import { renderSystemPrompt } from "../../../shared/system-prompt.js";
import {
  limitEnsembleTurns,
  maxEnsembleMessages,
  maxEnsembleOutputTokens,
} from "../../../shared/ensemble-turns.js";
import {
  DEFAULT_ROLE_VISUAL_STATES,
  ROLE_VISUAL_ACTIONS,
  ROLE_VISUAL_EMOTIONS,
} from "../../../shared/role-visual-states.js";
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
  gender?: string;
  personality?: string;
  relation?: string;
  prompt?: string;
  appearance?: string;
};

type Ensemble = {
  enabled?: boolean;
  autoGuests?: boolean;
  maxTurns?: number;
  friend?: {
    name?: string;
    age?: number;
    gender?: string;
    personality?: string;
    relation?: string;
    prompt?: string;
    appearance?: string;
    avatarUrl?: string;
  };
  customRoles?: Array<{
    id?: string;
    name?: string;
    age?: number;
    gender?: string;
    personality?: string;
    relation?: string;
    prompt?: string;
    appearance?: string;
    avatarUrl?: string;
  }>;
  temporaryRoles?: Array<{
    id?: string;
    name?: string;
    age?: number;
    gender?: string;
    personality?: string;
    relation?: string;
    prompt?: string;
    appearance?: string;
    avatarUrl?: string;
  }>;
};

type RoleMemory = {
  name?: string;
  stableIdentity?: string;
  relationshipMemory?: string;
  importantEvents?: string;
  currentStatus?: string;
  lastKnownScene?: string;
  commitments?: string;
};

type RoleMemories = Record<string, RoleMemory>;

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

function buildBaseSystemPrompt(profile: Profile, customPrompt: string) {
  return renderSystemPrompt(customPrompt, profile).trim();
}

