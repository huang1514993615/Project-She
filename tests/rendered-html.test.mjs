import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  limitEnsembleTurns,
  maxEnsembleMessages,
} from "../shared/ensemble-turns.js";
import {
  buildImageGenerationPayload,
  imageModelAdapterLabel,
} from "../shared/image-models.js";
import {
  advanceStoryClock,
  normalizeStoryEvents,
} from "../shared/story-time.js";
import {
  DEFAULT_API_CONFIG,
  normalizeApiConfig,
  serializeApiConfig,
} from "../src/features/connections/config-schema.js";
import {
  chatModelCandidates,
  imageModelCandidates,
  normalizeModelCatalog,
} from "../src/features/connections/model-catalog.js";
import {
  STANDALONE_DEFAULT_HISTORY,
  STANDALONE_DEFAULT_SETTINGS,
} from "../src/config/default-settings.js";
import { currentRoleDerivedState } from "../src/domain/roles/derived-state.js";
import { appComputed } from "../src/app/computed.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("release starts with a blank, world-first profile", () => {
  assert.deepEqual(STANDALONE_DEFAULT_HISTORY, []);
  assert.equal(STANDALONE_DEFAULT_SETTINGS.onboardingStep, 1);
  assert.equal(STANDALONE_DEFAULT_SETTINGS.onboardingCompleted, false);
  assert.equal(STANDALONE_DEFAULT_SETTINGS.storyInitialized, false);
  assert.equal(STANDALONE_DEFAULT_SETTINGS.worldSetting, "");
  assert.equal(STANDALONE_DEFAULT_SETTINGS.storySummary, "");
  assert.equal(STANDALONE_DEFAULT_SETTINGS.profile.name, "");
  assert.equal(STANDALONE_DEFAULT_SETTINGS.ensemble.friend.name, "");
  assert.deepEqual(STANDALONE_DEFAULT_SETTINGS.roleMemories, {});
});

test("API config writes only one chat key and one image key", () => {
  assert.deepEqual(DEFAULT_API_CONFIG, {
    chatBaseUrl: "",
    chatApiKey: "",
    imageBaseUrl: "",
    imageApiKey: "",
    chatStream: true,
  });
  const migrated = normalizeApiConfig({
    downstreamBaseUrl: "https://api.example.com/v1/",
    downstreamKey: "chat-key",
    grokImageKey: "image-key",
  });
  assert.deepEqual(migrated, {
    chatBaseUrl: "https://api.example.com/v1",
    chatApiKey: "chat-key",
    imageBaseUrl: "https://api.example.com/v1",
    imageApiKey: "image-key",
    chatStream: true,
  });
  const saved = serializeApiConfig({ chatApiKey: "new-key", imageApiKey: "" }, migrated);
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(DEFAULT_API_CONFIG).sort());
  assert.equal(saved.chatApiKey, "new-key");
  assert.equal(saved.imageApiKey, "new-key");
});

test("model directory is normalized and split without selecting a default", () => {
  const models = normalizeModelCatalog({ data: [
    { id: "grok-4" },
    { id: "gpt-image-2" },
    { id: "text-embedding-3-large" },
    { id: "grok-4" },
    { id: "bad model id" },
  ] });
  assert.deepEqual(models, ["grok-4", "gpt-image-2", "text-embedding-3-large"]);
  assert.deepEqual(chatModelCandidates(models), ["grok-4"]);
  assert.deepEqual(imageModelCandidates(models), ["gpt-image-2"]);
});

test("image adapters preserve provider-specific request shapes", () => {
  const grok = buildImageGenerationPayload({
    model: "grok-imagine-image-quality",
    prompt: "成年人物站在午后的走廊",
    kind: "character",
  });
  assert.equal(grok.aspect_ratio, "9:16");
  assert.equal("size" in grok, false);

  const gpt = buildImageGenerationPayload({
    model: "gpt-image-2",
    prompt: "成年人物肖像",
    kind: "character",
  });
  assert.equal(gpt.size, "1024x1536");
  assert.equal(imageModelAdapterLabel("flux-1.1-pro"), "Flux 兼容参数");
});

