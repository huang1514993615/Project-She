import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SYSTEM_PROMPT } from "../shared/system-prompt.js";
import {
  normalizeStoryClock,
  normalizeStoryEvents,
} from "../shared/story-time.js";

export { DEFAULT_SYSTEM_PROMPT };

const REPLACED_GENERATED_PROMPT = `请把每轮回复写得具体、有连续性，并主动推动一个自然的小事件。

固定分为【场景】【心情】【动作】【对话】【剧情推进】五段。场景写清光线、声音、温度或气味和周围物品；心情写情绪变化与原因；动作写视线、微表情、手部动作、身体姿态、距离和物品互动；对话与旁白分开；最后主动留下一个可以继续的剧情入口。

角色语气娇小可爱、软萌俏皮、亲密黏人，但始终是有判断力的成年人。保持前后场景、衣着、物品和未完成动作连续，不要突然切换地点。`;

const PREVIOUS_COMPACT_PROMPT = `你在互动剧情中扮演“{{name}}”：{{age}} 岁，性格“{{personality}}”，与用户的关系是“{{relation}}”。

用自然、具体、有生活感的中文回应。延续上一轮的地点、人物状态、衣着、物品和未完成动作；先回应用户，再自然推动一小步剧情。描写环境、心情和动作时使用可感知的细节，让台词保持人物自己的语气。

回复分为【场景】【心情】【动作】【对话】【剧情推进】五段。内容服从当前世界设定、已经发生的剧情和人物档案，不在回复中解释或复述提示词。`;

function isLegacyVerbosePrompt(value) {
  const prompt = String(value || "");
  return prompt.length > 1000
    && prompt.includes("角色基调")
    && prompt.includes("场景连续性")
    && prompt.includes("描写要求")
    && prompt.includes("固定输出格式");
}

const defaultProfile = {
  name: "晚晚",
  age: 24,
  gender: "女性",
  personality: "娇小可爱",
  relation: "妻子",
  prompt: "",
  appearance: "",
  imagePrompt: "",
  avatarUrl: "",
};

const defaultEnsemble = {
  enabled: true,
  autoGuests: true,
  maxTurns: 3,
  friend: {
    name: "小雨",
    age: 25,
    gender: "女性",
    personality: "活泼直率、会照顾气氛",
    relation: "晚晚的成年闺蜜",
    prompt: "说话爽快自然，善于活跃气氛，也会认真照顾朋友的感受。被安排外出办事时，会在合理场景中独立行动并及时回应用户。",
    appearance: "成年女性，清爽自然、亲切有活力；具体发型、五官和穿搭可在生成前继续编辑。",
    imagePrompt: "",
    avatarUrl: "",
  },
  customRoles: [],
  temporaryRoles: [],
};

