import {
  STORY_TIME_SEGMENTS,
  formatStoryMoment,
  normalizeStoryClock,
  normalizeStoryEvent,
  normalizeStoryEvents,
} from "./story-time.js";
import { parseLooseJsonObject } from "./loose-json.js";

const OPERATIONS = new Set(["none", "create", "update", "cancel", "complete"]);
const SEGMENT_IDS = new Set(STORY_TIME_SEGMENTS.map((item) => item.id));

export function shouldAnalyzeStoryEvent(text) {
  const value = String(text || "").trim();
  if (value.length < 2 || value.length > 2400) return false;
  const hasTimeOrSchedule = /今天|今晚|今早|今夜|明天|明早|明晚|后天|大后天|下周|下个月|过几天|改天|稍后|待会|等会|一会儿|第\s*\d+\s*[天日]|\d+\s*(?:天|日|周)(?:后|以后)|[一二两三四五六七]\s*(?:天|日|周)(?:后|以后)|约定|日程|安排|计划|提醒|改期|推迟|提前/.test(value);
  const hasDecision = /去|来(?:我|这|那|家|店|公司|学校|镇|城)|见|买|找|做|吃|看电影|看医生|看展|看演出|参加|出发|回来|拜访|处理|完成|取消|不去|不来了|改到|改成|推迟|提前|提醒|记得|约好|答应|决定|安排|计划/.test(value);
  return hasTimeOrSchedule && hasDecision;
}

function compactEvent(event, clock) {
  return {
    id: event.id,
    title: event.title,
    time: event.day === null
      ? "日期待确认"
      : formatStoryMoment({ ...clock, day: event.day, segment: event.segment }),
    day: event.day,
    segment: event.segment,
    location: event.location,
    participants: event.participants,
    notes: event.notes,
    status: event.status,
  };
}

export function buildStoryEventDecisionMessages(input = {}) {
  const clock = normalizeStoryClock(input.storyClock);
  const events = normalizeStoryEvents(input.storyEvents)
    .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status))
    .slice(0, 40);
  const recentMessages = (Array.isArray(input.recentMessages) ? input.recentMessages : [])
    .filter((message) =>
      message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    )
    .slice(-8)
    .map((message) => ({
      role: message.role,
      speaker: String(message.speaker || "").trim().slice(0, 30),
      content: message.content.trim().slice(0, 1200),
    }));
  const segmentReference = STORY_TIME_SEGMENTS
    .map((segment) => `${segment.id}=${segment.label}`)
    .join("，");
  return [
    {
      role: "system",
      content: `你是互动剧情的“日程判定器”。只判断最新一条消息是否真正改变未来约定，不负责续写剧情。

高精度原则：
1. 只有明确约好、决定、承诺、要求提醒，或明确修改/取消/完成已有约定时才操作。
2. 普通叙述、角色背景、假设、比喻、回忆、时间环境描写、随口提议、疑问句、快捷选项、尚未被接受的建议，一律 operation=none。
3. 不要因为出现“明天、去、做”等单个关键词就建立约定。
4. 用户明确接受角色刚提出的计划，可以 create；角色单方面提议但用户尚未同意，只能 none。
5. 与已有约定是同一件事但时间、地点、人物或内容变化时，使用 update 并填写 targetEventId，不能重复 create。
6. “不去了、取消、别提醒了”对应 cancel；明确说已经做完才对应 complete。
7. create/update 的 day 必须是剧情日编号；无法可靠确定日期时填 null。时段只能使用：${segmentReference}。
8. confidence 低于 0.78 时必须 operation=none。reason 只写一句简短判断依据。

只输出一个 JSON 对象：
{
  "operation": "none|create|update|cancel|complete",
  "targetEventId": "",
  "confidence": 0.0,
  "reason": "",
  "event": {
    "title": "",
    "day": null,
    "segment": "morning",
    "location": "",
    "participants": [],
    "notes": ""
  }
}`,
    },
    {
      role: "user",
      content: `当前剧情时间：${formatStoryMoment(clock)}
当前地点：${clock.location || "未记录"}

已有有效约定：
${events.length ? JSON.stringify(events.map((event) => compactEvent(event, clock)), null, 2) : "[]"}

最近对话：
${recentMessages.length ? JSON.stringify(recentMessages, null, 2) : "[]"}

需要判定的最新消息：
发言人：${String(input.speaker || (input.role === "assistant" ? "角色" : "用户")).slice(0, 30)}
身份：${input.role === "assistant" ? "角色" : "用户"}
内容：${String(input.message || "").trim().slice(0, 2400)}`,
    },
  ];
}

export function parseStoryEventDecision(content, input = {}) {
  const parsed = typeof content === "string"
    ? parseLooseJsonObject(content, (value) => typeof value?.operation === "string")
    : content;
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || 0));
  const operation = OPERATIONS.has(parsed?.operation) ? parsed.operation : "none";
  const events = normalizeStoryEvents(input.storyEvents);
  const targetEventId = String(parsed?.targetEventId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  const targetExists = targetEventId && events.some((event) => event.id === targetEventId);
  if (
    confidence < 0.78
    || operation === "none"
    || (["update", "cancel", "complete"].includes(operation) && !targetExists)
  ) {
    return {
      operation: "none",
      targetEventId: "",
      confidence,
      reason: String(parsed?.reason || "").trim().slice(0, 240),
      event: null,
    };
  }
  if (operation === "cancel" || operation === "complete") {
    return {
      operation,
      targetEventId,
      confidence,
      reason: String(parsed?.reason || "").trim().slice(0, 240),
      event: null,
    };
  }
  const rawEvent = parsed?.event && typeof parsed.event === "object" ? parsed.event : {};
  const title = String(rawEvent.title || "").trim().slice(0, 240);
  if (title.length < 2) {
    return {
      operation: "none",
      targetEventId: "",
      confidence,
      reason: "模型没有提供明确约定内容",
      event: null,
    };
  }
  const numericDay = Number(rawEvent.day);
  const day = rawEvent.day === null
    || rawEvent.day === ""
    || !Number.isFinite(numericDay)
    || numericDay < 1
    ? null
    : Math.max(1, Math.min(99999, Math.round(numericDay)));
  const segment = SEGMENT_IDS.has(rawEvent.segment) ? rawEvent.segment : "morning";
  return {
    operation,
    targetEventId: operation === "update" ? targetEventId : "",
    confidence,
    reason: String(parsed?.reason || "").trim().slice(0, 240),
    event: normalizeStoryEvent({
      ...(operation === "update" ? events.find((event) => event.id === targetEventId) : {}),
      ...rawEvent,
      id: operation === "update"
        ? targetEventId
        : `story-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      day,
      segment,
      status: "pending-confirmation",
      needsDateConfirmation: day === null,
      sourceMessageId: input.sourceMessageId,
      sourceText: input.message,
    }),
  };
}
