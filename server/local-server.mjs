import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import {
  DEFAULT_SYSTEM_PROMPT,
  createCompanionStore,
} from "./companion-store.mjs";
import {
  buildImagePromptRequest,
  formatImagePromptResponse,
} from "../shared/image-prompt-context.js";
import { parseLooseJsonObject } from "../shared/loose-json.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
const publicPort = Number(process.env.PORT || 3000);
const applicationPort = Number(process.env.VINEXT_INTERNAL_PORT || 3001);
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_JOB_CONCURRENCY = 6;
const BACKUP_FORMAT = "night-mailbox-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 350 * 1024 * 1024;

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(projectDirectory, ".env.local"));
  } catch {}
}

const aiConfigFile = path.join(projectDirectory, "config", "ai-models.json");
function loadAiConfig() {
  try {
    const parsed = JSON.parse(readFileSync(aiConfigFile, "utf8"));
    const downstream = parsed?.downstream;
    if (!downstream || typeof downstream !== "object") throw new Error("downstream is missing");
    return downstream;
  } catch (error) {
    throw new Error(`无法读取 config/ai-models.json：${error instanceof Error ? error.message : error}`);
  }
}

function cleanModelList(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .filter((model) => typeof model === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(model)),
  )];
}

const aiConfig = loadAiConfig();
const downstreamBaseUrl = String(
  aiConfig.baseUrl || process.env.GROK_BASE_URL || process.env.IMAGE_BASE_URL || "",
).replace(/\/$/, "");
const configuredChatModels = cleanModelList(aiConfig.chat?.models);
const configuredImageModels = cleanModelList(aiConfig.image?.models);
const defaultChatModel = String(
  aiConfig.chat?.defaultModel || configuredChatModels[0] || process.env.GROK_MODEL || "grok-4",
);
const defaultImageModel = String(
  aiConfig.image?.defaultModel || configuredImageModels[0] || process.env.IMAGE_MODEL || "gpt-image-2",
);
const imageBaseUrl = String(
  aiConfig.image?.baseUrl || process.env.IMAGE_BASE_URL || "https://downstream.jbbtoken.cn/v1",
).replace(/\/$/, "");
const downstreamApiKey = process.env.DOWNSTREAM_API_KEY || process.env.GROK_API_KEY || "";
const downstreamImageApiKey = process.env.GPT_IMAGE_API_KEY
  || process.env.IMAGE_API_KEY
  || "";

process.env.GROK_BASE_URL = downstreamBaseUrl;
process.env.IMAGE_BASE_URL = imageBaseUrl;
process.env.GROK_MODEL = defaultChatModel;
process.env.IMAGE_MODEL = defaultImageModel;
if (downstreamApiKey) process.env.GROK_API_KEY = downstreamApiKey;
if (downstreamImageApiKey) process.env.IMAGE_API_KEY = downstreamImageApiKey;

const localProxyUrl = String(process.env.LOCAL_HTTP_PROXY || "http://127.0.0.1:7897").trim();
const localProxyAgent = localProxyUrl && localProxyUrl.toLowerCase() !== "direct"
  ? new ProxyAgent(localProxyUrl)
  : null;
function externalFetch(url, init = {}) {
  if (!localProxyAgent) return fetch(url, init);
  return undiciFetch(url, { ...init, dispatcher: localProxyAgent });
}

function promptModelConfig(body = {}) {
  const provider = body?.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const requestedModel = typeof body?.model === "string"
    && /^[a-zA-Z0-9._-]{2,100}$/.test(body.model)
    ? body.model
    : "";
  return {
    provider,
    apiKey: isGrok ? process.env.GROK_API_KEY : process.env.DEEPSEEK_API_KEY,
    baseUrl: String(
      isGrok
        ? process.env.GROK_BASE_URL || downstreamBaseUrl
        : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    ).replace(/\/$/, ""),
    model: isGrok
      ? requestedModel || process.env.GROK_MODEL || defaultChatModel
      : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    isGrok,
  };
}

async function callImagePromptModel(body, request, {
  temperature = 0.42,
  maxTokens = 1600,
} = {}) {
  const config = promptModelConfig(body);
  if (!config.apiKey) {
    throw new Error(`${config.provider === "grok" ? "Grok" : "DeepSeek"} 对话模型尚未配置`);
  }
  const upstream = await externalFetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      stream: false,
      temperature,
      max_tokens: maxTokens,
      ...(config.isGrok ? {} : {
        thinking: { type: "disabled" },
      }),
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`对话模型整理失败（${upstream.status}）：${detail.slice(0, 240)}`);
  }
  const result = await upstream.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length < 40) {
    throw new Error("对话模型没有返回有效的视觉提示词");
  }
  return content.trim();
}

const store = createCompanionStore(projectDirectory);
const vinextCli = path.join(projectDirectory, "node_modules", "vinext", "dist", "cli.js");
const serverLogFile = path.join(store.dataDirectory, "server.log");
const generatedImagesDirectory = path.join(store.dataDirectory, "generated-images");
const appUpdateHtmlFile = path.join(projectDirectory, "outputs", "night-mailbox-app-update.html");
const appUpdateBuildScript = path.join(projectDirectory, "scripts", "build-standalone-html.mjs");
const imageJobsFile = path.join(store.dataDirectory, "image-jobs.json");
const imageJobs = new Map();
const imageJobRequests = new Map();
let activeImageJobCount = 0;
let imageJobsPersistQueue = Promise.resolve();
let modelsCatalogCache = null;
let imageModelsCatalogCache = null;
let appUpdateBuildPromise = null;
mkdirSync(store.dataDirectory, { recursive: true });
const applicationLog = openSync(serverLogFile, "a");
const application = spawn(
  process.execPath,
  [vinextCli, "dev", "--hostname", "127.0.0.1", "--port", String(applicationPort)],
  {
    cwd: projectDirectory,
    env: {
      ...process.env,
      LOCAL_AI_BRIDGE_URL: `http://127.0.0.1:${publicPort}/api/_ai-bridge`,
      LOCAL_NODE_RUNTIME: "1",
    },
    stdio: ["ignore", applicationLog, applicationLog],
    windowsHide: true,
  },
);
closeSync(applicationLog);

function log(message) {
  appendFile(serverLogFile, `[${new Date().toISOString()}] ${message}\n`, "utf8").catch(() => {});
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function loadAppUpdatePackage() {
  const [html, metadata] = await Promise.all([
    readFile(appUpdateHtmlFile),
    stat(appUpdateHtmlFile),
  ]);
  const sha256 = createHash("sha256").update(html).digest("hex");
  return {
    html,
    manifest: {
      format: "night-mailbox-app-update",
      version: `${Math.floor(metadata.mtimeMs)}-${sha256.slice(0, 12)}`,
      sha256,
      byteSize: html.length,
      updatedAt: metadata.mtime.toISOString(),
      path: "/app-update/night-mailbox.html",
    },
  };
}

function rebuildAppUpdatePackage() {
  if (appUpdateBuildPromise) return appUpdateBuildPromise;
  appUpdateBuildPromise = new Promise((resolve, reject) => {
    const buildProcess = spawn(process.execPath, [appUpdateBuildScript], {
      cwd: projectDirectory,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorOutput = "";
    buildProcess.stderr.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-8000);
    });
    buildProcess.once("error", reject);
    buildProcess.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorOutput.trim() || `App update build exited with code ${code}`));
    });
  }).finally(() => {
    appUpdateBuildPromise = null;
  });
  return appUpdateBuildPromise;
}