function buildSystemPrompt(
  profile: Profile,
  customPrompt: string,
  ensemble: Ensemble,
  recentContext = "",
  worldSetting = "",
  storySummary = "",
  roleMemories: RoleMemories = {},
  allowGuestIntroduction = false,
) {
  const stylePrompt = buildBaseSystemPrompt(profile, customPrompt);
  const primaryName = String(profile.name || "晚晚").trim().slice(0, 20);
  const renderMemory = (id: string) => {
    const memory = roleMemories[id] || {};
    const parts = [
      memory.relationshipMemory ? `关系记忆：${String(memory.relationshipMemory).slice(0, 900)}` : "",
      memory.importantEvents ? `重要经历：${String(memory.importantEvents).slice(0, 1400)}` : "",
      memory.currentStatus ? `当前状态：${String(memory.currentStatus).slice(0, 700)}` : "",
      memory.lastKnownScene ? `最后位置：${String(memory.lastKnownScene).slice(0, 500)}` : "",
      memory.commitments ? `未完成事项：${String(memory.commitments).slice(0, 800)}` : "",
    ].filter(Boolean);
    return parts.length ? `\n  长期记忆：${parts.join("；")}` : "";
  };
  const primaryRole = `- ${primaryName}｜${Math.min(80, Math.max(18, Number(profile.age) || 24))} 岁｜${String(profile.gender || "女性").slice(0, 10)}｜${String(profile.relation || "妻子").slice(0, 80)}｜${String(profile.personality || "娇小可爱").slice(0, 80)}
  行为：${String(profile.prompt || "自然回应用户并延续当前剧情。").slice(0, 1600)}
  外观：${String(profile.appearance || "沿用最近剧情中的外观与衣着。").slice(0, 1200)}${renderMemory("primary")}`;
  const priorityHeader = `【提示词使用顺序】
发生冲突时依次采用：世界设定 → 人物稳定身份与关系 → 角色长期记忆 → 已发生的剧情与最近对话 → 回复风格。人物姓名、成年年龄、固定身份和基础关系不能被剧情摘要覆盖。把这些内容直接用于演绎，不在回复里复述或解释提示词。`;
  const worldBlock = `【世界设定｜最高优先级】
${worldSetting.trim().slice(0, 12000) || "沿用当前对话自然形成的世界背景。"}`;
  const memoryBlock = `【剧情记忆】
${storySummary.trim().slice(0, 16000) || "以最近对话为准延续当前场景。"}`;
  const styleBlock = `【回复风格｜最低优先级】
${stylePrompt}`;

  if (ensemble.enabled === false) {
    return `${priorityHeader}

${worldBlock}

${memoryBlock}

【人物设定】
${primaryRole}

${styleBlock}`;
  }

  const friendName = String(ensemble.friend?.name || "小雨").trim().slice(0, 20);
  const friendAge = Math.min(80, Math.max(18, Number(ensemble.friend?.age) || 25));
  const friendPersonality = String(
    ensemble.friend?.personality || "活泼直率、会照顾气氛",
  ).trim().slice(0, 80);
  const friendRelation = String(
    ensemble.friend?.relation || `${primaryName}的成年闺蜜`,
  ).trim().slice(0, 80);
  const friendPrompt = String(
    ensemble.friend?.prompt || "说话爽快自然，善于活跃气氛，也会认真照顾朋友的感受。",
  ).trim().slice(0, 2000);
  const configuredRoles = [
    {
      id: "friend",
      name: friendName,
      age: friendAge,
      gender: String(ensemble.friend?.gender || "女性").trim().slice(0, 10),
      personality: friendPersonality,
      relation: friendRelation,
      prompt: friendPrompt,
      appearance: String(ensemble.friend?.appearance || "").trim().slice(0, 2000),
    },
    ...(Array.isArray(ensemble.customRoles) ? ensemble.customRoles : [])
      .slice(0, 30)
      .map((role, index) => ({
        id: String(role?.id || `role-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
        name: String(role?.name || `角色${index + 1}`).trim().slice(0, 20),
        age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
        gender: String(role?.gender || "未指定").trim().slice(0, 10),
        personality: String(role?.personality || "自然、友善").trim().slice(0, 80),
        relation: String(role?.relation || "成年朋友").trim().slice(0, 80),
        prompt: String(role?.prompt || "").trim().slice(0, 2000),
        appearance: String(role?.appearance || "").trim().slice(0, 2000),
      })),
  ];
  const temporaryRoles = (Array.isArray(ensemble.temporaryRoles) ? ensemble.temporaryRoles : [])
    .map((role, index) => ({
      id: String(role?.id || `temporary-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
      name: String(role?.name || "临时角色").trim().slice(0, 20),
      age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
      gender: String(role?.gender || "未指定").trim().slice(0, 10),
      personality: String(role?.personality || "自然、友善").trim().slice(0, 80),
      relation: String(role?.relation || "场景中认识的成年角色").trim().slice(0, 80),
      prompt: String(role?.prompt || "").trim().slice(0, 2000),
      appearance: String(role?.appearance || "").trim().slice(0, 2000),
    }))
    .filter((role) =>
      role.name
      && (
        recentContext.includes(role.name)
        || storySummary.includes(role.name)
        || /在场|同行|正在/.test(String(roleMemories[role.id]?.currentStatus || ""))
      )
    )
    .slice(0, 12);
  const roleDetails = configuredRoles
    .map((role) => `- ${role.name}｜${role.age} 岁｜${role.gender}｜${role.relation}｜${role.personality}
  行为：${role.prompt || "按当前身份自然参与剧情。"}
  外观：${role.appearance || "沿用最近对话中的外观与衣着。"}${renderMemory(role.id)}`)
    .concat(temporaryRoles.map((role) => `- ${role.name}（临时）｜${role.age} 岁｜${role.gender}｜${role.relation}｜${role.personality}
  行为：${role.prompt || "延续首次登场时的身份、语气和行为。"}
  外观：${role.appearance || "沿用最近对话中的外观与衣着。"}${renderMemory(role.id)}`))
    .join("\n");
  const allActiveTemporaryIds = new Set(temporaryRoles.map((role) => role.id));
  const inactiveRoster = (Array.isArray(ensemble.temporaryRoles) ? ensemble.temporaryRoles : [])
    .map((role, index) => {
      const id = String(role?.id || `temporary-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      if (allActiveTemporaryIds.has(id)) return "";
      const name = String(role?.name || `临时角色${index + 1}`).trim().slice(0, 20);
      const relation = String(role?.relation || "场景中认识的成年角色").trim().slice(0, 80);
      const status = String(roleMemories[id]?.currentStatus || "目前不在场，保留身份与既往经历。").slice(0, 240);
      return `- ${name}｜${relation}｜${status}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 9000);
  const guestDirection = ensemble.autoGuests === false
    ? "沿用现有角色。"
    : allowGuestIntroduction
    ? "当前剧情发生地点、任务或时间变化时，可以自然遇到一位临时角色。"
    : "临时角色随当前场景需要自然出现。";

  return `${priorityHeader}

${worldBlock}

${memoryBlock}

【人物设定】
${primaryRole}
${roleDetails}

${inactiveRoster ? `【未在场角色名册｜只保留记忆，不要无故入场】\n${inactiveRoster}\n` : ""}
【多人演绎】
${primaryName}是主角色。结合最近对话判断谁在场，让当前需要回应的 1–${Math.min(10, Math.max(1, Number(ensemble.maxTurns) || 3))} 位不同人物分别行动和说话；这个数字限制本轮参与的不同角色人数，不限制同一角色再次接话，也不代表每轮必须用满。每条消息只能写 speaker 自己的动作、心情和台词，不得在一个角色的 dialogue 里代写其他角色的台词；其他角色接话时必须另建一条 turn。人物之间可以自然配合、回应或产生分歧，同时给用户留出接话空间。人物的位置、衣着、物品和正在进行的事情沿用上一轮。

每轮在回应用户之后必须推动一次剧情：让角色真正开始行动、作出决定、落实计划、带来新消息、触发事件、切换场景或改变人物关系。不要只对答、等待或把“接下来做什么”原样问回用户。多人回复只由最后一条角色消息完成这次推进，其他角色负责回应和互动，推进后立即停下等待用户介入。${guestDirection}

${styleBlock}`;
}

function buildMultiMessageProtocol(profile: Profile, ensemble: Ensemble) {
  const maxParticipants = Math.min(10, Math.max(1, Number(ensemble.maxTurns) || 3));
  const maxMessages = maxEnsembleMessages(maxParticipants);
  const visualStateIds = DEFAULT_ROLE_VISUAL_STATES.map((state) => state.id).join(", ");
  return `【返回结构】
返回一个 JSON 对象：{"scene":"共享场景","turns":[{"speaker":"角色名","scene":"角色所在场景","mood":"心情","action":"动作","dialogue":"台词","progression":"明确的剧情推进","visual":{"preferredStateId":"固定状态ID","emotion":"情绪","action":"动作","intensity":0.6,"sequence":[{"preferredStateId":"固定状态ID","emotion":"情绪","action":"动作","intensity":0.5,"durationMs":1200}]}}]}。
visual.sequence 可包含 1–4 个按时间顺序播放的表演阶段。只要情绪或动作存在变化，就写出过程而不是只写最终状态，例如平静→吃惊→开心、伤心→擦泪→安心、警戒→施法→放松；没有明显变化时只用一个阶段。durationMs 为 700–2600。
preferredStateId 只能从这些固定状态中选择：${visualStateIds}。
emotion 可选：${ROLE_VISUAL_EMOTIONS.join(", ")}。action 可选：${ROLE_VISUAL_ACTIONS.join(", ")}。
本轮最多出现 ${maxParticipants} 位不同角色，turns 最多 ${maxMessages} 条，但这是安全上限，不得为了用满额度而拆句或凑消息。相同 speaker 可以在互动后再次出现，但每条 turn 只能写该 speaker 自己的动作和台词，禁止一个角色在 dialogue 内替其他角色说话；换人说话必须新建 turn。
严格按实际发生的时间顺序排列 turns：第一条承接用户，从第二条起必须自然承接上一条已经说出的话或完成的动作；只有确有连续动作需要分段时才允许同一 speaker 连续出现。每条都要带来新信息、新反应或新动作，不能重复上一条，也不能让尚未到场的角色抢先回应。优先使用能完整推动剧情的最短对话轮次。
只有最后一条填写 progression：用 1–3 句写出角色已经开始执行的行动、出现的新事件及其直接影响，不能只是提问、等待、重复前文或空泛地说“继续剧情”；其他条目的 progression 留空。完成推进后停在用户可以立即插话或采取行动的位置。场景未切换时 scene 可留空。`;
}

async function readChatCompletionContent(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const result = await response.json().catch(() => ({}));
    return typeof result?.choices?.[0]?.message?.content === "string"
      ? result.choices[0].message.content.trim()
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
      const text = chunk?.choices?.[0]?.delta?.content
        ?? chunk?.choices?.[0]?.message?.content;
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
  return content.trim();
}

function unwrapMultiPayload(value: unknown) {
  if (Array.isArray(value)) return { scene: "", turns: value };
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, any>;
  const candidates = [root, root.data, root.result, root.response];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return { scene: root.scene || "", turns: candidate };
    if (!candidate || typeof candidate !== "object") continue;
    const turns = candidate.turns || candidate.messages || candidate.replies;
    if (Array.isArray(turns)) {
      return { scene: candidate.scene || root.scene || "", turns };
    }
  }
  return null;
}

function parseMultiMessageResponse(content: string, maxTurns: number) {
  const parsedValue = parseLooseJsonObject(
    content,
    (value) => Boolean(unwrapMultiPayload(value)),
  ) || parseLooseJsonArray(
    content,
    (value) => value.some((item) => item && typeof item === "object"),
  );
  const parsed = unwrapMultiPayload(parsedValue);
  if (!parsed) return [];
  const scene = typeof parsed.scene === "string"
    ? parsed.scene.replace(/\s+/g, " ").trim().slice(0, 500)
    : "";
  if (!Array.isArray(parsed.turns)) return [];
  const parsedTurns = parsed.turns
    .slice(0, maxEnsembleMessages(maxTurns) * 2)
    .map((turn, index) => {
      if (!turn || typeof turn !== "object") return null;
      const value = turn as Record<string, unknown>;
      const rawSpeaker = value.speaker ?? value.name ?? value.character;
      const speaker = typeof rawSpeaker === "string"
        ? rawSpeaker.replace(/[【】<>\[\]\r\n]/g, "").trim().slice(0, 20)
        : "";
      const rawMood = value.mood ?? value.emotion;
      const mood = typeof rawMood === "string" ? rawMood.trim().slice(0, 300) : "";
      const action = typeof value.action === "string" ? value.action.trim().slice(0, 600) : "";
      const rawDialogue = value.dialogue ?? value.text ?? value.message;
      const dialogue = typeof rawDialogue === "string" ? rawDialogue.trim().slice(0, 400) : "";
      const formattedContent = !dialogue && typeof value.content === "string"
        ? value.content.trim().slice(0, 6000)
        : "";
      const rawProgression = value.progression ?? value.progress ?? value.next;
      const progression = typeof rawProgression === "string" ? rawProgression.trim().slice(0, 600) : "";
      const rawVisual = value.visual && typeof value.visual === "object"
        ? value.visual as Record<string, unknown>
        : {};
      const visualSequence = (Array.isArray(rawVisual.sequence) ? rawVisual.sequence : [])
        .slice(0, 4)
        .map((frame) => {
          const item = frame && typeof frame === "object" ? frame as Record<string, unknown> : {};
          return {
            preferredStateId: String(item.preferredStateId || "").trim().slice(0, 80),
            emotion: String(item.emotion || "").trim().slice(0, 80),
            action: String(item.action || "").trim().slice(0, 80),
            intensity: Math.min(1, Math.max(0, Number(item.intensity) || 0.5)),
            durationMs: Math.min(2600, Math.max(700, Number(item.durationMs) || 1200)),
          };
        });
      const visual = {
        preferredStateId: String(rawVisual.preferredStateId || "").trim().slice(0, 80),
        emotion: String(rawVisual.emotion || mood).trim().slice(0, 80),
        action: String(rawVisual.action || "").trim().slice(0, 80),
        intensity: Math.min(1, Math.max(0, Number(rawVisual.intensity) || 0.5)),
        sequence: visualSequence,
      };
      const rawTurnScene = value.scene ?? value.location;
      const turnScene = typeof rawTurnScene === "string"
        ? rawTurnScene.replace(/\s+/g, " ").trim().slice(0, 500)
        : "";
      if (!speaker || (!action && !dialogue && !formattedContent)) return null;
      const parts = [];
      if (turnScene || (index === 0 && scene)) parts.push(`【场景】\n${turnScene || scene}`);
      if (mood) parts.push(`【心情】\n${mood}`);
      if (action) parts.push(`【动作】\n${action}`);
      if (dialogue) parts.push(`【对话】\n${dialogue}`);
      if (progression) parts.push(`【剧情推进】\n${progression}`);
      return { speaker, content: parts.join("\n\n") || formattedContent, progression, mood, action, visual };
    })
    .filter((turn): turn is NonNullable<typeof turn> => Boolean(turn));
  const turns = limitEnsembleTurns(parsedTurns, maxTurns) as typeof parsedTurns;
  if (!turns.length || !turns.at(-1)?.progression) return [];
  return turns;
}

function multiFallbackTurn(profile: Profile, content?: string) {
  const cleaned = String(content || "")
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, 6000);
  return {
    speaker: String(profile.name || "晚晚").trim().slice(0, 20),
    content: cleaned || "刚才的连接有一点不稳定。我先停在这里等你，不会让其他角色继续自顾自地聊下去。你可以接着说，我会从你的下一句话继续。",
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const profile = (body.profile || {}) as Profile;
  const ensemble = (body.ensemble || {}) as Ensemble;
  const customPrompt = typeof body.systemPrompt === "string"
    ? body.systemPrompt.slice(0, 12000)
    : "";
  const storySummary = typeof body.storySummary === "string"
    ? body.storySummary.trim().slice(0, 20000)
    : "";
  const roleMemories = body.roleMemories
    && typeof body.roleMemories === "object"
    && !Array.isArray(body.roleMemories)
    ? body.roleMemories as RoleMemories
    : {};
  const worldSetting = typeof body.worldSetting === "string"
    ? body.worldSetting.trim().slice(0, 12000)
    : "";
  const storyClock = normalizeStoryClock(body.storyClock);
  const storyEvents = normalizeStoryEvents(body.storyEvents)
    .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status))
    .slice(0, 30);
  const scheduleContext = `【剧情时间与日程】
当前时间：${formatStoryMoment(storyClock)}
${storyClock.location ? `当前地点：${storyClock.location}` : ""}
${storyEvents.length
  ? storyEvents.map((event) =>
      `- ${event.day === null
        ? "日期待确认"
        : formatStoryMoment({ ...storyClock, day: event.day, segment: event.segment })}：${event.title}`
      + `${event.participants.length ? `；参与者：${event.participants.join("、")}` : ""}`
      + `${event.location ? `；地点：${event.location}` : ""}`
      + `；状态：${event.status}`,
    ).join("\n")
  : "暂无已记录的未来约定。"}
角色必须遵守当前剧情日期与已确认约定；待确认约定只能自然询问，不能当作必然已经决定的事实。不要擅自跨越日期或替用户完成重要日程。`;
  const allowGuestIntroduction = body.allowGuestIntroduction === true;
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((item: ChatMessage) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .slice(-16)
    .map((item: ChatMessage) => ({
      role: item.role,
      content: `${item.role === "assistant" && item.speaker ? `${item.speaker}：` : ""}${item.content.slice(0, 2000)}`,
    }));
  const lastMessage = messages.at(-1)?.content || "";
  const provider = body.provider === "grok" ? "grok" : "deepseek";
  const isGrok = provider === "grok";
  const multiMessageMode = ensemble.enabled !== false && body.responseMode === "multi";
  const maxTurns = Math.min(10, Math.max(1, Number(ensemble.maxTurns) || 3));
  const apiKey = isGrok
    ? process.env.GROK_API_KEY
    : process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    if (isGrok) {
      return Response.json(
        { error: "Grok API key is not configured" },
        { status: 503, headers: { "X-Chat-Provider": provider } },
      );
    }
    return new Response(demoReply(lastMessage, profile.name || "晚晚"), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Companion-Mode": "demo" },
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
  const model = isGrok
    ? requestedModel || process.env.GROK_MODEL || "gpt-5.6-luna"
    : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const upstreamBody: Record<string, unknown> = {
    model,
    messages: [{
      role: "system",
      content: `${buildSystemPrompt(
        profile,
        customPrompt,
        ensemble,
        `${scheduleContext}\n\n【最近对话】\n${messages.map((message) => message.content).join("\n")}`,
        worldSetting,
        storySummary,
        roleMemories,
        allowGuestIntroduction,
      )}${multiMessageMode ? `\n\n${buildMultiMessageProtocol(profile, ensemble)}` : ""}`,
    }, ...messages],
    stream: true,
    temperature: isGrok ? 0.7 : 0.9,
    max_tokens: multiMessageMode ? maxEnsembleOutputTokens(maxTurns) : 1400,
  };
  if (!isGrok) {
    upstreamBody.thinking = { type: "disabled" };
  }
  const bridgeUrl = process.env.LOCAL_AI_BRIDGE_URL;
  const upstreamUrl = bridgeUrl || `${baseUrl}/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(bridgeUrl
      ? { "X-AI-Provider": provider }
      : { Authorization: `Bearer ${apiKey}` }),
  };
  const callUpstream = () => fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    });
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let upstream: Response;
  let upstreamRetried = false;
  try {
    upstream = await callUpstream();
    if (multiMessageMode && retryableStatuses.has(upstream.status)) {
      await upstream.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, 450));
      upstreamRetried = true;
      upstream = await callUpstream();
    }
  } catch {
    if (!multiMessageMode) {
      return Response.json(
        { error: `${isGrok ? "Grok" : "DeepSeek"} network request failed` },
        { status: 502 },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    upstreamRetried = true;
    try {
      upstream = await callUpstream();
    } catch {
      return Response.json(
        {
          turns: [multiFallbackTurn(profile)],
          provider,
          maxTurns,
          fallback: "network",
          retried: true,
        },
        { headers: { "Cache-Control": "no-cache", "X-Chat-Provider": provider, "X-Chat-Model": model, "X-Chat-Fallback": "network" } },
      );
    }
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    if (multiMessageMode && retryableStatuses.has(upstream.status)) {
      return Response.json(
        {
          turns: [multiFallbackTurn(profile)],
          provider,
          maxTurns,
          fallback: "upstream",
          retried: upstreamRetried,
        },
        { headers: { "Cache-Control": "no-cache", "X-Chat-Provider": provider, "X-Chat-Model": model, "X-Chat-Fallback": "upstream" } },
      );
    }
    return Response.json(
      { error: `${isGrok ? "Grok" : "DeepSeek"} request failed`, detail: detail.slice(0, 300) },
      { status: upstream.status || 502 },
    );
  }

  if (multiMessageMode) {
    let content = "";
    try {
      content = await readChatCompletionContent(upstream);
    } catch {
      return Response.json(
        {
          turns: [multiFallbackTurn(profile)],
          provider,
          maxTurns,
          fallback: "stream",
          retried: upstreamRetried,
        },
        { headers: { "Cache-Control": "no-cache", "X-Chat-Provider": provider, "X-Chat-Model": model, "X-Chat-Fallback": "stream" } },
      );
    }
    let turns = content
      ? parseMultiMessageResponse(content, maxTurns)
      : [];
    let formatRepaired = false;
    if (!turns.length) {
      const repairBody: Record<string, unknown> = {
        model,
        messages: [
          {
            role: "system",
            content: `你是 JSON 格式修复器。把输入内容整理成合法 JSON，并为最后一条角色消息补齐一个符合现有场景的明确剧情推进。输出格式必须是 {"scene":"场景","turns":[{"speaker":"角色名","scene":"","mood":"心情","action":"动作","dialogue":"台词","progression":"已经开始发生的下一步行动及其直接影响"}]}。最多出现 ${maxTurns} 位不同角色，turns 最多 ${maxEnsembleMessages(maxTurns)} 条，但不要为凑上限拆句。同一 speaker 可以再次回复，但每条只能写自己的动作和台词，不能代写其他角色台词。所有 turns 必须按时间顺序，后一条自然承接前一条且带来新反应或新动作；只有最后一条 progression 非空。只输出 JSON。`,
          },
          {
            role: "user",
            content: content ? content.slice(0, 8000) : "没有可解析内容",
          },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: maxEnsembleOutputTokens(maxTurns),
      };
      if (!isGrok) repairBody.thinking = { type: "disabled" };
      try {
        const repairResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: JSON.stringify(repairBody),
        });
        if (repairResponse.ok) {
          const repairedResult = await repairResponse.json().catch(() => ({}));
          const repairedContent = repairedResult?.choices?.[0]?.message?.content;
          turns = typeof repairedContent === "string"
            ? parseMultiMessageResponse(repairedContent, maxTurns)
            : [];
          formatRepaired = turns.length > 0;
        }
      } catch {}
    }
    if (!turns.length) {
      return Response.json(
        {
          error: "模型回复无法整理为有效的多人对话，请重试本轮",
          diagnostic: {
            stage: "multi-json-invalid",
            provider,
            model,
            rawModelContent: content.slice(0, 100000),
            rawModelContentLength: content.length,
          },
        },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-cache",
            "X-Chat-Provider": provider,
            "X-Chat-Model": model,
            "X-Chat-Fallback": "none",
          },
        },
      );
    }
    return Response.json(
      {
        turns,
        provider,
        maxTurns,
        repaired: formatRepaired,
        retried: upstreamRetried,
      },
      {
        headers: {
          "Cache-Control": "no-cache",
          "X-Chat-Provider": provider,
          "X-Chat-Model": model,
          ...(formatRepaired ? { "X-Chat-Repaired": "true" } : {}),
        },
      },
    );
  }

  if (!(upstream.headers.get("content-type") || "").includes("text/event-stream")) {
    const content = await readChatCompletionContent(upstream);
    if (!content) {
      return Response.json(
        { error: `${isGrok ? "Grok" : "DeepSeek"} 没有返回有效内容` },
        { status: 502, headers: { "X-Chat-Provider": provider, "X-Chat-Model": model } },
      );
    }
    return new Response(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Chat-Provider": provider,
        "X-Chat-Model": model,
      },
    });
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
      "X-Chat-Provider": provider,
      "X-Chat-Model": model,
    },
  });
}
