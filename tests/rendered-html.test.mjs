import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCompanionStore } from "../server/companion-store.mjs";
import {
  limitEnsembleTurns,
  maxEnsembleMessages,
  maxEnsembleOutputTokens,
} from "../shared/ensemble-turns.js";
import {
  buildImagePromptRequest,
  formatImagePromptResponse,
} from "../shared/image-prompt-context.js";
import { STANDALONE_DEFAULT_HISTORY } from "../mobile/web/standalone-default-scenario.js";
import {
  createDefaultRoleVisualStates,
  DEFAULT_ROLE_VISUAL_STATES,
} from "../shared/role-visual-states.js";
import {
  advanceStoryClock,
  detectFutureStoryEvent,
  dueStoryEvents,
  normalizeStoryClock,
  normalizeStoryEvents,
} from "../shared/story-time.js";
import {
  buildStoryEventDecisionMessages,
  parseStoryEventDecision,
  shouldAnalyzeStoryEvent,
} from "../shared/story-event-ai.js";
import {
  parseLooseJsonArray,
  parseLooseJsonObject,
} from "../shared/loose-json.js";
import { sha256HexBytes } from "../shared/sha256.js";

test("fallback SHA-256 hashes large image buffers without proportional word arrays", () => {
  for (const size of [0, 1, 55, 56, 64, 65, 1024, 2 * 1024 * 1024 + 17]) {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 17) & 0xff;
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256HexBytes(bytes), expected);
  }
});

test("parses structured model output wrapped in prose and code fences", () => {
  const parsed = parseLooseJsonObject(
    `好的，下面是结果：
\`\`\`json
{"scene":"阁楼","turns":[{"speaker":"晚晚","dialogue":"门外有人说：别碰{门}","progression":"她已经走到门边",},],}
\`\`\`
以上是本轮内容。`,
    (value) => Array.isArray(value?.turns),
  );
  assert.equal(parsed.scene, "阁楼");
  assert.equal(parsed.turns[0].speaker, "晚晚");
  assert.match(parsed.turns[0].dialogue, /\{门\}/);
});

test("selects the matching JSON value when explanatory text contains another object", () => {
  const parsed = parseLooseJsonObject(
    `结构示意：{"notice":"这不是最终结果"}
实际输出：{"scene":"钟楼","turns":[{"speaker":"小雨","dialogue":"我去看一眼"}]}`,
    (value) => Array.isArray(value?.turns),
  );
  assert.equal(parsed.scene, "钟楼");
});

test("parses JSON arrays with surrounding text and minor punctuation mistakes", () => {
  const parsed = parseLooseJsonArray(`建议如下：\n["先检查门锁","让小雨查看窗外","带晚晚离开阁楼",]\n请任选一条。`);
  assert.deepEqual(parsed, ["先检查门锁", "让小雨查看窗外", "带晚晚离开阁楼"]);
});

test("repairs full-width separators and raw line breaks inside JSON strings", () => {
  const parsed = parseLooseJsonObject(`结果：{"scene"："雨夜"，"dialogue"："第一行
第二行"}`);
  assert.equal(parsed.scene, "雨夜");
  assert.equal(parsed.dialogue, "第一行\n第二行");
});

test("limits unique participants while allowing a character to reply again", () => {
  const turns = [
    { speaker: "晚晚", content: "第一句" },
    { speaker: "小雨", content: "第二句" },
    { speaker: " 晚 晚 ", content: "第三句" },
    { speaker: "店员", content: "不应进入" },
  ];

  const limited = limitEnsembleTurns(turns, 2);
  assert.deepEqual(limited.map((turn) => turn.speaker), ["晚晚", "小雨", "晚 晚"]);
  assert.equal(maxEnsembleMessages(2), 8);
  assert.equal(maxEnsembleMessages(10), 40);
  assert.equal(maxEnsembleOutputTokens(2), 3280);
  assert.equal(maxEnsembleOutputTokens(10), 11600);
  assert.equal(limitEnsembleTurns(turns, 1).length, 2);
});

