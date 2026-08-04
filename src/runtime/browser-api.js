/**
 * 浏览器运行时服务层。
 *
 * 页面继续使用 `/api/*` 形式调用功能，本文件在浏览器内拦截这些请求，并把
 * 数据存储、模型调用、图片后台任务和备份统一封装。它不是 Node 服务端。
 * 查找功能时优先搜索 `handleChat`、`handleImage`、`handleStorage` 或
 * `routeMobileRequest`，不要为小修改阅读整个文件。
 */
import {
  DEFAULT_SYSTEM_PROMPT,
  renderSystemPrompt,
} from "../../shared/system-prompt.js";
import {
  limitEnsembleTurns,
  maxEnsembleMessages,
  maxEnsembleOutputTokens,
} from "../../shared/ensemble-turns.js";
import {
  DEFAULT_ROLE_VISUAL_STATES,
  ROLE_VISUAL_ACTIONS,
  ROLE_VISUAL_EMOTIONS,
} from "../../shared/role-visual-states.js";
import {
  buildImagePromptRequest,
  formatImagePromptResponse,
} from "../../shared/image-prompt-context.js";
import {
  buildImageGenerationPayload,
  isGrokImageModel,
  normalizeImagePromptForModel,
} from "../../shared/image-models.js";
import {
  formatStoryMoment,
  normalizeStoryClock,
  normalizeStoryEvents,
} from "../../shared/story-time.js";
import {
  buildStoryEventDecisionMessages,
  parseStoryEventDecision,
  shouldAnalyzeStoryEvent,
} from "../../shared/story-event-ai.js";
import {
  parseLooseJsonArray,
  parseLooseJsonObject,
} from "../../shared/loose-json.js";
import { sha256HexBytes } from "../../shared/sha256.js";
import {
  STANDALONE_DEFAULT_HISTORY,
  STANDALONE_DEFAULT_SETTINGS,
} from "../config/default-settings.js";
import {
  chatModelCandidates,
  imageModelCandidates,
  normalizeModelCatalog,
} from "../features/connections/model-catalog.js";
import {
  API_CONFIG_STORAGE_KEY,
  DEFAULT_API_CONFIG,
  normalizeApiConfig,
  serializeApiConfig,
} from "../features/connections/config-schema.js";

// ---------- 存储键、任务限制与运行时缓存 ----------
const SETTINGS_KEY = "night-mailbox-mobile-settings";
const HISTORY_KEY = "night-mailbox-mobile-history";
const IMAGE_JOBS_KEY = "night-mailbox-mobile-image-jobs";
const TOKEN_USAGE_KEY = "night-mailbox-token-usage";
const TOKEN_USAGE_MAX_ENTRIES = 20000;
const BACKUP_FORMAT = "night-mailbox-backup";
const BACKUP_VERSION = 1;
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_JOB_CONCURRENCY = 6;
const MOTION_DISPLAY_ENABLED = false;
const INDEXED_DB_NAME = "night-mailbox";
const INDEXED_DB_STORE = "local-data";
const INDEXED_DB_VERSION = 4;
const ASSET_STORE = "assets";
const ASSET_BLOB_STORE = "asset-blobs";
const ASSET_THUMBNAIL_STORE = "asset-thumbnails";
const MESSAGE_STORE = "messages";
const EPISODE_STORE = "episodes";
const MEMORY_FACT_STORE = "memory-facts";
const META_STORE = "meta";
const ASSET_PREFIX = "asset://";
const originalFetch = window.fetch.bind(window);
const storageCache = new Map();
const assetMetadataCache = new Map();
const assetObjectUrlCache = new Map();
const plusFileEntryCache = new Map();
let indexedDatabase = null;
let storageWriteQueue = Promise.resolve();
let activeImageJobCount = 0;
let imageJobSchedulerRunning = false;
let imageJobsMemoryCache = null;
let imageJobsPersistTimer = null;
let pendingImageJobs = null;
let plusDetectionPromise = null;
let plusAssetDirectoryPromise = null;
let assetMigrationPromise = null;

const fallbackSuggestions = [
  "追问她刚才回避的那个细节",
  "提议去线索指向的地点调查",
  "从现场物品中找一个可验证的证据",
];

const mobileDefaultSettings = {
  scenarioVersion: "world-first-onboarding-v2",
  onboardingCompleted: false,
  onboardingStep: 1,
  onboardingDismissed: false,
  storyInitialized: false,
  worldVersion: 0,
  worldSyncPending: false,
  userProfile: {
    name: "",
    gender: "未指定",
    pronoun: "TA",
  },
  profile: {
    name: "",
    age: 24,
    gender: "女性",
    personality: "",
    relation: "旅伴",
    prompt: "",
    appearance: "",
    imagePrompt: "",
    avatarUrl: "",
    worldVersion: 0,
    derivedProfile: {},
  },
  ensemble: {
    enabled: false,
    autoGuests: true,
    maxTurns: 3,
    friend: {
      name: "",
      age: 24,
      gender: "未指定",
      personality: "",
      relation: "",
      prompt: "",
      appearance: "",
      imagePrompt: "",
      avatarUrl: "",
      derivedProfile: {},
    },
    customRoles: [],
    temporaryRoles: [],
  },
  roleMemories: {},
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  storySummary: "",
  storyClock: normalizeStoryClock({ day: 1, segment: "morning", location: "" }),
  storyEvents: [],
  worldSetting: "",
  autoCompress: true,
  autoCompressThreshold: 40,
  randomRoleEnabled: true,
  randomRoleInterval: 18,
  actionStyle: "行动型",
  summaryUpdatedAt: "",
};
const defaultSettings = window.__NIGHT_MAILBOX_STANDALONE__
  ? {
      ...mobileDefaultSettings,
      ...STANDALONE_DEFAULT_SETTINGS,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      autoCompress: true,
      autoCompressThreshold: 40,
      randomRoleEnabled: true,
      randomRoleInterval: 18,
      summaryUpdatedAt: "",
    }
  : mobileDefaultSettings;

const imageRuntimeDefaults = {
  portraitSize: "1024x1536",
  landscapeSize: "1536x1024",
  endpoint: "/images/generations",
};
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const PREVIOUS_DEFAULT_FIVE_SECTION_PROMPT = `你在互动剧情中扮演“{{name}}”：{{age}} 岁，性格“{{personality}}”，与用户的关系是“{{relation}}”。

用自然、具体、有生活感的中文回应。延续上一轮的地点、人物状态、衣着、物品和未完成动作；先正面回应用户，再主动推动剧情。描写环境、心情和动作时使用可感知的细节，让台词保持人物自己的语气。

每轮都要让局面产生一个明确变化，例如角色开始执行一件事、作出决定、提出并落实计划、带来新消息、触发事件、改变地点或让人物关系向前一步。不能只回答一句、原地等待或用“接下来想做什么”把推动责任交还给用户。

回复分为【场景】【心情】【动作】【对话】【剧情推进】五段。【剧情推进】用 1–3 句写出已经开始发生的下一步行动及其直接结果，同时留下用户可以介入的具体位置。内容服从当前世界设定、已经发生的剧情和人物档案，不在回复中解释或复述提示词。`;

function normalizePromptWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mergeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const storedPrompt = typeof input?.systemPrompt === "string" ? input.systemPrompt : "";
  const migratedPrompt = normalizePromptWhitespace(storedPrompt)
    === normalizePromptWhitespace(PREVIOUS_DEFAULT_FIVE_SECTION_PROMPT)
    ? DEFAULT_SYSTEM_PROMPT
    : storedPrompt;
  return {
    ...clone(defaultSettings),
    ...input,
    systemPrompt: migratedPrompt || DEFAULT_SYSTEM_PROMPT,
    userProfile: {
      ...clone(defaultSettings.userProfile || mobileDefaultSettings.userProfile),
      ...(input.userProfile || {}),
    },
    profile: { ...clone(defaultSettings.profile), ...(input.profile || {}) },
    ensemble: {
      ...clone(defaultSettings.ensemble),
      ...(input.ensemble || {}),
      friend: {
        ...clone(defaultSettings.ensemble.friend),
        ...(input.ensemble?.friend || {}),
      },
      customRoles: Array.isArray(input.ensemble?.customRoles) ? input.ensemble.customRoles : [],
      temporaryRoles: Array.isArray(input.ensemble?.temporaryRoles) ? input.ensemble.temporaryRoles : [],
    },
    roleMemories: input.roleMemories && typeof input.roleMemories === "object"
      ? input.roleMemories
      : {},
    storyClock: normalizeStoryClock(input.storyClock || defaultSettings.storyClock),
    storyEvents: normalizeStoryEvents(input.storyEvents),
  };
}

// ---------- Token 用量统计（只存本地，不写源码/构建产物） ----------
function estimateTokens(text) {
  const value = String(text || "");
  let chinese = 0;
  let other = 0;
  for (const character of value) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(character)) chinese += 1;
    else other += 1;
  }
  return Math.max(1, Math.round(chinese * 0.8 + other / 4));
}

function loadTokenUsage() {
  const stored = readStoredJson(TOKEN_USAGE_KEY, null);
  return stored && typeof stored === "object" && Array.isArray(stored.entries)
    ? stored
    : { version: 1, entries: [], pricePerMillionInput: 0, pricePerMillionOutput: 0, updatedAt: "" };
}

function saveTokenUsage(data) {
  storageSet(TOKEN_USAGE_KEY, data);
}

function recordTokenUsage(category, usage, inputText, outputText, model) {
  try {
    const source = usage && typeof usage === "object" ? usage : {};
    const promptTokens = Number(source.prompt_tokens);
    const completionTokens = Number(source.completion_tokens);
    const hasPrompt = Number.isFinite(promptTokens) && promptTokens > 0;
    const hasCompletion = Number.isFinite(completionTokens) && completionTokens > 0;
    const data = loadTokenUsage();
    data.entries.push({
      ts: Date.now(),
      category: String(category || "chat"),
      input: hasPrompt ? Math.round(promptTokens) : estimateTokens(inputText),
      output: hasCompletion ? Math.round(completionTokens) : estimateTokens(outputText),
      estimated: !(hasPrompt && hasCompletion),
      model: String(model || "").slice(0, 120),
    });
    if (data.entries.length > TOKEN_USAGE_MAX_ENTRIES) {
      data.entries = data.entries.slice(-TOKEN_USAGE_MAX_ENTRIES);
    }
    data.updatedAt = new Date().toISOString();
    saveTokenUsage(data);
  } catch {
    // 用量统计失败不应影响对话主流程
  }
}

function summarizeUsage(entries) {
  const summary = { input: 0, output: 0, total: 0, estimated: false };
  for (const entry of entries) {
    summary.input += Math.max(0, Number(entry?.input) || 0);
    summary.output += Math.max(0, Number(entry?.output) || 0);
    if (entry?.estimated) summary.estimated = true;
  }
  summary.total = summary.input + summary.output;
  return summary;
}

function aggregateTokenUsage() {
  const data = loadTokenUsage();
  const now = new Date();
  const todayKey = now.toDateString();
  const cutoff = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  const todayEntries = [];
  const weekEntries = [];
  const byCategory = { chat: [], "image-prompt": [], summary: [] };
  for (const entry of data.entries) {
    if (new Date(entry.ts).toDateString() === todayKey) todayEntries.push(entry);
    if (entry.ts >= cutoff) weekEntries.push(entry);
    const category = String(entry.category || "chat");
    if (byCategory[category]) byCategory[category].push(entry);
    else byCategory[category] = [entry];
  }
  const categorySummaries = {};
  for (const [category, entries] of Object.entries(byCategory)) {
    if (entries.length) categorySummaries[category] = summarizeUsage(entries);
  }
  const priceInput = Math.max(0, Number(data.pricePerMillionInput) || 0);
  const priceOutput = Math.max(0, Number(data.pricePerMillionOutput) || 0);
  const estimateCost = (summary) => (summary.input / 1e6) * priceInput + (summary.output / 1e6) * priceOutput;
  const today = summarizeUsage(todayEntries);
  const last7Days = summarizeUsage(weekEntries);
  const cumulative = summarizeUsage(data.entries);
  return {
    pricePerMillionInput: priceInput,
    pricePerMillionOutput: priceOutput,
    today,
    last7Days,
    cumulative,
    categories: categorySummaries,
    estimatedCost: {
      today: estimateCost(today),
      last7Days: estimateCost(last7Days),
      cumulative: estimateCost(cumulative),
    },
    updatedAt: data.updatedAt || "",
  };
}

function handleUsage(body, method) {
  if (method === "POST") {
    const data = loadTokenUsage();
    data.pricePerMillionInput = Math.max(0, Number(body.pricePerMillionInput) || 0);
    data.pricePerMillionOutput = Math.max(0, Number(body.pricePerMillionOutput) || 0);
    data.updatedAt = new Date().toISOString();
    saveTokenUsage(data);
  }
  return jsonResponse(aggregateTokenUsage());
}

function legacyStorageGet(key) {
  try {
    if (window.plus?.storage) return window.plus.storage.getItem(key);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ---------- IndexedDB 与 localStorage 兼容存储 ----------
function openIndexedDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(INDEXED_DB_STORE)) database.createObjectStore(INDEXED_DB_STORE);
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const assets = database.createObjectStore(ASSET_STORE, { keyPath: "hash" });
        assets.createIndex("backend", "backend", { unique: false });
        assets.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(ASSET_BLOB_STORE)) database.createObjectStore(ASSET_BLOB_STORE);
      if (!database.objectStoreNames.contains(ASSET_THUMBNAIL_STORE)) database.createObjectStore(ASSET_THUMBNAIL_STORE);
      if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
        const messages = database.createObjectStore(MESSAGE_STORE, { keyPath: "id" });
        messages.createIndex("createdAt", "createdAt", { unique: false });
        messages.createIndex("storyDay", "storyDay", { unique: false });
        messages.createIndex("speakerId", "speakerId", { unique: false });
        messages.createIndex("episodeId", "episodeId", { unique: false });
      }
      if (!database.objectStoreNames.contains(EPISODE_STORE)) {
        const episodes = database.createObjectStore(EPISODE_STORE, { keyPath: "id" });
        episodes.createIndex("createdAt", "createdAt", { unique: false });
        episodes.createIndex("storyDay", "storyDay", { unique: false });
      }
      if (!database.objectStoreNames.contains(MEMORY_FACT_STORE)) {
        const facts = database.createObjectStore(MEMORY_FACT_STORE, { keyPath: "id" });
        facts.createIndex("type", "type", { unique: false });
        facts.createIndex("status", "status", { unique: false });
        facts.createIndex("storyDay", "storyDay", { unique: false });
        facts.createIndex("updatedAt", "updatedAt", { unique: false });
        facts.createIndex("subjectRoleIds", "subjectRoleIds", { unique: false, multiEntry: true });
      }
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function indexedRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 操作失败"));
  });
}

function indexedStoreGet(storeName, key) {
  if (!indexedDatabase?.objectStoreNames.contains(storeName)) return Promise.resolve(undefined);
  return indexedRequest(indexedDatabase.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

function indexedStorePut(storeName, value, key) {
  if (!indexedDatabase?.objectStoreNames.contains(storeName)) return Promise.reject(new Error("IndexedDB 存储不可用"));
  return new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    if (key === undefined) store.put(value);
    else store.put(value, key);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 写入失败"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 写入中断"));
  });
}

function indexedStoreDelete(storeName, key) {
  if (!indexedDatabase?.objectStoreNames.contains(storeName)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 删除失败"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 删除中断"));
  });
}

function indexedStoreClear(storeName) {
  if (!indexedDatabase?.objectStoreNames.contains(storeName)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 清理失败"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 清理中断"));
  });
}

function indexedStoreGetAll(storeName) {
  if (!indexedDatabase?.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  const store = indexedDatabase.transaction(storeName, "readonly").objectStore(storeName);
  if (typeof store.getAll === "function") return indexedRequest(store.getAll());
  return new Promise((resolve, reject) => {
    const values = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }
      values.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB 读取失败"));
  });
}

function readIndexedValue(database, key) {
  return new Promise((resolve) => {
    const request = database
      .transaction(INDEXED_DB_STORE, "readonly")
      .objectStore(INDEXED_DB_STORE)
      .get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => resolve(null);
  });
}

function writeIndexedValue(database, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(INDEXED_DB_STORE, "readwrite");
    transaction.objectStore(INDEXED_DB_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 写入失败"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 写入中断"));
  });
}

