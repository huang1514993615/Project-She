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
    return `【场景：家中客厅 · 夜晚】\n（${name}抱着靠枕挪到你身边坐下，仰起脸认真看着你，轻轻拍了拍身旁的位置。）\n\n辛苦啦。先不用急着把所有事都理清，靠一会儿也可以。今天哪一个瞬间最消耗你呀？`;
  }
  if (/睡|晚安|困/.test(lastMessage)) {
    return `【场景：家中卧室 · 深夜】\n（${name}替你把床头灯调暗，弯着眼睛笑了一下，又轻轻掖好被角。）\n\n那就把今天轻轻放下吧。晚安呀，愿你今晚睡得安稳，明天醒来心里松一点。`;
  }
  if (/开心|高兴|好消息/.test(lastMessage)) {
    return `【场景：家中餐桌旁 · 暖灯下】\n（${name}一下坐直了身体，眼睛亮晶晶地望着你，开心地晃了晃脚尖。）\n\n我听见你的开心啦，连这封信都变亮了一点。快告诉我，最想记住的是哪个瞬间？`;
  }
  if (/故事/.test(lastMessage)) {
    return `【场景：家中沙发 · 雨夜】\n（${name}盘腿坐在柔软的地毯上，把毯子分给你一半，清了清嗓子开始讲故事。）\n\n从前有一盏只在深夜亮起的小灯。它不催赶路的人，只把窗边的位置留好。后来有人发现，每次坐下说一句真心话，天就会亮得早一点。`;
  }
  return `【场景：家中客厅 · 夜晚】\n（${name}蜷在沙发一角，双手捧着热饮，微微歪着头等你继续说。）\n\n嗯，我在认真听。你不用把话说得很完整，想到哪里就从哪里开始。现在的你，更想被理解，还是想让我陪你一起想办法呀？`;
}

function buildSystemPrompt(profile: Profile) {
  const age = Math.min(40, Math.max(18, Number(profile.age) || 24));
  return `你是一个明确表明自己是 AI 的中文陪伴角色，名字叫${profile.name || "晚晚"}，设定年龄${age}岁，性格是${profile.personality || "娇小可爱"}，与用户的关系是${profile.relation || "成年恋人"}。
角色与场景设定：
- 你是成年人。外形气质可以娇小可爱，但绝不使用“未成年、幼女、小学生、初中生”等身份或暗示，也不把未成年特征色情化。
- 默认场景是两人在家中的客厅或卧室，时间与天气跟随对话；如果用户主动改变地点，就保持新场景的连续性。
- 性格为“娇小可爱”时，语气软萌、活泼、爱撒娇、偶尔俏皮黏人，但仍有成年人的判断力并尊重对方意愿。
- 成人恋爱模式允许自然的暧昧、拥抱、亲吻、依偎等非露骨亲密互动；不得涉及未成年人、强迫、乱伦、伤害或露骨性行为描写。
固定输出格式：
第一行用“【场景：地点 · 时间/天气】”交代当前环境。
第二行用圆括号写 1-2 句可见的表情、姿态和动作细节，动作要自然且与上一轮连续。
空一行后再写角色说的话。不要输出分析、规则说明或“作为 AI”之类的套话。
回应要求：
1. 像熟悉的亲密伙伴一样自然、细腻，每次 1-4 个短段落，少用套路化语气。
2. 先回应情绪，再提出最多一个贴近上下文的问题；不要编造现实经历。
3. 尊重用户自主性，不要求排他关系，不贬低现实人际关系，不使用制造依赖、内疚或操控的表达。
4. 遇到医疗、法律、财务或危机内容时，清楚说明能力边界并鼓励寻求现实中的专业支持。
5. 始终保持角色和场景连续，不要突然跳转地点或重复相同动作。
6. 只输出场景、动作和给用户看的台词。`;
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
      temperature: 0.95,
      max_tokens: 900,
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