async function handleAppUpdate(request, response, pathname) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (pathname === "/app-update/manifest.json") {
    try {
      await rebuildAppUpdatePackage();
    } catch (error) {
      sendJson(response, 500, {
        error: "App update package build failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  let updatePackage;
  try {
    updatePackage = await loadAppUpdatePackage();
  } catch {
    sendJson(response, 404, {
      error: "App update package is not built",
      hint: "Run npm run build:app-update on the computer first",
    });
    return;
  }

  if (pathname === "/app-update/manifest.json") {
    sendJson(response, 200, updatePackage.manifest);
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": updatePackage.html.length,
    "Content-Disposition": 'attachment; filename="night-mailbox.html"',
    "Cache-Control": "no-store",
    ETag: `"${updatePackage.manifest.sha256}"`,
    "Access-Control-Allow-Origin": "*",
  });
  response.end(updatePackage.html);
}

async function readBody(request, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleStorage(request, response) {
  if (request.method === "GET") {
    const requestUrl = new URL(request.url || "/api/storage", `http://${request.headers.host || "localhost"}`);
    const settingsOnly = requestUrl.searchParams.get("scope") === "settings";
    const settings = await store.loadSettings();
    const messages = settingsOnly ? null : await store.loadHistory();
    sendJson(response, 200, {
      ...settings,
      ...(settingsOnly ? {} : { messages }),
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      storage: "node-json-files",
    });
    return;
  }

  if (request.method !== "PUT") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readBody(request);
  if (body.action === "settings") {
    const settings = await store.saveSettings(body);
    sendJson(response, 200, { ok: true, settings });
    return;
  }
  if (body.action === "history") {
    const messages = await store.saveHistory(body.messages);
    sendJson(response, 200, { ok: true, count: messages.length });
    return;
  }
  if (body.action === "clear-history") {
    await store.saveHistory([]);
    sendJson(response, 200, { ok: true, count: 0 });
    return;
  }
  sendJson(response, 400, { error: "Unsupported storage action" });
}

function resolveRoleGender(role, fallback = "未指定") {
  const explicit = String(role?.gender || "").trim();
  if (["女性", "男性", "非二元"].includes(explicit)) return explicit;
  const clues = [
    role?.relation,
    role?.personality,
    role?.appearance,
    role?.prompt,
    role?.imagePrompt,
  ].filter(Boolean).join(" ");
  if (/(?:成年男性|男性|男人|男友|丈夫|老公|哥哥|弟弟|父亲|爸爸|男同事|男医生|男士)/.test(clues)) return "男性";
  if (/(?:成年女性|女性|女人|女友|妻子|老婆|姐姐|妹妹|母亲|妈妈|闺蜜|女士)/.test(clues)) return "女性";
  return fallback;
}

function renderSceneRole(role, kind, fallbackGender = "未指定") {
  const name = String(role?.name || "未命名角色").trim().slice(0, 20);
  const age = Math.min(80, Math.max(18, Number(role?.age) || 24));
  return [
    `${kind}｜${name}｜${age}岁｜性别：${resolveRoleGender(role, fallbackGender)}`,
    `关系：${String(role?.relation || "成年角色").trim().slice(0, 100)}`,
    `气质：${String(role?.personality || "自然鲜明").trim().slice(0, 100)}`,
    `稳定外观：${String(role?.appearance || "未明确，以最近对话中的既有描述为准").trim().slice(0, 500)}`,
  ].join("；");
}

function buildSceneRewriteRequest(body) {
  const profile = body?.profile || {};
  const ensemble = body?.ensemble || {};
  const name = String(profile.name || "晚晚").trim().slice(0, 20);
  const roleRoster = [
    renderSceneRole(profile, "主角色", "女性"),
    ...(ensemble?.enabled === false
      ? []
      : [
          renderSceneRole(ensemble?.friend || {}, "固定角色", "女性"),
          ...(Array.isArray(ensemble?.customRoles)
            ? ensemble.customRoles.slice(0, 30).map((role) => renderSceneRole(role, "固定角色"))
            : []),
          ...(Array.isArray(ensemble?.temporaryRoles)
            ? ensemble.temporaryRoles.slice(0, 80).map((role) => renderSceneRole(role, "临时角色"))
            : []),
        ]),
  ].join("\n");
  const context = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((message) =>
      message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    )
    .slice(-10)
    .map((message) => `${message.role === "assistant" ? String(message.speaker || name).trim().slice(0, 20) : "用户"}：${message.content.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 6500);
  const storySummary = typeof body?.storySummary === "string"
    ? body.storySummary.trim().slice(0, 4000)
    : "";

  return {
    system: `你是电影分镜师、人物连续性编辑和成年时装摄影提示词导演。根据角色名册与最近剧情还原最后一个连贯瞬间，生成具体、可拍摄且有视觉张力的画面方案。

角色名册是人物姓名、年龄、性别和稳定外观的最高依据。不得把男性写成女性，也不得因为示例、服装或场景模板改变角色性别。只选择最近对话中实际在场、正在行动或明确被镜头捕捉的人物，不把名册中的其他人强行塞进画面。用户没有外观资料时，不擅自补成某个固定角色。

画面张力来自姿态重心、人物距离、视线、手部动作、衣料褶皱与受光、天气、空间层次和镜头调度。服装必须符合人物身份、世界和当前事件，不默认套用白色雪纺或固定身材。只有剧情真的出现下雨、漏水、落水等事件时，才表现湿发、水珠、衣料颜色加深、贴合和反光等真实状态，不凭空制造“意外打湿”。

缺失细节可以按现实逻辑补全，但不能推翻已知事实。人物正面或正面三分之二角度，面部、视线、完整姿态和双手清楚可见。返回严格 JSON：
{"scene":"地点、时间、天气、事件和空间基调","cast":"逐一写姓名、成年年龄、性别、位置与画面范围","appearance":"逐一写稳定外观、发型、体态与显著特征","wardrobe":"逐一写符合剧情的服装结构、材质、颜色、干湿状态、褶皱与受光","pose":"主体朝向、重心、身体姿态与四肢位置","interaction":"人物距离、接触方式、双手、道具和因果关系","expression":"逐一写表情、视线方向和可见情绪","environment":"前中后景、家具、物品、天气痕迹与空气细节","lighting":"主辅光源、方向、色温、高光、阴影和色彩","camera":"正面或正面三分之二视角、景别、机位、焦段感、景深和9:16构图"}`,
    user: `永久角色名册：
${roleRoster}

请根据下面的素材还原“最后一个连贯瞬间”。优先保证地点、人物身份与性别、服装、姿势和动作准确；缺失的画面信息请按现实逻辑主动补全。不要复述素材文字，只返回规定的 JSON：

长期剧情摘要：
${storySummary || "暂无。"}

最近对话：
${context || `${name}在当前世界中的日常空间里，等待剧情继续。`}`,
  };
}

function normalizeImagePromptLanguage(value) {
  return String(value || "")
    .replace(/全透|纯透明|完全透明|透视装/g, "轻薄叠层面料、搭配完整内层")
    .replace(/一丝不挂|全裸|裸体|半裸/g, "清凉的成年时装造型")
    .replace(/乳头|阴蒂|阴茎|阴道|生殖器|精液|体液|插入|口交|性交/g, "含蓄的亲密氛围")
    .replace(/\s+/g, " ")
    .trim();
}

function parseScenePlan(content) {
  const parsed = parseLooseJsonObject(
    content,
    (value) => typeof value?.scene === "string",
  );
  if (!parsed) throw new Error("对话模型返回的场景结构无法解析");
  const fields = [
    ["scene", "场景与空间"],
    ["cast", "画面人物"],
    ["appearance", "外观特征"],
    ["wardrobe", "服装造型"],
    ["pose", "定格姿势"],
    ["interaction", "动作互动"],
    ["expression", "表情视线"],
    ["environment", "环境细节"],
    ["lighting", "灯光色彩"],
    ["camera", "镜头构图"],
  ];
  const parts = fields
    .map(([key, label]) => {
      if (typeof parsed?.[key] !== "string") return "";
      const value = normalizeImagePromptLanguage(parsed[key])
        .replace(/[\r\n]+/g, " ")
        .replace(/[“”"'`]/g, "")
        .replace(/【[^】]{0,20}】/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 150);
      return value ? `${label}：${value}` : "";
    })
    .filter(Boolean);
  if (parts.length < 7) throw new Error("对话模型返回的场景细节不足");
  return parts.join("。");
}

