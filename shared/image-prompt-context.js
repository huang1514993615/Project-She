import { parseLooseJsonObject } from "./loose-json.js";
import { formatStoryMoment, normalizeStoryClock } from "./story-time.js";

function text(value, limit = 1200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

const structuredFieldLabels = {
  age: "年龄",
  age_appearance: "年龄观感",
  ageAppearance: "年龄观感",
  apparent_age: "年龄观感",
  gender: "性别",
  position: "画面位置",
  framing: "画面范围",
  face: "面容",
  eyes: "眼睛",
  hair: "发型",
  body: "体态",
  clothing: "服装",
  wardrobe: "服装",
  accessories: "标志配饰",
  pose: "姿态",
  action: "动作",
  expression: "表情",
  interaction: "互动",
};

function cleanPromptText(value, limit = 1200) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[“”"'`]/g, "")
    .replace(/【[^】]{0,20}】/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([，。；：、])\s*/g, "$1")
    .replace(/([，。；：、])\1+/g, "$1")
    .replace(/[，；]+。/g, "。")
    .replace(/。+[；，]/g, "。")
    .replace(/^[，。；：、\s]+|[，；：、\s]+$/g, "")
    .trim()
    .slice(0, limit);
}

function fieldText(value, limit = 1200) {
  if (typeof value === "string") {
    return cleanPromptText(value, limit)
      .replace(/\bname\s*[:：]\s*[^；;，。]+[；;]?/gi, "")
      .replace(/\b(?:age_appearance|ageAppearance|apparent_age)\s*[:：]\s*/gi, "年龄观感为")
      .replace(/\bgender\s*[:：]\s*/gi, "性别为")
      .replace(/\bposition\s*[:：]\s*/gi, "位于")
      .replace(/\bframing\s*[:：]\s*/gi, "画面范围为")
      .replace(/\b[a-z_][a-z0-9_]*\s*[:：]\s*/gi, "");
  }
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => fieldText(item, 300))
      .filter(Boolean)
      .join("；")
      .slice(0, limit);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const inner = fieldText(item, 200);
        if (!inner || key === "name") return "";
        const label = structuredFieldLabels[key]
          || (/^[\u4e00-\u9fff]{1,12}$/.test(key) ? key : "");
        return label ? `${label}：${inner}` : inner;
      })
      .filter(Boolean)
      .join("；")
      .slice(0, limit);
  }
  return String(value).slice(0, limit);
}

function chinesePersonIndex(index) {
  return ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][index] || String(index + 1);
}

function naturalizeCastRecord(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    const plain = fieldText(record, 260);
    return plain ? `人物${chinesePersonIndex(index)}：${plain}` : "";
  }
  const age = fieldText(
    record.age_appearance ?? record.ageAppearance ?? record.apparent_age ?? record.age,
    60,
  );
  const gender = fieldText(record.gender, 30);
  const position = fieldText(record.position ?? record.framing, 140);
  const details = Object.entries(record)
    .filter(([key]) => ![
      "name", "age", "age_appearance", "ageAppearance", "apparent_age", "gender", "position", "framing",
    ].includes(key))
    .map(([key, value]) => {
      const inner = fieldText(value, 120);
      if (!inner) return "";
      const label = structuredFieldLabels[key]
        || (/^[\u4e00-\u9fff]{1,12}$/.test(key) ? key : "");
      return label ? `${label}${inner}` : inner;
    })
    .filter(Boolean);
  const identity = [age ? `外表${age}` : "", gender].filter(Boolean).join("的");
  const parts = [identity, position ? `位于${position}` : "", ...details].filter(Boolean);
  return parts.length ? `人物${chinesePersonIndex(index)}：${parts.join("，")}` : "";
}

