import {
  formatStoryMoment,
  normalizeStoryClock,
  normalizeStoryEvents,
} from "../../../shared/story-time.js";
import {
  parseLooseJsonArray,
  parseLooseJsonObject,
} from "../../../shared/loose-json.js";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  speaker?: string;
};

type Profile = {
  name?: string;
  age?: number;
  personality?: string;
  relation?: string;
};

type Ensemble = {
  enabled?: boolean;
  friend?: {
    name?: string;
    age?: number;
    personality?: string;
    relation?: string;
  };
  customRoles?: Array<{ name?: string; relation?: string }>;
};

function cleanSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").trim().slice(0, 36))
    .filter((item, index, list) => item.length >= 2 && list.indexOf(item) === index)
    .slice(0, 3);
}

function parseSuggestions(content: string) {
  const array = parseLooseJsonArray(content)
    || parseLooseJsonObject(content, (value) => Array.isArray(value?.suggestions))?.suggestions;
  if (array) return cleanSuggestions(array);
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean);
  return cleanSuggestions(lines);
}

async function readSuggestionContent(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const result = await response.json().catch(() => ({}));
    return typeof result?.choices?.[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : "";
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const chunk = JSON.parse(raw);
      const text = chunk?.choices?.[0]?.delta?.content;
      if (typeof text === "string") content += text;
    } catch {}
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  return content;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const profile = (body.profile || {}) as Profile;
  const ensemble = (body.ensemble || {}) as Ensemble;
  const storySummary = typeof body.storySummary === "string" ? body.storySummary.trim().slice(0, 2500) : "";
  const worldSetting = typeof body.worldSetting === "string" ? body.worldSetting.trim().slice(0, 1800) : "";
  const storyClock = normalizeStoryClock(body.storyClock);
  const storyEvents = normalizeStoryEvents(body.storyEvents)
    .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status))
    .slice(0, 12);
  const scheduleContext = `当前剧情时间：${formatStoryMoment(storyClock)}${storyClock.location ? `，地点：${storyClock.location}` : ""}
${storyEvents.length
  ? `有效约定：${storyEvents.map((event) => `${event.day === null ? "日期待确认" : formatStoryMoment({ ...storyClock, day: event.day, segment: event.segment })}·${event.title}·${event.status}`).join("；")}`
  : "当前没有有效约定。"} `;
  const age = Math.min(80, Math.max(18, Number(profile.age) || 24));
  const actionStyle = ["观察型", "行动型", "幽默型", "谨慎型"].includes(body.actionStyle)
    ? body.actionStyle
    : "";
  const style = ["冒险", "保守", "幽默"].includes(body.style) ? body.style : "";
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((item: ChatMessage) =>
      item
      && (item.role === "user" || item.role === "assistant")
      && typeof item.content === "string"
      && item.content.trim()
    )
    .slice(-8)
    .map((item: ChatMessage) => ({
      role: item.role,
      content: item.content.trim().slice(0, 1400),
      speaker: typeof item.speaker === "string" ? item.speaker.trim().slice(0, 20) : "",
    }));

  const provider = body.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const apiKey = isGrok
    ? process.env.GROK_API_KEY
    : process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({
      suggestions: ["我牵住她的手，立刻开始行动", "按刚才的计划，我们现在就出发", "联系相关角色，让新消息进入现场"],
      mode: "demo",
    });
  }

  const baseUrl = (
    isGrok
      ? process.env.GROK_BASE_URL || process.env.IMAGE_BASE_URL || "https://downstream.jbbtoken.cn/v1"
      : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const requestedModel = typeof body.model === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(body.model)
    ? body.model
    : "";
  const transcript = messages
    .map((item) => `${item.role === "user" ? "用户" : item.speaker || profile.name || "晚晚"}：${item.content}`)
    .join("\n\n");
  const ensembleContext = ensemble.enabled === false
    ? "当前是单角色模式。"
    : `当前是多人场景模式。固定配角“${ensemble.friend?.name || "小雨"}”是${Math.max(18, Number(ensemble.friend?.age) || 25)}岁成年人、身份为“${ensemble.friend?.relation || `${profile.name || "晚晚"}的成年闺蜜`}”；其他自定义角色为“${(ensemble.customRoles || []).map((role) => role.name).filter(Boolean).join("、") || "暂无"}”。如果最近对话里某个配角已经入场或被用户安排任务，选项可以自然回应、追问或邀请对应角色；如果无人入场，不要假装他们已经在场。`;
  const bridgeUrl = process.env.LOCAL_AI_BRIDGE_URL;
  let upstream: Response;
  try {
    upstream = await fetch(bridgeUrl || `${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeUrl
          ? { "X-AI-Provider": provider }
          : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
      model: isGrok
        ? requestedModel || process.env.GROK_MODEL || "gpt-5.6-luna"
        : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: `你是互动剧情的“下一句选项生成器”。角色${profile.name || "晚晚"}是${age}岁成年人，性格“${profile.personality || "娇小可爱"}”，与用户关系为“${profile.relation || "妻子"}”。${ensembleContext}
${worldSetting ? `所有选项必须遵守以下世界设定：${worldSetting}` : ""}
${storySummary ? `长期剧情记忆：${storySummary}` : ""}
${scheduleContext}

根据最近对话生成恰好 3 条可由用户直接点击发送的“剧情行动指令”：
1. 必须站在用户第一人称说话，像真实聊天，不替角色回答。
2. 每条 8–32 个中文字符，必须同时包含“具体动词 + 对象或地点 + 下一步目的”，点击后能让场景立即发生变化。
3. 三条方向必须明显不同：第一条让用户马上执行现场动作；第二条作出决定、分配任务或带角色切换地点；第三条主动联系人物、调查线索或触发一个合理的新事件。
4. 选项要利用最近对话里的具体人物、道具、地点、计划或未完成事件，不能是脱离场景的万能句。
5. 不生成“然后呢”“你觉得呢”“接下来做什么”“再说详细一点”“继续刚才剧情”等被动追问，也不要只表达情绪或等待角色安排。
6. 选项末尾不用问号；保持当前人物关系和情节连续，不总结、不解释、不添加序号。
7. 当前有到期或临近日程时，至少一条选项必须用于处理该约定；待确认约定只能给出“确认、修改或暂不确定”的动作，不能假装已经发生。
8. 只输出 JSON 字符串数组，例如 ["我拿起桌上的钥匙，带她立刻出门","让小雨先去车站打听那个人的消息","我推开书房暗门，检查刚出现的脚印"]。

${actionStyle ? `用户常用行动倾向是“${actionStyle}”：观察型=选项偏向先观察、询问、确认情况再行动；行动型=选项直接上手执行、推进任务、立即改变局面；幽默型=选项更轻松俏皮、带玩笑感和生活气息；谨慎型=选项优先安全、留有余地、避免冲动冒险。本组选项应整体贴合这一倾向。` : ""}${style ? `本组选项额外风格：${style === "冒险" ? "更冒险——更大胆直接、敢于打破常规、行动更果断" : style === "保守" ? "更保守——更稳妥克制、优先保证安全与关系、行动更收敛" : "更幽默——更轻松俏皮、带玩笑感" }。风格与上面 1–8 条规则冲突时，规则优先，选项仍必须是有效行动指令。` : ""}`,
        },
        {
          role: "user",
          content: `下面是最近对话。请严格输出三条用户下一句的 JSON 数组：\n\n${transcript || "晚晚：今晚想和你一起做点什么？"}`,
        },
      ],
      stream: isGrok,
      temperature: 0.85,
      max_tokens: 220,
      ...(isGrok ? {} : { thinking: { type: "disabled" } }),
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    return Response.json({
      suggestions: ["我牵住她的手，立刻开始行动", "按刚才的计划，我们现在就出发", "联系相关角色，让新消息进入现场"],
      provider,
      mode: "fallback",
    });
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json(
      { error: `${isGrok ? "Grok" : "DeepSeek"} suggestion request failed`, detail: detail.slice(0, 240) },
      { status: upstream.status || 502 },
    );
  }

  let content = "";
  try {
    content = await readSuggestionContent(upstream);
  } catch {
    return Response.json({
      suggestions: ["我牵住她的手，立刻开始行动", "按刚才的计划，我们现在就出发", "联系相关角色，让新消息进入现场"],
      provider,
      mode: "fallback",
    });
  }
  const suggestions = typeof content === "string" ? parseSuggestions(content) : [];
  if (suggestions.length !== 3) {
    return Response.json(
      {
        error: "模型没有返回有效的剧情选项",
        detail: typeof content === "string" ? content.slice(0, 300) : "",
      },
      { status: 502 },
    );
  }
  return Response.json({ suggestions, provider });
}