async function rewriteScenePrompt(body) {
  const request = buildImagePromptRequest(body, "scene");
  const content = await callImagePromptModel(body, request, {
    temperature: 0.38,
    maxTokens: 1800,
  });
  const visualPlan = normalizeImagePromptLanguage(
    formatImagePromptResponse(content, "scene"),
  );
  const style = String(body?.style || "").trim().slice(0, 200);
  return `${visualPlan.trim().slice(0, 1120)}

人物正面或正面三分之二角度，面部与眼神清晰可见。竖版 9:16，${style ? `${style}风格` : "自然写实电影摄影"}，手部结构与人体比例自然。`;
}

async function rewriteCharacterPrompt(body) {
  const role = body?.role || {};
  const request = buildImagePromptRequest(body, "character");
  const content = await callImagePromptModel(body, request, {
    temperature: 0.38,
    maxTokens: 1800,
  });
  if (typeof content !== "string" || content.trim().length < 80) {
    throw new Error("对话模型没有返回有效的角色形象提示词");
  }
  return normalizeImagePromptLanguage(
    formatImagePromptResponse(content, "character", request),
  )
    .slice(0, 1100);
}

async function generateRoleProfile(body) {
  const provider = body?.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const apiKey = isGrok ? process.env.GROK_API_KEY : process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error(`${isGrok ? "Grok" : "DeepSeek"} 尚未配置`);
  const baseUrl = (
    isGrok
      ? process.env.GROK_BASE_URL || process.env.IMAGE_BASE_URL || "https://downstream.jbbtoken.cn/v1"
      : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const role = body?.role || {};
  const name = String(role.name || "临时角色").trim().slice(0, 20);
  const gender = resolveRoleGender(role);
  const requestedModel = typeof body?.model === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(body.model)
    ? body.model
    : "";
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((message) =>
      message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    )
    .slice(-30)
    .map((message) => `${message.role === "user" ? "用户" : message.speaker || "角色"}：${message.content.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 12000);
  const requestBody = {
    model: isGrok
      ? requestedModel || process.env.GROK_MODEL || "gpt-5.6-luna"
      : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `你是互动剧情的角色设计师。根据“${name}”参与过的对话，整理并丰富一份可长期使用的人物档案。

提取该角色已经表现出的性别、身份、关系、说话方式、欲望、价值取向、情绪习惯、主动行为、与其他人物的互动方式和外观。缺少的部分可以发挥想象自然补全，让角色更鲜明、更有主动性，同时延续已经发生的剧情。不得因为示例或其他角色而改变其性别。

prompt 写成一段直接用于角色扮演的创作说明，集中描述角色是谁、如何说话、想要什么、如何行动和推动剧情。返回 JSON：
{"name":"角色名","age":24,"gender":"女性、男性、非二元或未指定","personality":"40-100字性格概括","relation":"与用户和主要角色的关系","prompt":"200-800字角色行为提示词","appearance":"80-300字稳定外观设定"}`,
      },
      {
        role: "user",
        content: `当前可编辑资料：
姓名：${name}
年龄：${Math.min(80, Math.max(18, Number(role.age) || 24))}
性别：${gender}
性格：${String(role.personality || "").slice(0, 200)}
关系：${String(role.relation || "").slice(0, 200)}
现有行为提示词：${String(role.prompt || "").slice(0, 2000)}
现有外观：${String(role.appearance || "").slice(0, 2000)}

长期剧情摘要：
${String(body?.storySummary || "暂无").slice(0, 5000)}

世界设定：
${String(body?.worldSetting || "暂无").slice(0, 4000)}

该角色长期记忆：
${String(JSON.stringify(body?.roleMemory || {})).slice(0, 4000)}

与该角色相关的最近对话：
${messages || "暂无有效对话；请只根据当前资料生成保守、稳定的设定。"}`,
      },
    ],
    stream: false,
    temperature: 0.45,
    max_tokens: 1800,
    ...(isGrok ? {} : { thinking: { type: "disabled" } }),
  };
  const upstream = await externalFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000),
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`角色设定生成失败（${upstream.status}）：${detail.slice(0, 240)}`);
  }
  const result = await upstream.json();
  const parsed = parseLooseJsonObject(
    result?.choices?.[0]?.message?.content,
    (value) => typeof value?.prompt === "string",
  );
  if (!parsed || typeof parsed.prompt !== "string" || parsed.prompt.trim().length < 60) {
    throw new Error("模型没有返回有效的角色设定");
  }
  return {
    name: String(parsed.name || name).trim().slice(0, 20) || name,
    age: Math.min(80, Math.max(18, Number(parsed.age) || 24)),
    gender: ["女性", "男性", "非二元", "未指定"].includes(parsed.gender)
      ? parsed.gender
      : gender,
    personality: String(parsed.personality || role.personality || "自然、友善").trim().slice(0, 80),
    relation: String(parsed.relation || role.relation || "场景中认识的成年角色").trim().slice(0, 80),
    prompt: parsed.prompt.trim().slice(0, 2000),
    appearance: String(parsed.appearance || role.appearance || "").trim().slice(0, 2000),
  };
}

async function handleRoleProfile(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const body = await readBody(request);
    const role = await generateRoleProfile(body);
    sendJson(response, 200, { role, provider: body?.provider === "grok" ? "grok" : "deepseek" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "角色设定生成失败";
    log(`Role profile generation failed: ${detail}`);
    sendJson(response, 502, { error: "角色设定生成失败", detail });
  }
}

function isChatModelId(value) {
  return typeof value === "string"
    && /^[a-zA-Z0-9._-]{2,100}$/.test(value)
    && !/(?:image|imagine|flux|dall|review)/i.test(value);
}

function isImageModelId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{2,100}$/.test(value)) return false;
  const patterns = Array.isArray(aiConfig.image?.includePatterns)
    ? aiConfig.image.includePatterns
    : [];
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  }) || /(?:image|imagine|flux|dall)/i.test(value);
}

async function loadUpstreamModelCatalog() {
  if (modelsCatalogCache && Date.now() - modelsCatalogCache.updatedAt < 5 * 60 * 1000) {
    return modelsCatalogCache.value;
  }
  const value = {
    ids: [],
    discoveryError: "",
    authConfigured: Boolean(downstreamApiKey),
    updatedAt: new Date().toISOString(),
  };
  if (aiConfig.discoverModels !== false && downstreamApiKey) {
    try {
      const upstream = await externalFetch(`${downstreamBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${downstreamApiKey}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        throw new Error(`模型列表请求失败（${upstream.status}）：${detail.slice(0, 200)}`);
      }
      const result = await upstream.json();
      value.ids = cleanModelList(
        (Array.isArray(result?.data) ? result.data : []).map((item) => item?.id),
      );
    } catch (error) {
      value.discoveryError = error instanceof Error ? error.message : "fetch failed";
      log(`Model catalog discovery failed: ${value.discoveryError}`);
    }
  } else if (!downstreamApiKey) {
    value.discoveryError = "DOWNSTREAM_API_KEY 尚未配置";
  }
  modelsCatalogCache = { updatedAt: Date.now(), value };
  return value;
}