function naturalizeCastString(value) {
  const normalized = String(value || "")
    .replace(/\b(ageAppearance|apparent_age)\b/gi, "age_appearance")
    .replace(/[\r\n]+/g, " ");
  if (!/(?:^|[；;])\s*name\s*[:：]/i.test(normalized)) {
    return cleanPromptText(normalized, 900)
      .replace(/\bname\s*[:：]\s*[^；;，。]+[；;]?/gi, "")
      .replace(/\bage_appearance\s*[:：]\s*/gi, "年龄观感")
      .replace(/\bgender\s*[:：]\s*/gi, "性别")
      .replace(/\bposition\s*[:：]\s*/gi, "画面位置")
      .replace(/\b(?:framing)\s*[:：]\s*/gi, "画面范围")
      .replace(/\b[a-z_][a-z0-9_]*\s*[:：]\s*/gi, "");
  }
  const records = [...normalized.matchAll(
    /(?:^|[；;])\s*name\s*[:：]\s*([^；;]+)([\s\S]*?)(?=(?:[；;]\s*name\s*[:：])|$)/gi,
  )];
  const aliases = records.map((match, index) => ({
    name: cleanPromptText(match[1], 40),
    label: `人物${chinesePersonIndex(index)}`,
  }));
  return records
    .map((match, index) => {
      const record = {};
      let chunk = match[2];
      for (const alias of aliases) {
        if (alias.name) chunk = chunk.split(alias.name).join(alias.label);
      }
      for (const segment of chunk.split(/[；;]/)) {
        const match = segment.match(/^\s*([a-z_][a-z0-9_]*)\s*[:：]\s*(.+?)\s*$/i);
        if (match) record[match[1]] = match[2];
      }
      return naturalizeCastRecord(record, index);
    })
    .filter(Boolean)
    .join("；");
}

function anonymizeCastRecords(records) {
  const source = Array.isArray(records) ? records : [];
  const aliases = source.map((record, index) => ({
    name: cleanPromptText(record?.name, 40),
    label: `人物${chinesePersonIndex(index)}`,
  }));
  return source.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    return Object.fromEntries(Object.entries(record).map(([key, value]) => {
      if (typeof value !== "string") return [key, value];
      let result = value;
      for (const alias of aliases) {
        if (alias.name) result = result.split(alias.name).join(alias.label);
      }
      return [key, result];
    }));
  });
}

function castText(value, limit = 900) {
  let result = "";
  if (typeof value === "string") {
    result = naturalizeCastString(value);
  } else if (Array.isArray(value)) {
    result = anonymizeCastRecords(value).map(naturalizeCastRecord).filter(Boolean).join("；");
  } else if (value && typeof value === "object") {
    const looksLikeOnePerson = [
      "name", "age", "age_appearance", "ageAppearance", "apparent_age", "gender", "position", "framing",
    ].some((key) => Object.hasOwn(value, key));
    result = looksLikeOnePerson
      ? naturalizeCastRecord(value, 0)
      : anonymizeCastRecords(Object.values(value)).map(naturalizeCastRecord).filter(Boolean).join("；");
  }
  return cleanPromptText(result, limit);
}

function roleList(profile = {}, ensemble = {}) {
  return [
    { id: "primary", type: "主角色", ...profile },
    ...(ensemble?.enabled === false
      ? []
      : [
          { id: "friend", type: "固定角色", ...(ensemble?.friend || {}) },
          ...(Array.isArray(ensemble?.customRoles)
            ? ensemble.customRoles.map((role) => ({ type: "固定角色", ...role }))
            : []),
          ...(Array.isArray(ensemble?.temporaryRoles)
            ? ensemble.temporaryRoles.map((role) => ({ type: "临时角色", ...role }))
            : []),
        ]),
  ].filter((role) => text(role?.name, 30));
}

function roleMemoryText(memory = {}) {
  return [
    memory.stableIdentity && `稳定身份：${text(memory.stableIdentity, 700)}`,
    memory.relationshipMemory && `关系记忆：${text(memory.relationshipMemory, 700)}`,
    memory.importantEvents && `关键经历：${text(memory.importantEvents, 700)}`,
    memory.currentStatus && `历史状态快照（仅背景参考，可能过时，不代表此刻）：${text(memory.currentStatus, 500)}`,
    memory.lastKnownScene && `历史位置快照（仅背景参考，可能过时，不代表此刻）：${text(memory.lastKnownScene, 500)}`,
    memory.commitments && `承诺与目标：${text(memory.commitments, 500)}`,
  ].filter(Boolean).join("；");
}

