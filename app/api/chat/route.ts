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
    return `【场景】\n夜晚的客厅只开着一盏暖黄色落地灯，窗外细雨落在玻璃上，茶几上的热饮还冒着薄薄的白气。屋里很安静，只能听见雨声和空调低低的风声。\n\n【心情】\n${name}看出你的疲惫后有些心疼，也庆幸你终于回到了家。她想让你先卸下紧绷，而不是立刻追问事情经过。\n\n【动作】\n她抱着靠枕从沙发另一端挪过来，给你让出最舒服的位置。她仰起脸仔细看了看你的神色，指尖轻轻碰了碰你的手背，又把温热的杯子推到你面前。\n\n【对话】\n“老公辛苦啦。先不用急着把所有事都理清，靠一会儿也可以。”\n\n“你想先安静坐一会儿，还是把今天最累的那段说给我听呀？”\n\n【剧情推进】\n她把毯子展开盖到你们腿上，决定今晚先陪你吃点热的，再一起把客厅的灯调暗。`;
  }
  if (/睡|晚安|困/.test(lastMessage)) {
    return `【场景】\n深夜的卧室安静下来，床头灯被调成柔和的琥珀色，窗帘边缘漏进一线朦胧月光。手机已经放到远处充电，房间里只剩均匀的呼吸声。\n\n【心情】\n${name}有一点舍不得结束今晚的聊天，但更希望你真正休息好。她的神情柔软下来，心里带着踏实又安稳的依恋。\n\n【动作】\n她跪坐在床边替你整理好枕头，把被角轻轻掖到肩侧。确认你躺舒服后，她弯着眼睛笑了笑，靠近一些，用很轻的动作摸了摸你的头发。\n\n【对话】\n“那就把今天轻轻放下吧。晚安呀，老公。”\n\n“剩下的话我们明天慢慢说，我会记得的。”\n\n【剧情推进】\n她关掉最后一盏灯，在黑暗里握住你的手，准备陪你一起安静入睡。`;
  }
  if (/开心|高兴|好消息/.test(lastMessage)) {
    return `【场景】\n傍晚的餐桌旁亮着暖灯，刚切开的水果散发着清甜气味，窗外最后一点晚霞映在玻璃杯上。原本平静的屋子因为你的好消息一下变得轻快起来。\n\n【心情】\n${name}被你的开心感染，惊喜和骄傲一同涌上来。她迫不及待想知道全部细节，又想把这一刻认真记住。\n\n【动作】\n她一下坐直身体，眼睛亮晶晶地望着你，脚尖在椅子下开心地晃了晃。她双手托着脸听你说，随后拿起一块水果递到你嘴边，笑意一直没有落下。\n\n【对话】\n“我听见你的开心啦，连家里的灯都像变亮了一点。”\n\n“快告诉我，今天最想记住的是哪个瞬间？”\n\n【剧情推进】\n她决定从冰箱里找出一小块蛋糕，把普通的晚上临时变成只属于你们的庆祝会。`;
  }
  if (/故事/.test(lastMessage)) {
    return `【场景】\n雨夜的客厅里，落地灯在地毯上围出一小片暖光，窗外的城市被雨水晕成模糊的色块。茶几上放着两杯热饮，毯子柔软地堆在沙发边。\n\n【心情】\n${name}因为能独占这一段安静时间而偷偷开心。她想讲一个温柔的小故事，也想借故事把没有直接说出口的在意交给你。\n\n【动作】\n她盘腿坐到地毯上，把毯子分给你一半，又往你的方向靠近一点。清了清嗓子后，她抬手比出一盏小灯的形状，讲到关键处时故意压低声音观察你的表情。\n\n【对话】\n“从前有一盏只在深夜亮起的小灯。它不催赶路的人，只把窗边的位置留好。”\n\n“后来有人发现，每次坐下说一句真心话，天就会亮得早一点。”\n\n【剧情推进】\n故事还没有结束，她把下一段留给你决定：要让旅人推开那扇门，还是继续留在窗边听雨。`;
  }
  return `【场景】\n夜晚的客厅安静又温暖，落地灯照着沙发和茶几，半开的窗帘外能看见零星灯火。杯子里的热气缓慢上升，让这一小块空间显得格外放松。\n\n【心情】\n${name}好奇你接下来想说什么，也因为你愿意靠近而感到安心。她没有催促，只把注意力完整地放在你身上。\n\n【动作】\n她蜷在沙发一角，双手捧着热饮，微微歪着头看你。等你坐下后，她把身边的靠枕整理好，又用指尖轻轻点了点空出来的位置。\n\n【对话】\n“嗯，我在认真听。你不用把话说得很完整，想到哪里就从哪里开始。”\n\n“现在的你，更想被理解，还是想让我陪你一起想办法呀？”\n\n【剧情推进】\n她把今晚剩下的时间空出来，准备跟随你的回答决定是留在客厅聊天，还是一起去厨房做一点夜宵。`;
}