async function loadUpstreamImageModelCatalog() {
  if (imageModelsCatalogCache && Date.now() - imageModelsCatalogCache.updatedAt < 5 * 60 * 1000) {
    return imageModelsCatalogCache.value;
  }
  const value = {
    ids: [],
    discoveryError: "",
    authConfigured: Boolean(downstreamImageApiKey),
    updatedAt: new Date().toISOString(),
  };
  if (downstreamImageApiKey) {
    try {
      const upstream = await externalFetch(`${imageBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${downstreamImageApiKey}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        throw new Error(`图片模型列表请求失败（${upstream.status}）：${detail.slice(0, 200)}`);
      }
      const result = await upstream.json();
      value.ids = cleanModelList(
        (Array.isArray(result?.data) ? result.data : []).map((item) => item?.id),
      );
    } catch (error) {
      value.discoveryError = error instanceof Error ? error.message : "fetch failed";
      log(`Image model catalog discovery failed: ${value.discoveryError}`);
    }
  } else {
    value.discoveryError = "图片 API Key 尚未配置";
  }
  imageModelsCatalogCache = { updatedAt: Date.now(), value };
  return value;
}

async function handleChatModels(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  const catalog = await loadUpstreamModelCatalog();
  const models = [...new Set([
    ...configuredChatModels,
    ...catalog.ids.filter(isChatModelId),
  ])];
  sendJson(response, 200, {
    models,
    defaultModel: models.includes(defaultChatModel) ? defaultChatModel : models[0] || defaultChatModel,
    baseUrl: downstreamBaseUrl,
    source: catalog.ids.length ? "api+config" : "config",
    discoveryError: catalog.discoveryError,
    authConfigured: catalog.authConfigured,
    updatedAt: catalog.updatedAt,
  });
}

async function handleImageModels(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  const catalog = await loadUpstreamImageModelCatalog();
  const discovered = catalog.ids.filter(isImageModelId);
  const models = [...new Set([
    ...configuredImageModels,
    ...discovered,
  ])];
  sendJson(response, 200, {
    models,
    defaultModel: models.includes(defaultImageModel) ? defaultImageModel : models[0] || defaultImageModel,
    baseUrl: imageBaseUrl,
    source: discovered.length ? "api+config" : "config",
    discoveryError: catalog.discoveryError,
    authConfigured: catalog.authConfigured,
    updatedAt: catalog.updatedAt,
  });
}

function buildLocalCharacterPrompt(body) {
  const role = body?.role || {};
  const age = Math.min(9999, Math.max(0, Number(role.age) || 24));
  const gender = resolveRoleGender(role);
  const personality = String(role.personality || "自然、友善").trim().slice(0, 100);
  const relation = String(role.relation || "成年朋友").trim().slice(0, 100);
  const appearance = String(role.appearance || "").trim().slice(0, 1000);
  const roleId = String(body?.roleId || role.id || "").trim();
  const memory = body?.roleMemories?.[roleId] || {};
  const memoryText = [
    memory.stableIdentity,
    memory.relationshipMemory,
    memory.currentStatus,
    memory.lastKnownScene,
  ].filter(Boolean).join("；").slice(0, 1200);
  const latest = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((message) => message && typeof message.content === "string" && message.content.trim())
    .slice(-3)
    .map((message) => message.content.replace(/\s+/g, " ").slice(0, 260))
    .join("；");
  return normalizeImagePromptLanguage(`整体：目标人物，资料年龄${age}岁，${gender === "未指定" ? "性别未指定" : gender}，与用户关系为${relation}，气质为${personality}；实际年龄与外表年龄不一致时，以稳定外观明确写出的年龄观感为准。面容五官与稳定外观：${appearance || "根据角色自己的身份设计自然可信的面容、眼睛、体态和标志特征，不混入其他人物外观"}。人物连续性：${memoryText || "保持现有人物身份、关系和标志物"}。服装与标志物：完整落实稳定外观中的基础服装、发饰、首饰与随身物，再根据当前事件补充材质、褶皱、临时状态和受光。姿态与表情：依据当前剧情“${latest || "角色处于自己的日常空间"}”定格一个动作，面部、眼神、发型、标志配饰和双手清晰可见，不照抄对白。场景：${String(body?.worldSetting || body?.storySummary || "沿用人物所属世界与最近剧情").replace(/\s+/g, " ").slice(0, 420)}。构图：正面或正面三分之二角度，全身或膝上肖像，人物为画面绝对主体，环境和能力效果不超过画面信息的五分之一，低畸变人像镜头，浅景深，9:16竖图，自然写实电影摄影。`)
    .slice(0, 1100);
}

function imageError(message, statusCode = 502, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function resolveImageModel(body) {
  const candidate = typeof body?.imageModel === "string" ? body.imageModel : body?.model;
  const requestedModel = typeof candidate === "string" && isImageModelId(candidate)
    ? candidate
    : "";
  return requestedModel || defaultImageModel;
}

function resolveImageSize() {
  const candidate = String(aiConfig.image?.portraitSize || "1024x1536").trim();
  return /^(?:1024x1024|1536x1024|1024x1536|1k|2k)$/.test(candidate)
    ? candidate
    : "1024x1536";
}

function validateImageRequest(body) {
  const configuredImageModel = resolveImageModel(body);
  const imageApiKey = downstreamImageApiKey || process.env.OPENAI_API_KEY;
  if (!imageApiKey) {
    throw imageError("图片接口尚未配置 DOWNSTREAM_API_KEY", 503, "IMAGE_API_KEY_MISSING");
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 40) {
    throw imageError("请先整理并确认有效的图片提示词", 400, "IMAGE_PROMPT_INVALID");
  }
  return { configuredImageModel, imageApiKey, prompt };
}

async function generateImageFile(body) {
  const { configuredImageModel, imageApiKey, prompt } = validateImageRequest(body);
  const model = configuredImageModel;
  const quality = "standard";
  const imageKind = body.kind === "character" ? "character" : "scene";
  const isGrokImage = /^grok-/i.test(model);
  const size = resolveImageSize();
  const imageRequestBody = isGrokImage
    ? {
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }
    : {
        model,
        prompt,
        n: 1,
        size,
        quality,
        response_format: "url",
        output_format: "png",
      };
  const imageEndpoint = String(aiConfig.image?.endpoint || "/images/generations");
  const upstream = await externalFetch(`${imageBaseUrl}${imageEndpoint.startsWith("/") ? imageEndpoint : `/${imageEndpoint}`}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${imageApiKey}`,
    },
    body: JSON.stringify(imageRequestBody),
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    log(`OpenAI image request failed (${upstream.status}): ${detail.slice(0, 500)}`);
    throw imageError(`图片生成失败：${detail.slice(0, 500)}`, upstream.status || 502, "IMAGE_UPSTREAM_FAILED");
  }

  const result = await upstream.json();
  const imageBase64 = result?.data?.[0]?.b64_json;
  const temporaryImageUrl = result?.data?.[0]?.url;
  let imageBuffer;
  let extension = "jpg";
  if (imageBase64) {
    imageBuffer = Buffer.from(imageBase64, "base64");
    extension = imageBuffer.length >= 8
      && imageBuffer[0] === 0x89
      && imageBuffer[1] === 0x50
      && imageBuffer[2] === 0x4e
      && imageBuffer[3] === 0x47
      ? "png"
      : imageBuffer.length >= 12
        && imageBuffer.toString("ascii", 0, 4) === "RIFF"
        && imageBuffer.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : "jpg";
  } else if (typeof temporaryImageUrl === "string" && /^https:\/\//i.test(temporaryImageUrl)) {
    const imageResponse = await externalFetch(temporaryImageUrl, {
      signal: AbortSignal.timeout(120000),
    });
    if (!imageResponse.ok) {
      log(`Generated image download failed (${imageResponse.status})`);
      throw imageError("图片已经生成，但临时图片下载失败", 502, "IMAGE_DOWNLOAD_FAILED");
    }
    const contentType = imageResponse.headers.get("content-type") || "";
    extension = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";
    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (imageBuffer.length > 25 * 1024 * 1024) {
      throw imageError("生成图片超过本地保存大小限制", 502, "IMAGE_TOO_LARGE");
    }
  }
  if (!imageBuffer?.length) {
    log("OpenAI image request returned no image data");
    throw imageError("图片接口没有返回图片数据", 502, "IMAGE_EMPTY");
  }

  await mkdir(generatedImagesDirectory, { recursive: true });
  const filename = `${imageKind}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  await writeFile(path.join(generatedImagesDirectory, filename), imageBuffer);
  log(`Generated ${imageKind} image ${filename} with ${model}/${quality}/${size}`);
  return {
    imageUrl: `/generated-images/${filename}`,
    model,
    quality,
    size,
  };
}

async function generateImageWithRetry(body, onAttempt = null) {
  const prompt = String(body?.prompt || "").trim().slice(0, 1200);
  if (onAttempt) await onAttempt({ attempt: 1, maxAttempts: 1, prompt, rewritten: false });
  const result = await generateImageFile({ ...body, prompt });
  return { ...result, prompt, attempt: 1, maxAttempts: 1, rewritten: false };
}

function persistImageJobs() {
  imageJobsPersistQueue = imageJobsPersistQueue
    .catch(() => {})
    .then(async () => {
      const sortedJobs = Array.from(imageJobs.values())
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      const jobs = [
        ...sortedJobs.filter((job) => job.status === "queued" || job.status === "running"),
        ...sortedJobs.filter((job) => job.status === "completed").slice(0, 240),
        ...sortedJobs.filter((job) => job.status === "failed").slice(0, 40),
      ]
        .filter((job, index, values) => values.findIndex((item) => item.id === job.id) === index)
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      await writeFile(imageJobsFile, `${JSON.stringify({ jobs }, null, 2)}\n`, "utf8");
    });
  return imageJobsPersistQueue;
}

function normalizeImageArchive(value, kind, fallbackName = "") {
  const input = value && typeof value === "object" ? value : {};
  const text = (candidate, limit) => typeof candidate === "string"
    ? candidate.replace(/\r/g, "").trim().slice(0, limit)
    : "";
  if (kind === "character" || kind === "visual-state") {
    return {
      type: "character",
      title: text(input.title, 80) || fallbackName || "人物形象",
      characterId: text(input.characterId, 80),
      name: text(input.name, 40) || fallbackName || "人物",
      age: Math.min(80, Math.max(18, Number(input.age) || 24)),
      gender: ["女性", "男性", "非二元", "未指定"].includes(input.gender)
        ? input.gender
        : "未指定",
      relation: text(input.relation, 160),
      personality: text(input.personality, 400),
      introduction: text(input.introduction, 2400),
      appearance: text(input.appearance, 2400),
      capturedAt: text(input.capturedAt, 40) || new Date().toISOString(),
      summaryGenerated: input.summaryGenerated === true,
      summaryModel: text(input.summaryModel, 100),
      summaryError: text(input.summaryError, 500),
    };
  }
  return {
    type: "scene",
    title: text(input.title, 120) || fallbackName || "剧情场景",
    scene: text(input.scene, 800),
    eventSummary: text(input.eventSummary, 3000),
    contextSnapshot: text(input.contextSnapshot, 8000),
    participants: Array.isArray(input.participants)
      ? input.participants.map((name) => text(name, 40)).filter(Boolean).slice(0, 20)
      : [],
    capturedAt: text(input.capturedAt, 40) || new Date().toISOString(),
    summaryGenerated: input.summaryGenerated === true,
    summaryModel: text(input.summaryModel, 100),
    summaryError: text(input.summaryError, 500),
  };
}

async function generateImageArchiveSummary(body, archive) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("对话模型未配置，无法生成图片档案摘要");
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const isCharacter = body.kind === "character";
  const system = isCharacter
    ? `你是互动故事的人物档案编辑。根据人物当前资料，为这一次人物形象生成一份独立、长期保存的介绍。缺失细节可以结合已有设定自然补全，但不要改变姓名、成年年龄、性别、核心关系和稳定身份。

返回 JSON：{"title":"简洁相册标题","personality":"80-240字性格与行为特点","introduction":"240-800字人物介绍，包含身份、关系、说话与行动风格、当前剧情位置","appearance":"120-500字稳定外观与这次形象特征"}。只输出 JSON。`
    : `你是互动故事的剧情档案编辑。根据生成图片时保留的对话快照和图片提示词，整理一份独立、长期保存的场景事件摘要。准确记录时间地点、在场人物、事件起因、正在发生的动作和已经推动到哪一步；不要只复述图片提示词。

返回 JSON：{"title":"20-60字相册标题","scene":"80-300字时间、地点与氛围","eventSummary":"240-900字完整事件摘要","participants":["在场人物"]}。只输出 JSON。`;
  const material = isCharacter
    ? `人物姓名：${archive.name}
年龄：${archive.age}
性别：${archive.gender || "未指定"}
关系：${archive.relation || "未填写"}
性格资料：${archive.personality || "未填写"}
人物行为设定：${archive.introduction || "未填写"}
稳定外观：${archive.appearance || "未填写"}
本次图片提示词：${String(body.prompt || "").slice(0, 1200)}`
    : `初始标题：${archive.title}
场景线索：${archive.scene || "未填写"}
初始事件摘录：${archive.eventSummary || "未填写"}
在场人物：${archive.participants?.join("、") || "未填写"}
生成时对话快照：
${archive.contextSnapshot || "未填写"}

本次图片提示词：
${String(body.prompt || "").slice(0, 1200)}`;
  const upstream = await externalFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: material.slice(0, 12000) },
      ],
      stream: false,
      temperature: 0.4,
      max_tokens: 1400,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`图片档案摘要生成失败（${upstream.status}）：${detail.slice(0, 240)}`);
  }
  const result = await upstream.json();
  const parsed = parseLooseJsonObject(
    result?.choices?.[0]?.message?.content,
    (value) => isCharacter
      ? typeof value?.introduction === "string"
      : typeof value?.eventSummary === "string",
  );
  if (!parsed || typeof parsed !== "object") throw new Error("对话模型没有返回有效的图片档案摘要");
  const merged = isCharacter
    ? {
        ...archive,
        title: parsed.title || archive.title,
        personality: parsed.personality || archive.personality,
        introduction: parsed.introduction || archive.introduction,
        appearance: parsed.appearance || archive.appearance,
      }
    : {
        ...archive,
        title: parsed.title || archive.title,
        scene: parsed.scene || archive.scene,
        eventSummary: parsed.eventSummary || archive.eventSummary,
        participants: Array.isArray(parsed.participants) ? parsed.participants : archive.participants,
      };
  return {
    ...normalizeImageArchive(merged, body.kind, body.targetName),
    summaryGenerated: true,
    summaryModel: model,
    summaryError: "",
  };
}