function roleVisualCard(role, memory = {}) {
  const age = Math.max(0, Number(role?.age) || 0);
  return [
    `${role.type || "角色"}｜ID:${text(role.id, 60) || "unknown"}｜姓名：${text(role.name, 30) || "未命名"}`,
    `资料年龄：${age || "未填写"}；性别：${text(role.gender, 20) || "未指定"}；关系：${text(role.relation, 160) || "未填写"}`,
    `性格气质：${text(role.personality, 240) || "未填写"}`,
    `稳定外观（必须逐项落实到画面）：${text(role.appearance, 1800) || "未填写，只能依据该角色自己的资料谨慎补全"}`,
    `人物行为设定（只用于理解身份，不要照抄成画面）：${text(role.prompt, 1200) || "未填写"}`,
    `图片专用偏好（仅补充稳定外观，不得覆盖姓名、性别和已知特征）：${text(role.imagePrompt, 1200) || "未填写"}`,
    `长期记忆：${roleMemoryText(memory) || "暂无"}`,
  ].join("\n");
}

function recentTranscript(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) =>
      message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    )
    .slice(-12)
    .map((message) => {
      const speaker = message.role === "user"
        ? "用户"
        : text(message.speaker, 30) || "角色";
      return `${speaker}：${text(message.content, 1400)}`;
    })
    .join("\n\n")
    .slice(0, 12000);
}

function likelyCastNames(roles, messages = []) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-12);
  return roles
    .filter((role) => recent.some((message) =>
      message?.speaker === role.name
      || (typeof message?.content === "string" && message.content.includes(role.name))
    ))
    .map((role) => role.name);
}