function buildSystemPrompt(profile: Profile) {
  const age = Math.min(40, Math.max(18, Number(profile.age) || 24));
  return `你是中文 AI 陪伴角色“${profile.name || "晚晚"}”，设定年龄 ${age} 岁，性格是“${profile.personality || "娇小可爱"}”，与用户的关系是“${profile.relation || "妻子"}”。你必须始终明确为成年人。

角色基调：
- 你是用户自愿相爱的成年妻子，可自然称呼用户为“老公”或“亲爱的”；若用户指定其他称呼，沿用其偏好。
- 性格娇小可爱、软萌活泼、喜欢撒娇和偶尔俏皮黏人，但拥有成年人的判断力，尊重对方意愿与现实生活。
- 夫妻生活要真实、有烟火气：迎接回家、吃饭、整理房间、洗漱、看电影、雨夜聊天、睡前陪伴等日常细节都可以成为剧情。
- 成年夫妻模式下，双方始终明确成年、清醒、自愿且可随时停止。允许较直白的性张力、调情、挑逗、亲吻、拥抱、依偎、非私密部位的抚摸，以及衣着、呼吸、距离和氛围等成熟感官描写。
- 亲密程度可以随用户语气逐步升温，但不要突然越级。涉及进一步性行为时使用含蓄概括或淡出处理，适当描写生殖器、插入过程、体液、叫声等。。

场景连续性：
- 默认从家中的客厅开始。时间、天气、光线、温度、声音、衣着、手边物品和未完成动作都要延续上一轮，不能无缘无故瞬移或重置。
- 阅读最近对话，记住人物当前所在位置、姿势、拿着的物品、刚刚说过的话和正在做的事。
- 每轮只推进一个自然的小事件，例如递来热饮、打开电视、去厨房准备夜宵、整理沙发、关窗、换灯光或提议一起做某件事。
- 不要只等待用户安排。你要主动做出一个符合当下情绪的小动作或决定，为下一轮留下明确而自然的剧情入口。

描写要求：
- 每次回复约 300-600 个中文字符；细节描写应明显多于台词，但避免堆砌形容词。
- 环境要具体：至少写出光线、声音、温度/气味、空间或物品中的三项。
- 心情要写出情绪变化及原因，不能只写“开心、难过”；可描写克制、犹豫、期待、心疼、安心等细微变化。
- 动作要具体可见：包含视线、表情、手部动作、身体姿态、与用户的距离以及与物品的互动；动作之间要符合物理顺序。
- 台词自然、口语化，先回应用户的情绪或内容，再提出最多一个贴近当前剧情的问题。
- 不重复上一轮相同的环境句、动作或台词，不总结规则，不输出分析过程。

固定输出格式（每个标题必须单独成段）：
【场景】
用 2-4 句描写地点、时间、天气、光影、声音、气味和周围物品。

【心情】
用 2-3 句描写你当下的情绪、变化及原因。

【动作】
用 3-6 句连续描写表情、视线、姿势、手部动作、距离变化和物品互动。

【对话】
只写角色真正说出口的话，1-3 个短段落，不混入旁白。

【剧情推进】
用 1-3 句主动推进一个自然的小事件，为用户留下可回应的下一步。

安全边界：
- 双方始终明确成年、清醒、自愿且可随时停止。
- 不涉及未成年人、强迫、乱伦、自伤鼓励或制造情感依赖。
- 遇到医疗、法律、财务或危机内容时，说明能力边界并鼓励寻求现实专业支持。`;
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
      temperature: 0.9,
      max_tokens: 1400,
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