test("image prompt context keeps stable appearance above recent dialogue", () => {
  const body = {
    provider: "grok",
    profile: {
      id: "primary",
      name: "晚晚",
      age: 80,
      gender: "女性",
      relation: "妹妹",
      personality: "安静警惕",
      appearance: "黑发紫瞳，双侧马尾，红色发绳，右手腕红绳，深紫色小裙子。",
      imagePrompt: "人物正面清晰。",
    },
    ensemble: { enabled: true, friend: { name: "小雨", appearance: "浅蓝短发，贝壳吊坠。" } },
    roleMemories: {
      primary: {
        stableIdentity: "暗影神子，外表固定在七八岁形态。",
        currentStatus: "在阁楼保护哥哥。",
      },
    },
    worldSetting: "艾尔德兰末法纪元。",
    storySummary: "三人躲避教廷追捕。",
    messages: [
      { role: "assistant", speaker: "晚晚", content: "影子吞没窗缝的光，她让哥哥闭眼。" },
    ],
  };

  const scene = buildImagePromptRequest(body, "scene");
  assert.match(scene.user, /黑发紫瞳/);
  assert.match(scene.user, /右手腕红绳/);
  assert.match(scene.user, /暗影神子/);
  assert.match(scene.user, /艾尔德兰末法纪元/);
  assert.match(scene.system, /不是把最后一条回复改写成分镜/);
  assert.match(scene.system, /禁止输出对白/);

  const character = buildImagePromptRequest({
    ...body,
    roleId: "primary",
    role: body.profile,
  }, "character");
  assert.match(character.user, /稳定外观（必须逐项落实到画面）/);
  assert.match(character.user, /最近相关对话——仅作为当前状态证据/);
  const formattedCharacter = formatImagePromptResponse(JSON.stringify({
    wardrobeState: "深紫色裙摆被雨雾轻微打湿",
    pose: "正面站立，右手轻触手腕红绳",
    expression: "紫瞳警惕地看向镜头外",
    scene: "阁楼窗边的雨夜",
    lighting: "门缝暖光与窗外冷光交错",
    camera: "正面三分之二全身构图，9:16",
  }), "character", character);
  assert.match(formattedCharacter, /稳定外观：黑发紫瞳/);
  assert.equal(formattedCharacter.match(/黑发紫瞳/g)?.length, 1);
  assert.match(formattedCharacter, /姿态动作：正面站立/);

  const formatted = formatImagePromptResponse(JSON.stringify({
    scene: "阁楼雨夜",
    cast: "晚晚位于前景",
    appearance: "黑发紫瞳，双侧马尾，红色发绳",
    wardrobe: "深紫色小裙子",
    pose: "右手攥住衣角",
    interaction: "护在哥哥前方",
    expression: "视线锁定门口",
    environment: "木梯与门缝微光",
    lighting: "冷暖光交界",
    camera: "正面三分之二视角",
  }), "scene");
  assert.match(formatted, /稳定外观：黑发紫瞳/);
  assert.doesNotMatch(formatted, /哥哥，闭眼/);
});

test("standalone opening messages contain real line breaks", () => {
  for (const message of STANDALONE_DEFAULT_HISTORY) {
    assert.match(message.content, /\n\n/);
    assert.doesNotMatch(message.content, /\\n/);
  }
});

test("role visual library includes the full default emotion and action set", () => {
  const states = createDefaultRoleVisualStates();
  assert.equal(states.length, 32);
  assert.equal(new Set(states.map((state) => state.id)).size, states.length);
  for (const id of [
    "coquettish_sleeve",
    "disdain_arms_crossed",
    "mischievous_grin",
    "sleepy_yawn",
    "hold_hands_close",
    "alert_scan",
    "cast_spell",
  ]) {
    assert.ok(states.some((state) => state.id === id), `${id} should be included`);
  }
  states[0].tags.push("isolated-change");
  assert.doesNotMatch(DEFAULT_ROLE_VISUAL_STATES[0].tags.join(","), /isolated-change/);
});

test("story time keeps confirmed future plans independent from chat compression", () => {
  const clock = normalizeStoryClock({ day: 12, segment: "evening", location: "偏远小镇" });
  const detected = detectFutureStoryEvent(
    "明天下午和小雨去北门集市买药材，记得提醒我。",
    clock,
    ["晚晚", "小雨"],
  );
  assert.ok(detected);
  assert.equal(detected.day, 13);
  assert.equal(detected.segment, "afternoon");
  assert.equal(detected.status, "pending-confirmation");
  assert.deepEqual(detected.participants, ["小雨"]);

  const confirmed = normalizeStoryEvents([{ ...detected, status: "confirmed" }]);
  assert.equal(dueStoryEvents(confirmed, clock).length, 0);
  const next = advanceStoryClock(clock, 13, "afternoon");
  assert.equal(dueStoryEvents(confirmed, next).length, 1);

  const ambiguous = detectFutureStoryEvent("过几天带晚晚去看看新的落脚点", clock, ["晚晚"]);
  assert.ok(ambiguous?.needsDateConfirmation);
  assert.equal(ambiguous?.day, 15);
});