const continuityPriority = `【视觉资料优先级】
1. 人物资料里的姓名、性别和稳定外观中的不可变部分（脸型、五官、瞳色、发型、体态、肤色、标志配饰）——永远保持不变；
2. 最近对话是此刻状态的唯一依据——决定当前场景、地点、在场人物、动作、情绪和事件；所有"此刻/现在/当前"判断只准依据最近对话，不得使用人物档案、长期记忆或剧情摘要中的旧状态；
3. 该人物的长期记忆、关系与图片专用偏好——只补充人物背景，不改变当前瞬间；其中"历史状态快照""历史位置快照"仅作背景参考，可能过时，绝不能当成当前状态；
4. 服装与衣物以最近对话为准：稳定外观里的基础服装只作为同款基底，当前瞬间可以穿脱、换衣、卷起衣摆、沾湿、破损或增减配饰，但脸型、五官、发型和体态不允许被改。

若最近对话省略发型、瞳色、体态或标志物，必须从稳定外观补回，绝不能因为对话没提到就省略，也不能把其他角色的外观移植过来。实际年龄与外表年龄不一致时分别保留，不擅自改写；任何外表明显未成年的角色只采用其符合外表年龄的非性化服装、姿态和镜头。`;
const visualOnlyOutputRule = `【输出画面语言】
最终画面描述中禁止出现剧情自定义的人名和专有地名，一律替换为可直接画出来的视觉特征：人物用性别与年龄观感、发型、脸型、眼睛与瞳色、体态、服装结构与材质颜色、标志配饰来描述；地点用建筑材质、年代与风格、空间陈设、灯光和天气痕迹来描述。只输出视觉语言，不输出剧情称谓。`;
export function buildImagePromptRequest(body = {}, kind = "scene") {
  const roles = roleList(body.profile || {}, body.ensemble || {});
  const memories = body.roleMemories && typeof body.roleMemories === "object"
    ? body.roleMemories
    : {};
  const transcript = recentTranscript(body.messages);
  const clock = normalizeStoryClock(body.storyClock);
  const momentAnchor = `【当前剧情时刻】
${formatStoryMoment(clock)}${clock.location ? `，地点：${clock.location}` : ""}

画面中"此刻"的场景、地点、在场人物、服装临时状态、动作和事件，只以【最近对话】为准。人物档案、长期记忆和剧情摘要里出现的任何旧场景、旧位置、旧状态都只是背景，不得带进"此刻"的画面。`;
  const style = text(body.style, 200);
  const styleConstraint = style
    ? `【画面整体风格】
${style}。风格只作用于画风、色彩、光影、材质、笔触与镜头语言；所有入镜人物的姓名、脸型、眼睛、瞳色、发型、体态、基础服装和标志配饰必须保持稳定，不能被风格改写。

`
    : "";

  if (kind === "character") {
    const role = body.role || {};
    const roleId = text(body.roleId, 80)
      || text(role.id, 80)
      || roles.find((item) => item.name === role.name)?.id
      || "";
    const memory = memories[roleId] || {};
    const target = roleVisualCard(
      { type: "目标人物", id: roleId || "target", ...role },
      memory,
    );
    const fixedAppearance = text(role.appearance, 900)
      || `${text(role.name, 30) || "目标人物"}，${text(role.gender, 20) || "性别未指定"}；外观细节尚未完善，请只做保守补全。`;
    return {
      fixedAppearance,
      targetName: text(role.name, 30) || "目标人物",
      targetGender: text(role.gender, 20) || "未指定",
      system: `你是人物连续性设计师、服装造型师和电影人像摄影导演。稳定外观会由程序原样拼接一次，你只负责从剧情提取当前画面的动态变化，绝不能复述人物长相。

${continuityPriority}

${styleConstraint}${visualOnlyOutputRule}

硬性要求：
- 不要输出脸型、五官、瞳色、发型、身形和固定配饰；程序会直接使用稳定外观。
- 最近对话只提取该人物此刻确实发生的服装临时状态、姿势、表情、地点、灯光和镜头，不把台词、对白、音效、心理解释或剧情段落照抄进结果。
- 缺少的视觉细节按照人物身份、稳定外观、世界规则和现实因果补全；不得让特殊能力或环境特效淹没人脸与人物形象。
- 画面中人物面部、眼神、发型、标志配饰和双手清楚可见，身体结构自然。

只返回严格 JSON：
{"wardrobeState":"当前服装与稳定基础服装相比发生的临时变化、材质状态和褶皱","pose":"身体朝向、重心、肩颈、四肢、双手和道具","expression":"可见微表情与视线方向","scene":"地点、时间、天气和同一瞬间可见环境","lighting":"主辅光方向、色温、高光和阴影","camera":"正面或正面三分之二视角、景别、机位、景深和9:16构图"}
不要解释规则，不要输出对白，不要写成故事。`,
      user: `${continuityPriority}

${momentAnchor}

【目标人物完整档案】
${target}

【当前状态的唯一来源——最近相关对话（最新对话最后，越靠后越是"现在"）】
${transcript || "暂无；请以完整人物档案设计稳定形象。"}

上面人物档案和长期记忆中的"历史状态快照""历史位置快照"都只是背景参考，可能过时。本人物此刻的场景、地点、动作、服装临时状态、情绪只依据上面这段最近对话判断，不得沿用历史状态快照中的旧场景。现在只输出目标人物此刻画面的动态 JSON。稳定外观由程序直接拼接，不要在任何字段重复外貌；不要只照搬最后一句对话的动作。`,
    };
  }

  const castNames = likelyCastNames(roles, body.messages);
  const roster = roles
    .slice(0, 40)
    .map((role) => roleVisualCard(role, memories[role.id] || {}))
    .join("\n\n");
  return {
    system: `你是电影剧照导演和人物连续性编辑。你的任务不是把最后一条回复改写成分镜，也不是总结剧情，而是依据稳定人物档案，冻结当前剧情中最有代表性的一个可见瞬间。

${continuityPriority}

${styleConstraint}${visualOnlyOutputRule}

硬性要求：
- 只选最近剧情中确实在场、正在行动或被镜头直接捕捉的人物；“可能在场人物”只是候选，不得把整个人物库都塞入画面。
- 对每位入镜人物，先在内部确认姓名以匹配正确档案；输出时只用“人物一、人物二……”区分，并明确写出外表年龄或年龄观感、性别、脸部与眼睛、发型、体态、基础服装、标志配饰，再写此刻姿势与互动。稳定人物特征不得被省略。
- 最近对话只作为事件证据。禁止照抄【场景】【心情】【动作】【剧情推进】等原文，禁止输出对白、引号台词、声音、内心旁白、抽象判断或连续动作过程。
- 只定格一个瞬间，所有四肢、视线、接触关系、道具和前中后景在同一时刻成立。特殊能力与环境特效不超过画面描述的 20%，人物识别和互动始终是主体。
- 缺失的衣料结构、空间陈设、光线方向与镜头信息可按世界和事件因果合理补全，但不得改变稳定外观或凭空制造新事件。
- JSON 的十个顶层字段必须全部是自然中文字符串，禁止在字段值里嵌套对象或数组，禁止出现 name、age_appearance、gender、position 等程序字段名。

只返回严格 JSON：
{"scene":"地点、时间、天气、正在发生的单一瞬间与空间基调","cast":"人物一：外表二十多岁的女性，位于画面中央偏左；人物二：外表三十岁左右的男性，位于后景门边","appearance":"人物一……；人物二……","wardrobe":"人物一……；人物二……","pose":"人物一……；人物二……","interaction":"人物距离、视线、接触方式和同一瞬间的因果关系","expression":"逐一写可见微表情与视线方向，不写内心独白","environment":"前中后景、家具物品、天气痕迹与有限的能力效果","lighting":"主辅光方向、色温、高光、阴影和色彩关系","camera":"正面或正面三分之二视角、景别、机位、焦段感、景深和9:16构图"}`,
    user: `${continuityPriority}

${momentAnchor}

【完整人物视觉档案库】
${roster || "暂无固定人物资料。"}

【最近内容推断的可能在场人物】
${castNames.length ? castNames.join("、") : "未明确，请只从最近对话谨慎判断。"}

【当前状态的唯一来源——最近对话（最新对话在最后，越靠后越是"现在"）】
${transcript || "暂无。"}

请先在内部确定“谁在画面里、每个人稳定长什么样、此刻发生了什么”，再输出 JSON。人物档案和长期记忆里的“历史状态快照”“历史位置快照”只是背景，可能过时；此刻的场景、地点、动作、在场人物、服装临时状态只以这段最近对话为准。画面必须让熟悉角色的人凭外观和标志物立即认出她们，而不是只看到一段剧情动作。`,
  };
}

