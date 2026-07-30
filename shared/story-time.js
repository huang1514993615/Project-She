export const STORY_TIME_SEGMENTS = [
  { id: "dawn", label: "清晨" },
  { id: "morning", label: "上午" },
  { id: "noon", label: "中午" },
  { id: "afternoon", label: "下午" },
  { id: "evening", label: "傍晚" },
  { id: "night", label: "夜晚" },
  { id: "late-night", label: "深夜" },
];

const SEGMENT_IDS = new Set(STORY_TIME_SEGMENTS.map((item) => item.id));
const ACTIVE_EVENT_STATUSES = new Set(["pending-confirmation", "confirmed", "accepted"]);

export function normalizeStoryClock(input = {}) {
  const segment = SEGMENT_IDS.has(input?.segment) ? input.segment : "evening";
  return {
    calendar: String(input?.calendar || "剧情历").trim().slice(0, 40) || "剧情历",
    day: Math.min(99999, Math.max(1, Math.round(Number(input?.day) || 1))),
    segment,
    location: String(input?.location || "").trim().slice(0, 120),
    updatedAt: typeof input?.updatedAt === "string"
      ? input.updatedAt.slice(0, 40)
      : new Date().toISOString(),
  };
}

export function storySegmentLabel(segment) {
  return STORY_TIME_SEGMENTS.find((item) => item.id === segment)?.label || "傍晚";
}

export function storyMomentValue(day, segment) {
  const safeDay = Math.min(99999, Math.max(1, Math.round(Number(day) || 1)));
  const index = Math.max(0, STORY_TIME_SEGMENTS.findIndex((item) => item.id === segment));
  return safeDay * STORY_TIME_SEGMENTS.length + index;
}

export function formatStoryMoment(clock = {}) {
  const normalized = normalizeStoryClock(clock);
  return `${normalized.calendar}·第${normalized.day}日 · ${storySegmentLabel(normalized.segment)}`;
}

export function normalizeStoryEvent(input = {}, index = 0) {
  const rawDay = Number(input?.day);
  const day = Number.isFinite(rawDay)
    ? Math.min(99999, Math.max(1, Math.round(rawDay)))
    : null;
  const segment = SEGMENT_IDS.has(input?.segment) ? input.segment : "morning";
  const allowedStatuses = [
    "pending-confirmation",
    "confirmed",
    "accepted",
    "declined",
    "completed",
    "missed",
    "cancelled",
  ];
  const status = allowedStatuses.includes(input?.status)
    ? input.status
    : "pending-confirmation";
  return {
    id: String(input?.id || `story-event-${Date.now()}-${index}`)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80) || `story-event-${Date.now()}-${index}`,
    title: String(input?.title || "未命名约定").trim().slice(0, 240) || "未命名约定",
    day,
    segment,
    location: String(input?.location || "").trim().slice(0, 120),
    participants: [...new Set(
      (Array.isArray(input?.participants) ? input.participants : [])
        .map((item) => String(item || "").trim().slice(0, 40))
        .filter(Boolean),
    )].slice(0, 20),
    notes: String(input?.notes || "").trim().slice(0, 1000),
    sourceMessageId: Number.isFinite(Number(input?.sourceMessageId))
      ? Number(input.sourceMessageId)
      : null,
    sourceText: String(input?.sourceText || "").trim().slice(0, 1000),
    status,
    needsDateConfirmation: input?.needsDateConfirmation === true || day === null,
    reminderCount: Math.min(20, Math.max(0, Number(input?.reminderCount) || 0)),
    snoozedUntil: Number.isFinite(Number(input?.snoozedUntil))
      ? Number(input.snoozedUntil)
      : null,
    createdAt: typeof input?.createdAt === "string"
      ? input.createdAt.slice(0, 40)
      : new Date().toISOString(),
    updatedAt: typeof input?.updatedAt === "string"
      ? input.updatedAt.slice(0, 40)
      : new Date().toISOString(),
  };
}

export function normalizeStoryEvents(input) {
  if (!Array.isArray(input)) return [];
  const unique = new Map();
  input.slice(-300).forEach((item, index) => {
    const event = normalizeStoryEvent(item, index);
    unique.set(event.id, event);
  });
  return [...unique.values()].sort((left, right) => {
    if (left.day === null) return right.day === null ? 0 : 1;
    if (right.day === null) return -1;
    return storyMomentValue(left.day, left.segment) - storyMomentValue(right.day, right.segment);
  });
}

export function isActiveStoryEvent(event) {
  return ACTIVE_EVENT_STATUSES.has(event?.status);
}

export function dueStoryEvents(events, clock) {
  const current = storyMomentValue(clock?.day, clock?.segment);
  return normalizeStoryEvents(events).filter((event) =>
    event.day !== null
    && event.status === "confirmed"
    && storyMomentValue(event.day, event.segment) <= current
    && (!Number.isFinite(event.snoozedUntil) || event.snoozedUntil <= current)
  );
}