export async function initializeMobileStorage() {
  indexedDatabase = await openIndexedDatabase();
  const keys = [SETTINGS_KEY, HISTORY_KEY, IMAGE_JOBS_KEY, API_CONFIG_STORAGE_KEY];
  for (const key of keys) {
    const indexedValue = indexedDatabase ? await readIndexedValue(indexedDatabase, key) : null;
    const legacyValue = indexedValue ?? legacyStorageGet(key);
    if (legacyValue !== null) {
      storageCache.set(key, legacyValue);
      if (indexedDatabase && indexedValue === null) {
        await writeIndexedValue(indexedDatabase, key, legacyValue);
      }
    }
  }
  for (const metadata of await indexedStoreGetAll(ASSET_STORE)) {
    if (metadata?.hash) assetMetadataCache.set(metadata.hash, metadata);
  }
  await archiveMessages(loadHistory(), loadSettings().storyClock);
  const restoredJobs = loadImageJobs().map((job) => (
    !MOTION_DISPLAY_ENABLED
    && ["visual-state", "stage-background"].includes(job.kind)
    && (job.status === "queued" || job.status === "running")
  )
    ? {
        ...job,
        status: "failed",
        statusMessage: "旧动作展示任务已停止",
        error: "当前 HTML 已移除动作展示模块，未继续调用图片接口。",
        request: null,
        updatedAt: new Date().toISOString(),
      }
    : job.status === "running"
      ? {
        ...job,
        status: "failed",
        statusMessage: "页面关闭时任务被中断",
        error: "生成期间页面被完全关闭，无法继续当前请求；未开始的排队任务会自动继续。",
        updatedAt: new Date().toISOString(),
      }
      : job);
  saveImageJobs(restoredJobs);
  scheduleImageJobQueue();
}

function storageGet(key) {
  return storageCache.get(key) ?? legacyStorageGet(key);
}

function storageSet(key, value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  storageCache.set(key, serialized);
  storageWriteQueue = storageWriteQueue.then(async () => {
    if (indexedDatabase) {
      await writeIndexedValue(indexedDatabase, key, serialized);
      return;
    }
    if (window.plus?.storage) window.plus.storage.setItem(key, serialized);
    else localStorage.setItem(key, serialized);
  });
  return storageWriteQueue;
}

export function flushMobileStorage() {
  if (pendingImageJobs) persistPendingImageJobs();
  return storageWriteQueue;
}

function readStoredJson(key, fallback) {
  try {
    const raw = storageGet(key);
    return raw ? JSON.parse(raw) : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function loadSettings() {
  return mergeSettings(readStoredJson(SETTINGS_KEY, defaultSettings));
}

function saveSettings(value) {
  const normalized = mergeSettings(value);
  storageSet(SETTINGS_KEY, normalized);
  return normalized;
}

function loadHistory() {
  const useStandaloneDefault = window.__NIGHT_MAILBOX_STANDALONE__
    && !storageGet(SETTINGS_KEY)
    && !storageGet(HISTORY_KEY);
  const history = readStoredJson(
    HISTORY_KEY,
    useStandaloneDefault ? STANDALONE_DEFAULT_HISTORY : [],
  );
  return normalizeStoredHistory(history);
}

function saveHistory(value) {
  const history = normalizeStoredHistory(value);
  storageSet(HISTORY_KEY, history);
  const storyClock = loadSettings().storyClock;
  storageWriteQueue = storageWriteQueue.then(() => archiveMessages(history, storyClock));
  return history;
}

function normalizeStoredHistory(value) {
  return (Array.isArray(value) ? value : []).slice(-1000).map((message) => {
    const content = typeof message?.content === "string" ? message.content : "";
    const hasNarrativeLabels = /【(?:场景|心情|动作|对话|剧情推进)/.test(content);
    const normalizedContent = hasNarrativeLabels && content.includes("\\n") && !content.includes("\n")
      ? content.replace(/\\r\\n|\\n/g, "\n")
      : content;
    return { ...message, content: normalizedContent };
  });
}

function normalizedArchiveMessage(message, index, storyClock) {
  const numericId = Number(message?.id);
  const createdAt = typeof message?.createdAt === "string" && message.createdAt
    ? message.createdAt
    : Number.isFinite(numericId) && numericId > 1000000000000
      ? new Date(numericId).toISOString()
      : new Date(Date.now() + index).toISOString();
  return {
    ...message,
    id: String(message?.id || `message-${createdAt}-${index}`),
    createdAt,
    storyDay: Math.max(1, Number(message?.storyDay || storyClock?.day) || 1),
    storySegment: String(message?.storySegment || storyClock?.segment || "morning"),
    speakerId: String(message?.speakerId || (message?.role === "user" ? "user" : "")),
    episodeId: String(message?.episodeId || "active"),
    archivedAt: message?.archivedAt || "",
  };
}

async function archiveMessages(messages, storyClock = {}) {
  if (!indexedDatabase?.objectStoreNames.contains(MESSAGE_STORE)) return;
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message, index) => normalizedArchiveMessage(message, index, storyClock));
  if (!normalized.length) return;
  await new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(MESSAGE_STORE, "readwrite");
    const store = transaction.objectStore(MESSAGE_STORE);
    normalized.forEach((message, index) => {
      const request = store.get(message.id);
      request.onsuccess = () => {
        const existing = request.result || {};
        store.put({
          ...existing,
          ...message,
          storyDay: messages[index]?.storyDay == null
            ? existing.storyDay || message.storyDay
            : message.storyDay,
          storySegment: messages[index]?.storySegment == null
            ? existing.storySegment || message.storySegment
            : message.storySegment,
          createdAt: messages[index]?.createdAt
            ? message.createdAt
            : existing.createdAt || message.createdAt,
        });
      };
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("历史记录归档失败"));
    transaction.onabort = () => reject(transaction.error || new Error("历史记录归档中断"));
  });
}

export function getMobileApiConfig() {
  return normalizeApiConfig(readStoredJson(API_CONFIG_STORAGE_KEY, DEFAULT_API_CONFIG));
}

export function saveMobileApiConfig(value) {
  const next = serializeApiConfig(value, getMobileApiConfig());
  storageSet(API_CONFIG_STORAGE_KEY, next);
  return next;
}

function imageApiKey(config) {
  return config.imageApiKey;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function textResponse(value, status = 200, headers = {}) {
  return new Response(String(value || ""), {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function waitForPlus(timeout = 3500) {
  if (window.__NIGHT_MAILBOX_STANDALONE__ && !window.__NIGHT_MAILBOX_APP_SHELL__) {
    return Promise.resolve(null);
  }
  if (window.plus) return Promise.resolve(window.plus);
  if (plusDetectionPromise) return plusDetectionPromise;
  plusDetectionPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(window.plus || null);
    };
    document.addEventListener("plusready", finish, { once: true });
    window.setTimeout(finish, timeout);
  });
  return plusDetectionPromise;
}

function isAssetReference(value) {
  return typeof value === "string" && value.startsWith(ASSET_PREFIX);
}

function assetHashFromReference(value) {
  return isAssetReference(value) ? value.slice(ASSET_PREFIX.length).split(/[?#]/, 1)[0] : "";
}

function blobToArrayBuffer(blob) {
  if (typeof blob?.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Blob(blob) {
  const buffer = await blobToArrayBuffer(blob);
  if (window.crypto?.subtle?.digest) {
    try {
      const digest = await window.crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    } catch {}
  }
  return sha256HexBytes(new Uint8Array(buffer));
}

function extensionForMimeType(mimeType) {
  if (/jpe?g/i.test(mimeType)) return "jpg";
  if (/webp/i.test(mimeType)) return "webp";
  if (/gif/i.test(mimeType)) return "gif";
  return "png";
}

function blobFromDataUrl(value) {
  const parts = dataUrlParts(value);
  if (!parts) throw new Error("图片 Data URL 无效");
  const binary = atob(parts.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: parts.mimeType });
}

async function plusFileAsBlob(plus, path) {
  const dataUrl = await readPlusImageAsDataUrl(plus, path);
  return blobFromDataUrl(dataUrl);
}

function plusEntryFileSize(entry) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(Number(file?.size) || 0),
      (error) => reject(error || new Error("无法读取 App 图片文件信息")),
    );
  });
}

async function plusPathFileSize(plus, path) {
  if (!plus?.io) throw new Error("App 文件服务暂不可用");
  const entry = plusFileEntryCache.get(path) || await resolvePlusEntry(plus, path);
  plusFileEntryCache.set(path, entry);
  return plusEntryFileSize(entry);
}

async function getAssetMetadata(reference) {
  const hash = assetHashFromReference(reference);
  if (!hash) return null;
  if (assetMetadataCache.has(hash)) return assetMetadataCache.get(hash);
  const metadata = await indexedStoreGet(ASSET_STORE, hash);
  if (metadata) assetMetadataCache.set(hash, metadata);
  return metadata || null;
}

async function sourceImageBlob(source) {
  if (source instanceof Blob) return source;
  const candidate = String(source || "").trim();
  if (!candidate) throw new Error("图片地址为空");
  if (isAssetReference(candidate)) {
    const metadata = await getAssetMetadata(candidate);
    if (!metadata) throw new Error("图片资产记录不存在");
    if (metadata.backend === "app-file") {
      const plus = await waitForPlus(8000);
      if (!plus?.io) throw new Error("App 文件服务暂不可用");
      return plusFileAsBlob(plus, metadata.path);
    }
    const storedBlob = await indexedStoreGet(ASSET_BLOB_STORE, metadata.hash);
    if (!(storedBlob instanceof Blob)) throw new Error("图片资产内容不存在");
    return storedBlob;
  }
  if (/^data:image\//i.test(candidate)) return blobFromDataUrl(candidate);
  try {
    const response = await originalFetch(candidate);
    if (!response.ok) throw new Error(`读取失败（${response.status}）`);
    return await response.blob();
  } catch (fetchError) {
    const plus = await waitForPlus(3000);
    if (plus?.io) return plusFileAsBlob(plus, candidate);
    throw fetchError;
  }
}

function blobAsBase64(blob, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value = "") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve(value);
    };
    const timeoutId = window.setTimeout(
      () => finish(new Error(`图片读取超时（${Math.round(timeoutMs / 1000)}秒）`)),
      timeoutMs,
    );
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0 || !result.slice(separator + 1)) {
        finish(new Error("图片 Base64 转换失败"));
        return;
      }
      finish(null, result.slice(separator + 1));
    };
    reader.onerror = () => finish(reader.error || new Error("图片读取失败"));
    reader.onabort = () => finish(new Error("图片读取被中断"));
    reader.readAsDataURL(blob);
  });
}

function writePlusBinaryBase64(entry, base64, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve(entry);
    };
    const timeoutId = window.setTimeout(
      () => finish(new Error(`App 图片写入超时（${Math.round(timeoutMs / 1000)}秒）`)),
      timeoutMs,
    );
    entry.createWriter((writer) => {
      writer.onwrite = () => finish();
      writer.onerror = (error) => finish(error || new Error("图片文件写入失败"));
      writer.onabort = () => finish(new Error("图片文件写入被中断"));
      writer.onwriteend = (event) => {
        const writerError = event?.target?.error || writer.error;
        if (writerError) finish(writerError);
        else if (writer.readyState === 2) finish();
      };
      if (typeof writer.writeAsBinary !== "function") {
        finish(new Error("当前 App 文件接口不支持二进制写入"));
        return;
      }
      try {
        writer.writeAsBinary(base64);
      } catch (error) {
        finish(error);
      }
    }, (error) => finish(error || new Error("无法创建图片文件写入器")));
  });
}

async function writePlusBlob(entry, blob) {
  const plus = await waitForPlus(3000);
  if (!plus?.io) throw new Error("App 文件服务暂不可用");
  const base64 = await blobAsBase64(blob);
  if (plus.android?.importClass) {
    try {
      const Base64 = plus.android.importClass("android.util.Base64");
      const FileOutputStream = plus.android.importClass("java.io.FileOutputStream");
      const localUrl = entry.toLocalURL?.() || entry.fullPath;
      const absolutePath = plus.io.convertLocalFileSystemURL(localUrl);
      const bytes = Base64.decode(base64, 0);
      const output = new FileOutputStream(absolutePath);
      try {
        output.write(bytes);
        output.flush();
      } finally {
        output.close();
      }
      return entry;
    } catch (error) {
      if (typeof entry?.createWriter !== "function") throw error;
    }
  }
  return writePlusBinaryBase64(entry, base64);
}

async function saveAssetBlobToApp(hash, blob) {
  const plus = await waitForPlus(8000);
  if (!plus?.io) return "";
  if (!plusAssetDirectoryPromise) {
    plusAssetDirectoryPromise = (async () => {
      const root = await resolvePlusEntry(plus, "_doc/");
      const mailbox = await getPlusDirectory(root, "night-mailbox");
      return getPlusDirectory(mailbox, "assets");
    })().catch((error) => {
      plusAssetDirectoryPromise = null;
      throw error;
    });
  }
  const assets = await plusAssetDirectoryPromise;
  const filename = `${hash}.${extensionForMimeType(blob.type)}`;
  const entry = await getPlusFile(assets, filename);
  await writePlusBlob(entry, blob);
  const path = entry.toLocalURL?.() || `_doc/night-mailbox/assets/${filename}`;
  plusFileEntryCache.set(path, entry);
  return path;
}

async function storeImageAsset(source, category = "other") {
  if (typeof source === "string" && isAssetReference(source)) {
    const existing = await getAssetMetadata(source);
    if (existing) return source;
  }
  const blob = await sourceImageBlob(source);
  if (!blob.size) throw new Error("图片内容为空");
  const hash = await sha256Blob(blob);
  const reference = `${ASSET_PREFIX}${hash}`;
  const existing = await indexedStoreGet(ASSET_STORE, hash);
  if (existing) {
    assetMetadataCache.set(hash, existing);
    return reference;
  }
  const now = new Date().toISOString();
  const appPath = await saveAssetBlobToApp(hash, blob);
  const metadata = {
    hash,
    reference,
    category,
    backend: appPath ? "app-file" : "indexeddb",
    path: appPath,
    mimeType: blob.type || "image/png",
    size: blob.size,
    createdAt: now,
    updatedAt: now,
  };
  if (!appPath) await indexedStorePut(ASSET_BLOB_STORE, blob, hash);
  await indexedStorePut(ASSET_STORE, metadata);
  const verifiedSize = appPath
    ? await plusPathFileSize(await waitForPlus(3000), appPath)
    : Number((await indexedStoreGet(ASSET_BLOB_STORE, hash))?.size || 0);
  if (verifiedSize !== Number(blob.size)) {
    await indexedStoreDelete(ASSET_STORE, hash);
    if (!appPath) await indexedStoreDelete(ASSET_BLOB_STORE, hash);
    throw new Error("图片资产写入校验失败，原图片未删除");
  }
  assetMetadataCache.set(hash, metadata);
  return reference;
}

function cacheAssetObjectUrl(key, blob) {
  if (assetObjectUrlCache.has(key)) return assetObjectUrlCache.get(key);
  const url = URL.createObjectURL(blob);
  assetObjectUrlCache.set(key, url);
  while (assetObjectUrlCache.size > 32) {
    const oldest = assetObjectUrlCache.keys().next().value;
    const oldUrl = assetObjectUrlCache.get(oldest);
    assetObjectUrlCache.delete(oldest);
    if (String(oldUrl).startsWith("blob:")) URL.revokeObjectURL(oldUrl);
  }
  return url;
}

async function resolveAssetDisplaySource(reference) {
  const metadata = await getAssetMetadata(reference);
  if (!metadata) throw new Error("图片资产记录不存在");
  if (metadata.backend === "app-file") {
    const plus = await waitForPlus(8000);
    if (!plus?.io) throw new Error("App 本地图片服务暂不可用");
    return readPlusImageAsDataUrl(plus, metadata.path);
  }
  const blob = await indexedStoreGet(ASSET_BLOB_STORE, metadata.hash);
  if (!(blob instanceof Blob)) throw new Error("图片资产内容不存在");
  return cacheAssetObjectUrl(metadata.hash, blob);
}

function imageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("缩略图解码失败"));
    };
    image.src = objectUrl;
  });
}

function canvasAsBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("缩略图生成失败")),
      "image/webp",
      0.78,
    );
  });
}

async function resolveAssetThumbnailSource(reference) {
  const metadata = await getAssetMetadata(reference);
  if (!metadata) throw new Error("图片资产记录不存在");
  let thumbnail = await indexedStoreGet(ASSET_THUMBNAIL_STORE, metadata.hash);
  if (!(thumbnail instanceof Blob)) {
    const original = await sourceImageBlob(reference);
    const image = await imageElementFromBlob(original);
    const maxEdge = 420;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
    thumbnail = await canvasAsBlob(canvas);
    await indexedStorePut(ASSET_THUMBNAIL_STORE, thumbnail, metadata.hash);
  }
  return cacheAssetObjectUrl(`thumbnail:${metadata.hash}`, thumbnail);
}

function looksLikeStoredImage(value, key = "") {
  if (typeof value !== "string" || !value.trim()) return false;
  if (/^(?:avatarUrl|imageUrl|visualBaseImageUrl)$/i.test(key)) return true;
  return /^(?:data:image\/|asset:\/\/|file:|_(?:doc|downloads?)\/|\/storage\/|\/data\/)/i.test(value);
}