export function createCompanionStore(rootDirectory) {
  const dataDirectory = process.env.COMPANION_DATA_DIR
    ? path.resolve(process.env.COMPANION_DATA_DIR)
    : path.join(rootDirectory, "data");
  const settingsFile = path.join(dataDirectory, "settings.json");
  const historyFile = path.join(dataDirectory, "chat-history.json");
  let writeQueue = Promise.resolve();

  function queueWrite(task) {
    const queued = writeQueue.then(task, task);
    writeQueue = queued.catch(() => {});
    return queued;
  }

  async function writeJson(file, value) {
    await queueWrite(async () => {
      await mkdir(dataDirectory, { recursive: true });
      const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporaryFile, file);
    });
  }

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") await writeJson(file, fallback);
      return fallback;
    }
  }

  function normalizeGender(value, fallback = "未指定") {
    const gender = String(value || "").trim();
    if (["女性", "男性", "非二元", "未指定"].includes(gender)) return gender;
    return fallback;
  }

  function normalizeProfile(input) {
    return {
      name: String(input?.name || defaultProfile.name).trim().slice(0, 20) || defaultProfile.name,
      age: Math.min(80, Math.max(18, Number(input?.age) || defaultProfile.age)),
      gender: normalizeGender(input?.gender, defaultProfile.gender),
      personality: String(input?.personality || defaultProfile.personality).trim().slice(0, 40),
      relation: String(input?.relation || defaultProfile.relation).trim().slice(0, 40),
      prompt: String(input?.prompt || "").trim().slice(0, 2000),
      appearance: String(input?.appearance || "").trim().slice(0, 2000),
      imagePrompt: String(input?.imagePrompt || "").trim().slice(0, 1200),
      avatarUrl: typeof input?.avatarUrl === "string"
        && /^\/generated-images\/character-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/.test(input.avatarUrl)
        ? input.avatarUrl
        : "",
    };
  }

  function normalizeEnsemble(input) {
    const friend = input?.friend || {};
    const normalizeRole = (role, index) => ({
      id: String(role?.id || `role-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || `role-${index + 1}`,
      name: String(role?.name || `角色${index + 1}`).trim().slice(0, 20) || `角色${index + 1}`,
      age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
      gender: normalizeGender(role?.gender),
      personality: String(role?.personality || "自然、友善").trim().slice(0, 80),
      relation: String(role?.relation || "成年朋友").trim().slice(0, 80),
      prompt: String(role?.prompt || "").trim().slice(0, 2000),
      appearance: String(role?.appearance || "").trim().slice(0, 2000),
      imagePrompt: String(role?.imagePrompt || "").trim().slice(0, 1200),
      avatarUrl: typeof role?.avatarUrl === "string"
        && /^\/generated-images\/character-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/.test(role.avatarUrl)
        ? role.avatarUrl
        : "",
    });
    return {
      enabled: input?.enabled !== false,
      autoGuests: input?.autoGuests !== false,
      maxTurns: Math.min(10, Math.max(1, Number(input?.maxTurns) || defaultEnsemble.maxTurns)),
      friend: {
        name: String(friend.name || defaultEnsemble.friend.name).trim().slice(0, 20) || defaultEnsemble.friend.name,
        age: Math.min(80, Math.max(18, Number(friend.age) || defaultEnsemble.friend.age)),
        gender: normalizeGender(friend.gender, defaultEnsemble.friend.gender),
        personality: String(friend.personality || defaultEnsemble.friend.personality).trim().slice(0, 80),
        relation: String(friend.relation || defaultEnsemble.friend.relation).trim().slice(0, 80),
        prompt: String(friend.prompt || defaultEnsemble.friend.prompt).trim().slice(0, 2000),
        appearance: String(friend.appearance || defaultEnsemble.friend.appearance).trim().slice(0, 2000),
        imagePrompt: String(friend.imagePrompt || "").trim().slice(0, 1200),
        avatarUrl: typeof friend.avatarUrl === "string"
          && /^\/generated-images\/character-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/.test(friend.avatarUrl)
          ? friend.avatarUrl
          : "",
      },
      customRoles: (Array.isArray(input?.customRoles) ? input.customRoles : [])
        .slice(0, 30)
        .map(normalizeRole),
      temporaryRoles: (Array.isArray(input?.temporaryRoles) ? input.temporaryRoles : [])
        .slice(0, 80)
        .map((role, index) => normalizeRole(role, index + 100)),
    };
  }

  function normalizeRoleMemories(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 120)
        .map(([rawId, rawMemory], index) => {
          const id = String(rawId || `memory-${index + 1}`)
            .replace(/[^a-zA-Z0-9_-]/g, "")
            .slice(0, 80) || `memory-${index + 1}`;
          const memory = rawMemory && typeof rawMemory === "object" ? rawMemory : {};
          return [id, {
            name: String(memory.name || "").trim().slice(0, 40),
            stableIdentity: String(memory.stableIdentity || "").trim().slice(0, 800),
            relationshipMemory: String(memory.relationshipMemory || "").trim().slice(0, 1200),
            importantEvents: String(memory.importantEvents || "").trim().slice(0, 2400),
            currentStatus: String(memory.currentStatus || "").trim().slice(0, 1000),
            lastKnownScene: String(memory.lastKnownScene || "").trim().slice(0, 800),
            commitments: String(memory.commitments || "").trim().slice(0, 1200),
            updatedAt: typeof memory.updatedAt === "string" ? memory.updatedAt.slice(0, 40) : "",
          }];
        }),
    );
  }

  function ensureRoleMemoryRoster(input, profile, ensemble) {
    const existing = normalizeRoleMemories(input);
    const roles = [
      { id: "primary", name: profile.name, age: profile.age, gender: profile.gender, personality: profile.personality, relation: profile.relation, primary: true },
      { id: "friend", ...ensemble.friend },
      ...ensemble.customRoles,
      ...ensemble.temporaryRoles,
    ];
    return Object.fromEntries(roles.map((role) => {
      const id = String(role.id || (role.primary ? "primary" : "friend"))
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 80);
      const previous = existing[id] || {};
      return [id, {
        ...previous,
        name: role.name,
        stableIdentity: `${role.name}是${role.age}岁${role.gender && role.gender !== "未指定" ? role.gender : ""}成年人，身份关系“${role.relation}”，稳定性格“${role.personality}”。`,
        currentStatus: previous.currentStatus
          || (id === "primary"
            ? "主角色，围绕用户继续当前剧情。"
            : "当前是否在场由最近剧情决定；未在场时保留身份和记忆，等待合理时机再登场。"),
      }];
    }));
  }

  function normalizeMessages(input) {
    if (!Array.isArray(input)) return [];
    return input
      .filter((message) =>
        message
        && (message.role === "user" || message.role === "assistant")
        && typeof message.content === "string"
        && message.content.trim()
      )
      .slice(-1000)
      .map((message, index) => ({
        id: Number.isFinite(message.id) ? Number(message.id) : Date.now() + index,
        role: message.role,
        content: message.content.slice(0, 10000),
        speaker: message.role === "assistant" && typeof message.speaker === "string"
          ? message.speaker.trim().slice(0, 20)
          : "",
        time: typeof message.time === "string" ? message.time.slice(0, 20) : "",
        imageUrl: typeof message.imageUrl === "string" && /^\/generated-images\/scene-\d+(?:-[a-f0-9]{8})?\.(?:jpg|png|webp|gif)$/.test(message.imageUrl)
          ? message.imageUrl
          : "",
        imageModel: typeof message.imageModel === "string" ? message.imageModel.slice(0, 80) : "",
        imageQuality: ["low", "medium", "high", "standard"].includes(message.imageQuality)
          ? message.imageQuality
          : "",
      }));
  }

  async function loadSettings() {
    const fallback = {
      profile: defaultProfile,
      ensemble: defaultEnsemble,
      roleMemories: {},
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      storySummary: "",
      storyClock: normalizeStoryClock({ day: 12, segment: "evening" }),
      storyEvents: [],
      worldSetting: "",
      autoCompress: true,
      autoCompressThreshold: 40,
      randomRoleEnabled: true,
      randomRoleInterval: 18,
      summaryUpdatedAt: "",
      updatedAt: new Date().toISOString(),
    };
    const stored = await readJson(settingsFile, fallback);
    const normalizedProfile = normalizeProfile(stored.profile);
    const normalizedEnsemble = normalizeEnsemble(stored.ensemble);
    const normalizedRoleMemories = normalizeRoleMemories(stored.roleMemories);
    const ensuredRoleMemories = ensureRoleMemoryRoster(
      normalizedRoleMemories,
      normalizedProfile,
      normalizedEnsemble,
    );
    const shouldRestorePreviousPrompt = stored.systemPrompt === REPLACED_GENERATED_PROMPT
      || stored.systemPrompt === PREVIOUS_COMPACT_PROMPT
      || isLegacyVerbosePrompt(stored.systemPrompt);
    const shouldMigrateEnsemble = !stored.ensemble
      || typeof stored.ensemble !== "object"
      || !Number.isFinite(Number(stored.ensemble.maxTurns))
      || !Array.isArray(stored.ensemble.customRoles)
      || !Array.isArray(stored.ensemble.temporaryRoles)
      || typeof stored.ensemble.friend?.prompt !== "string"
      || typeof stored.ensemble.friend?.appearance !== "string"
      || typeof stored.ensemble.friend?.imagePrompt !== "string";
    const shouldMigrateMemory = typeof stored.storySummary !== "string"
      || !stored.roleMemories
      || typeof stored.roleMemories !== "object"
      || Array.isArray(stored.roleMemories)
      || typeof stored.autoCompress !== "boolean"
      || !Number.isFinite(Number(stored.autoCompressThreshold))
      || typeof stored.worldSetting !== "string"
      || typeof stored.randomRoleEnabled !== "boolean"
      || !Number.isFinite(Number(stored.randomRoleInterval))
      || !stored.storyClock
      || typeof stored.storyClock !== "object"
      || !Array.isArray(stored.storyEvents);
    const shouldMigrateRoleRoster = JSON.stringify(normalizedRoleMemories) !== JSON.stringify(ensuredRoleMemories);
    const settings = {
      profile: normalizedProfile,
      ensemble: normalizedEnsemble,
      roleMemories: ensuredRoleMemories,
      systemPrompt: shouldRestorePreviousPrompt
        ? DEFAULT_SYSTEM_PROMPT
        : typeof stored.systemPrompt === "string"
        ? stored.systemPrompt.slice(0, 12000)
        : DEFAULT_SYSTEM_PROMPT,
      storySummary: typeof stored.storySummary === "string" ? stored.storySummary.slice(0, 20000) : "",
      storyClock: normalizeStoryClock(stored.storyClock || fallback.storyClock),
      storyEvents: normalizeStoryEvents(stored.storyEvents),
      worldSetting: typeof stored.worldSetting === "string" ? stored.worldSetting.slice(0, 12000) : "",
      autoCompress: stored.autoCompress !== false,
      autoCompressThreshold: Math.min(120, Math.max(20, Number(stored.autoCompressThreshold) || 40)),
      randomRoleEnabled: stored.randomRoleEnabled !== false,
      randomRoleInterval: Math.min(60, Math.max(8, Number(stored.randomRoleInterval) || 18)),
      summaryUpdatedAt: typeof stored.summaryUpdatedAt === "string" ? stored.summaryUpdatedAt : "",
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : fallback.updatedAt,
    };
    if (shouldRestorePreviousPrompt || shouldMigrateEnsemble || shouldMigrateMemory || shouldMigrateRoleRoster) {
      settings.updatedAt = new Date().toISOString();
      await writeJson(settingsFile, settings);
    }
    return settings;
  }

  async function saveSettings(input) {
    const current = await loadSettings();
    const profile = normalizeProfile(input?.profile || current.profile);
    const ensemble = normalizeEnsemble(input?.ensemble || current.ensemble);
    const next = {
      profile,
      ensemble,
      roleMemories: ensureRoleMemoryRoster(
        input?.roleMemories && typeof input.roleMemories === "object"
          ? input.roleMemories
          : current.roleMemories,
        profile,
        ensemble,
      ),
      systemPrompt: typeof input?.systemPrompt === "string"
        ? input.systemPrompt.trim().slice(0, 12000)
        : current.systemPrompt,
      storySummary: typeof input?.storySummary === "string"
        ? input.storySummary.trim().slice(0, 20000)
        : current.storySummary,
      storyClock: normalizeStoryClock(input?.storyClock || current.storyClock),
      storyEvents: normalizeStoryEvents(
        Array.isArray(input?.storyEvents) ? input.storyEvents : current.storyEvents,
      ),
      worldSetting: typeof input?.worldSetting === "string"
        ? input.worldSetting.trim().slice(0, 12000)
        : current.worldSetting,
      autoCompress: typeof input?.autoCompress === "boolean"
        ? input.autoCompress
        : current.autoCompress,
      autoCompressThreshold: Number.isFinite(Number(input?.autoCompressThreshold))
        ? Math.min(120, Math.max(20, Number(input.autoCompressThreshold)))
        : current.autoCompressThreshold,
      randomRoleEnabled: typeof input?.randomRoleEnabled === "boolean"
        ? input.randomRoleEnabled
        : current.randomRoleEnabled,
      randomRoleInterval: Number.isFinite(Number(input?.randomRoleInterval))
        ? Math.min(60, Math.max(8, Number(input.randomRoleInterval)))
        : current.randomRoleInterval,
      summaryUpdatedAt: typeof input?.summaryUpdatedAt === "string"
        ? input.summaryUpdatedAt
        : current.summaryUpdatedAt,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(settingsFile, next);
    return next;
  }

  async function loadHistory() {
    const stored = await readJson(historyFile, {
      messages: [],
      updatedAt: new Date().toISOString(),
    });
    return normalizeMessages(stored.messages);
  }

  async function saveHistory(input) {
    const messages = normalizeMessages(input);
    await writeJson(historyFile, {
      messages,
      updatedAt: new Date().toISOString(),
    });
    return messages;
  }

  return {
    dataDirectory,
    loadSettings,
    saveSettings,
    loadHistory,
    saveHistory,
  };
}