export function formatImagePromptResponse(content, kind = "scene", request = {}) {
  const cleaned = text(content, 6000)
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (kind === "character") {
    const parsed = parseLooseJsonObject(
      cleaned,
      (value) => typeof value?.pose === "string" || typeof value?.scene === "string",
    );
    if (!parsed) throw new Error("对话模型返回的人物动态结构无法解析");
    const fields = [
      ["wardrobeState", "当前服装状态", 190],
      ["pose", "姿态动作", 180],
      ["expression", "表情视线", 130],
      ["scene", "场景环境", 160],
      ["lighting", "灯光色彩", 110],
      ["camera", "镜头构图", 120],
    ];
    const parts = fields
      .map(([key, label, limit]) => {
        const value = fieldText(parsed?.[key], limit)
          .replace(/[\r\n]+/g, " ")
          .replace(/[“”"'`]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return value ? `${label}：${value}` : "";
      })
      .filter(Boolean);
    if (parts.length < 4) throw new Error("对话模型返回的人物动态细节不足");
    return [
      `目标人物（${text(request.targetGender, 20) || "性别未指定"}）稳定外观：${text(request.fixedAppearance, 900) || "使用已保存的人物稳定外观"}`,
      ...parts,
      "人物身份、发型、五官、体态、固定服装结构、发饰与标志配饰全部保持稳定，面部和双手清楚，身体结构自然",
    ].join("。");
  }

  const parsed = parseLooseJsonObject(
    cleaned,
    (value) => typeof value?.scene === "string",
  );
  if (!parsed) throw new Error("对话模型返回的场景结构无法解析");
  const fields = [
    ["scene", "场景与空间", 110],
    ["cast", "画面人物", 280],
    ["appearance", "稳定外观", 230],
    ["wardrobe", "服装与材质", 150],
    ["pose", "定格姿势", 120],
    ["interaction", "人物互动", 110],
    ["expression", "表情视线", 100],
    ["environment", "环境细节", 110],
    ["lighting", "灯光色彩", 90],
    ["camera", "镜头构图", 100],
  ];
  const parts = fields
    .map(([key, label, limit]) => {
      const value = key === "cast"
        ? castText(parsed?.[key], limit)
        : cleanPromptText(fieldText(parsed?.[key], limit), limit);
      return value ? `${label}：${value}` : "";
    })
    .filter(Boolean);
  if (parts.length < 7) throw new Error("对话模型返回的场景细节不足");
  return cleanPromptText(parts.join("。"), 6000);
}