test("ensemble turn limit is user-centered and bounded", () => {
  const turns = [
    { speaker: "甲", content: "一" },
    { speaker: "乙", content: "二" },
    { speaker: "甲", content: "三" },
    { speaker: "丙", content: "四" },
  ];
  assert.deepEqual(limitEnsembleTurns(turns, 2).map((turn) => turn.speaker), ["甲", "乙", "甲"]);
  assert.equal(maxEnsembleMessages(1), 4);
  assert.equal(maxEnsembleMessages(10), 40);
});

test("story schedule and role derived state remain pure domain logic", () => {
  const next = advanceStoryClock({ day: 1, segment: "night", location: "码头" }, 2, "morning");
  assert.equal(next.day, 2);
  assert.equal(next.segment, "morning");
  assert.equal(next.location, "码头");
  assert.equal(normalizeStoryEvents([{ id: "x", title: "见面", day: 2, segment: "morning" }]).length, 1);

  const role = currentRoleDerivedState({
    age: 20,
    personality: "安静",
    derivedProfile: { agingRule: "normal", initialActualAge: 20, anchorStoryDay: 1 },
  }, 366);
  assert.equal(role.actualAge, 21);
  assert.equal(role.corePersonality, "安静");
});

test("story computed properties have all time helpers available", () => {
  const context = {
    storyClock: { day: 2, segment: "morning" },
    activeScheduleEvents: [
      { id: "future", day: 3, segment: "morning", status: "confirmed" },
      { id: "past", day: 1, segment: "morning", status: "confirmed" },
    ],
  };
  assert.deepEqual(
    appComputed.upcomingStoryEvents.call(context).map((event) => event.id),
    ["future"],
  );
});

test("source entry is pure frontend and legacy server UI is absent", async () => {
  const [packageText, main, template, createState, browserApi] = await Promise.all([
    read("package.json"),
    read("src/main.js"),
    read("src/app/template.js"),
    read("src/app/create-state.js"),
    read("src/runtime/browser-api.js"),
  ]);
  const manifest = JSON.parse(packageText);
  assert.match(manifest.scripts.dev, /^vite /);
  assert.deepEqual(Object.keys(manifest.dependencies), ["vue"]);
  assert.doesNotMatch(packageText, /vinext|next|react|drizzle/i);
  assert.match(main, /installMobileApi/);
  assert.doesNotMatch(template, /\.env\.local|data\/settings\.json|data\/chat-history\.json/);
  assert.match(createState, /onboardingCompleted: false/);
  assert.doesNotMatch(browserApi, /gptImageKey|grokImageKey|deepseekKey|downstreamKey/);
  assert.doesNotMatch(browserApi, /defaultModel\s*\|\|\s*["']gpt-image/);
  assert.match(browserApi, /maxAttempts: 1/);
});

test("cloud build is static and includes Sites hosting metadata", async () => {
  const [html, hosting] = await Promise.all([
    read("dist/index.html"),
    read("dist/.openai/hosting.json"),
  ]);
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /<script type="module" crossorigin src="\.\/assets\//);
  assert.equal(JSON.parse(hosting).d1, null);
  assert.equal(JSON.parse(hosting).r2, null);
});

test("single-file H5 contains inlined runtime and no external bundle", async () => {
  const html = await read("standalone/night-mailbox.html");
  assert.match(html, /window\.__NIGHT_MAILBOX_STANDALONE__=true/);
  assert.match(html, /window\.__NIGHT_MAILBOX_CORE_AVATARS__/);
  assert.match(html, /<style>[\s\S]+<\/style>/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(html, /<script type="module"[^>]+src=/);
  assert.doesNotMatch(html, /<link rel="stylesheet"[^>]+href=/);
});