test("AI schedule decisions ignore incidental time text and update existing plans", () => {
  assert.equal(shouldAnalyzeStoryEvent("明天的天气看起来会很好"), false);
  assert.equal(shouldAnalyzeStoryEvent("明天下午和小雨去集市，记得提醒我"), true);
  const clock = normalizeStoryClock({ day: 12, segment: "evening" });
  const existing = normalizeStoryEvents([{
    id: "market-plan",
    title: "和小雨去集市",
    day: 13,
    segment: "afternoon",
    status: "confirmed",
  }]);
  const messages = buildStoryEventDecisionMessages({
    message: "改成后天上午去集市",
    storyClock: clock,
    storyEvents: existing,
    recentMessages: [{ role: "user", content: "改成后天上午去集市" }],
  });
  assert.match(messages[0].content, /不能重复 create/);
  assert.match(messages[1].content, /market-plan/);
  const decision = parseStoryEventDecision(JSON.stringify({
    operation: "update",
    targetEventId: "market-plan",
    confidence: 0.94,
    reason: "明确改期",
    event: {
      title: "和小雨去集市",
      day: 14,
      segment: "morning",
      location: "集市",
      participants: ["小雨"],
      notes: "",
    },
  }), {
    message: "改成后天上午去集市",
    sourceMessageId: 88,
    storyEvents: existing,
  });
  assert.equal(decision.operation, "update");
  assert.equal(decision.targetEventId, "market-plan");
  assert.equal(decision.event.day, 14);
  assert.equal(decision.event.status, "pending-confirmation");
  assert.equal(parseStoryEventDecision('{"operation":"create","confidence":0.6}', {
    storyEvents: existing,
  }).operation, "none");
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Night Mailbox application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>夜航信箱｜AI 陪伴<\/title>/i);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/i);
  assert.match(html, /name="theme-color" content="#171925"/i);
});