function detectSegment(text) {
  const candidates = [
    ["late-night", /深夜|半夜|凌晨/],
    ["dawn", /清晨|天亮|一早|早晨/],
    ["morning", /上午|早上/],
    ["noon", /中午|午间|午饭/],
    ["afternoon", /下午|午后/],
    ["evening", /傍晚|黄昏/],
    ["night", /晚上|夜里|夜晚/],
  ];
  return candidates.find(([, pattern]) => pattern.test(text))?.[0] || "morning";
}

function detectDay(text, currentDay) {
  const chineseNumbers = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
  };
  const numbered = text.match(/(\d{1,3})\s*(?:天|日)(?:后|以后)/);
  if (numbered) return { day: currentDay + Number(numbered[1]), ambiguous: false };
  const chineseNumbered = text.match(/([一二两三四五六七])\s*(?:天|日)(?:后|以后)/);
  if (chineseNumbered) return { day: currentDay + chineseNumbers[chineseNumbered[1]], ambiguous: false };
  const weeks = text.match(/(\d{1,2})\s*周(?:后|以后)/);
  if (weeks) return { day: currentDay + Number(weeks[1]) * 7, ambiguous: false };
  const chineseWeeks = text.match(/([一二两三四])\s*周(?:后|以后)/);
  if (chineseWeeks) return { day: currentDay + chineseNumbers[chineseWeeks[1]] * 7, ambiguous: false };
  if (/大后天/.test(text)) return { day: currentDay + 3, ambiguous: false };
  if (/后天/.test(text)) return { day: currentDay + 2, ambiguous: false };
  if (/明天|明早|明晚/.test(text)) return { day: currentDay + 1, ambiguous: false };
  if (/下周/.test(text)) return { day: currentDay + 7, ambiguous: false };
  if (/下个月/.test(text)) return { day: currentDay + 30, ambiguous: true };
  if (/今天|今晚|今早|今夜/.test(text)) return { day: currentDay, ambiguous: false };
  if (/过几天|改天|过些天/.test(text)) return { day: currentDay + 3, ambiguous: true };
  const absolute = text.match(/第\s*(\d{1,5})\s*(?:天|日)/);
  if (absolute) return { day: Number(absolute[1]), ambiguous: false };
  return null;
}

function cleanEventTitle(text) {
  return String(text || "")
    .replace(/(?:大后天|后天|明天|明早|明晚|下周|过几天|过些天|改天)/g, "")
    .replace(/\d{1,3}\s*(?:天|日)(?:后|以后)/g, "")
    .replace(/[一二两三四五六七]\s*(?:天|日)(?:后|以后)/g, "")
    .replace(/(?:\d{1,2}|[一二两三四])\s*周(?:后|以后)/g, "")
    .replace(/(?:下个月|今天|今晚|今早|今夜)/g, "")
    .replace(/第\s*\d{1,5}\s*(?:天|日)/g, "")
    .replace(/(?:清晨|天亮|一早|早晨|上午|早上|中午|午间|午饭|下午|午后|傍晚|黄昏|晚上|夜里|夜晚|深夜|半夜|凌晨)/g, "")
    .replace(/^(?:我想|我们想|我们|我|记得|别忘了|约好|计划|打算|到时候|等到)\s*/g, "")
    .replace(/[，。！？!?]+$/g, "")
    .trim()
    .slice(0, 240);
}

export function detectFutureStoryEvent(text, clock, roleNames = []) {
  const sourceText = String(text || "").trim();
  if (!sourceText || sourceText.length > 1000) return null;
  const normalizedClock = normalizeStoryClock(clock);
  const date = detectDay(sourceText, normalizedClock.day);
  if (!date) return null;
  if (!/(?:要|去|做|带|提醒|记得|约|参加|见|买|找|出发|回来|吃|看|处理|完成|拜访)/.test(sourceText)) {
    return null;
  }
  const title = cleanEventTitle(sourceText);
  if (title.length < 2) return null;
  const participants = [...new Set(
    roleNames
      .map((name) => String(name || "").trim())
      .filter((name) => name && sourceText.includes(name)),
  )].slice(0, 20);
  const locationMatch = sourceText.match(/(?:去|到|前往)\s*([^，。！？\s]{2,18})/);
  return normalizeStoryEvent({
    id: `story-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    day: date.day,
    segment: detectSegment(sourceText),
    location: locationMatch?.[1] || "",
    participants,
    sourceText,
    status: "pending-confirmation",
    needsDateConfirmation: date.ambiguous,
  });
}

export function advanceStoryClock(clock, targetDay, targetSegment) {
  const current = normalizeStoryClock(clock);
  const nextDay = Math.min(99999, Math.max(current.day, Math.round(Number(targetDay) || current.day)));
  const nextSegment = SEGMENT_IDS.has(targetSegment) ? targetSegment : current.segment;
  if (storyMomentValue(nextDay, nextSegment) < storyMomentValue(current.day, current.segment)) {
    return current;
  }
  return {
    ...current,
    day: nextDay,
    segment: nextSegment,
    updatedAt: new Date().toISOString(),
  };
}
