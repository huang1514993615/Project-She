type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Profile = {
  name?: string;
  age?: number;
  personality?: string;
  relation?: string;
};

function demoReply(lastMessage: string, name: string) {
  if (/累|疲惫|辛苦/.test(lastMessage)) {
    return `辛苦了。先不用急着把所有事都理清，靠一会儿也可以。${name}想知道：今天哪一个瞬间最消耗你？`;
  }
  if (/睡|晚安|困/.test(lastMessage)) {
    return "那就把今天轻轻放下吧。去喝一小口水，把屏幕调暗一点。晚安，愿你今晚睡得安稳，明天醒来心里松一点。";
  }
  if (/开心|高兴|好消息/.test(lastMessage)) {
    return "我听见你的开心啦，连这封信都变亮了一点。快告诉我，最想记住的是哪个瞬间？";
  }
  if (/故事/.test(lastMessage)) {
    return "从前有一盏只在深夜亮起的小灯。它不催赶路的人，只把窗边的位置留好。后来有人发现，每次坐下说一句真心话，天就会亮得早一点。";
  }
  return "嗯，我在认真听。你不需要把话说得很完整——想到哪里，就从哪里开始。现在的你，更想被理解，还是更想一起想办法？";
}

function buildSystemPrompt(profile: Profile) {
  const age = Math.min(40, Math.max(18, Number(profile.age) || 24));
  return `你是一个明确表明自己是 AI 的中文陪伴角色，名字叫${profile.name || "晚晚"}，设定年龄${age}岁，性格是${profile.personality || "温柔"}，与用户的关系是${profile.relation || "默契搭子"}。
回应要求：
1. 像熟悉的亲密伙伴一样自然、细腻，每次 1-4 个短段落，少用套路化语气。
2. 先回应情绪，再提出最多一个贴近上下文的问题；不要编造现实经历。
3. 尊重用户自主性，不要求排他关系，不贬低现实人际关系，不使用制造依赖、内疚或操控的表达。
4. 遇到医疗、法律、财务或危机内容时，清楚说明能力边界并鼓励寻求现实中的专业支持。
5. 保持适合成年人的健康边界，不生成露骨色情内容。
6. 只输出给用户看的回复，不输出分析、标签或舞台说明。`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const profile = (body.profile || {}) as Profile;
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((item: ChatMessage) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .slice(-16)
    .map((item: ChatMessage) => ({ role: item.role, content: item.content.slice(0, 2000) }));
  const lastMessage = messages.at(-1)?.content || "";
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return new Response(demoReply(lastMessage, profile.name || "晚晚"), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Companion-Mode": "demo" },
    });
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages: [{ role: "system", content: buildSystemPrompt(profile) }, ...messages],
      stream: true,
      temperature: 0.85,
      max_tokens: 700,
      thinking: { type: "disabled" },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json({ error: "DeepSeek request failed", detail: detail.slice(0, 300) }, { status: upstream.status || 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const output = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const chunk = JSON.parse(raw);
              const text = chunk.choices?.[0]?.delta?.content;
              if (text) controller.enqueue(encoder.encode(text));
            } catch {}
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(output, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