function collectImageReferences(value, key = "", result = new Set()) {
  if (typeof value === "string") {
    if (looksLikeStoredImage(value, key)) result.add(value);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageReferences(item, key, result));
    return result;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, item]) => collectImageReferences(item, childKey, result));
  }
  return result;
}

function replaceImageReferences(value, replacements, key = "") {
  if (typeof value === "string") {
    return looksLikeStoredImage(value, key) ? replacements.get(value) || value : value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceImageReferences(item, replacements, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [
        childKey,
        replaceImageReferences(item, replacements, childKey),
      ]),
    );
  }
  return value;
}

function migrationCategoryForSource(source, root) {
  const job = root.imageJobs.find((item) => item?.imageUrl === source);
  if (job?.kind === "character" || job?.kind === "visual-state") return "character";
  if (job) return "scene";
  return "character";
}

function legacySourceKey(source) {
  const text = String(source || "");
  const sample = text.length > 4096
    ? `${text.slice(0, 2048)}|${text.length}|${text.slice(-2048)}`
    : text;
  const bytes = typeof TextEncoder === "function"
    ? new TextEncoder().encode(sample)
    : Uint8Array.from(unescape(encodeURIComponent(sample)), (character) => character.charCodeAt(0));
  return `legacy-${sha256HexBytes(bytes)}`;
}

async function migrateIndexedDbAssetToAppFile(metadata) {
  const blob = await indexedStoreGet(ASSET_BLOB_STORE, metadata.hash);
  if (!(blob instanceof Blob) || !blob.size) throw new Error("IndexedDB 原图内容不存在");
  const appPath = await saveAssetBlobToApp(metadata.hash, blob);
  if (!appPath) throw new Error("App 文件服务暂不可用");
  const plus = await waitForPlus(3000);
  const verifiedSize = await plusPathFileSize(plus, appPath);
  if (verifiedSize !== Number(blob.size)) throw new Error("App 文件写入校验失败");
  const updated = {
    ...metadata,
    backend: "app-file",
    path: appPath,
    size: blob.size,
    updatedAt: new Date().toISOString(),
  };
  await indexedStorePut(ASSET_STORE, updated);
  assetMetadataCache.set(metadata.hash, updated);
  await indexedStoreDelete(ASSET_BLOB_STORE, metadata.hash);
  return updated;
}

async function migrateLegacyImages() {
  const root = {
    settings: loadSettings(),
    messages: loadHistory(),
    imageJobs: loadImageJobs(),
    archivedMessages: await indexedStoreGetAll(MESSAGE_STORE),
  };
  const sources = [...collectImageReferences(root)].filter((source) => !isAssetReference(source));
  const plus = await waitForPlus(1500);
  const indexedDbAssets = plus?.io
    ? (await indexedStoreGetAll(ASSET_STORE)).filter((asset) => asset?.backend === "indexeddb")
    : [];
  const previous = await indexedStoreGet(META_STORE, "asset-migration-v1") || {};
  const savedReplacements = previous.replacements || {};
  const replacements = new Map();
  const successfulSources = [];
  const state = {
    status: sources.length || indexedDbAssets.length ? "running" : "completed",
    total: sources.length + indexedDbAssets.length,
    completed: 0,
    failed: 0,
    migratedAssets: 0,
    migratedLegacyReferences: 0,
    current: "",
    replacements: { ...savedReplacements },
    errors: [],
    startedAt: previous.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await indexedStorePut(META_STORE, state, "asset-migration-v1");
  for (const metadata of indexedDbAssets) {
    state.current = metadata.reference || `asset://${metadata.hash}`;
    try {
      await migrateIndexedDbAssetToAppFile(metadata);
      state.completed += 1;
      state.migratedAssets += 1;
    } catch (error) {
      state.failed += 1;
      state.errors.push({
        source: metadata.reference || `asset://${metadata.hash}`,
        error: error instanceof Error ? error.message : "App 文件迁移失败",
      });
      state.errors = state.errors.slice(-30);
    }
    state.updatedAt = new Date().toISOString();
    await indexedStorePut(META_STORE, state, "asset-migration-v1");
  }
  for (const source of sources) {
    const sourceKey = legacySourceKey(source);
    state.current = String(source).slice(0, 180);
    try {
      let reference = savedReplacements[sourceKey];
      if (!reference || !(await getAssetMetadata(reference))) {
        reference = await storeImageAsset(source, migrationCategoryForSource(source, root));
      }
      replacements.set(source, reference);
      successfulSources.push(source);
      state.completed += 1;
      state.migratedLegacyReferences += 1;
      state.replacements[sourceKey] = reference;
    } catch (error) {
      state.failed += 1;
      state.errors.push({
        source: String(source).slice(0, 240),
        error: error instanceof Error ? error.message : "迁移失败",
      });
      state.errors = state.errors.slice(-30);
    }
    state.updatedAt = new Date().toISOString();
    await indexedStorePut(META_STORE, state, "asset-migration-v1");
  }
  if (replacements.size) {
    const replaced = replaceImageReferences(root, replacements);
    saveSettings(replaced.settings);
    saveHistory(replaced.messages);
    saveImageJobs(replaced.imageJobs);
    await archiveMessages(replaced.archivedMessages, replaced.settings.storyClock);
    await flushMobileStorage();
    for (const source of successfulSources) {
      if (/(?:^|[\\/])night-mailbox[\\/]/i.test(source)) {
        await deleteMobileGeneratedImageFile(source);
      }
    }
  }
  if (!state.failed) {
    state.status = "completed";
    state.current = "";
    state.completedAt = new Date().toISOString();
  } else {
    state.status = state.completed ? "partial" : "paused";
    state.current = "";
  }
  state.updatedAt = new Date().toISOString();
  await indexedStorePut(META_STORE, state, "asset-migration-v1");
  return state;
}

async function assetStorageStatus() {
  const plus = await waitForPlus(1500);
  const assets = await indexedStoreGetAll(ASSET_STORE);
  const storedMigration = await indexedStoreGet(META_STORE, "asset-migration-v1");
  const migration = assetMigrationPromise
    ? { ...(storedMigration || {}), status: "running" }
    : storedMigration;
  const archivedMessages = await indexedStoreGetAll(MESSAGE_STORE);
  const legacySources = [...collectImageReferences({
    settings: loadSettings(),
    messages: loadHistory(),
    imageJobs: loadImageJobs(),
    archivedMessages,
  })].filter((source) => !isAssetReference(source));
  return {
    assetCount: assets.length,
    appFileCount: assets.filter((asset) => asset.backend === "app-file").length,
    indexedDbCount: assets.filter((asset) => asset.backend === "indexeddb").length,
    migratableAssetCount: plus?.io
      ? assets.filter((asset) => asset.backend === "indexeddb").length
      : 0,
    totalBytes: assets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0),
    legacyCount: legacySources.length,
    migration: migration || {
      status: legacySources.length ? "not-started" : "completed",
      total: legacySources.length,
      completed: 0,
      failed: 0,
    },
    backend: plus?.io ? "app-file" : "indexeddb",
  };
}

async function deleteAssetIfUnreferenced(reference) {
  const hash = assetHashFromReference(reference);
  if (!hash) return false;
  const references = collectImageReferences({
    settings: loadSettings(),
    messages: loadHistory(),
    imageJobs: loadImageJobs(),
    archivedMessages: await indexedStoreGetAll(MESSAGE_STORE),
  });
  if (references.has(reference)) return false;
  const metadata = await getAssetMetadata(reference);
  if (!metadata) return false;
  if (metadata.backend === "app-file" && metadata.path) {
    const plus = await waitForPlus(3000);
    if (plus?.io) {
      try {
        const entry = await resolvePlusEntry(plus, metadata.path);
        await new Promise((resolve) => entry.remove(resolve, resolve));
      } catch {}
    }
    plusFileEntryCache.delete(metadata.path);
  }
  await Promise.all([
    indexedStoreDelete(ASSET_STORE, hash),
    indexedStoreDelete(ASSET_BLOB_STORE, hash),
    indexedStoreDelete(ASSET_THUMBNAIL_STORE, hash),
  ]);
  assetMetadataCache.delete(hash);
  for (const cacheKey of [hash, `thumbnail:${hash}`]) {
    const objectUrl = assetObjectUrlCache.get(cacheKey);
    if (!objectUrl) continue;
    assetObjectUrlCache.delete(cacheKey);
    if (String(objectUrl).startsWith("blob:")) URL.revokeObjectURL(objectUrl);
  }
  return true;
}

// ---------- 浏览器 fetch 与 App WebView 原生网络兼容 ----------
async function nativeFetchRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeout || 120000);
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new Error("直连接口请求超时"));
      }, timeoutMs);
    });
    const response = await Promise.race([
      originalFetch(url, { ...options, signal: controller.signal }),
      timeout,
    ]);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      headers: response.headers,
    };
  } catch (error) {
    if (error?.name === "AbortError" || error?.message === "直连接口请求超时") {
      const timeoutError = new Error("直连接口请求超时");
      timeoutError.diagnostic = {
        stage: "browser-network-timeout",
        requestUrl: String(url).replace(/[?#].*$/, "").slice(0, 500),
        timeoutMs,
        rawResponse: "",
      };
      throw timeoutError;
    }
    const networkError = new Error("浏览器无法直连接口；请确认网络正常，并且中转站允许 CORS 跨域请求");
    networkError.diagnostic = {
      stage: "browser-network-or-cors",
      requestUrl: String(url).replace(/[?#].*$/, "").slice(0, 500),
      timeoutMs,
      browserError: String(error?.message || error).slice(0, 1000),
      rawResponse: "",
    };
    throw networkError;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function nativeHttpRequest(url, options = {}) {
  if (options.body instanceof FormData) {
    return nativeFetchRequest(url, options);
  }
  const plus = await waitForPlus();
  if (!plus?.net?.XMLHttpRequest) {
    return nativeFetchRequest(url, options);
  }
  return new Promise((resolve, reject) => {
    const xhr = new plus.net.XMLHttpRequest();
    xhr.timeout = Number(options.timeout || 120000);
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      const status = Number(xhr.status || 0);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        text: typeof xhr.responseText === "string" ? xhr.responseText : String(xhr.response || ""),
        headers: {
          get(name) {
            return xhr.getResponseHeader?.(name) || "";
          },
        },
      });
    };
    xhr.onerror = () => reject(new Error("安卓网络请求失败"));
    xhr.ontimeout = () => reject(new Error("安卓网络请求超时"));
    xhr.open(options.method || "GET", url);
    Object.entries(options.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, String(value)));
    xhr.send(options.body || null);
  });
}

function parseJsonText(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

// ---------- 对话模型请求与响应兼容 ----------
function getProvider(body) {
  const config = getMobileApiConfig();
  return {
    id: "chat",
    key: config.chatApiKey,
    baseUrl: config.chatBaseUrl,
    model: String(body?.model || "").trim(),
    stream: config.chatStream !== false,
  };
}

function completionPartText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.text?.value === "string") return value.text.value;
  if (typeof value.content === "string") return value.content;
  return "";
}

function completionContent(result) {
  const choice = result?.choices?.[0];
  const message = choice?.message || {};
  const candidates = [
    message.content,
    message.refusal,
    choice?.text,
    result?.output_text,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const combined = candidate.map(completionPartText).join("").trim();
      if (combined) return combined;
      continue;
    }
    const text = completionPartText(candidate).trim();
    if (text) return text;
  }
  return "";
}

function chatResponseShape(result) {
  const choice = result?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const contentText = Array.isArray(content)
    ? content.map(completionPartText).join("")
    : (typeof content === "string" ? content : "");
  return {
    topLevelKeys: result && typeof result === "object" ? Object.keys(result).slice(0, 30) : [],
    choicesCount: Array.isArray(result?.choices) ? result.choices.length : 0,
    choiceKeys: choice && typeof choice === "object" ? Object.keys(choice).slice(0, 30) : [],
    messageKeys: message && typeof message === "object" ? Object.keys(message).slice(0, 30) : [],
    messageContentKind: Array.isArray(content) ? "array" : typeof content,
    messageContentLength: contentText.length,
    messageContentTrimmedLength: contentText.trim().length,
    messageContentCodePoints: [...contentText.slice(0, 40)].map((character) => character.codePointAt(0)),
    hasRefusal: Boolean(String(message?.refusal || "").trim()),
    hasReasoningContent: typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0,
    reasoningContentLength: typeof message?.reasoning_content === "string" ? message.reasoning_content.length : 0,
    streamComplete: result?.stream_complete !== false,
    doneReceived: result?.done_received === true,
    chunkCount: Number(result?.chunk_count || 0),
    streamedReasoningLength: Number(result?.reasoning_content_length || 0),
  };
}

function parseSseChatCompletion(value) {
  const text = String(value || "");
  let content = "";
  let reasoningContentLength = 0;
  let finishReason = "";
  let usage = {};
  let chunkCount = 0;
  let doneReceived = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const raw = trimmed.slice(5).trim();
    if (!raw) continue;
    if (raw === "[DONE]") {
      doneReceived = true;
      continue;
    }
    const chunk = parseJsonText(raw, null);
    if (!chunk || typeof chunk !== "object") continue;
    chunkCount += 1;
    const choice = chunk?.choices?.[0];
    const part = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
    const reasoningPart = choice?.delta?.reasoning_content
      ?? choice?.message?.reasoning_content;
    if (Array.isArray(part)) content += part.map(completionPartText).join("");
    else content += completionPartText(part);
    reasoningContentLength += completionPartText(reasoningPart).length;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;
  }
  if (!chunkCount) return null;
  return {
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason || null,
    }],
    usage,
    transport: "sse",
    chunk_count: chunkCount,
    done_received: doneReceived,
    stream_complete: doneReceived || (Boolean(finishReason) && finishReason !== "length"),
    reasoning_content_length: reasoningContentLength,
  };
}

function parseChatCompletionResponse(response) {
  const json = parseJsonText(response?.text, null);
  if (json && typeof json === "object") return { result: json, transport: "json" };
  const sse = parseSseChatCompletion(response?.text);
  if (sse) return { result: sse, transport: "sse" };
  return { result: null, transport: "unknown" };
}

function responseDiagnostic(response, stage, extra = {}) {
  const readHeader = (name) => {
    try { return response?.headers?.get?.(name) || ""; } catch { return ""; }
  };
  const rawResponse = String(response?.text || "");
  return {
    stage,
    status: Number(response?.status || 0),
    contentType: readHeader("content-type"),
    requestId: readHeader("x-request-id")
      || readHeader("x-oneapi-request-id")
      || readHeader("x-ds-trace-id"),
    rawResponse: rawResponse.slice(0, 100000),
    rawResponseLength: rawResponse.length,
    rawResponseTruncated: rawResponse.length > 100000,
    ...extra,
  };
}

function modelResponseError(message, response, stage, extra = {}) {
  const error = new Error(message);
  error.diagnostic = responseDiagnostic(response, stage, extra);
  return error;
}