async function restoreImageJobs() {
  try {
    const stored = JSON.parse(await readFile(imageJobsFile, "utf8"));
    for (const job of Array.isArray(stored?.jobs) ? stored.jobs : []) {
      if (!job?.id) continue;
      job.kind = ["character", "visual-state", "scene", "stage-background"].includes(job.kind)
        ? job.kind
        : "scene";
      job.archive = normalizeImageArchive(job.archive, job.kind, job.targetName);
      if (job.status === "queued" || job.status === "running") {
        job.status = "failed";
        job.error = "服务曾在生成过程中重启，无法确认上游任务状态，请重新生成";
        job.updatedAt = new Date().toISOString();
      }
      imageJobs.set(job.id, job);
    }
    await persistImageJobs();
  } catch {}
}

async function saveCharacterJobResult(targetId, imageUrl, prompt) {
  if (!targetId) return;
  const settings = await store.loadSettings();
  if (targetId === "primary") {
    settings.profile = {
      ...settings.profile,
      avatarUrl: imageUrl,
      imagePrompt: prompt,
    };
  } else if (targetId === "friend") {
    settings.ensemble.friend = {
      ...settings.ensemble.friend,
      avatarUrl: imageUrl,
      imagePrompt: prompt,
    };
  } else {
    const roleIndex = settings.ensemble.customRoles.findIndex((role) => role.id === targetId);
    if (roleIndex >= 0) {
      settings.ensemble.customRoles[roleIndex] = {
        ...settings.ensemble.customRoles[roleIndex],
        avatarUrl: imageUrl,
        imagePrompt: prompt,
      };
    } else {
      const temporaryIndex = settings.ensemble.temporaryRoles.findIndex((role) => role.id === targetId);
      if (temporaryIndex < 0) throw imageError("目标角色已经不存在，图片已生成但无法设为头像", 409, "ROLE_NOT_FOUND");
      settings.ensemble.temporaryRoles[temporaryIndex] = {
        ...settings.ensemble.temporaryRoles[temporaryIndex],
        avatarUrl: imageUrl,
        imagePrompt: prompt,
      };
    }
  }
  await store.saveSettings(settings);
}

