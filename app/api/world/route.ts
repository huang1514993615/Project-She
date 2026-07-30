export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const seed = typeof body.seed === "string" ? body.seed.trim().slice(0, 5000) : "";
  const existing = typeof body.existing === "string" ? body.existing.trim().slice(0, 8000) : "";
  const provider = body.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const apiKey = isGrok ? process.env.GROK_API_KEY : process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: `${isGrok ? "Grok" : "DeepSeek"} 尚未配置` },
      { status: 503 },
    );
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
    ? requestedModel || process.env.GROK_MODEL || "gpt-5.6-luna"
    : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

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
        messages: [
          {
            role: "system",
            content: `你是互动剧情的世界观设计师。把用户草稿扩写成富有想象力、可长期使用的世界设定。

保留用户已经确定的时代、人物关系和核心规则，并自然补全地理、社会、力量体系、生活方式、地点、组织、习俗和剧情机会。设定应当帮助角色在世界中自由行动和产生故事，而不是添加创作限制。

使用【世界概览】【核心设定】【社会与地点】【人物与生活】【剧情线索】组织正文，直接输出完整设定。`,
          },
          {
            role: "user",
            content: `现有设定：\n${existing || "暂无"}\n\n用户希望补充或重写的草稿：\n${seed || existing || "现代都市背景，多人角色自然生活和互动。"}`,
          },
        ],
        stream: false,
        temperature: 0.65,
        max_tokens: 2200,
        ...(isGrok ? {} : { thinking: { type: "disabled" } }),
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        { error: "世界设定生成失败", detail: detail.slice(0, 300) },
        { status: upstream.status || 502 },
      );
    }
    const result = await upstream.json();
    const worldSetting = result?.choices?.[0]?.message?.content;
    if (typeof worldSetting !== "string" || worldSetting.trim().length < 100) {
      return Response.json({ error: "模型没有返回有效的世界设定" }, { status: 502 });
    }
    return Response.json({
      worldSetting: worldSetting
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
        .slice(0, 12000),
      provider,
      model,
    });
  } catch (error) {
    return Response.json(
      { error: "世界设定生成失败", detail: error instanceof Error ? error.message : "网络连接失败" },
      { status: 502 },
    );
  }
}