async function callChatModel(body, messages, options = {}) {
  const provider = getProvider(body);
  if (!provider.key || !provider.baseUrl) throw new Error(`${provider.id} 尚未在 App API 设置中配置`);
  if (!provider.model) throw new Error("请先查询模型目录并选择一个对话模型");
  const inputTextForEstimate = JSON.stringify(messages || []);
  const payload = {
    model: options.model || provider.model,
    messages,
    stream: typeof options.stream === "boolean" ? options.stream : provider.stream,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1800,
  };
  const request = (requestPayload = payload) => nativeHttpRequest(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify(requestPayload),
      timeout: options.timeout || 180000,
    });
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await request();
      if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    const retryDelay = response?.status === 503 || response?.status === 429 ? 2500 : 800;
    await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
  }
  if (!response.ok) {
    throw modelResponseError(
      `模型请求失败（${response.status}）：${response.text.slice(0, 500)}`,
      response,
      "upstream-http",
      { provider: provider.id, model: payload.model },
    );
  }
  let parsedResponse = parseChatCompletionResponse(response);
  let result = parsedResponse.result;
  if (!result || typeof result !== "object") {
    throw modelResponseError(
      "模型返参不是有效 JSON",
      response,
      "response-json-parse",
      { provider: provider.id, model: payload.model, transport: parsedResponse.transport },
    );
  }
  let content = completionContent(result);
  const incompleteStream = parsedResponse.transport === "sse"
    && result?.stream_complete === false;
  let firstRecoveryDiagnostic = null;
  let recoveryPayload = null;
  if (!content || incompleteStream) {
    firstRecoveryDiagnostic = responseDiagnostic(
      response,
      incompleteStream ? "incomplete-sse-first-attempt" : "empty-content-first-attempt",
      {
        provider: provider.id,
        model: payload.model,
        finishReason: result?.choices?.[0]?.finish_reason || "",
        usage: result?.usage || {},
        expectsStructuredOutput: Boolean(options.expectsStructuredOutput),
        streamEnabled: payload.stream,
        transport: parsedResponse.transport,
        responseShape: chatResponseShape(result),
      },
    );
    recoveryPayload = payload.stream === false
      ? payload
      : { ...payload, stream: false };
    response = await request(recoveryPayload);
    if (!response.ok) {
      throw modelResponseError(
        `对话模型响应恢复失败（${response.status}）：${response.text.slice(0, 500)}`,
        response,
        "content-recovery-http",
        {
          provider: provider.id,
          model: payload.model,
          firstAttempt: firstRecoveryDiagnostic,
          retryRequestIdentical: recoveryPayload === payload,
          recoveryStream: recoveryPayload.stream,
        },
      );
    }
    parsedResponse = parseChatCompletionResponse(response);
    result = parsedResponse.result;
    if (!result || typeof result !== "object") {
      throw modelResponseError(
        "对话模型恢复请求返参不是有效 JSON",
        response,
        "content-recovery-json-parse",
        {
          provider: provider.id,
          model: payload.model,
          firstAttempt: firstRecoveryDiagnostic,
          retryRequestIdentical: recoveryPayload === payload,
          recoveryStream: recoveryPayload.stream,
          transport: parsedResponse.transport,
        },
      );
    }
    content = completionContent(result);
  }
  if (!content) {
    const choice = result?.choices?.[0];
    const usage = result?.usage || {};
    throw modelResponseError(
      `模型没有返回有效内容；finish_reason=${choice?.finish_reason || "unknown"}，`
        + `completion_tokens=${usage.completion_tokens ?? "unknown"}，`
        + `reasoning_tokens=${usage.completion_tokens_details?.reasoning_tokens ?? "unknown"}`,
      response,
      "empty-content",
      {
        provider: provider.id,
        model: payload.model,
        finishReason: choice?.finish_reason || "",
        usage,
        firstAttempt: firstRecoveryDiagnostic,
        retryRequestIdentical: recoveryPayload === payload,
        recoveryStream: recoveryPayload?.stream,
        streamEnabled: payload.stream,
        transport: parsedResponse.transport,
        responseShape: chatResponseShape(result),
      },
    );
  }
  recordTokenUsage(options.category, result?.usage, inputTextForEstimate, content, payload.model);
  return content;
}

async function repairMultiTurns(body, content, maxParticipants) {
  const repairedContent = await callChatModel(body, [
    {
      role: "system",
      content: `你是多人对话 JSON 格式修复器。把用户提供的模型回复整理成一个 JSON 对象，只输出这个 JSON，不添加任何解释、说明或前后缀文字，不包裹在 \`\`\`json 代码块里，不使用 JSON Output / JSON mode 等结构化输出功能。

必须直接以 { 开头、以 } 结尾输出下面结构（键名英文半角、值中文、每个字段都出现、没有内容用空字符串 "" 占位、字符串内不要出现未转义的双引号、不要单引号、不要残留结尾逗号）：
{"scene":"共享场景","turns":[{"speaker":"角色名","scene":"角色所在场景","mood":"心情","action":"动作","dialogue":"台词","progression":"","visual":{"preferredStateId":"状态ID","emotion":"情绪","action":"动作","intensity":0.7,"sequence":[]}}]}

最多保留 ${maxParticipants} 位不同角色和 ${maxEnsembleMessages(maxParticipants)} 条消息。同一角色可以多次回复，但每条只能包含该角色自己的动作和台词。按实际发生顺序排列，只有最后一条 progression 非空。只整理原回复里已经存在的剧情，不引入无关人物或新世界。`,
    },
    {
      role: "user",
      content: `请修复下面的多人回复，只输出整理后的 JSON：\n\n${String(content || "").slice(0, 30000)}`,
    },
  ], {
    temperature: 0.1,
    maxTokens: maxEnsembleOutputTokens(maxParticipants),
    expectsStructuredOutput: true,
    stream: false,
    category: "chat",
  });
  return parseMultiTurns(repairedContent, maxParticipants);
}

// ---------- 角色、多人回复与长期记忆 ----------
function roleRoster(profile, ensemble) {
  return [
    { id: "primary", type: "主角色", ...profile },
    { id: "friend", type: "固定角色", ...(ensemble?.friend || {}) },
    ...(Array.isArray(ensemble?.customRoles) ? ensemble.customRoles.map((role) => ({ type: "固定角色", ...role })) : []),
    ...(Array.isArray(ensemble?.temporaryRoles) ? ensemble.temporaryRoles.map((role) => ({ type: "临时角色", ...role })) : []),
  ].filter((role) => role?.name);
}

function roleDerivedState(role, storyDay = 1) {
  const source = role?.derivedProfile && typeof role.derivedProfile === "object"
    ? role.derivedProfile
    : {};
  const initialActualAge = source.initialActualAge !== null
    && source.initialActualAge !== ""
    && Number.isFinite(Number(source.initialActualAge))
    ? Number(source.initialActualAge)
    : Number.isFinite(Number(role?.age))
      ? Number(role.age)
      : null;
  const initialApparentAge = source.initialApparentAge !== null
    && source.initialApparentAge !== ""
    && Number.isFinite(Number(source.initialApparentAge))
    ? Number(source.initialApparentAge)
    : initialActualAge;
  const anchorStoryDay = Math.max(1, Number(source.anchorStoryDay) || 1);
  const elapsedYears = Math.max(0, Math.floor((Math.max(1, Number(storyDay) || 1) - anchorStoryDay) / 365));
  const agingRule = ["normal", "fixed", "long-lived", "ageless", "unknown"].includes(source.agingRule)
    ? source.agingRule
    : "unknown";
  return {
    actualAge: initialActualAge === null
      ? null
      : agingRule === "ageless"
        ? initialActualAge
        : initialActualAge + elapsedYears,
    apparentAge: initialApparentAge === null
      ? null
      : agingRule === "normal"
        ? initialApparentAge + elapsedYears
        : initialApparentAge,
    agingRule,
    corePersonality: String(source.corePersonality || role?.personality || "按人物提示词表现").trim(),
    characterDevelopment: String(source.characterDevelopment || "").trim(),
  };
}

function roleDerivedLabel(role, storyDay) {
  const state = roleDerivedState(role, storyDay);
  const age = state.actualAge === null
    ? "年龄未明确"
    : state.apparentAge !== null && state.apparentAge !== state.actualAge
      ? `实际${state.actualAge}岁、外表约${state.apparentAge}岁`
      : `${state.actualAge}岁`;
  return `${age}｜${state.corePersonality || "按人物提示词表现"}`;
}

function retrievalTerms(text) {
  const normalized = String(text || "").toLowerCase();
  const terms = new Set(normalized.match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,6}/g) || []);
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (/^[\u4e00-\u9fff]{2}$/.test(pair)) terms.add(pair);
  }
  return [...terms].slice(0, 80);
}

async function retrieveRelevantMemory(body, messages) {
  if (!indexedDatabase) return "";
  const [facts, episodes, archivedMessages] = await Promise.all([
    indexedStoreGetAll(MEMORY_FACT_STORE),
    indexedStoreGetAll(EPISODE_STORE),
    indexedStoreGetAll(MESSAGE_STORE),
  ]);
  if (!facts.length && !episodes.length && !archivedMessages.length) return "";
  const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const terms = retrievalTerms(latestUser);
  const roster = roleRoster(body.profile || {}, body.ensemble || {});
  const mentionedRoleIds = roster
    .filter((role) => latestUser.includes(role.name))
    .map((role) => role.id);
  const scoredFacts = facts.map((fact) => {
    const content = String(fact?.content || "");
    const roleScore = (fact?.subjectRoleIds || []).some((id) => mentionedRoleIds.includes(id)) ? 9 : 0;
    const termScore = terms.reduce((score, term) => score + (content.toLowerCase().includes(term) ? 1 : 0), 0);
    const statusScore = fact?.status === "active" ? 2 : 0;
    const typeScore = ["promise", "relationship", "secret"].includes(fact?.type) ? 2 : 0;
    return { fact, score: roleScore + termScore + statusScore + typeScore + (Number(fact?.importance) || 1) };
  }).sort((left, right) =>
    right.score - left.score
    || String(right.fact?.updatedAt || "").localeCompare(String(left.fact?.updatedAt || "")),
  );
  const selectedFacts = scoredFacts
    .filter((item, index) => item.score > 3 || index < 6)
    .slice(0, 18)
    .map(({ fact }) => `- [${fact.type}] ${fact.content}`);
  const selectedEpisodes = episodes
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 4)
    .map((episode) => `- ${episode.title}：${episode.summary}`);
  const recentContents = new Set(messages.map((message) => String(message.content || "").slice(0, 600)));
  const selectedRawMessages = archivedMessages
    .filter((message) => !recentContents.has(String(message?.content || "").slice(0, 600)))
    .map((message) => {
      const content = String(message?.content || "");
      const termScore = terms.reduce((score, term) => score + (content.toLowerCase().includes(term) ? 1 : 0), 0);
      const roleScore = mentionedRoleIds.includes(String(message?.speakerId || "")) ? 6 : 0;
      return { message, score: termScore + roleScore };
    })
    .sort((left, right) =>
      right.score - left.score
      || String(right.message?.createdAt || "").localeCompare(String(left.message?.createdAt || "")),
    )
    .filter((item, index) => item.score > 0 || index < 4)
    .slice(0, 10)
    .map(({ message }) =>
      `- 第${message.storyDay || "?"}天 ${message.role === "user" ? "用户" : message.speaker || "角色"}：`
      + String(message.content || "").replace(/\s+/g, " ").slice(0, 700),
    );
  return [
    selectedFacts.length ? `可检索事实：\n${selectedFacts.join("\n")}` : "",
    selectedEpisodes.length ? `最近剧情章节：\n${selectedEpisodes.join("\n")}` : "",
    selectedRawMessages.length ? `与当前话题相关的原始历史片段：\n${selectedRawMessages.join("\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 10000);
}

function buildChatSystem(body) {
  const profile = body.profile || {};
  const userProfile = body.userProfile || {};
  const ensemble = body.ensemble || {};
  const storyClock = normalizeStoryClock(body.storyClock);
  const storyEvents = normalizeStoryEvents(body.storyEvents)
    .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status))
    .slice(0, 30);
  const scheduleText = storyEvents.length
    ? storyEvents.map((event) =>
        `- ${event.day === null
          ? "日期待确认"
          : formatStoryMoment({ ...storyClock, day: event.day, segment: event.segment })}：${event.title}`
        + `${event.participants.length ? `；参与者：${event.participants.join("、")}` : ""}`
        + `${event.location ? `；地点：${event.location}` : ""}`
        + `；状态：${event.status}`,
      ).join("\n")
    : "暂无已记录的未来约定。";
  const timeContext = `【剧情时间与日程】
当前时间：${formatStoryMoment(storyClock)}
${storyClock.location ? `当前地点：${storyClock.location}` : ""}
${scheduleText}
角色遵守剧情中已经确定的时间与约定；待确认约定只能自然询问，不能当作必然已经决定的事实。不要擅自替用户完成重要日程。`;
  const roster = roleRoster(profile, ensemble);
  const rosterText = roster.map((role) => {
    const memory = body.roleMemories?.[role.id] || {};
    const derived = roleDerivedState(role, storyClock.day);
    return `- ${role.name}｜${roleDerivedLabel(role, storyClock.day)}｜成长规则：${derived.agingRule}｜${role.gender || "未指定"}｜${String(role.relation || "当前剧情角色").slice(0, 160)}
  行为：${String(role.prompt || "按当前身份自然参与剧情。").slice(0, 900)}
  外观：${String(role.appearance || "沿用最近剧情。").slice(0, 700)}
  当前发展：${String(derived.characterDevelopment || "以最近剧情表现为准。").slice(0, 500)}
  长期记忆：${String([memory.relationshipMemory, memory.importantEvents, memory.currentStatus, memory.lastKnownScene, memory.commitments].filter(Boolean).join("；") || "暂无").slice(0, 1500)}`;
  }).join("\n");
  const primaryDerived = roleDerivedState(profile, storyClock.day);
  const style = renderSystemPrompt(body.systemPrompt || DEFAULT_SYSTEM_PROMPT, {
    ...profile,
    age: primaryDerived.actualAge ?? "",
    personality: primaryDerived.corePersonality,
  });
  const visualStateIds = DEFAULT_ROLE_VISUAL_STATES.map((state) => state.id).join(", ");
  const multi = body.responseMode === "multi" && ensemble.enabled !== false
    ? `\n【多人返回结构】
必须只输出一个合法的 JSON 对象：直接以 { 开头、以 } 结尾，不包裹在 \`\`\`json 代码块里，不缩进到其他标记内，不使用 JSON Output / JSON mode 等结构化输出功能，不输出任何 JSON 之外的解释、说明、前后缀或问候语。

严格结构（键名必须使用英文半角，值使用中文）：
{"scene":"共享场景","turns":[{"speaker":"角色名","scene":"角色所在场景","mood":"心情","action":"动作","dialogue":"台词","progression":"","visual":{"preferredStateId":"固定立绘状态","emotion":"情绪标签","action":"动作标签","intensity":0.7,"sequence":[]}}]}

字段规则：
- turns 不能是空数组；每个 turn 的 speaker 必须来自人物名册，dialogue 只写该角色自己的台词。
- scene/mood/action/dialogue/progression/visual 每个字段都要出现，没有内容就用空字符串 "" 占位，不要省略字段。
- 所有值用半角引号包裹，字符串内不要出现未转义的双引号；不要使用单引号代替双引号。
- 只有最后一条 progression 非空；turns 内部不要残留逗号结尾。
本轮最多出现 ${Math.min(10, Math.max(1, Number(ensemble.maxTurns) || 3))} 位不同角色，turns 最多 ${maxEnsembleMessages(ensemble.maxTurns)} 条，但这是安全上限，不要为了用满而拆句或凑消息。同一 speaker 可以在互动后再次回复，但每条只能写自己的动作和台词，不能在 dialogue 里代写其他角色台词；换人必须另建 turn。严格按时间顺序排列：后一条要自然承接前一条并带来新信息、新反应或新动作，避免重复，只有连续动作确实需要分段时才让同一 speaker 连续出现。只安排当前场景需要的人物，优先使用能完整推动剧情的最短轮次；只有最后一条 progression 非空，完成推进后立即停下让用户接话。`
    : "";
  return `【提示词优先级】
世界设定 → 人物稳定身份与关系 → 角色长期记忆 → 已发生剧情与最近对话 → 回复风格。不要在回复中复述规则。

【世界设定】
${String(body.worldSetting || "沿用对话自然形成的世界。").slice(0, 8000)}

【剧情摘要】
${String(body.storySummary || "以最近对话为准。").slice(0, 9000)}

【用户档案】
姓名或称呼：${String(userProfile.name || "主角").slice(0, 40)}
性别：${String(userProfile.gender || "未指定").slice(0, 20)}
代词或称谓：${String(userProfile.pronoun || "TA").slice(0, 20)}
用户档案只用于正确称呼，不得据此推断性格、能力、职业或与角色的关系；不要替用户发言。

【本地检索到的相关长期记忆】
${String(body.retrievedMemory || "暂无额外检索结果。").slice(0, 10000)}

【人物名册】
${rosterText}

【回复风格】
${String(style).slice(0, 4000)}

每轮必须让局面产生一个已经发生的明确变化，而不是只提问或等待。保持地点、人物位置、衣着、物品和未完成动作连续。${multi}

【独立HTML立绘标签】
每条 turn 的 visual 必须选择最接近当前表演的固定状态，不要创造新的状态ID。
preferredStateId 可选：${visualStateIds}
emotion 可选：${ROLE_VISUAL_EMOTIONS.join(", ")}
action 可选：${ROLE_VISUAL_ACTIONS.join(", ")}
intensity 为 0 到 1。visual 只控制前端立绘，不要在 dialogue 中朗读标签。
【动态表演序列】visual 可增加 sequence 数组，包含 1–4 个按时间顺序播放的阶段；每项结构为 {"preferredStateId":"固定状态ID","emotion":"情绪","action":"动作","intensity":0.5,"durationMs":1200}。当情绪或动作发生变化时必须写出过程，例如平静→吃惊→开心、伤心→擦泪→安心、警戒→施法→放松；不要只返回最终情绪。没有明显变化时只用一个阶段。durationMs 使用 700–2600。

【最近上下文】
${timeContext}`;
}

function unwrapMultiPayload(value) {
  if (Array.isArray(value)) return { scene: "", turns: value };
  if (!value || typeof value !== "object") return null;
  const candidates = [value, value.data, value.result, value.response];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return { scene: value.scene || "", turns: candidate };
    if (!candidate || typeof candidate !== "object") continue;
    const turns = candidate.turns || candidate.messages || candidate.replies;
    if (Array.isArray(turns)) {
      return { scene: candidate.scene || value.scene || "", turns };
    }
  }
  return null;
}

