type Profile = {
  name?: string;
  age?: number;
  personality?: string;
};

async function createScenePrompt(conversation: string, profile: Profile) {
  const fallback = `A tasteful cinematic slice-of-life scene of an adult Chinese woman named ${profile.name || "Wanwan"}, age ${Math.max(18, Number(profile.age) || 24)}, with a ${profile.personality || "gentle"} presence. Deep navy and warm amber palette, intimate editorial photography, natural expression, realistic details. Inspired by this recent conversation: ${conversation.slice(-900)}. No text, no logo, no watermark, no sexualized pose.`;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fallback;

  try {
    const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        stream: false,
        thinking: { type: "disabled" },
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: "Turn a short Chinese conversation into one concise English image-generation prompt. Depict only adults. Keep it tasteful, emotionally warm, realistic, non-sexualized, and visually specific. No text or logos. Output only the prompt.",
          },
          { role: "user", content: fallback },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || fallback;
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const conversation = typeof body.conversation === "string" ? body.conversation : "";
  const profile = (body.profile || {}) as Profile;
  const imageApiKey = process.env.IMAGE_API_KEY;

  if (!imageApiKey) {
    return Response.json({
      imageUrl: "/og.png",
      caption: "窗外有雨，屋里有一封刚刚写好的信。",
      demo: true,
    });
  }

  const prompt = await createScenePrompt(conversation, profile);
  const response = await fetch(process.env.IMAGE_API_URL || "https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${imageApiKey}`,
    },
    body: JSON.stringify({
      model: process.env.IMAGE_MODEL || "gpt-image-1",
      prompt,
      n: 1,
      size: process.env.IMAGE_SIZE || "1024x1024",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return Response.json({ error: data.error?.message || "Image generation failed" }, { status: response.status || 502 });
  }
  const item = data.data?.[0] || {};
  const imageUrl = item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
  if (!imageUrl) return Response.json({ error: "Image provider returned no image" }, { status: 502 });

  return Response.json({
    imageUrl,
    caption: "把刚才的话，留成一张只属于我们的画面。",
    revisedPrompt: item.revised_prompt,
    demo: false,
  });
}