async function runImageJob(jobId, body) {
  const job = imageJobs.get(jobId);
  if (!job) return;
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  await persistImageJobs().catch(() => {});
  try {
    job.statusMessage = body.kind === "character" ? "正在由模型整理人物档案" : "正在由模型整理剧情档案";
    job.updatedAt = new Date().toISOString();
    await persistImageJobs().catch(() => {});
    try {
      job.archive = await generateImageArchiveSummary(body, job.archive);
    } catch (summaryError) {
      job.archive = {
        ...job.archive,
        summaryGenerated: false,
        summaryError: summaryError instanceof Error ? summaryError.message.slice(0, 500) : "图片档案摘要生成失败",
      };
      log(`Image archive summary ${jobId} failed: ${job.archive.summaryError}`);
    }
    job.updatedAt = new Date().toISOString();
    await persistImageJobs().catch(() => {});
    const result = await generateImageWithRetry(body, async ({ attempt, maxAttempts, prompt, rewritten }) => {
      Object.assign(job, {
        attempt,
        maxAttempts,
        prompt,
        rewritten,
        statusMessage: attempt === 1
          ? "正在调用图片模型"
          : `提示词已自动调整，正在进行第 ${attempt}/${maxAttempts} 次调用`,
        updatedAt: new Date().toISOString(),
      });
      await persistImageJobs().catch(() => {});
    });
    if (body.kind === "character") {
      await saveCharacterJobResult(body.targetId, result.imageUrl, result.prompt);
    }
    Object.assign(job, result, {
      status: "completed",
      statusMessage: result.rewritten ? "调整提示词后生成成功" : "生成成功",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "图片生成失败";
    job.code = error?.code || "IMAGE_JOB_FAILED";
    job.statusMessage = "生成失败，未自动重试，请查看错误详情";
    job.updatedAt = new Date().toISOString();
    log(`Image job ${jobId} failed: ${job.error}`);
  }
  await persistImageJobs().catch(() => {});
}

function scheduleImageJobQueue() {
  while (activeImageJobCount < IMAGE_JOB_CONCURRENCY) {
    const nextJob = Array.from(imageJobs.values())
      .filter((job) => job.status === "queued" && imageJobRequests.has(job.id))
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];
    if (!nextJob) break;
    const requestBody = imageJobRequests.get(nextJob.id);
    activeImageJobCount += 1;
    void runImageJob(nextJob.id, requestBody)
      .catch((error) => {
        log(`Image job ${nextJob.id} worker failed unexpectedly: ${error instanceof Error ? error.message : error}`);
      })
      .finally(() => {
        imageJobRequests.delete(nextJob.id);
        activeImageJobCount = Math.max(0, activeImageJobCount - 1);
        scheduleImageJobQueue();
      });
  }
}

function publicImageJob(job) {
  if (!job) return null;
  const {
    id, kind, targetId, targetName, visualStateId, status, createdAt, updatedAt, imageUrl, model,
    quality, size, error, code, attempt, maxAttempts, prompt, rewritten, statusMessage, archive,
  } = job;
  return {
    id, kind, targetId, targetName, visualStateId, status, createdAt, updatedAt, imageUrl, model,
    quality, size, error, code, attempt, maxAttempts, prompt, rewritten, statusMessage, archive,
  };
}

async function deleteGeneratedImageFile(imageUrl) {
  if (!/^\/generated-images\//.test(String(imageUrl || ""))) return false;
  const filename = path.basename(decodeURIComponent(String(imageUrl)));
  if (!/^(?:scene|character|visual-state|stage-background)-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/i.test(filename)) {
    return false;
  }
  const target = path.resolve(generatedImagesDirectory, filename);
  if (path.dirname(target) !== path.resolve(generatedImagesDirectory)) return false;
  try {
    await unlink(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function clearDeletedImageReferences({ jobId = "", imageUrl = "", targetId = "", visualStateId = "" }) {
  if (!jobId && !imageUrl && !targetId) return;
  const settings = await store.loadSettings();
  const roles = [
    { id: "primary", role: settings.profile },
    { id: "friend", role: settings.ensemble?.friend },
    ...(settings.ensemble?.customRoles || []).map((role) => ({ id: role.id, role })),
    ...(settings.ensemble?.temporaryRoles || []).map((role) => ({ id: role.id, role })),
  ];
  let changed = false;
  for (const record of roles) {
    const role = record.role;
    if (!role || (targetId && record.id !== targetId)) continue;
    if (imageUrl && role.avatarUrl === imageUrl) {
      const fallback = Array.from(imageJobs.values())
        .filter((item) =>
          item.status === "completed"
          && item.kind === "character"
          && item.targetId === record.id
          && item.imageUrl
          && item.imageUrl !== imageUrl
        )
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
      role.avatarUrl = fallback?.imageUrl || "";
      changed = true;
    }
    if (
      (jobId && role.visualBaseImageJobId === jobId)
      || (imageUrl && role.visualBaseImageUrl === imageUrl)
    ) {
      role.visualBaseImageJobId = "";
      role.visualBaseImageUrl = "";
      role.visualBaseSource = "";
      changed = true;
    }
    for (const state of Array.isArray(role.visualStates) ? role.visualStates : []) {
      if (
        (visualStateId && state.id === visualStateId)
        || (jobId && state.imageJobId === jobId)
        || (imageUrl && state.imageUrl === imageUrl)
      ) {
        state.imageJobId = "";
        state.imageUrl = "";
        changed = true;
      }
    }
  }
  if (changed) await store.saveSettings(settings);
}

function parseBackupDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/);
  return match ? { mimeType: match[1], dataBase64: match[2].replace(/\s+/g, "") } : null;
}

function backupAssetCategory(pathParts, root) {
  if (pathParts[0] === "messages") return "scene";
  if (pathParts[0] === "imageJobs") {
    const job = root.imageJobs?.[Number(pathParts[1])];
    return job?.kind === "character" || job?.kind === "visual-state" ? "character" : "scene";
  }
  return pathParts.includes("stageBackground") ? "scene" : "character";
}

async function packNodeBackupContent(root) {
  const assets = [];
  const cache = new Map();
  async function visit(value, pathParts = []) {
    if (typeof value === "string") {
      if (cache.has(value)) return cache.get(value);
      let parts = parseBackupDataUrl(value);
      let filename = "";
      if (!parts && /^\/generated-images\//.test(value)) {
        const candidate = path.basename(decodeURIComponent(value));
        if (/^(?:scene|character)-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/i.test(candidate)) {
          try {
            const buffer = await readFile(path.join(generatedImagesDirectory, candidate));
            const extension = path.extname(candidate).toLowerCase();
            parts = {
              mimeType: extension === ".png"
                ? "image/png"
                : extension === ".webp"
                  ? "image/webp"
                  : "image/jpeg",
              dataBase64: buffer.toString("base64"),
            };
            filename = candidate;
          } catch {}
        }
      }
      if (!parts) return value;
      const extension = parts.mimeType === "image/jpeg" ? "jpg" : parts.mimeType.split("/")[1];
      const id = `asset-${assets.length + 1}`;
      const reference = `backup-asset://${id}`;
      assets.push({
        id,
        category: backupAssetCategory(pathParts, root),
        filename: filename || `${id}.${extension}`,
        mimeType: parts.mimeType,
        dataBase64: parts.dataBase64,
      });
      cache.set(value, reference);
      return reference;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        result.push(await visit(value[index], [...pathParts, String(index)]));
      }
      return result;
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = await visit(item, [...pathParts, key]);
      }
      return result;
    }
    return value;
  }
  return { content: await visit(root), assets };
}

async function restoreNodeBackupContent(backup) {
  const assets = Array.isArray(backup.assets) ? backup.assets.slice(0, 400) : [];
  const assetMap = new Map();
  let totalBytes = 0;
  await mkdir(generatedImagesDirectory, { recursive: true });
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (
      !asset
      || typeof asset.id !== "string"
      || !/^image\/(?:png|jpeg|webp|gif)$/.test(asset.mimeType)
      || typeof asset.dataBase64 !== "string"
    ) continue;
    const buffer = Buffer.from(asset.dataBase64.replace(/\s+/g, ""), "base64");
    totalBytes += buffer.length;
    if (!buffer.length || buffer.length > 30 * 1024 * 1024 || totalBytes > 320 * 1024 * 1024) {
      throw new Error("备份图片数据超过安全导入限制");
    }
    const extension = asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType.split("/")[1];
    const category = asset.category === "scene" ? "scene" : "character";
    const filename = `${category}-${Date.now() + index}-${randomUUID().slice(0, 8)}.${extension}`;
    await writeFile(path.join(generatedImagesDirectory, filename), buffer);
    assetMap.set(`backup-asset://${asset.id}`, `/generated-images/${filename}`);
  }
  function visit(value) {
    if (typeof value === "string") return assetMap.get(value) || value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    }
    return value;
  }
  return visit({
    settings: backup.settings,
    messages: backup.messages,
    imageJobs: backup.imageJobs,
  });
}