function parseMultiTurns(content, maxTurns) {
  const parsedValue = parseLooseJsonObject(content, (value) => Boolean(unwrapMultiPayload(value)))
    || parseLooseJsonArray(content, (value) => value.some((item) => item && typeof item === "object"));
  const parsed = unwrapMultiPayload(parsedValue);
  if (!parsed) return [];
  const turns = parsed.turns.slice(0, maxEnsembleMessages(maxTurns) * 2).map((turn, index) => {
    const speaker = String(turn?.speaker || turn?.name || turn?.character || "").trim();
    const scene = String(turn?.scene || turn?.location || (index === 0 ? parsed.scene : "") || "").trim();
    const mood = String(turn?.mood || turn?.emotion || "").trim();
    const action = String(turn?.action || "").trim();
    const dialogue = String(turn?.dialogue || turn?.text || turn?.message || "").trim();
    const formattedContent = !dialogue && typeof turn?.content === "string"
      ? turn.content.trim()
      : "";
    const progression = String(turn?.progression || turn?.progress || turn?.next || "").trim();
    const visual = turn?.visual && typeof turn.visual === "object"
      ? {
          preferredStateId: String(turn.visual.preferredStateId || "").trim(),
          emotion: String(turn.visual.emotion || mood || "").trim(),
          action: String(turn.visual.action || "").trim(),
          intensity: Math.min(1, Math.max(0, Number(turn.visual.intensity) || 0.5)),
          sequence: (Array.isArray(turn.visual.sequence) ? turn.visual.sequence : [])
            .slice(0, 4)
            .map((frame) => ({
              preferredStateId: String(frame?.preferredStateId || "").trim(),
              emotion: String(frame?.emotion || "").trim(),
              action: String(frame?.action || "").trim(),
              intensity: Math.min(1, Math.max(0, Number(frame?.intensity) || 0.5)),
              durationMs: Math.min(2600, Math.max(700, Number(frame?.durationMs) || 1200)),
            })),
        }
      : {
          preferredStateId: "",
          emotion: mood,
          action: "",
          intensity: 0.5,
          sequence: [],
        };
    const parts = [];
    if (scene) parts.push(`\u3010\u573a\u666f\u3011\n${scene}`);
    if (mood) parts.push(`\u3010\u5fc3\u60c5\u3011\n${mood}`);
    if (action) parts.push(`\u3010\u52a8\u4f5c\u3011\n${action}`);
    if (dialogue) parts.push(`\u3010\u5bf9\u8bdd\u3011\n${dialogue}`);
    if (progression) parts.push(`\u3010\u5267\u60c5\u63a8\u8fdb\u3011\n${progression}`);
    return {
      speaker,
      content: parts.join("\n\n") || formattedContent,
      progression,
      mood,
      action,
      visual,
    };
  }).filter((turn) => turn.speaker && turn.content);
  return limitEnsembleTurns(turns, maxTurns);
}

async function handleChat(body) {
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .slice(-16)
    .map((item) => ({
      role: item.role,
      content: `${item.role === "assistant" && item.speaker ? `${item.speaker}：` : ""}${item.content.slice(0, 2400)}`,
    }));
  const multiMessageMode = body.responseMode === "multi" && body.ensemble?.enabled !== false;
  const maxParticipants = Math.min(10, Math.max(1, Number(body.ensemble?.maxTurns) || 3));
  const retrievedMemory = await retrieveRelevantMemory(body, messages);
  let content;
  try {
    content = await callChatModel(body, [
      {
        role: "system",
        content: buildChatSystem({ ...body, retrievedMemory }),
      },
      ...messages,
    ], {
      temperature: multiMessageMode ? 0.65 : 0.8,
      maxTokens: multiMessageMode ? maxEnsembleOutputTokens(maxParticipants) : 2200,
      expectsStructuredOutput: multiMessageMode,
      category: "chat",
    });
  } catch (error) {
    if (error?.diagnostic?.stage !== "empty-content") throw error;
    const selectedProvider = getProvider(body);
    const fallbackText = "刚才对话模型连续返回了空白或不完整内容。我先停在这里，不会让角色自行继续。你可以重新发送刚才的话，我会从当前剧情接着回复。";
    if (!multiMessageMode) {
      return textResponse(fallbackText, 200, {
        "X-Chat-Provider": "chat",
        "X-Chat-Model": getProvider(body).model,
        "X-Chat-Fallback": "empty-content",
      });
    }
    return jsonResponse({
      turns: [{
        speaker: body.profile?.name || "岚",
        content: fallbackText,
      }],
      fallback: "empty-content",
      retried: true,
      provider: "chat",
      model: selectedProvider.model,
      diagnostic: error.diagnostic,
    });
  }
  if (multiMessageMode) {
    let turns = parseMultiTurns(content, maxParticipants);
    let repaired = false;
    let repairFailure = null;
    if (!turns.length) {
      try {
        turns = await repairMultiTurns(body, content, maxParticipants);
        repaired = turns.length > 0;
      } catch (error) {
        repairFailure = {
          message: String(error?.message || error).slice(0, 1000),
          diagnostic: error?.diagnostic || null,
        };
      }
    }
    if (!turns.length) {
      const selectedProvider = getProvider(body);
      let degraded = false;
      let degradeFailure = null;
      try {
        const singleContent = await callChatModel(body, [
          {
            role: "system",
            content: buildChatSystem({ ...body, responseMode: "single", retrievedMemory }),
          },
          ...messages,
        ], {
          temperature: 0.8,
          maxTokens: 2200,
          stream: false,
          category: "chat",
        });
        const fallbackSpeaker = body.profile?.name || "岚";
        const trimmedSingle = String(singleContent || "").trim();
        if (trimmedSingle) {
          turns = [{ speaker: fallbackSpeaker, content: trimmedSingle }];
          degraded = true;
        }
      } catch (error) {
        degradeFailure = {
          message: String(error?.message || error).slice(0, 1000),
          diagnostic: error?.diagnostic || null,
        };
      }
      if (!turns.length) {
        return jsonResponse({
          error: "模型回复无法整理为有效的多人对话，请重试本轮",
          diagnostic: {
            stage: "multi-json-invalid",
            provider: selectedProvider.id,
            model: selectedProvider.model,
            rawModelContent: String(content || "").slice(0, 100000),
            rawModelContentLength: String(content || "").length,
            repairFailure,
            degradeFailure,
          },
        }, 502);
      }
      return jsonResponse({
        turns,
        provider: "chat",
        model: getProvider(body).model,
        maxTurns: maxParticipants,
        repaired: false,
        degraded,
        degradeReason: "multi-json-invalid",
      });
    }
    return jsonResponse({
      turns,
      provider: "chat",
      model: getProvider(body).model,
      maxTurns: maxParticipants,
      repaired,
    });
  }
  return textResponse(content, 200, {
    "X-Chat-Provider": "chat",
    "X-Chat-Model": getProvider(body).model,
  });
}

async function handleSuggestions(body) {
  try {
    const storyClock = normalizeStoryClock(body.storyClock);
    const storyEvents = normalizeStoryEvents(body.storyEvents)
      .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status))
      .slice(0, 12);
    const scheduleContext = `当前剧情时间：${formatStoryMoment(storyClock)}${storyClock.location ? `，地点：${storyClock.location}` : ""}
${storyEvents.length
  ? `有效约定：${storyEvents.map((event) => `${event.day === null ? "日期待确认" : formatStoryMoment({ ...storyClock, day: event.day, segment: event.segment })}·${event.title}·${event.status}`).join("；")}`
  : "当前没有有效约定。"}`;
    const transcript = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-8)
      .map((message) => `${message.role === "user" ? "用户" : message.speaker || body.profile?.name || "角色"}：${message.content}`)
      .join("\n\n");
    const actionStyle = ["观察型", "行动型", "幽默型", "谨慎型"].includes(body.actionStyle)
      ? body.actionStyle
      : "";
    const style = ["冒险", "保守", "幽默"].includes(body.style) ? body.style : "";
    const content = await callChatModel(body, [
      {
        role: "system",
        content: `根据最近剧情生成恰好3条给用户参考的“剧情方向或提问视角”，不要代替用户写完整台词，也不要使用“我说”“我问”等第一人称成句。每条8–32个中文字符，包含具体对象、地点、线索或调查目的，三条方向不同。当前有到期或临近日程时，至少一条应提醒处理该约定；待确认约定不能假装已经发生。只输出 JSON 字符串数组。

示例输出（只示范格式）：["问问岚是否见过同样的印章","提议去三楼核对旧门牌","从黄铜钥匙的磨损痕迹继续调查"]

${actionStyle ? `用户常用行动倾向是“${actionStyle}”：观察型=先观察、询问、确认情况再行动；行动型=直接上手执行、推进任务、立即改变局面；幽默型=轻松俏皮、带玩笑感和生活气息；谨慎型=优先安全、留有余地、避免冲动冒险。本组选项应整体贴合这一倾向。` : ""}${style ? `本组选项额外风格：${style === "冒险" ? "更冒险——更大胆直接、敢于打破常规、行动更果断" : style === "保守" ? "更保守——更稳妥克制、优先保证安全与关系、行动更收敛" : "更幽默——更轻松俏皮、带玩笑感"}。风格与前面规则冲突时，规则优先，选项仍必须是有效行动指令。` : ""}

${scheduleContext}`,
      },
      { role: "user", content: transcript || "请给出三条具体行动。" },
    ], { temperature: 0.7, maxTokens: 260, timeout: 90000, category: "chat" });
    const parsed = parseLooseJsonArray(content)
      || parseLooseJsonObject(content, (value) => Array.isArray(value?.suggestions));
    const suggestions = (Array.isArray(parsed) ? parsed : parsed?.suggestions)
      ?.filter((item) => typeof item === "string")
      .slice(0, 3);
    return jsonResponse({
      suggestions: suggestions?.length === 3 ? suggestions : fallbackSuggestions,
      provider: "chat",
    });
  } catch {
    return jsonResponse({ suggestions: fallbackSuggestions, mode: "fallback" });
  }
}

async function handleStoryEventDecision(body) {
  const message = String(body.message || "").trim().slice(0, 2400);
  if (!shouldAnalyzeStoryEvent(message)) {
    return jsonResponse({ operation: "none", skipped: true });
  }
  try {
    const content = await callChatModel(
      body,
      buildStoryEventDecisionMessages({
        message,
        role: body.role === "assistant" ? "assistant" : "user",
        speaker: body.speaker,
        sourceMessageId: body.sourceMessageId,
        storyClock: body.storyClock,
        storyEvents: body.storyEvents,
        recentMessages: body.recentMessages,
      }),
      {
        temperature: 0.1,
        maxTokens: 850,
        timeout: 90000,
        expectsStructuredOutput: true,
        category: "chat",
      },
    );
    return jsonResponse(parseStoryEventDecision(content, {
      message,
      sourceMessageId: body.sourceMessageId,
      storyEvents: body.storyEvents,
    }));
  } catch (error) {
    return jsonResponse({
      operation: "none",
      error: "日程判定失败",
      detail: error instanceof Error ? error.message : "网络连接失败",
    }, 502);
  }
}

async function handleWorld(body) {
  const content = await callChatModel(body, [
    {
      role: "system",
      content: `你是互动剧情世界观设计师。保留用户已确定内容，补全地理、社会、力量体系、生活方式、地点、组织、习俗和剧情机会。使用【世界概览】【核心设定】【社会与地点】【人物与生活】【剧情线索】，直接输出正文。`,
    },
    {
      role: "user",
      content: `现有设定：${String(body.existing || "暂无").slice(0, 8000)}\n\n草稿：${String(body.seed || body.existing || "现代都市多人互动").slice(0, 5000)}`,
    },
  ], { temperature: 0.65, maxTokens: 2400, category: "chat" });
  return jsonResponse({ worldSetting: content.slice(0, 12000), provider: "chat" });
}

async function handleRole(body) {
  const role = body.role || {};
  const instruction = String(body.instruction || "").trim().slice(0, 1000);
  const transcript = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-30)
    .map((message) => `${message.role === "user" ? "用户" : message.speaker || "角色"}：${message.content}`)
    .join("\n\n");
  const system = `根据用户本次修改要求、人物提示词、世界设定、长期记忆和对话整理角色档案。用户本次要求具有最高优先级；人物提示词是年龄、性格和身份的重要稳定来源。不要受旧版 age/personality 字段限制。区分实际年龄与外表年龄，并判断随剧情时间成长的规则。返回严格 JSON：
{"name":"","gender":"女性、男性、非二元或未指定","relation":"","prompt":"200-800字行为设定","appearance":"80-300字稳定外观","derivedProfile":{"initialActualAge":18,"initialApparentAge":18,"agingRule":"normal、fixed、long-lived、ageless 或 unknown","corePersonality":"一句稳定核心性格","characterDevelopment":"当前性格发展与变化","anchorStoryDay":1}}
normal 表示实际和外表每过365剧情天增加一岁；fixed 表示实际年龄增加但外表固定；long-lived 表示长生种实际年龄增加、外表缓慢或固定；ageless 表示两者均不变。资料不明确时用 null 或 unknown，不要强行改成成年人。`;
  const user = `用户本次修改要求：${instruction || "未提供额外要求；请基于现有资料和对话保守完善。"}\n当前剧情时间：${JSON.stringify(body.storyClock || {})}\n当前资料：${JSON.stringify(role).slice(0, 5000)}\n世界：${String(body.worldSetting || "").slice(0, 3000)}\n摘要：${String(body.storySummary || "").slice(0, 4000)}\n角色长期记忆：${JSON.stringify(body.roleMemory || {}).slice(0, 4000)}\n对话：${transcript}`;
  const content = await callChatModel(body, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { temperature: 0.45, maxTokens: 4000, stream: false, category: "chat" });
  const parsed = parseLooseJsonObject(content, (value) => typeof value?.prompt === "string");
  if (!parsed?.prompt) throw new Error("模型没有返回有效角色档案");
  return jsonResponse({ role: parsed, provider: "chat" });
}

function baselineRoleMemories(profile, ensemble, existing = {}) {
  return Object.fromEntries(roleRoster(profile, ensemble).map((role) => {
    const previous = existing[role.id] || {};
    const derived = roleDerivedState(role, 1);
    return [role.id, {
      ...previous,
      name: role.name,
      stableIdentity: `${role.name}的身份关系是“${role.relation || "当前剧情角色"}”，${roleDerivedLabel(role, 1)}，成长规则为${derived.agingRule}。人物提示词中的稳定身份高于剧情摘要。`,
      currentStatus: previous.currentStatus || (role.id === "primary"
        ? "主角色，围绕用户继续当前剧情。"
        : "是否在场由最近剧情决定，未在场时保留身份和记忆。"),
    }];
  }));
}

function normalizeRoleMemoryValue(value = {}) {
  const listText = (input) => Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean).join("；")
    : String(input || "").trim();
  return {
    relationshipMemory: listText(value.relationshipMemory),
    importantEvents: listText(value.importantEvents),
    currentStatus: listText(value.currentStatus),
    lastKnownScene: listText(value.lastKnownScene),
    commitments: listText(value.commitments),
  };
}

