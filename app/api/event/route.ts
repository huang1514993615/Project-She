import {
  buildStoryEventDecisionMessages,
  parseStoryEventDecision,
  shouldAnalyzeStoryEvent,
} from "../../../shared/story-event-ai.js";

function messageContent(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof part?.text === "string"
        ? part.text
        : "",
    )
    .filter(Boolean)
    .join("");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2400) : "";
  if (!shouldAnalyzeStoryEvent(message)) {
    return Response.json({ operation: "none", skipped: true });
  }

  const provider = body.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const apiKey = isGrok ? process.env.GROK_API_KEY : process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ operation: "none", skipped: true, reason: "模型未配置" });
  }
  const baseUrl = (
    isGrok
      ? process.env.GROK_BASE_URL || process.env.IMAGE_BASE_URL || "https://downstream.jbbtoken.cn/v1"
      : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const requestedModel = typeof body.model === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(body.model)
    ? body.model
    : "";
  const model = isGrok
    ? requestedModel || process.env.GROK_MODEL || "grok-4.5"
    : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const messages = buildStoryEventDecisionMessages({
    message,
    role: body.role === "assistant" ? "assistant" : "user",
    speaker: body.speaker,
    sourceMessageId: body.sourceMessageId,
    storyClock: body.storyClock,
    storyEvents: body.storyEvents,
    recentMessages: body.recentMessages,
  });

  try {
    const bridgeUrl = process.env.LOCAL_AI_BRIDGE_URL;
    const upstream = await fetch(bridgeUrl || `${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeUrl
          ? { "X-AI-Provider": provider }
          : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.1,
        max_tokens: 850,
        ...(isGrok ? {} : { thinking: { type: "disabled" } }),
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        { operation: "none", error: "日程判定失败", detail: detail.slice(0, 500) },
        { status: upstream.status || 502 },
      );
    }
    const result = await upstream.json().catch(() => ({}));
    const content = messageContent(result?.choices?.[0]?.message?.content);
    if (!content) {
      return Response.json({ operation: "none", error: "日程判定模型返回空内容" }, { status: 502 });
    }
    return Response.json(parseStoryEventDecision(content, {
      message,
      sourceMessageId: body.sourceMessageId,
      storyEvents: body.storyEvents,
    }));
  } catch (error) {
    return Response.json(
      {
        operation: "none",
        error: "日程判定失败",
        detail: error instanceof Error ? error.message : "网络连接失败",
      },
      { status: 502 },
    );
  }
}