function validateBackupPayload(value) {
  if (!value || typeof value !== "object" || value.format !== BACKUP_FORMAT) {
    throw new Error("这不是夜航信箱备份文件");
  }
  if (Number(value.version) !== BACKUP_VERSION) throw new Error("备份版本暂不支持");
  if (!value.settings || typeof value.settings !== "object") throw new Error("备份缺少设定数据");
  if (!Array.isArray(value.messages) || !Array.isArray(value.imageJobs)) {
    throw new Error("备份缺少对话或图片记录");
  }
  return value;
}

async function handleBackup(request, response) {
  if (request.method === "GET") {
    const packed = await packNodeBackupContent({
      settings: await store.loadSettings(),
      messages: await store.loadHistory(),
      imageJobs: Array.from(imageJobs.values()).map(publicImageJob),
    });
    sendJson(response, 200, {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      source: "node-json-files",
      ...packed.content,
      assets: packed.assets,
      preferences: {},
      security: { apiKeysIncluded: false },
    });
    return;
  }
  if (request.method !== "PUT") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (activeImageJobCount > 0 || Array.from(imageJobs.values()).some((job) => job.status === "queued")) {
    sendJson(response, 409, { error: "仍有图片正在生成或排队，请完成后再导入备份" });
    return;
  }
  const body = await readBody(request, MAX_BACKUP_BYTES);
  const backup = validateBackupPayload(body.backup);
  const restored = await restoreNodeBackupContent(backup);
  const settings = await store.saveSettings(restored.settings);
  const messages = await store.saveHistory(restored.messages);
  imageJobs.clear();
  imageJobRequests.clear();
  const importedAt = new Date().toISOString();
  for (const rawJob of restored.imageJobs.slice(0, 300)) {
    if (!rawJob || typeof rawJob !== "object" || typeof rawJob.id !== "string") continue;
    const unfinished = rawJob.status === "queued" || rawJob.status === "running";
    imageJobs.set(rawJob.id, {
      ...rawJob,
      status: unfinished ? "failed" : rawJob.status,
      statusMessage: unfinished ? "备份导入后未继续未完成任务" : rawJob.statusMessage,
      error: unfinished ? "为避免重复扣费，导入时未自动恢复排队或生成中的图片任务。" : rawJob.error,
      updatedAt: unfinished ? importedAt : rawJob.updatedAt,
    });
  }
  await persistImageJobs();
  sendJson(response, 200, {
    ok: true,
    settings: true,
    messageCount: messages.length,
    imageCount: Array.from(imageJobs.values()).filter((job) => job.status === "completed" && job.imageUrl).length,
    roleCount: 2
      + (settings.ensemble?.customRoles?.length || 0)
      + (settings.ensemble?.temporaryRoles?.length || 0),
  });
}