function normalizedMemoryFacts(value, episodeId, storyClock) {
  const now = new Date().toISOString();
  return (Array.isArray(value) ? value : [])
    .slice(0, 80)
    .map((fact, index) => {
      const content = String(fact?.content || fact?.fact || "").trim();
      if (!content) return null;
      return {
        id: `fact-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
        type: String(fact?.type || "event").slice(0, 40),
        subjectRoleIds: (Array.isArray(fact?.subjectRoleIds) ? fact.subjectRoleIds : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 12),
        content: content.slice(0, 1200),
        importance: Math.min(5, Math.max(1, Number(fact?.importance) || 3)),
        status: String(fact?.status || "active").slice(0, 30),
        storyDay: Math.max(1, Number(fact?.storyDay || storyClock?.day) || 1),
        episodeId,
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter(Boolean);
}

async function saveEpisodeMemory(episode, facts, messages, storyClock) {
  if (!indexedDatabase) return;
  const stores = [EPISODE_STORE, MEMORY_FACT_STORE, MESSAGE_STORE]
    .filter((name) => indexedDatabase.objectStoreNames.contains(name));
  if (!stores.length) return;
  await new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(stores, "readwrite");
    if (stores.includes(EPISODE_STORE)) transaction.objectStore(EPISODE_STORE).put(episode);
    if (stores.includes(MEMORY_FACT_STORE)) {
      const factStore = transaction.objectStore(MEMORY_FACT_STORE);
      facts.forEach((fact) => factStore.put(fact));
    }
    if (stores.includes(MESSAGE_STORE)) {
      const messageStore = transaction.objectStore(MESSAGE_STORE);
      messages.forEach((message, index) => {
        messageStore.put({
          ...normalizedArchiveMessage(message, index, storyClock),
          episodeId: episode.id,
          archivedAt: episode.createdAt,
        });
      });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("长期记忆保存失败"));
    transaction.onabort = () => reject(transaction.error || new Error("长期记忆保存中断"));
  });
}

async function handleSummary(body) {
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-240);
  const transcript = messages
    .map((message) => `${message.role === "user" ? "用户" : message.speaker || body.profile?.name || "角色"}：${message.content}`)
    .join("\n\n")
    .slice(-60000);
  const rosterRoles = roleRoster(body.profile || {}, body.ensemble || {});
  const roster = rosterRoles
    .map((role) => `${role.id}｜${role.name}｜${roleDerivedLabel(role, body.storyClock?.day || 1)}｜${role.gender || "未指定"}｜${role.relation || ""}`)
    .join("\n");
  const primaryContent = await callChatModel(body, [
    {
      role: "system",
      content: `你是本地互动剧情的长期记忆整理器。把旧摘要与本轮对话整理成一个 JSON 对象，不要输出 JSON 之外的解释。

必须使用这个格式：
{"storySummary":"900-2200字，包含【当前场景】【角色状态】【关键剧情】【用户偏好】【未完成事项】【连续性约束】","roleMemories":[{"roleId":"永久角色ID","relationshipMemory":"与用户和其他角色的稳定关系","importantEvents":"不可遗忘的经历","currentStatus":"当前状态","lastKnownScene":"最后已知地点与在场情况","commitments":"尚未完成的约定或任务"}],"episode":{"title":"本段剧情标题","summary":"200-700字完整事件摘要","keywords":["地点","人物","物品"]},"facts":[{"type":"relationship|event|promise|item|location|preference|secret|status","subjectRoleIds":["角色ID"],"content":"一条可独立检索的事实","importance":1,"status":"active","storyDay":1}]}

storySummary 和 roleMemories 必须完整输出；episode 与 facts 尽量给出，给不出可以省略，我会在本地补全。永久名册中的角色全部保留，即使本段没有登场也必须出现在 roleMemories；只能使用名册里的稳定角色ID。不要把推测写成既定事实，不要把已取消事项保留为 active。`,
    },
    {
      role: "user",
      content: `永久名册：\n${roster}\n\n当前剧情时间：${formatStoryMoment(normalizeStoryClock(body.storyClock))}\n\n旧摘要：${String(body.existingSummary || "暂无").slice(0, 12000)}\n\n旧角色记忆：${JSON.stringify(body.existingRoleMemories || {}).slice(0, 12000)}\n\n本轮对话：\n${transcript}`,
    },
  ], {
    temperature: 0.2,
    maxTokens: 5200,
    stream: false,
    expectsStructuredOutput: true,
    category: "summary",
  });
  const acceptSummaryShape = (value) =>
    typeof value?.storySummary === "string"
    && (Array.isArray(value?.roleMemories) || (value?.roleMemories && typeof value.roleMemories === "object"));
  let parsed = parseLooseJsonObject(primaryContent, acceptSummaryShape);
  if (!parsed) {
    const repairContent = await callChatModel(body, [
      {
        role: "system",
        content: `你是剧情记忆压缩器。把旧摘要与本轮对话压缩成一个 JSON 对象，只输出这个 JSON，不添加任何解释、前后缀或代码块，不使用 JSON Output / JSON mode 等结构化输出功能。必须直接以 { 开头、以 } 结尾，键名英文半角、值中文、每个字段都出现、没有内容用空字符串 "" 占位、不要残留结尾逗号。

{"storySummary":"900-2200字，合并旧摘要与关键新剧情，含【当前场景】【角色状态】【关键剧情】【用户偏好】【未完成事项】【连续性约束】","roleMemories":[{"roleId":"永久角色ID","relationshipMemory":"与用户和其他角色的稳定关系","importantEvents":"不可遗忘的经历","currentStatus":"当前状态","lastKnownScene":"最后已知地点与在场情况","commitments":"尚未完成的约定或任务"}]}

永久名册中的角色全部保留，即使本段没有登场也必须出现在 roleMemories；只能使用名册里的稳定角色ID。不要把推测写成既定事实。`,
      },
      {
        role: "user",
        content: `上一版输出未能按格式解析，请严格按上述 JSON 重写。\n\n永久名册：\n${roster}\n\n当前剧情时间：${formatStoryMoment(normalizeStoryClock(body.storyClock))}\n\n旧摘要：${String(body.existingSummary || "暂无").slice(0, 12000)}\n\n旧角色记忆：${JSON.stringify(body.existingRoleMemories || {}).slice(0, 12000)}\n\n本轮对话：\n${transcript}`,
      },
    ], {
      temperature: 0.1,
      maxTokens: 5200,
      stream: false,
      expectsStructuredOutput: true,
      category: "summary",
    });
    parsed = parseLooseJsonObject(repairContent, acceptSummaryShape);
  }
  if (!parsed) throw new Error("剧情总结格式不完整，原始对话已保留，请稍后重试");
  const rawRoleMemories = Array.isArray(parsed.roleMemories)
    ? parsed.roleMemories
    : Object.entries(parsed.roleMemories || {}).map(([roleId, value]) => ({
        roleId,
        ...(value && typeof value === "object" ? value : { currentStatus: String(value || "") }),
      }));
  const roleMemories = baselineRoleMemories(
    body.profile || {},
    body.ensemble || {},
    body.existingRoleMemories || {},
  );
  for (const item of rawRoleMemories) {
    const roleId = String(item?.roleId || "").trim();
    if (!roleMemories[roleId]) continue;
    roleMemories[roleId] = {
      ...roleMemories[roleId],
      ...normalizeRoleMemoryValue(item),
    };
  }
  const storyClock = normalizeStoryClock(body.storyClock);
  const episodeId = `episode-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const episode = {
    id: episodeId,
    title: String(parsed.episode?.title || `第${storyClock.day}天剧情`).slice(0, 160),
    summary: String(parsed.episode?.summary || parsed.storySummary).slice(0, 5000),
    keywords: (Array.isArray(parsed.episode?.keywords) ? parsed.episode.keywords : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 30),
    storyDay: storyClock.day,
    storySegment: storyClock.segment,
    messageIds: messages.map((message) => String(message?.id || "")).filter(Boolean),
    createdAt: new Date().toISOString(),
  };
  const facts = normalizedMemoryFacts(parsed.facts, episodeId, storyClock);
  await saveEpisodeMemory(episode, facts, messages, storyClock);
  return jsonResponse({
    summary: String(parsed.storySummary).slice(0, 20000),
    roleMemories,
    roleMemoryCount: Object.keys(roleMemories).length,
    processedMessages: messages.length,
    chunks: 1,
    episode,
    factCount: facts.length,
  });
}

async function prepareImagePrompt(body, kind) {
  const request = buildImagePromptRequest(body, kind);
  const content = await callChatModel(body, [
    { role: "system", content: request.system },
    { role: "user", content: request.user },
  ], {
    temperature: 0.38,
    maxTokens: 1800,
    expectsStructuredOutput: kind === "scene",
    category: "image-prompt",
  });
  const prompt = formatImagePromptResponse(content, kind, request);
  return jsonResponse({
    prompt: prompt.slice(0, 1200),
    model: String(body.imageModel || ""),
    quality: "standard",
    size: imageRuntimeDefaults.portraitSize,
  });
}

async function prepareStageBackgroundPrompt(body) {
  const transcript = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-10)
    .map((message) => `${message.role === "user" ? "用户" : message.speaker || "角色"}：${message.content}`)
    .join("\n\n")
    .slice(-12000);
  const content = await callChatModel(body, [
    {
      role: "system",
      content: `你是对话舞台背景设计师。根据当前世界与最近剧情，冻结一个最能代表此刻地点的空镜背景。只描述环境、时间、天气、建筑、家具、道具、光线、色彩与镜头；严禁出现人物、人体、文字、水印、对白和连续动作。背景会与透明角色立绘叠加，主体活动区域必须留出干净空间。直接输出120–450字中文图片提示词。`,
    },
    {
      role: "user",
      content: `世界设定：${String(body.worldSetting || "沿用当前世界").slice(0, 3500)}
剧情摘要：${String(body.storySummary || "以最近对话为准").slice(0, 4500)}
最近对话：
${transcript}`,
    },
  ], { temperature: 0.35, maxTokens: 900, category: "image-prompt" });
  return jsonResponse({
    prompt: content.replace(/^```[\s\S]*?\n|```$/g, "").trim().slice(0, 1200),
    model: String(body.imageModel || ""),
    size: imageRuntimeDefaults.landscapeSize,
  });
}

// ---------- 图片、相册、备份与后台任务 ----------
function loadImageJobs() {
  if (Array.isArray(imageJobsMemoryCache)) return imageJobsMemoryCache;
  const jobs = readStoredJson(IMAGE_JOBS_KEY, []);
  imageJobsMemoryCache = Array.isArray(jobs) ? jobs : [];
  return imageJobsMemoryCache;
}

function storedRoleById(settings, targetId) {
  if (targetId === "primary") return settings.profile;
  if (targetId === "friend") return settings.ensemble?.friend;
  return settings.ensemble?.customRoles?.find((role) => role.id === targetId)
    || settings.ensemble?.temporaryRoles?.find((role) => role.id === targetId)
    || null;
}

function resolveRoleBaseImage(body) {
  const settings = loadSettings();
  const role = storedRoleById(settings, body.targetId);
  if (!role) return "";
  if (role.visualBaseSource === "upload" && role.visualBaseImageUrl) {
    return role.visualBaseImageUrl;
  }
  if (role.visualBaseImageJobId) {
    const job = loadImageJobs().find((item) =>
      item.id === role.visualBaseImageJobId
      && item.status === "completed"
      && item.imageUrl
    );
    if (job?.imageUrl) return job.imageUrl;
  }
  if (role.visualBaseSource === "avatar" && role.avatarUrl) return role.avatarUrl;
  return "";
}

async function localImageBlob(imageUrl) {
  if (!imageUrl) throw new Error("角色尚未设置基底图");
  if (isAssetReference(imageUrl)) return sourceImageBlob(imageUrl);
  try {
    const response = await originalFetch(imageUrl);
    if (!response.ok) throw new Error(`读取失败（${response.status}）`);
    return await response.blob();
  } catch (error) {
    const plus = await waitForPlus(3000);
    if (plus?.io?.resolveLocalFileSystemURL) {
      try {
        const entry = await resolvePlusEntry(plus, imageUrl);
        return await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
      } catch {}
    }
    throw new Error(`无法读取本地基底图：${error instanceof Error ? error.message : "文件不可用"}`);
  }
}

function saveImageJobs(jobs) {
  imageJobsMemoryCache = jobs.slice(0, 280);
  pendingImageJobs = imageJobsMemoryCache;
  window.clearTimeout(imageJobsPersistTimer);
  imageJobsPersistTimer = window.setTimeout(persistPendingImageJobs, 250);
}

function persistPendingImageJobs() {
  window.clearTimeout(imageJobsPersistTimer);
  if (!pendingImageJobs) return storageWriteQueue;
  const jobs = pendingImageJobs;
  pendingImageJobs = null;
  return storageSet(IMAGE_JOBS_KEY, jobs);
}

function safeBackupPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem("night-mailbox-state") || "{}");
    return {
      chatProvider: "chat",
      chatModel: typeof (stored.chatModel || stored.grokModel) === "string"
        ? String(stored.chatModel || stored.grokModel).slice(0, 100)
        : "",
      imageModel: typeof stored.imageModel === "string" ? stored.imageModel.slice(0, 100) : "",
      imageEnabled: stored.imageEnabled === true,
      imageQuality: typeof stored.imageQuality === "string" ? stored.imageQuality : "standard",
      suggestions: Array.isArray(stored.suggestions)
        ? stored.suggestions.filter((item) => typeof item === "string").slice(0, 3)
        : [],
      nextGuestAt: Number(stored.nextGuestAt) || 18,
    };
  } catch {
    return {};
  }
}

function normalizeImportedImageJobs(value) {
  const importedAt = new Date().toISOString();
  return (Array.isArray(value) ? value : [])
    .slice(0, 280)
    .filter((job) => job && typeof job === "object" && typeof job.id === "string")
    .map((job) => {
      if (job.status !== "queued" && job.status !== "running") return job;
      return {
        ...job,
        status: "failed",
        statusMessage: "备份导入后未继续未完成任务",
        error: "为避免重复扣费，导入时未自动恢复排队或生成中的图片任务。",
        request: null,
        updatedAt: importedAt,
      };
    });
}

function dataUrlParts(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/);
  return match ? { mimeType: match[1], dataBase64: match[2].replace(/\s+/g, "") } : null;
}

async function localFileAsDataUrl(path) {
  if (!window.plus?.io?.resolveLocalFileSystemURL) return "";
  let entry;
  try {
    entry = await resolvePlusEntry(window.plus, path);
  } catch {
    return "";
  }
  return new Promise((resolve) => {
    entry.file((file) => {
      const Reader = window.plus.io.FileReader || FileReader;
      const reader = new Reader();
      reader.onloadend = (event) => resolve(String(event?.target?.result || reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    }, () => resolve(""));
  });
}

async function portableImageDataUrl(value) {
  if (dataUrlParts(value)) return value;
  const candidate = String(value || "");
  if (!candidate || !/(?:^asset:\/\/|^file:|^_downloads\/|^\/generated-images\/|\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$)/i.test(candidate)) {
    return "";
  }
  try {
    const blob = await sourceImageBlob(candidate);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {}
  return localFileAsDataUrl(candidate);
}

function backupAssetCategory(path, root) {
  if (path[0] === "messages") return "scene";
  if (path[0] === "archive" && path[1] === "messages") return "scene";
  if (path[0] === "imageJobs") {
    const job = root.imageJobs?.[Number(path[1])];
    return job?.kind === "character" || job?.kind === "visual-state" ? "character" : "scene";
  }
  return path.includes("stageBackground") ? "scene" : "character";
}

async function extractBackupAssets(root) {
  const assets = [];
  const referenceCache = new Map();
  let skippedImages = 0;
  async function visit(value, path = []) {
    if (typeof value === "string") {
      const existing = referenceCache.get(value);
      if (existing) return existing;
      const dataUrl = await portableImageDataUrl(value);
      if (!dataUrl) {
        if (/(?:^file:|^_downloads\/|^\/generated-images\/)/i.test(value)) skippedImages += 1;
        return value;
      }
      const parts = dataUrlParts(dataUrl);
      if (!parts) return value;
      const extension = parts.mimeType === "image/jpeg" ? "jpg" : parts.mimeType.split("/")[1];
      const id = `asset-${assets.length + 1}`;
      const reference = `backup-asset://${id}`;
      assets.push({
        id,
        category: backupAssetCategory(path, root),
        filename: `${id}.${extension}`,
        mimeType: parts.mimeType,
        dataBase64: parts.dataBase64,
      });
      referenceCache.set(value, reference);
      return reference;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        result.push(await visit(value[index], [...path, String(index)]));
      }
      return result;
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = await visit(item, [...path, key]);
      }
      return result;
    }
    return value;
  }
  return {
    content: await visit(root),
    assets,
    skippedImages,
  };
}

function restoreBackupAssets(backup) {
  const assetMap = new Map(
    (Array.isArray(backup.assets) ? backup.assets : [])
      .filter((asset) =>
        asset
        && typeof asset.id === "string"
        && /^image\/(?:png|jpeg|webp|gif)$/.test(asset.mimeType)
        && typeof asset.dataBase64 === "string"
      )
      .map((asset) => [
        `backup-asset://${asset.id}`,
        `data:${asset.mimeType};base64,${asset.dataBase64.replace(/\s+/g, "")}`,
      ]),
  );
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
    preferences: backup.preferences,
    archive: backup.archive,
  });
}

async function createLocalBackup() {
  const [archivedMessages, episodes, memoryFacts] = await Promise.all([
    indexedStoreGetAll(MESSAGE_STORE),
    indexedStoreGetAll(EPISODE_STORE),
    indexedStoreGetAll(MEMORY_FACT_STORE),
  ]);
  const packed = await extractBackupAssets({
    settings: loadSettings(),
    messages: loadHistory(),
    imageJobs: loadImageJobs(),
    archive: {
      messages: archivedMessages,
      episodes,
      memoryFacts,
    },
  });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source: window.__NIGHT_MAILBOX_STANDALONE__ ? "standalone-html" : "android-local",
    ...packed.content,
    assets: packed.assets,
    warnings: packed.skippedImages
      ? [`有 ${packed.skippedImages} 个无法读取的旧图片路径，仅保留了原路径。`]
      : [],
    preferences: safeBackupPreferences(),
    security: {
      apiKeysIncluded: false,
    },
  };
}

function validateBackupPayload(value) {
  if (!value || typeof value !== "object") throw new Error("备份文件内容无效");
  if (value.format !== BACKUP_FORMAT) throw new Error("这不是夜航信箱备份文件");
  if (Number(value.version) !== BACKUP_VERSION) throw new Error("备份版本暂不支持");
  if (!value.settings || typeof value.settings !== "object") throw new Error("备份缺少设定数据");
  if (!Array.isArray(value.messages)) throw new Error("备份缺少对话记录");
  if (!Array.isArray(value.imageJobs)) throw new Error("备份缺少图片记录");
  return value;
}