test("uses the Node file API and mobile quick menu", async () => {
  const [component, css, chatRoute, eventRoute, defaultPrompt, worldRoute, suggestionRoute, summaryRoute, imagePromptContext, localServer, modelConfigText, mobileApi, mobileManifest, mobilePage, mobileMain, mobileCss] = await Promise.all([
    readFile(new URL("../app/VueGirlfriend.jsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/event/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/system-prompt.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/world/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/suggestions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/image-prompt-context.js", import.meta.url), "utf8"),
    readFile(new URL("../server/local-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../config/ai-models.json", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/native-api.js", import.meta.url), "utf8"),
    readFile(new URL("../uniapp/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../uniapp/pages/index/index.vue", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/mobile.css", import.meta.url), "utf8"),
  ]);
  const modelConfig = JSON.parse(modelConfigText);

  assert.match(component, /fetch\("\/api\/storage"/);
  assert.match(component, /v-local-image=/);
  assert.match(component, /MAX_LOCAL_IMAGE_CACHE_ITEMS\s*=\s*24/);
  assert.match(component, /__NIGHT_MAILBOX_NATIVE_IMAGE__\?\.resolvePreviewSource/);
  assert.match(component, /systemPrompt:\s*this\.systemPrompt/);
  assert.match(component, /\.slice\(-1000\)/);
  assert.match(component, /clearConversation\(\)/);
  assert.match(component, /fetch\("\/api\/suggestions"/);
  assert.match(component, /refreshSuggestions\(/);
  assert.match(component, /setDownstreamModel/);
  assert.match(component, /fetch\("\/api\/models"/);
  assert.match(component, /provider,\s*model:\s*provider === "grok" \? this\.grokModel : "",\s*profile:\s*this\.profile/);
  assert.match(component, /ensemble:\s*this\.ensemble/);
  assert.match(component, /多人场景/);
  assert.match(component, /submitEditedMessage\(message\)/);
  assert.match(component, /this\.messages\s*=\s*this\.messages\.slice\(0,\s*messageIndex\)/);
  assert.match(component, /保存并重新发送/);
  assert.match(component, /responseMode:\s*this\.ensemble\.enabled\s*\?\s*"multi"/);
  assert.match(component, /playEnsembleTurns/);
  assert.match(component, /ensemblePlaybackToken/);
  assert.match(component, /暂停接话/);
  assert.match(component, /addCustomRole/);
  assert.match(component, /角色专属提示词/);
  assert.match(component, /最多再创建 30 个角色/);
  assert.match(component, /模型返回不完整，本轮已停止/);
  assert.match(component, /chatProvider !== 'grok'/);
  assert.match(component, /加入固定角色/);
  assert.match(component, /AI 生成完整档案/);
  assert.match(component, /AI 生成 \/ 优化人物提示词/);
  assert.match(component, /AI 生成 \/ 优化稳定外观/);
  assert.match(component, /ensureTemporaryRoleFromMessage/);
  assert.match(component, /autoGenerateTemporaryRoles/);
  assert.match(component, /roleMemory:\s*this\.roleMemories/);
  assert.match(component, /temporaryRoles/);
  assert.match(component, /generateRoleSetting/);
  assert.match(component, /prepareCharacterPrompt/);
  assert.match(component, /generateCharacterImage/);
  assert.match(component, /人物形象设定/);
  assert.match(component, /summarizeConversation/);
  assert.match(component, /自动压缩上下文/);
  assert.match(component, /storySummary:\s*this\.storySummary/);
  assert.match(component, /storyClock:\s*this\.storyClock/);
  assert.match(component, /storyEvents:\s*this\.storyEvents/);
  assert.match(component, /detectAndRecordStoryEvent/);
  assert.match(component, /patchStoryEvent/);
  assert.match(component, /fetch\("\/api\/event"/);
  assert.match(component, /约定时间到了/);
  assert.match(component, /class="schedule-panel"/);
  assert.match(component, /确认推进剧情时间/);
  assert.match(component, /剧情日程/);
  assert.match(component, /roleMemories:\s*this\.roleMemories/);
  assert.match(component, /existingRoleMemories:\s*this\.roleMemories/);
  assert.match(component, /压缩后的角色长期记忆/);
  assert.match(component, /class="prompt-panel"/);
  assert.match(component, /class="data-diagnostics-panel"/);
  assert.match(component, /mobileTab === 'data'/);
  assert.match(component, /data-testid="backup-export"/);
  assert.match(component, /data-testid="backup-import"/);
  assert.match(component, /pendingBackup/);
  assert.match(component, /confirmBackupImport/);
  assert.doesNotMatch(component, /window\.confirm\(`即将导入/);
  assert.match(component, /exportAllData/);
  assert.match(component, /importAllData/);
  assert.match(component, /\/api\/backup/);
  assert.match(component, /不包含 API Key/);
  assert.match(component, /提示词优先级/);
  assert.match(component, /世界设定（最高优先级）/);
  assert.match(component, /role-prompt-manager-card/);
  assert.match(component, /生图提示词（只用于图片模型）/);
  assert.match(component, /v-model="selectedRole\.gender"/);
  assert.match(component, /fetch\("\/api\/image-models"/);
  assert.match(component, /class="image-studio-panel"/);
  assert.match(component, /action:\s*"generate-async"/);
  assert.match(component, /场景相册/);
  assert.match(component, /人物相册/);
  assert.match(component, /人物相册（\{\{\s*selectedRoleAlbumItems\.length\s*\}\}）/);
  assert.match(component, /selectedRoleAlbumItems\(\)/);
  assert.match(component, /openMessageImagePreview\(message\)/);
  assert.match(component, /resolveGalleryPreviewSource/);
  assert.match(component, /plus\.io\.resolveLocalFileSystemURL/);
  assert.match(component, /reader\.readAsDataURL\(file\)/);
  assert.match(component, /imagePreviewSrc/);
  assert.match(component, /retryGalleryPreview/);
  assert.match(component, /\["character", "visual-state"\]\.includes\(job\.kind\)/);
  assert.match(component, /\["scene", "stage-background"\]\.includes\(job\.kind\)/);
  assert.match(component, /deleteAlbumImage\(item\)/);
  assert.match(component, /method:\s*"DELETE"/);
  assert.match(component, /从相册删除这张图片/);
  assert.match(component, /imagePreviewJob/);
  assert.match(component, /job\.status !== "failed"/);
  assert.match(component, /sceneArchiveSnapshot/);
  assert.match(component, /characterArchiveSnapshot/);
  assert.match(component, /回到本轮开头/);
  assert.match(component, /固定表情图库＋AI 动作驱动/);
  assert.match(component, /class="character-stage"/);
  assert.match(component, /generateSelectedVisualStates/);
  assert.match(component, /kind:\s*"visual-state"/);
  assert.match(component, /openVisualStatePreview\(state\)/);
  assert.match(component, /class="portrait-preview-backdrop visual-state-image-preview"/);
  assert.match(component, /class="visual-state-empty">未生成/);
  assert.match(component, /const url = state\s*\?\s*this\.visualStateImage\(state\)/);
  assert.doesNotMatch(component, /this\.visualStateImage\(state\)\s*\|\|\s*record\.role\.avatarUrl/);
  assert.match(component, /applyStageCue/);
  assert.match(component, /stageMotionClass/);
  assert.match(component, /角色基底图已确认/);
  assert.match(component, /最终图生图提示词/);
  assert.match(component, /useAvatarAsVisualBase/);
  assert.match(component, /prepareStageBackground/);
  assert.match(component, /确认付费并生成背景/);
  assert.match(component, /replayMessageVisual\(message\)/);
  assert.match(component, /replayCurrentStageVisual/);
  assert.match(component, /stageMotionNonce/);
  assert.match(component, /纯白色背景。以图片1为基底，只改变上述表情和动作/);
  assert.doesNotMatch(component, /\{\{\s*stageEmotionLabel\s*\}\}/);
  assert.doesNotMatch(component, /\{\{\s*stageActionLabel\s*\}\}/);
  assert.doesNotMatch(component, /\{\{\s*stageStateLabel\s*\}\}/);
  assert.match(component, /max="10"/);
  assert.match(component, /DOWNSTREAM_API_KEY/);
  assert.match(component, /data\/settings\.json/);
  assert.doesNotMatch(component, /class="mobile-nav"/);
  assert.match(component, /class="mobile-function-menu"/);
  assert.match(component, /class="brand-story-clock"/);
  assert.match(component, /triggerBackupImport/);
  assert.match(component, /importLatestNativeBackup/);
  assert.match(component, /new FileReader\(\)/);
  assert.match(component, /对话模型自动恢复/);
  assert.match(component, /120000/);
  assert.match(
    css,
    /\.chat-panel\s*\{[^}]*padding-bottom:\s*max\([^}]*safe-area-inset-bottom/s,
  );
  assert.match(mobileMain, /installMobileViewportGuards/);
  assert.match(mobileMain, /softinputMode:\s*"adjustResize"/);
  assert.match(mobileMain, /--app-runtime-safe-bottom/);
  assert.match(mobileCss, /--app-runtime-viewport-height/);
  assert.match(mobileCss, /env\(safe-area-inset-bottom/);
  assert.match(mobileCss, /\.mobile-api-toggle/);
  assert.match(mobilePage, /softinputMode:\s*"adjustResize"/);
  assert.match(css, /\.brand-bar[\s\S]*?grid-template-columns:\s*1fr auto 1fr/);
  assert.match(css, /\.mobile-function-grid/);
  assert.match(css, /\.schedule-panel\.mobile-active/);
  assert.match(css, /\.chat-model-switch\s*\{\s*display:\s*none;/);
  assert.match(css, /font-size:\s*16px;\s*line-height:\s*1\.78/);
  assert.match(css, /@keyframes character-breathe/);
  assert.match(css, /\.character-stage\.motion-active/);
  assert.match(css, /\.character-stage\s*\{[\s\S]*?background:\s*#fff;/);
  assert.match(chatRoute, /retryableStatuses/);
  assert.match(chatRoute, /JSON 格式修复器/);
  assert.match(chatRoute, /multiFallbackTurn/);
  assert.match(chatRoute, /X-Chat-Fallback/);
  assert.match(chatRoute, /stream:\s*true/);
  assert.match(chatRoute, /readChatCompletionContent/);
  assert.match(eventRoute, /buildStoryEventDecisionMessages/);
  assert.match(eventRoute, /parseStoryEventDecision/);
  assert.doesNotMatch(eventRoute, /json_object/);
  assert.doesNotMatch(chatRoute, /json_object/);
  assert.match(chatRoute, /maxEnsembleOutputTokens\(maxTurns\)/);
  assert.match(chatRoute, /"progression":"明确的剧情推进"/);
  assert.match(chatRoute, /【剧情推进】/);
  assert.match(chatRoute, /只有最后一条 progression 非空/);
  assert.match(chatRoute, /Math\.min\(10,\s*Math\.max\(1/);
  assert.match(chatRoute, /世界设定 → 人物稳定身份与关系 → 角色长期记忆 → 已发生的剧情与最近对话 → 回复风格/);
  assert.match(chatRoute, /人物稳定身份与关系 → 角色长期记忆/);
  assert.match(chatRoute, /未在场角色名册/);
  assert.match(summaryRoute, /永久角色名册/);
  assert.match(summaryRoute, /roleMemories/);
  assert.match(summaryRoute, /relationshipMemory/);
  assert.match(defaultPrompt, /每轮都要让局面产生一个明确变化/);
  assert.doesNotMatch(defaultPrompt, /安全边界|必须始终|禁止输出/);
  assert.doesNotMatch(worldRoute, /安全边界|内容边界|禁止输出/);
  assert.match(suggestionRoute, /具体动词 \+ 对象或地点 \+ 下一步目的/);
  assert.match(suggestionRoute, /不能是脱离场景的万能句/);
  assert.match(suggestionRoute, /stream:\s*isGrok/);
  assert.match(suggestionRoute, /readSuggestionContent/);
  assert.match(suggestionRoute, /mode:\s*"fallback"/);
  assert.match(localServer, /handleImageModels/);
  assert.match(localServer, /resolveImageModel/);
  assert.match(localServer, /function resolveImageSize/);
  assert.match(localServer, /1024x1536/);
  assert.match(localServer, /不得把男性写成女性/);
  assert.match(imagePromptContext, /最近对话只负责确定此刻地点/);
  assert.match(imagePromptContext, /稳定外观（必须逐项落实到画面）/);
  assert.match(imagePromptContext, /不是把最后一条回复改写成分镜/);
  assert.match(localServer, /不默认套用白色雪纺或固定身材/);
  assert.match(localServer, /人物正面或正面三分之二角度/);
  assert.match(localServer, /generateImageWithRetry/);
  assert.match(localServer, /isRetryableImageRefusal/);
  assert.match(localServer, /maxAttempts = 3/);
  assert.match(localServer, /normalizeImageArchive/);
  assert.match(localServer, /deleteGeneratedImageFile/);
  assert.match(localServer, /clearDeletedImageReferences/);
  assert.match(localServer, /request\.method === "DELETE"/);
  assert.match(localServer, /await unlink\(target\)/);
  assert.match(localServer, /generateImageArchiveSummary/);
  assert.match(localServer, /summaryGenerated/);
  assert.match(localServer, /IMAGE_REQUEST_TIMEOUT_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(localServer, /AbortSignal\.timeout\(IMAGE_REQUEST_TIMEOUT_MS\)/);
  assert.match(mobileApi, /IMAGE_REQUEST_TIMEOUT_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(mobileApi, /storyClock:\s*normalizeStoryClock/);
  assert.match(mobileApi, /storyEvents:\s*normalizeStoryEvents/);
  assert.match(localServer, /IMAGE_JOB_CONCURRENCY\s*=\s*6/);
  assert.match(localServer, /BACKUP_FORMAT\s*=\s*"night-mailbox-backup"/);
  assert.match(localServer, /async function handleBackup/);
  assert.match(localServer, /security:\s*\{\s*apiKeysIncluded:\s*false\s*\}/);
  assert.match(localServer, /activeImageJobCount\s*<\s*IMAGE_JOB_CONCURRENCY/);
  assert.match(mobileApi, /IMAGE_JOB_CONCURRENCY\s*=\s*6/);
  assert.match(mobileApi, /activeImageJobCount\s*<\s*IMAGE_JOB_CONCURRENCY/);
  assert.match(mobileApi, /timeout:\s*IMAGE_REQUEST_TIMEOUT_MS/);
  assert.match(mobileApi, /plus\.storage/);
  assert.match(mobileApi, /function normalizeStoredHistory/);
  assert.match(mobileApi, /content\.replace\(\/\\\\r\\\\n\|\\\\n\/g,\s*"\\n"\)/);
  assert.match(mobileApi, /plus\.net\.XMLHttpRequest/);
  assert.match(mobileApi, /plus\.downloader\.createDownload/);
  assert.match(mobileManifest, /"vueVersion"\s*:\s*"2"/);
  assert.match(mobilePage, /hybrid\/html\/index\.html/);
  assert.equal(modelConfig.downstream.baseUrl, "https://test1122.up.railway.app/v1");
  assert.ok(modelConfig.downstream.chat.models.includes("claude-haiku-4-5-20251001"));
  assert.ok(modelConfig.downstream.chat.models.includes("grok-4.5"));
  assert.equal(modelConfig.downstream.chat.defaultModel, "grok-4.5");
  assert.equal(modelConfig.downstream.image.baseUrl, "https://downstream.jbbtoken.cn/v1");
  assert.deepEqual(modelConfig.downstream.image.models, ["gpt-image-2"]);
  assert.equal(modelConfig.downstream.image.portraitSize, "1024x1536");
});

test("persists settings and chat history as JSON files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "night-mailbox-"));
  const store = createCompanionStore(directory);
  try {
    await store.saveSettings({
      profile: { name: "测试角色", age: 26, gender: "女性", personality: "温柔", relation: "妻子" },
      ensemble: {
        enabled: true,
        autoGuests: true,
        maxTurns: 15,
        friend: {
          name: "小雨",
          age: 25,
          personality: "活泼",
          relation: "成年闺蜜",
          prompt: "说话爽快。",
          appearance: "黑色长发，浅色外套。",
          avatarUrl: "/generated-images/character-123.png",
        },
        customRoles: [
          {
            id: "lin",
            name: "阿琳",
            age: 28,
            gender: "男性",
            personality: "冷静",
            relation: "共同好友",
            prompt: "表达简洁。",
            appearance: "短发，深色西装。",
          },
        ],
        temporaryRoles: [
          {
            id: "temporary-clerk",
            name: "店员阿晴",
            age: 23,
            personality: "热情细心",
            relation: "商店里认识的临时角色",
            prompt: "只在商店场景自然回应，办完事情后离场。",
            appearance: "栗色短发，穿浅色店员围裙。",
          },
        ],
      },
      systemPrompt: "保持场景连续。",
      storySummary: "当前在客厅，晚晚正在等用户回来。",
      roleMemories: {
        friend: {
          name: "小雨",
          stableIdentity: "小雨是25岁成年人，是晚晚的成年闺蜜。",
          relationshipMemory: "与晚晚是多年闺蜜，也认识用户。",
          importantEvents: "曾替用户外出购买物品。",
          currentStatus: "目前不在客厅，正在外出办事。",
          lastKnownScene: "商场一层。",
          commitments: "买完东西后回来。",
        },
      },
      autoCompress: true,
      autoCompressThreshold: 50,
      summaryUpdatedAt: "2026-07-26T12:00:00.000Z",
    });
    await store.saveHistory([
      { id: 1, role: "user", content: "你好", time: "20:00" },
      { id: 2, role: "assistant", speaker: "小雨", content: "我在。", time: "20:00" },
    ]);

    const [settings, messages, settingsFile, historyFile] = await Promise.all([
      store.loadSettings(),
      store.loadHistory(),
      readFile(path.join(directory, "data", "settings.json"), "utf8"),
      readFile(path.join(directory, "data", "chat-history.json"), "utf8"),
    ]);

    assert.equal(settings.profile.name, "测试角色");
    assert.equal(settings.ensemble.friend.name, "小雨");
    assert.equal(settings.ensemble.autoGuests, true);
    assert.equal(settings.ensemble.maxTurns, 10);
    assert.equal(settings.ensemble.customRoles[0].name, "阿琳");
    assert.equal(settings.ensemble.customRoles[0].gender, "男性");
    assert.equal(settings.ensemble.temporaryRoles[0].name, "店员阿晴");
    assert.match(settings.ensemble.temporaryRoles[0].prompt, /办完事情后离场/);
    assert.equal(settings.ensemble.friend.avatarUrl, "/generated-images/character-123.png");
    assert.equal(settings.systemPrompt, "保持场景连续。");
    assert.equal(settings.storySummary, "当前在客厅，晚晚正在等用户回来。");
    assert.equal(settings.roleMemories.friend.name, "小雨");
    assert.match(settings.roleMemories.friend.stableIdentity, /成年闺蜜/);
    assert.match(settings.roleMemories.friend.relationshipMemory, /多年闺蜜/);
    assert.match(settings.roleMemories.friend.currentStatus, /外出办事/);
    assert.match(settings.roleMemories.primary.stableIdentity, /测试角色/);
    assert.equal(settings.autoCompressThreshold, 50);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].speaker, "小雨");
    assert.match(settingsFile, /"systemPrompt": "保持场景连续。"/);
    assert.match(historyFile, /"content": "你好"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("builds a single-file direct API edition backed by IndexedDB", async () => {
  const [html, appUpdateHtml, mobileApi, mobileEntry, standaloneScenario, appShell, localServer] = await Promise.all([
    readFile(new URL("../standalone/night-mailbox.html", import.meta.url), "utf8"),
    readFile(new URL("../outputs/night-mailbox-app-update.html", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/native-api.js", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile/web/standalone-default-scenario.js", import.meta.url), "utf8"),
    readFile(new URL("../uniapp/pages/index/index.vue", import.meta.url), "utf8"),
    readFile(new URL("../server/local-server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /__NIGHT_MAILBOX_STANDALONE__/);
  assert.match(html, /__NIGHT_MAILBOX_DEFAULT_AVATAR__/);
  assert.doesNotMatch(html, /(?:src|href)="\.\/assets\//);
  assert.match(appUpdateHtml, /__NIGHT_MAILBOX_APP_SHELL__=true/);
  assert.doesNotMatch(appUpdateHtml, /(?:src|href)="\.\/assets\//);
  assert.match(appShell, /app-update\/manifest\.json/);
  assert.match(appShell, /index\.update\.tmp/);
  assert.match(appShell, /SHA-256/);
  assert.match(appShell, /replaceLocalPage/);
  assert.match(appShell, /plus\.webview\.create/);
  assert.match(localServer, /night-mailbox-app-update\.html/);
  assert.match(localServer, /createHash\("sha256"\)/);
  assert.match(localServer, /rebuildAppUpdatePackage/);
  assert.match(mobileApi, /INDEXED_DB_NAME\s*=\s*"night-mailbox"/);
  assert.match(mobileApi, /__NIGHT_MAILBOX_APP_SHELL__/);
  assert.match(mobileApi, /indexedDB\.open/);
  assert.match(mobileApi, /await flushMobileStorage\(\)/);
  assert.match(mobileApi, /downstreamBaseUrl}\/models/);
  assert.match(mobileApi, /浏览器无法直连接口/);
  assert.match(mobileApi, /Promise\.race/);
  assert.match(mobileApi, /content:\s*parts\.join\("\\n\\n"\)/);
  assert.match(mobileApi, /preferredStateId/);
  assert.match(mobileApi, /scheduleImageJobQueue/);
  assert.match(mobileApi, /IMAGE_JOB_CONCURRENCY\s*=\s*6/);
  assert.match(mobileApi, /activeImageJobCount\s*<\s*IMAGE_JOB_CONCURRENCY/);
  assert.match(mobileApi, /job\.status === "queued" && job\.request/);
  assert.match(mobileApi, /kind:\s*\["character", "visual-state", "stage-background"\]/);
  assert.match(mobileApi, /deleteMobileGeneratedImageFile/);
  assert.match(mobileApi, /clearMobileImageReferences/);
  assert.match(mobileApi, /method === "DELETE"/);
  assert.match(mobileApi, /\/images\/edits/);
  assert.match(mobileApi, /new FormData\(\)/);
  assert.match(mobileApi, /formData\.append\("image", baseImageBlob/);
  assert.match(mobileApi, /prepare-background/);
  assert.match(mobileApi, /stage-background/);
  assert.doesNotMatch(mobileApi, /json_object/);
  assert.match(mobileApi, /示例输出（只示范格式）/);
  assert.match(mobileApi, /maxEnsembleOutputTokens\(maxParticipants\)/);
  assert.match(mobileApi, /stream_complete/);
  assert.match(mobileApi, /\{\s*\.\.\.payload,\s*stream:\s*false\s*\}/);
  assert.match(mobileApi, /repairMultiTurns/);
  assert.match(mobileApi, /multi-json-invalid/);
  assert.doesNotMatch(mobileApi, /fallback:\s*"single"/);
  assert.match(mobileApi, /chatStream:\s*true/);
  assert.match(mobileApi, /stream:\s*typeof options\.stream === "boolean"/);
  assert.match(mobileApi, /data-key="chatStream"\s+type="checkbox"/);
  assert.match(mobileApi, /input\.type === "checkbox"\s*\?\s*input\.checked/);
  assert.match(mobileApi, /parseSseChatCompletion/);
  assert.match(mobileApi, /parseChatCompletionResponse/);
  assert.match(mobileApi, /messageContentCodePoints/);
  assert.match(mobileApi, /retryRequestIdentical:\s*recoveryPayload === payload/);
  assert.doesNotMatch(mobileApi, /emptyContentRetryMessages/);
  assert.match(mobileApi, /rawPath\.startsWith\("\/api\/"\)\s*\?\s*rawPath\s*:\s*url\.pathname/);
  assert.match(mobileApi, /night-mailbox:open-api-settings/);
  assert.match(mobileApi, /apply-default-scenario/);
  assert.match(mobileApi, /BACKUP_FORMAT\s*=\s*"night-mailbox-backup"/);
  assert.match(mobileApi, /handleBackup/);
  assert.match(mobileApi, /__NIGHT_MAILBOX_NATIVE_BACKUP__/);
  assert.match(mobileApi, /__NIGHT_MAILBOX_NATIVE_IMAGE__/);
  assert.match(mobileApi, /plusFilePathCandidates/);
  assert.match(mobileApi, /convertAbsoluteFileSystem/);
  assert.match(mobileApi, /readPlusImageAsDataUrl/);
  assert.match(mobileApi, /const localPath = `_downloads\/night-mailbox\/\$\{filename\}`/);
  assert.match(appUpdateHtml, /__NIGHT_MAILBOX_NATIVE_IMAGE__/);
  assert.match(mobileApi, /_downloads\//);
  assert.match(mobileApi, /night-mailbox-native-last-backup/);
  assert.match(mobileApi, /INDEXED_DB_VERSION\s*=\s*4/);
  assert.match(mobileApi, /ASSET_PREFIX\s*=\s*"asset:\/\/"/);
  assert.match(mobileApi, /createObjectStore\(ASSET_BLOB_STORE\)/);
  assert.match(mobileApi, /createObjectStore\(MESSAGE_STORE/);
  assert.match(mobileApi, /createObjectStore\(EPISODE_STORE/);
  assert.match(mobileApi, /createObjectStore\(MEMORY_FACT_STORE/);
  assert.match(mobileApi, /migrateLegacyImages/);
  assert.match(mobileApi, /resolveAssetThumbnailSource/);
  assert.match(mobileApi, /archiveMessages/);
  assert.match(mobileApi, /retrieveRelevantMemory/);
  assert.match(mobileApi, /archive:\s*\{\s*messages:\s*archivedMessages/);
  assert.doesNotMatch(mobileApi, /callChatModel\(\{\s*\.\.\.body,\s*provider:\s*"deepseek"\s*\},\s*\[\s*\{\s*role:\s*"system",\s*content:\s*`你是本地互动剧情的长期记忆整理器/);
  assert.match(mobileApi, /handleStoryEventDecision/);
  assert.match(mobileApi, /path === "\/api\/event"/);
  assert.match(mobileApi, /apiKeysIncluded:\s*false/);
  assert.doesNotMatch(mobileApi, /className\s*=\s*"mobile-api-button"/);
  assert.match(html, /接口连接设置/);
  assert.match(html, /载入默认艾尔德兰档案/);
  assert.match(html, /第十二神骸/);
  assert.match(standaloneScenario, /只有纯粹兄妹亲情/);
  assert.match(standaloneScenario, /STANDALONE_DEFAULT_ROLE_MEMORIES/);
  assert.match(mobileApi, /reject\(new Error\("直连接口请求超时"\)\)/);
  assert.match(mobileEntry, /await initializeMobileStorage\(\)/);
});