async function handleImageGeneration(request, response) {
  const requestUrl = new URL(request.url || "/api/image", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET") {
    const jobId = requestUrl.searchParams.get("jobId");
    if (jobId) {
      const job = imageJobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: "生图任务不存在或已过期" });
        return;
      }
      sendJson(response, 200, { job: publicImageJob(job) });
      return;
    }
    const jobs = Array.from(imageJobs.values())
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, 300)
      .map(publicImageJob);
    sendJson(response, 200, { jobs });
    return;
  }
  if (request.method === "DELETE") {
    const body = await readBody(request).catch(() => ({}));
    const jobId = String(requestUrl.searchParams.get("jobId") || body?.jobId || "").slice(0, 120);
    const job = jobId ? imageJobs.get(jobId) : null;
    if (job && (job.status === "queued" || job.status === "running")) {
      sendJson(response, 409, { error: "图片仍在生成或排队，暂时不能删除" });
      return;
    }
    const imageUrl = String(job?.imageUrl || body?.imageUrl || "").slice(0, 2000);
    const targetId = String(job?.targetId || body?.targetId || "").slice(0, 80);
    const visualStateId = String(job?.visualStateId || body?.visualStateId || "").slice(0, 120);
    if (jobId) {
      imageJobs.delete(jobId);
      imageJobRequests.delete(jobId);
      await persistImageJobs();
    }
    await clearDeletedImageReferences({ jobId, imageUrl, targetId, visualStateId });
    const fileDeleted = await deleteGeneratedImageFile(imageUrl);
    sendJson(response, 200, {
      ok: true,
      deletedJob: Boolean(job),
      deletedFile: fileDeleted,
    });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readBody(request);
  if (body?.enabled !== true) {
    sendJson(response, 403, {
      error: "请先开启图片生成",
      code: "IMAGE_GENERATION_DISABLED",
    });
    return;
  }

  if (body.action === "prepare") {
    try {
      const prompt = await rewriteScenePrompt(body);
      const model = resolveImageModel(body);
      sendJson(response, 200, {
        prompt,
        model,
        quality: "standard",
        size: resolveImageSize(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "场景提示词整理失败";
      log(`Scene prompt rewrite failed: ${detail}`);
      sendJson(response, 502, { error: "场景提示词整理失败，未调用图片接口", detail });
    }
    return;
  }

  if (body.action === "prepare-character") {
    try {
      const prompt = await rewriteCharacterPrompt(body);
      const model = resolveImageModel(body);
      sendJson(response, 200, {
        prompt,
        model,
        quality: "standard",
        size: resolveImageSize(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "角色提示词整理失败";
      log(`Character prompt rewrite failed: ${detail}`);
      const model = resolveImageModel(body);
      sendJson(response, 200, {
        prompt: buildLocalCharacterPrompt(body),
        model,
        quality: "standard",
        size: resolveImageSize(),
        fallback: "local",
        warning: detail,
      });
    }
    return;
  }

  if (body.action === "generate-async") {
    try {
      validateImageRequest(body);
      const now = new Date().toISOString();
      const kind = body.kind === "character" ? "character" : "scene";
      const job = {
        id: randomUUID(),
        kind,
        targetId: typeof body.targetId === "string" ? body.targetId.slice(0, 80) : "",
        targetName: typeof body.targetName === "string" ? body.targetName.slice(0, 40) : "",
        archive: normalizeImageArchive(body.archive, kind, body.targetName),
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        prompt: String(body.prompt || "").trim().slice(0, 1200),
        rewritten: false,
        statusMessage: "已进入后台队列",
        createdAt: now,
        updatedAt: now,
      };
      imageJobs.set(job.id, job);
      imageJobRequests.set(job.id, {
        ...body,
        prompt: String(body.prompt || "").trim().slice(0, 1200),
      });
      await persistImageJobs();
      sendJson(response, 202, { job: publicImageJob(job) });
      scheduleImageJobQueue();
    } catch (error) {
      sendJson(response, error?.statusCode || 502, {
        error: error instanceof Error ? error.message : "无法创建生图任务",
        code: error?.code || "IMAGE_JOB_CREATE_FAILED",
      });
    }
    return;
  }

  if (body.action !== "generate") {
    sendJson(response, 400, { error: "Unsupported image action" });
    return;
  }
  try {
    sendJson(response, 200, await generateImageWithRetry(body));
  } catch (error) {
    sendJson(response, error?.statusCode || 502, {
      error: "图片生成失败",
      detail: error instanceof Error ? error.message : "图片生成失败",
      code: error?.code || "IMAGE_GENERATION_FAILED",
    });
  }
}

async function handleGeneratedImage(request, response, pathname) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  const filename = path.basename(decodeURIComponent(pathname));
  if (!/^(?:scene|character)-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/.test(filename)) {
    sendJson(response, 404, { error: "Image not found" });
    return;
  }
  try {
    const image = await readFile(path.join(generatedImagesDirectory, filename));
    const contentType = filename.endsWith(".png")
      ? "image/png"
      : filename.endsWith(".webp")
      ? "image/webp"
      : filename.endsWith(".gif")
      ? "image/gif"
      : "image/jpeg";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": image.length,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
    response.end(image);
  } catch {
    sendJson(response, 404, { error: "Image not found" });
  }
}

function proxyRequest(request, response) {
  const internalOrigin = `http://127.0.0.1:${applicationPort}`;
  const headers = {
    ...request.headers,
    host: `127.0.0.1:${applicationPort}`,
    "x-forwarded-host": request.headers.host,
    "x-forwarded-proto": "http",
  };
  if (request.headers.origin) headers.origin = internalOrigin;
  if (request.headers.referer) {
    headers.referer = request.headers.referer.replace(/^https?:\/\/[^/]+/i, internalOrigin);
  }
  const proxy = http.request({
    hostname: "127.0.0.1",
    port: applicationPort,
    path: request.url,
    method: request.method,
    headers,
  }, (upstream) => {
    response.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on("error", () => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: "页面服务正在启动，请稍后刷新" });
    } else {
      response.end();
    }
  });
  request.pipe(proxy);
}

function isLocalBridgeAddress(address) {
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1";
}

async function handleAiBridge(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (!isLocalBridgeAddress(request.socket.remoteAddress)) {
    sendJson(response, 403, { error: "Local bridge access only" });
    return;
  }

  const provider = request.headers["x-ai-provider"] === "grok" ? "grok" : "deepseek";
  const apiKey = provider === "grok"
    ? process.env.GROK_API_KEY
    : process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, { error: `${provider} API key is not configured` });
    return;
  }
  const baseUrl = (
    provider === "grok"
      ? process.env.GROK_BASE_URL || process.env.IMAGE_BASE_URL || "https://downstream.jbbtoken.cn/v1"
      : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const body = await readBody(request);

  try {
    const upstream = await externalFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    });
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (!upstream.body) {
      response.end();
      return;
    }
    for await (const chunk of upstream.body) {
      response.write(Buffer.from(chunk));
    }
    response.end();
  } catch (error) {
    log(`AI bridge ${provider} request failed: ${error instanceof Error ? error.message : error}`);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 502, {
      error: `${provider} network request failed`,
      detail: error instanceof Error ? error.message : "fetch failed",
    });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/_ai-bridge") {
      await handleAiBridge(request, response);
      return;
    }
    if (url.pathname === "/app-update/manifest.json"
      || url.pathname === "/app-update/night-mailbox.html") {
      await handleAppUpdate(request, response, url.pathname);
      return;
    }
    if (url.pathname === "/api/storage") {
      await handleStorage(request, response);
      return;
    }
    if (url.pathname === "/api/backup") {
      await handleBackup(request, response);
      return;
    }
    if (url.pathname === "/api/image") {
      await handleImageGeneration(request, response);
      return;
    }
    if (url.pathname === "/api/role") {
      await handleRoleProfile(request, response);
      return;
    }
    if (url.pathname === "/api/models") {
      await handleChatModels(request, response);
      return;
    }
    if (url.pathname === "/api/image-models") {
      await handleImageModels(request, response);
      return;
    }
    if (url.pathname.startsWith("/generated-images/")) {
      await handleGeneratedImage(request, response, url.pathname);
      return;
    }
    proxyRequest(request, response);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Local server error" });
  }
});

server.on("upgrade", (request, socket, head) => {
  const upstream = net.connect(applicationPort, "127.0.0.1", () => {
    const internalOrigin = `http://127.0.0.1:${applicationPort}`;
    const upgradeHeaders = {
      ...request.headers,
      host: `127.0.0.1:${applicationPort}`,
      origin: request.headers.origin ? internalOrigin : undefined,
      "x-forwarded-host": request.headers.host,
      "x-forwarded-proto": "http",
    };
    const headerLines = Object.entries(upgradeHeaders)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headerLines}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
});

await restoreImageJobs();

server.listen(publicPort, "0.0.0.0", () => {
  log(`Local companion server started on 0.0.0.0:${publicPort}; page service port ${applicationPort}`);
});

function shutdown() {
  server.close();
  if (!application.killed) application.kill();
  localProxyAgent?.close().catch(() => {});
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
application.on("exit", (code) => {
  log(`Page service exited with code ${code ?? "unknown"}`);
});

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error?.stack || error}`);
});

process.on("unhandledRejection", (error) => {
  log(`Unhandled rejection: ${error?.stack || error}`);
});