async function handleBackup(body, method) {
  if (method === "GET") return jsonResponse(await createLocalBackup());
  if (method !== "PUT") return jsonResponse({ error: "不支持的备份操作" }, 405);
  if (loadImageJobs().some((job) => job.status === "queued" || job.status === "running")) {
    return jsonResponse({ error: "仍有图片正在生成或排队，请完成后再导入备份" }, 409);
  }
  const backup = validateBackupPayload(body.backup);
  const restored = restoreBackupAssets(backup);
  await flushMobileStorage();
  await Promise.all([
    indexedStoreClear(MESSAGE_STORE),
    indexedStoreClear(EPISODE_STORE),
    indexedStoreClear(MEMORY_FACT_STORE),
  ]);
  const settings = saveSettings(restored.settings);
  const messages = saveHistory(restored.messages);
  const jobs = normalizeImportedImageJobs(restored.imageJobs);
  saveImageJobs(jobs);
  const archive = restored.archive && typeof restored.archive === "object" ? restored.archive : {};
  await archiveMessages(
    Array.isArray(archive.messages) ? archive.messages : messages,
    settings.storyClock,
  );
  for (const episode of Array.isArray(archive.episodes) ? archive.episodes : []) {
    if (episode?.id) await indexedStorePut(EPISODE_STORE, episode);
  }
  for (const fact of Array.isArray(archive.memoryFacts) ? archive.memoryFacts : []) {
    if (fact?.id) await indexedStorePut(MEMORY_FACT_STORE, fact);
  }
  if (restored.preferences && typeof restored.preferences === "object") {
    localStorage.setItem("night-mailbox-state", JSON.stringify(restored.preferences));
  }
  await flushMobileStorage();
  const migration = await migrateLegacyImages();
  return jsonResponse({
    ok: true,
    settings: true,
    messageCount: messages.length,
    archivedMessageCount: Array.isArray(archive.messages) ? archive.messages.length : messages.length,
    imageCount: jobs.filter((job) => job.status === "completed" && job.imageUrl).length,
    migratedImageCount: migration.completed || 0,
    roleCount: 2
      + (settings.ensemble?.customRoles?.length || 0)
      + (settings.ensemble?.temporaryRoles?.length || 0),
  });
}

function plusFilePathCandidates(plus, path) {
  const candidates = [];
  const append = (value) => {
    const candidate = String(value || "").trim();
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  const source = String(path || "").trim();
  append(source);

  if (/^_download\//i.test(source)) append(source.replace(/^_download\//i, "_downloads/"));
  if (/^_downloads\//i.test(source)) append(source.replace(/^_downloads\//i, "_download/"));

  let absolutePath = source;
  if (/^file:\/\//i.test(source)) {
    try {
      absolutePath = decodeURIComponent(new URL(source).pathname);
    } catch {
      absolutePath = source.replace(/^file:\/\//i, "");
    }
    append(absolutePath);
  }

  if (/^(?:\/|[a-z]:[\\/])/i.test(absolutePath)) {
    try {
      append(plus.io.convertAbsoluteFileSystem?.(absolutePath));
    } catch {}
    if (absolutePath.startsWith("/")) append(`file://${absolutePath}`);
  }

  for (const candidate of [...candidates]) {
    if (!/^_(?:doc|downloads?|documents|www)\//i.test(candidate)) continue;
    try {
      const converted = plus.io.convertLocalFileSystemURL?.(candidate);
      append(converted);
      if (String(converted || "").startsWith("/")) append(`file://${converted}`);
    } catch {}
  }
  return candidates;
}

async function resolvePlusEntry(plus, path) {
  let lastError = null;
  for (const candidate of plusFilePathCandidates(plus, path)) {
    try {
      return await new Promise((resolve, reject) => {
        plus.io.resolveLocalFileSystemURL(candidate, resolve, reject);
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("本地文件路径已经失效");
}

async function readPlusImageAsDataUrl(plus, path) {
  const entry = await resolvePlusEntry(plus, path);
  return new Promise((resolve, reject) => {
    entry.file((file) => {
      const Reader = plus.io.FileReader || FileReader;
      const reader = new Reader();
      reader.onloadend = (event) => {
        const result = String(event?.target?.result || reader.result || "");
        if (result) resolve(result);
        else reject(new Error("本地图片读取结果为空"));
      };
      reader.onerror = (error) => reject(error || new Error("本地图片文件读取失败"));
      reader.readAsDataURL(file);
    }, (error) => reject(error || new Error("无法打开本地图片文件")));
  });
}

function getPlusDirectory(parent, name) {
  return new Promise((resolve, reject) => {
    parent.getDirectory(name, { create: true }, resolve, reject);
  });
}

function getPlusFile(parent, name) {
  return new Promise((resolve, reject) => {
    parent.getFile(name, { create: true }, resolve, reject);
  });
}

function writePlusTextFile(entry, text) {
  return new Promise((resolve, reject) => {
    entry.createWriter((writer) => {
      writer.onwrite = () => resolve(entry);
      writer.onerror = (error) => reject(error || new Error("备份文件写入失败"));
      writer.write(new Blob([text], { type: "application/json;charset=utf-8" }));
    }, reject);
  });
}

function readPlusTextFile(plus, path) {
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(path, (entry) => {
      entry.file((file) => {
        const reader = new plus.io.FileReader();
        reader.onloadend = (event) => resolve(String(event?.target?.result || reader.result || ""));
        reader.onerror = (error) => reject(error || new Error("备份文件读取失败"));
        reader.readAsText(file, "utf-8");
      }, reject);
    }, reject);
  });
}

async function writeNativeBackupCopy(plus, rootPath, filename, text) {
  const root = await resolvePlusEntry(plus, rootPath);
  const mailboxDirectory = await getPlusDirectory(root, "night-mailbox");
  const backupDirectory = await getPlusDirectory(mailboxDirectory, "backups");
  const file = await getPlusFile(backupDirectory, filename);
  await writePlusTextFile(file, text);
  return file.toLocalURL?.() || file.fullPath || `${rootPath}night-mailbox/backups/${filename}`;
}

window.__NIGHT_MAILBOX_NATIVE_BACKUP__ = {
  async save(text, filename) {
    const plus = await waitForPlus(8000);
    if (!plus?.io) throw new Error("App 本地文件服务暂不可用");
    const safeFilename = String(filename || `night-mailbox-backup-${Date.now()}.json`)
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 160);
    const content = String(text || "");
    if (!content) throw new Error("备份内容为空");
    const privatePath = await writeNativeBackupCopy(plus, "_doc/", safeFilename, content);
    let visiblePath = "";
    try {
      visiblePath = await writeNativeBackupCopy(plus, "_downloads/", safeFilename, content);
    } catch {}
    localStorage.setItem("night-mailbox-native-last-backup", privatePath);
    return {
      filename: safeFilename,
      privatePath,
      visiblePath,
    };
  },
  async readLatest() {
    const plus = await waitForPlus(8000);
    if (!plus?.io) throw new Error("App 本地文件服务暂不可用");
    const path = localStorage.getItem("night-mailbox-native-last-backup") || "";
    if (!path) throw new Error("App 中还没有最近备份");
    return {
      path,
      text: await readPlusTextFile(plus, path),
    };
  },
};

window.__NIGHT_MAILBOX_NATIVE_IMAGE__ = {
  async resolvePreviewSource(imageUrl) {
    const source = String(imageUrl || "").trim();
    if (!source) throw new Error("图片地址为空");
    if (isAssetReference(source)) return resolveAssetDisplaySource(source);
    if (/^(?:data:|blob:|https?:)/i.test(source)) return source;
    const plus = await waitForPlus(8000);
    if (!plus?.io?.resolveLocalFileSystemURL) {
      if (/^file:/i.test(source)) return source;
      throw new Error("App 本地图片服务暂不可用");
    }
    return readPlusImageAsDataUrl(plus, source);
  },
  async resolveThumbnailSource(imageUrl) {
    const source = String(imageUrl || "").trim();
    if (!source) throw new Error("图片地址为空");
    if (isAssetReference(source)) return resolveAssetThumbnailSource(source);
    return this.resolvePreviewSource(source);
  },
};

function updateImageJob(id, patch) {
  const jobs = loadImageJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  jobs[index] = { ...jobs[index], ...patch, updatedAt: new Date().toISOString() };
  saveImageJobs(jobs);
  return jobs[index];
}

async function downloadGeneratedImage(url, filename) {
  const plus = await waitForPlus();
  if (!plus?.downloader) {
    try {
      const response = await originalFetch(url);
      if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
      const blob = await response.blob();
      return storeImageAsset(blob, "generated");
    } catch (error) {
      throw new Error(`图片已生成但无法保存到本地：${error instanceof Error ? error.message : "下载失败"}`);
    }
  }
  const localPath = `_downloads/night-mailbox/${filename}`;
  return new Promise((resolve, reject) => {
    const task = plus.downloader.createDownload(url, {
      filename: localPath,
      timeout: 600,
      retry: 1,
    }, async (download, status) => {
      if (status !== 200 || !download?.filename) {
        reject(new Error(`图片下载失败（${status || 0}）`));
        return;
      }
      try {
        await resolvePlusEntry(plus, download.filename);
        const reference = await storeImageAsset(localPath, "generated");
        await deleteMobileGeneratedImageFile(localPath);
        resolve(reference);
      } catch {
        try {
          const reference = await storeImageAsset(download.filename, "generated");
          await deleteMobileGeneratedImageFile(download.filename);
          resolve(reference);
        } catch (error) {
          reject(error);
        }
      }
    });
    task.start();
  });
}

async function deleteMobileGeneratedImageFile(imageUrl) {
  const candidate = String(imageUrl || "");
  const filename = candidate.split(/[\\/]/).pop()?.split(/[?#]/)[0] || "";
  if (
    !candidate
    || !/(?:^|[\\/])night-mailbox[\\/]/i.test(candidate)
    || !/^(?:scene|character|visual-state|stage-background)-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/i.test(filename)
  ) return false;
  const plus = await waitForPlus();
  if (!plus?.io?.resolveLocalFileSystemURL) return false;
  try {
    const entry = await resolvePlusEntry(plus, candidate);
    return await new Promise((resolve) => {
      entry.remove(() => resolve(true), () => resolve(false));
    });
  } catch {
    return false;
  }
}

function clearMobileImageReferences({ jobId = "", imageUrl = "", targetId = "", visualStateId = "" }) {
  const settings = loadSettings();
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
      const fallback = loadImageJobs()
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
  if (changed) saveSettings(settings);
  return changed;
}

async function runImageJob(id, body) {
  const config = getMobileApiConfig();
  const selectedImageModel = String(body.imageModel || "").trim();
  const selectedImageKey = imageApiKey(config);
  let prompt = normalizeImagePromptForModel(body.prompt, selectedImageModel);
  const editMode = body.kind === "visual-state" || Boolean(body.referenceImage?.imageUrl);
  updateImageJob(id, { status: "running", statusMessage: "正在调用图片模型", attempt: 1, prompt, model: selectedImageModel });
  try {
    const baseImageBlob = editMode ? await localImageBlob(body.referenceImage?.imageUrl || resolveRoleBaseImage(body)) : null;
    let result;
    const rewritten = false;
    let response;
    if (editMode && isGrokImageModel(selectedImageModel)) {
      const editPrompt = body.kind === "character" && body.referenceImage?.imageUrl
        ? `参考图片为同一人物的基准形象，必须保持脸型、五官、发型、发色、瞳色、体态和标志配饰一致；只按提示词改变动作、表情、服装状态或场景。${prompt}`.slice(0, 1024)
        : prompt;
      prompt = editPrompt;
      updateImageJob(id, { prompt });
      const mimeType = /^image\/(?:png|jpeg|webp)$/i.test(baseImageBlob?.type || "")
        ? baseImageBlob.type
        : "image/png";
      const base64 = await blobAsBase64(baseImageBlob);
      response = await nativeHttpRequest(`${config.imageBaseUrl}/images/edits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${selectedImageKey}`,
        },
        body: JSON.stringify({
          model: selectedImageModel,
          prompt: editPrompt,
          image: {
            url: `data:${mimeType};base64,${base64}`,
            type: "image_url",
          },
          resolution: "1k",
          response_format: "url",
        }),
        timeout: IMAGE_REQUEST_TIMEOUT_MS,
      });
    } else if (editMode) {
      const editPrompt = body.kind === "character" && body.referenceImage?.imageUrl
        ? `图片1为参考基底图，必须保持图片1中的同一个成年人物，脸型、五官、发型、发色、瞳色、体态和服装结构完全一致，不得重新设计人物；只按提示词要求改变动作、表情、服装状态或场景。${prompt}`.slice(0, 1200)
        : prompt;
      prompt = editPrompt;
      updateImageJob(id, { prompt });
      const formData = new FormData();
      const editPayload = buildImageGenerationPayload({
        model: selectedImageModel,
        prompt: editPrompt,
        kind: body.kind,
        portraitSize: imageRuntimeDefaults.portraitSize,
        landscapeSize: imageRuntimeDefaults.landscapeSize,
      });
      Object.entries(editPayload).forEach(([key, value]) => {
        if (key !== "n" && value !== undefined && value !== null) formData.append(key, String(value));
      });
      formData.append("image", baseImageBlob, `${body.targetId || "character"}-base.png`);
      response = await nativeHttpRequest(`${config.imageBaseUrl}/images/edits`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${selectedImageKey}`,
        },
        body: formData,
        timeout: IMAGE_REQUEST_TIMEOUT_MS,
      });
    } else {
      const generationPayload = buildImageGenerationPayload({
        model: selectedImageModel,
        prompt,
        kind: body.kind,
        portraitSize: imageRuntimeDefaults.portraitSize,
        landscapeSize: imageRuntimeDefaults.landscapeSize,
      });
      response = await nativeHttpRequest(`${config.imageBaseUrl}${imageRuntimeDefaults.endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${selectedImageKey}`,
        },
        body: JSON.stringify(generationPayload),
        timeout: IMAGE_REQUEST_TIMEOUT_MS,
      });
    }
    if (!response.ok) {
      throw modelResponseError(
        `图片生成失败（${response.status}）：${response.text.slice(0, 360)}`,
        response,
        "image-upstream-http",
        {
          kind: body.kind,
          model: selectedImageModel,
          attempt: 1,
        },
      );
    }
    result = parseJsonText(response.text);
    const imageData = result?.data?.[0] || {};
    const remoteUrl = imageData.url;
    const imageBase64 = imageData.b64_json;
    if (!remoteUrl && !imageBase64) throw new Error("图片接口没有返回下载地址或 Base64 图片");
    const filename = `${body.kind === "visual-state" ? "visual-state" : body.kind === "stage-background" ? "stage-background" : body.kind === "character" ? "character" : "scene"}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.png`;
    const imageUrl = remoteUrl
      ? await downloadGeneratedImage(remoteUrl, filename)
      : await storeImageAsset(
          `data:${/^image\/(?:png|jpeg|webp)$/i.test(imageData.mime_type || "") ? imageData.mime_type : "image/jpeg"};base64,${String(imageBase64).replace(/\s+/g, "")}`,
          "generated",
        );
    const outputPayload = buildImageGenerationPayload({
      model: selectedImageModel,
      prompt,
      kind: body.kind,
      portraitSize: imageRuntimeDefaults.portraitSize,
      landscapeSize: imageRuntimeDefaults.landscapeSize,
    });
    const outputSize = outputPayload.aspect_ratio
      ? `${outputPayload.aspect_ratio}/${outputPayload.resolution || "auto"}`
      : outputPayload.size || "原始尺寸";
    updateImageJob(id, {
      status: "completed",
      statusMessage: "生成成功并已保存到手机",
      prompt,
      rewritten,
      imageUrl,
      model: selectedImageModel,
      size: outputSize,
      sourceMode: editMode ? "image-edit" : "text-generation",
      referenceImageUrl: body.referenceImage?.imageUrl || "",
      referenceImageJobId: body.referenceImage?.jobId || "",
    });
    if (body.kind === "character" && body.targetId && !body.visualStateId) {
      const settings = loadSettings();
      const role = body.targetId === "primary"
        ? settings.profile
        : body.targetId === "friend"
          ? settings.ensemble.friend
          : settings.ensemble.customRoles.find((item) => item.id === body.targetId)
            || settings.ensemble.temporaryRoles.find((item) => item.id === body.targetId);
      if (role) {
        role.avatarUrl = imageUrl;
        role.imagePrompt = prompt;
        if (!role.visualBaseSource) {
          role.visualBaseSource = "avatar";
          role.visualBaseImageJobId = id;
        }
        saveSettings(settings);
      }
    }
  } catch (error) {
    updateImageJob(id, {
      status: "failed",
      statusMessage: "生成失败",
      error: error instanceof Error ? error.message : "图片生成失败",
      diagnostic: error?.diagnostic && typeof error.diagnostic === "object"
        ? error.diagnostic
        : null,
      failedPrompt: prompt,
      failedAt: new Date().toISOString(),
    });
  }
}

function scheduleImageJobQueue() {
  if (imageJobSchedulerRunning) return;
  imageJobSchedulerRunning = true;
  window.setTimeout(async () => {
    try {
      while (activeImageJobCount < IMAGE_JOB_CONCURRENCY) {
        const next = loadImageJobs()
          .filter((job) => job.status === "queued" && job.request)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
        if (!next) break;
        activeImageJobCount += 1;
        void runImageJob(next.id, next.request)
          .then(() => flushMobileStorage())
          .catch(() => {})
          .finally(() => {
            activeImageJobCount = Math.max(0, activeImageJobCount - 1);
            scheduleImageJobQueue();
          });
      }
    } finally {
      imageJobSchedulerRunning = false;
      if (
        activeImageJobCount < IMAGE_JOB_CONCURRENCY
        && loadImageJobs().some((job) => job.status === "queued" && job.request)
      ) {
        scheduleImageJobQueue();
      }
    }
  }, 20);
}

async function handleImage(body, method, url) {
  if (method === "GET") {
    const allJobs = loadImageJobs()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return jsonResponse({
      jobs: allJobs.filter((job) => job.status !== "failed"),
      failedJobs: allJobs.filter((job) => job.status === "failed").slice(0, 100),
    });
  }
  if (method === "DELETE") {
    const jobId = String(url?.searchParams?.get("jobId") || body?.jobId || "").slice(0, 120);
    const jobs = loadImageJobs();
    const job = jobId ? jobs.find((item) => item.id === jobId) : null;
    if (job && (job.status === "queued" || job.status === "running")) {
      return jsonResponse({ error: "图片仍在生成或排队，暂时不能删除" }, 409);
    }
    const imageUrl = String(job?.imageUrl || body?.imageUrl || "");
    const targetId = String(job?.targetId || body?.targetId || "");
    const visualStateId = String(job?.visualStateId || body?.visualStateId || "");
    if (jobId) saveImageJobs(jobs.filter((item) => item.id !== jobId));
    clearMobileImageReferences({ jobId, imageUrl, targetId, visualStateId });
    await flushMobileStorage();
    const fileDeleted = isAssetReference(imageUrl)
      ? await deleteAssetIfUnreferenced(imageUrl)
      : await deleteMobileGeneratedImageFile(imageUrl);
    return jsonResponse({
      ok: true,
      deletedJob: Boolean(job),
      deletedFile: fileDeleted,
    });
  }
  if (body.enabled !== true) return jsonResponse({ error: "请先开启图片生成" }, 403);
  if (body.action === "prepare") return prepareImagePrompt(body, "scene");
  if (body.action === "prepare-character") return prepareImagePrompt(body, "character");
  if (body.action === "prepare-background") return prepareStageBackgroundPrompt(body);
  if (body.action === "generate-async") {
    if (!MOTION_DISPLAY_ENABLED && ["visual-state", "stage-background"].includes(body.kind)) {
      return jsonResponse({ error: "当前 HTML 已移除动作展示模块" }, 410);
    }
    const config = getMobileApiConfig();
    const selectedImageModel = String(body.imageModel || "").trim();
    if (!selectedImageModel) return jsonResponse({ error: "请先查询图片模型目录并选择一个模型" }, 400);
    if (!imageApiKey(config)) {
      return jsonResponse({
        error: "请先在接口连接设置中填写图片 API Key",
        code: "IMAGE_API_KEY_MISSING",
      }, 503);
    }
    const referenceImage = body.referenceImage && typeof body.referenceImage === "object"
      ? {
          imageUrl: String(body.referenceImage.imageUrl || "").slice(0, 2000),
          jobId: String(body.referenceImage.jobId || "").slice(0, 120),
        }
      : null;
    if (referenceImage?.imageUrl && !/^(?:asset:\/\/|data:image\/|file:|_doc\/|_downloads\/|\/storage\/)/i.test(referenceImage.imageUrl)) {
      return jsonResponse({ error: "参考图地址无效，只能使用本机已保存的图片" }, 400);
    }
    const now = new Date().toISOString();
    const job = {
      id: `mobile-image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: ["character", "visual-state", "stage-background"].includes(body.kind) ? body.kind : "scene",
      targetId: String(body.targetId || ""),
      targetName: String(body.targetName || ""),
      visualStateId: String(body.visualStateId || ""),
      status: "queued",
      statusMessage: "已加入手机后台任务",
      createdAt: now,
      updatedAt: now,
      imageUrl: "",
      prompt: String(body.prompt || "").slice(0, 1200),
      attempt: 0,
      maxAttempts: 1,
      rewritten: false,
      referenceImageUrl: referenceImage?.imageUrl || "",
      referenceImageJobId: referenceImage?.jobId || "",
      archive: body.archive || {},
      request: {
        ...body,
        prompt: String(body.prompt || "").slice(0, 1200),
      },
    };
    saveImageJobs([job, ...loadImageJobs()]);
    scheduleImageJobQueue();
    return jsonResponse({ job });
  }
  if (body.action === "generate") {
    if (!String(body.imageModel || "").trim()) {
      return jsonResponse({ error: "请先查询图片模型目录并选择一个模型" }, 400);
    }
    const now = new Date().toISOString();
    const job = {
      id: `mobile-image-${Date.now()}`,
      kind: body.kind === "character" ? "character" : "scene",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      prompt: String(body.prompt || "").slice(0, 1200),
    };
    saveImageJobs([job, ...loadImageJobs()]);
    await runImageJob(job.id, body);
    return jsonResponse(updateImageJob(job.id, {}));
  }
  return jsonResponse({ error: "不支持的图片操作" }, 400);
}

async function handleStorage(body, method, url) {
  if (method === "GET") {
    const settings = loadSettings();
    return jsonResponse({
      ...settings,
      ...(url.searchParams.get("scope") === "settings" ? {} : { messages: loadHistory() }),
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      storage: "browser-local-storage",
    });
  }
  if (body.action === "apply-default-scenario" && window.__NIGHT_MAILBOX_STANDALONE__) {
    await Promise.all([
      indexedStoreClear(MESSAGE_STORE),
      indexedStoreClear(EPISODE_STORE),
      indexedStoreClear(MEMORY_FACT_STORE),
    ]);
    const settings = saveSettings({
      ...clone(defaultSettings),
      ...clone(STANDALONE_DEFAULT_SETTINGS),
    });
    const history = saveHistory(clone(STANDALONE_DEFAULT_HISTORY));
    await flushMobileStorage();
    return jsonResponse({ ok: true, settings, messages: history });
  }
  if (body.action === "settings") {
    const current = loadSettings();
    return jsonResponse({ ok: true, settings: saveSettings({ ...current, ...body }) });
  }
  if (body.action === "history") {
    const history = saveHistory(body.messages);
    return jsonResponse({ ok: true, count: history.length });
  }
  if (body.action === "clear-history") {
    saveHistory([]);
    return jsonResponse({ ok: true, count: 0 });
  }
  return jsonResponse({ error: "不支持的存储操作" }, 400);
}

async function handleAssets(body, method) {
  if (method === "GET") return jsonResponse(await assetStorageStatus());
  if (method !== "POST") return jsonResponse({ error: "不支持的图片存储操作" }, 405);
  if (body.action === "migrate") {
    if (!assetMigrationPromise) {
      assetMigrationPromise = migrateLegacyImages()
        .catch(async (cause) => {
          const previous = await indexedStoreGet(META_STORE, "asset-migration-v1").catch(() => null) || {};
          const next = {
            ...previous,
            status: "paused",
            current: previous.current || "",
            failed: (Number(previous.failed) || 0) + 1,
            errors: [
              ...(Array.isArray(previous.errors) ? previous.errors : []),
              {
                source: previous.current || "迁移任务",
                error: cause instanceof Error ? cause.message : "图片迁移异常中断",
              },
            ].slice(-30),
            diagnostic: {
              stage: "asset-migration-unhandled",
              stack: cause?.stack || "",
            },
            updatedAt: new Date().toISOString(),
          };
          await indexedStorePut(META_STORE, next, "asset-migration-v1").catch(() => {});
          return next;
        })
        .finally(() => {
          assetMigrationPromise = null;
        });
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const storage = await assetStorageStatus();
    return jsonResponse({
      ok: true,
      accepted: true,
      running: true,
      migration: {
        ...(storage.migration || {}),
        status: "running",
      },
      storage,
    }, 202);
  }
  if (body.action === "import") {
    const reference = await storeImageAsset(body.imageUrl || body.dataUrl, body.category || "other");
    return jsonResponse({ ok: true, reference });
  }
  return jsonResponse({ error: "不支持的图片存储操作" }, 400);
}

async function historyStatus(limit = 80) {
  const messages = (await indexedStoreGetAll(MESSAGE_STORE))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const dayCounts = {};
  const monthCounts = {};
  messages.forEach((message) => {
    const storyDay = `第${Math.max(1, Number(message.storyDay) || 1)}天`;
    dayCounts[storyDay] = (dayCounts[storyDay] || 0) + 1;
    const month = String(message.createdAt || "").slice(0, 7) || "未知时间";
    monthCounts[month] = (monthCounts[month] || 0) + 1;
  });
  return {
    total: messages.length,
    activeCount: loadHistory().length,
    oldestAt: messages.length ? messages[messages.length - 1]?.createdAt || "" : "",
    newestAt: messages[0]?.createdAt || "",
    dayCounts,
    monthCounts,
    messages: messages.slice(0, Math.min(300, Math.max(0, Number(limit) || 80))),
  };
}

async function deleteArchivedMessages(predicate) {
  const messages = await indexedStoreGetAll(MESSAGE_STORE);
  const ids = messages.filter(predicate).map((message) => message.id);
  if (!ids.length) return 0;
  await new Promise((resolve, reject) => {
    const transaction = indexedDatabase.transaction(MESSAGE_STORE, "readwrite");
    const store = transaction.objectStore(MESSAGE_STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("历史记录清理失败"));
    transaction.onabort = () => reject(transaction.error || new Error("历史记录清理中断"));
  });
  return ids.length;
}

async function handleHistory(body, method, url) {
  if (method === "GET") return jsonResponse(await historyStatus(url.searchParams.get("limit")));
  if (method !== "POST" && method !== "DELETE") return jsonResponse({ error: "不支持的历史记录操作" }, 405);
  if (body.action === "archive-active") {
    saveHistory([]);
    await flushMobileStorage();
    return jsonResponse({ ok: true, removed: 0, activeCount: 0 });
  }
  if (body.action === "delete-all") {
    const removed = await deleteArchivedMessages(() => true);
    saveHistory([]);
    await flushMobileStorage();
    return jsonResponse({ ok: true, removed, activeCount: 0 });
  }
  if (body.action === "delete-older-than") {
    const days = Math.max(1, Math.min(3650, Number(body.days) || 30));
    const cutoff = Date.now() - days * 86400000;
    const activeIds = new Set(loadHistory().map((message) => String(message?.id || "")));
    const removed = await deleteArchivedMessages((message) =>
      !activeIds.has(String(message.id))
      && Date.parse(message.createdAt || "") < cutoff,
    );
    return jsonResponse({ ok: true, removed, ...(await historyStatus(0)) });
  }
  return jsonResponse({ error: "不支持的历史记录操作" }, 400);
}

async function handleMemory(body, method) {
  if (method === "GET") {
    const [episodes, facts] = await Promise.all([
      indexedStoreGetAll(EPISODE_STORE),
      indexedStoreGetAll(MEMORY_FACT_STORE),
    ]);
    return jsonResponse({
      episodeCount: episodes.length,
      factCount: facts.length,
      episodes: episodes
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, 80),
      facts: facts
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
        .slice(0, 160),
    });
  }
  return jsonResponse({ error: "不支持的长期记忆操作" }, 405);
}

// ---------- 浏览器内 `/api/*` 路由入口 ----------
async function routeMobileRequest(path, method, body, url) {
  if (path === "/api/storage") return handleStorage(body, method, url);
  if (path === "/api/assets") return handleAssets(body, method);
  if (path === "/api/history") return handleHistory(body, method, url);
  if (path === "/api/memory") return handleMemory(body, method);
  if (path === "/api/backup") return handleBackup(body, method);
  if (path === "/api/usage") return handleUsage(body, method);
  if (path === "/api/health") {
    const config = getMobileApiConfig();
    return jsonResponse({
      chat: config.chatApiKey && config.chatBaseUrl ? "saved" : "missing",
      image: config.imageApiKey && config.imageBaseUrl ? "saved" : "missing",
      mobile: true,
    });
  }
  if (path === "/api/models") {
    const config = getMobileApiConfig();
    let discovered = [];
    let discoveryError = "";
    if (config.chatApiKey && config.chatBaseUrl) {
      try {
        const response = await nativeHttpRequest(`${config.chatBaseUrl}/models`, {
          method: "GET",
          headers: { Authorization: `Bearer ${config.chatApiKey}` },
          timeout: 45000,
        });
        if (response.ok) {
          const result = parseJsonText(response.text);
          discovered = normalizeModelCatalog(result);
          if (!discovered.length) discoveryError = "接口已响应，但没有返回可用模型";
        } else {
          discoveryError = `模型目录请求失败（HTTP ${response.status}）`;
        }
      } catch (error) {
        discoveryError = String(error?.message || "模型目录请求失败");
      }
    } else {
      discoveryError = "请先填写 API 地址和 Key";
    }
    const discoveredChatModels = chatModelCandidates(discovered);
    return jsonResponse({
      models: discoveredChatModels,
      allModels: discovered,
      verifiedModels: discoveredChatModels,
      defaultModel: "",
      source: discoveredChatModels.length ? "direct-api" : "unverified",
      discoveryError,
      authConfigured: Boolean(config.chatApiKey && config.chatBaseUrl),
    });
  }
  if (path === "/api/image-models") {
    const config = getMobileApiConfig();
    let discovered = [];
    let discoveryError = "";
    const imageKey = imageApiKey(config);
    if (imageKey && config.imageBaseUrl) {
      try {
        const errors = [];
        let standardFailed = false;
        for (const endpoint of ["/models", "/image-generation-models"]) {
          // /models 已成功响应时不再请求供应商扩展目录，避免无意义的 404。
          if (endpoint !== "/models" && !standardFailed) break;
          const response = await nativeHttpRequest(`${config.imageBaseUrl}${endpoint}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${imageKey}` },
            timeout: 45000,
          });
          if (!response.ok) {
            if (endpoint === "/models") standardFailed = true;
            errors.push(`${endpoint}（${response.status}）`);
            continue;
          }
          discovered.push(...normalizeModelCatalog(parseJsonText(response.text)));
          discovered = [...new Set(discovered)];
          if (imageModelCandidates(discovered).length) break;
        }
        if (!imageModelCandidates(discovered).length) {
          if (standardFailed) {
            discoveryError = `图片模型目录请求失败：${errors.join("；")}`;
          } else {
            discoveryError = "接口已响应，但没有返回图片模型";
          }
        }
      } catch (error) {
        discoveryError = String(error?.message || "图片模型目录请求失败");
      }
    }
    const models = imageModelCandidates(discovered);
    return jsonResponse({
      models,
      allModels: discovered,
      defaultModel: "",
      source: models.length ? "direct-api" : "unverified",
      discoveryError,
      authConfigured: Boolean(imageKey),
    });
  }
  if (path === "/api/chat") return handleChat(body);
  if (path === "/api/event") return handleStoryEventDecision(body);
  if (path === "/api/suggestions") return handleSuggestions(body);
  if (path === "/api/world") return handleWorld(body);
  if (path === "/api/role") return handleRole(body);
  if (path === "/api/summary") return handleSummary(body);
  if (path === "/api/image") return handleImage(body, method, url);
  return jsonResponse({ error: `App 本地接口不存在：${path}` }, 404);
}

export function installMobileApi() {
  window.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === "string" ? input : input?.url || "";
    const url = new URL(requestUrl, window.location.href);
    const rawPath = String(requestUrl).split(/[?#]/, 1)[0];
    const apiPath = rawPath.startsWith("/api/") ? rawPath : url.pathname;
    if (!apiPath.startsWith("/api/")) return originalFetch(input, init);
    const method = String(init.method || "GET").toUpperCase();
    let body = {};
    if (typeof init.body === "string" && init.body) body = parseJsonText(init.body);
    try {
      return await routeMobileRequest(apiPath, method, body, url);
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : "App 本地服务调用失败",
        diagnostic: error?.diagnostic && typeof error.diagnostic === "object"
          ? error.diagnostic
          : undefined,
      }, 502);
    }
  };
}
