import { parseLooseJsonObject } from "../../../shared/loose-json.js";

type SummaryMessage = {
  role?: "user" | "assistant";
  speaker?: string;
  content?: string;
};

type RoleRecord = {
  id: string;
  type: "primary" | "friend" | "fixed" | "temporary";
  name: string;
  age: number;
  gender: string;
  personality: string;
  relation: string;
};

type RoleMemory = {
  name: string;
  stableIdentity: string;
  relationshipMemory: string;
  importantEvents: string;
  currentStatus: string;
  lastKnownScene: string;
  commitments: string;
  updatedAt: string;
};

function chunkMessages(messages: SummaryMessage[], size: number) {
  const chunks: SummaryMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}

function cleanId(value: unknown, fallback: string) {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || fallback;
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function buildRoleRoster(profile: Record<string, unknown>, ensemble: Record<string, any>): RoleRecord[] {
  const primaryName = cleanText(profile.name, 20) || "晚晚";
  const friend = ensemble.friend || {};
  const roles: RoleRecord[] = [{
    id: "primary",
    type: "primary",
    name: primaryName,
    age: Math.min(80, Math.max(18, Number(profile.age) || 24)),
    gender: cleanText(profile.gender, 10) || "女性",
    personality: cleanText(profile.personality, 80) || "娇小可爱",
    relation: cleanText(profile.relation, 80) || "妻子",
  }, {
    id: "friend",
    type: "friend",
    name: cleanText(friend.name, 20) || "小雨",
    age: Math.min(80, Math.max(18, Number(friend.age) || 25)),
    gender: cleanText(friend.gender, 10) || "女性",
    personality: cleanText(friend.personality, 80) || "活泼直率、会照顾气氛",
    relation: cleanText(friend.relation, 80) || `${primaryName}的成年闺蜜`,
  }];
  for (const [index, role] of (Array.isArray(ensemble.customRoles) ? ensemble.customRoles : []).slice(0, 30).entries()) {
    roles.push({
      id: cleanId(role?.id, `role-${index + 1}`),
      type: "fixed",
      name: cleanText(role?.name, 20) || `角色${index + 1}`,
      age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
      gender: cleanText(role?.gender, 10) || "未指定",
      personality: cleanText(role?.personality, 80) || "自然、友善",
      relation: cleanText(role?.relation, 80) || "成年朋友",
    });
  }
  for (const [index, role] of (Array.isArray(ensemble.temporaryRoles) ? ensemble.temporaryRoles : []).slice(0, 80).entries()) {
    roles.push({
      id: cleanId(role?.id, `temporary-${index + 1}`),
      type: "temporary",
      name: cleanText(role?.name, 20) || `临时角色${index + 1}`,
      age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
      gender: cleanText(role?.gender, 10) || "未指定",
      personality: cleanText(role?.personality, 80) || "延续已经表现出的性格",
      relation: cleanText(role?.relation, 80) || "场景中认识的成年角色",
    });
  }
  return roles;
}

function baselineMemory(role: RoleRecord, existing: Record<string, unknown> = {}): RoleMemory {
  return {
    name: role.name,
    stableIdentity: `${role.name}是${role.age}岁${role.gender === "未指定" ? "" : role.gender}成年人，身份关系“${role.relation}”，稳定性格“${role.personality}”。`,
    relationshipMemory: cleanText(existing.relationshipMemory, 1200),
    importantEvents: cleanText(existing.importantEvents, 2400),
    currentStatus: cleanText(existing.currentStatus, 1000)
      || (role.type === "primary" ? "主角色，围绕用户继续当前剧情。" : "当前是否在场由最近剧情决定；未在场时保留身份和记忆，等待合理时机再登场。"),
    lastKnownScene: cleanText(existing.lastKnownScene, 800),
    commitments: cleanText(existing.commitments, 1200),
    updatedAt: cleanText(existing.updatedAt, 40),
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "DeepSeek API key is not configured" }, { status: 503 });
  }

  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const ensemble = body.ensemble && typeof body.ensemble === "object" ? body.ensemble : {};
  const roster = buildRoleRoster(profile, ensemble);
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((message: SummaryMessage) =>
      message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim()
    )
    .slice(-120)
    .map((message: SummaryMessage) => ({
      role: message.role,
      speaker: cleanText(message.speaker, 20),
      content: cleanText(message.content, 900),
    }));

  if (messages.length < 4) {
    return Response.json({ error: "有效对话太少，暂时不需要压缩" }, { status: 400 });
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const bridgeUrl = process.env.LOCAL_AI_BRIDGE_URL;
  const callModel = (payload: Record<string, unknown>) => fetch(bridgeUrl || `${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bridgeUrl
        ? { "X-AI-Provider": "deepseek" }
        : { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const rosterText = roster
    .map((role) => `${role.id}｜${role.name}｜${role.age}岁｜${role.relation}｜${role.personality}｜${role.type}`)
    .join("\n");
  let rollingSummary = cleanText(body.existingSummary, 8000);
  const chunks = chunkMessages(messages, 30);

  for (const chunk of chunks) {
    const transcript = chunk
      .map((message) => `${message.role === "user" ? "用户" : message.speaker || cleanText(profile.name, 20) || "晚晚"}：${message.content}`)
      .join("\n\n");
    const upstream = await callModel({
      model,
      messages: [
        {
          role: "system",
          content: `你是长期剧情记忆整理器。把旧摘要与新增对话合并成一份紧凑、准确、可继续用于角色扮演的中文记忆。

固定输出六个标题：
【当前场景】地点、时间、在场人物、各自位置、衣着、物品和未完成动作。
【角色状态】只写本轮确实出现或状态改变的角色；没有出现的角色不要擅自删除、改名或改变关系。
【关键剧情】按先后顺序压缩会影响后续的事件。
【用户偏好】用户明确表达的称呼、喜好、选择和长期目标。
【未完成事项】承诺、任务、约定、悬念、外出办事和等待决定的分支。
【连续性约束】下一轮必须延续的事实，以及哪些角色已离场或位于别处。

下方“永久角色名册”是不可被剧情摘要覆盖的稳定事实，尤其姓名、成年年龄、身份和关系。旧摘要与名册冲突时以名册为准。新对话只有明确表示关系发生真实改变时才能记录为剧情变化，但不能偷偷改写角色档案。

总长度控制在 900–1800 个中文字符。只输出摘要正文。`,
        },
        {
          role: "user",
          content: `永久角色名册：
${rosterText}

旧剧情摘要：
${rollingSummary || "暂无，这是第一次整理。"}

新增对话：
${transcript}`,
        },
      ],
      stream: false,
      temperature: 0.25,
      max_tokens: 2400,
      thinking: { type: "disabled" },
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        { error: "剧情总结请求失败", detail: detail.slice(0, 400) },
        { status: upstream.status || 502 },
      );
    }
    const result = await upstream.json().catch(() => ({}));
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length < 120) {
      return Response.json(
        { error: "模型没有返回有效的剧情摘要", detail: typeof content === "string" ? content.slice(0, 300) : "" },
        { status: 502 },
      );
    }
    rollingSummary = content
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
      .slice(0, 20000);
  }

  const existingMemories = body.existingRoleMemories
    && typeof body.existingRoleMemories === "object"
    && !Array.isArray(body.existingRoleMemories)
    ? body.existingRoleMemories as Record<string, Record<string, unknown>>
    : {};
  const roleMemories: Record<string, RoleMemory> = Object.fromEntries(
    roster.map((role) => [role.id, baselineMemory(role, existingMemories[role.id])]),
  );
  const fullTranscript = messages
    .map((message) => `${message.role === "user" ? "用户" : message.speaker || cleanText(profile.name, 20) || "晚晚"}：${message.content}`)
    .join("\n\n")
    .slice(-40000);
  const activeRoles = roster.filter((role) =>
    role.type === "primary"
    || messages.some((message) => message.speaker === role.name || message.content?.includes(role.name))
  );
  const memoryUpstream = await callModel({
    model,
    messages: [
      {
        role: "system",
        content: `你是多人互动剧情的角色长期记忆管理员。只更新本轮真正出现、被提及或状态变化的角色；没有出现的角色由程序保留旧记忆。

永久角色名册中的姓名、成年年龄、稳定性格和身份关系不可改写。为每个需要更新的角色提取：
- relationshipMemory：与用户及其他角色已经形成的具体关系与称呼。
- importantEvents：该角色亲历、获知或承诺记住的重要事件。
- currentStatus：现在是否在场、正在做什么；离场则写清去向或等待状态。
- lastKnownScene：最后出现的时间地点和位置。
- commitments：任务、承诺、未完成目标和应在未来继续的线索。

返回严格 JSON：{"roleMemories":[{"id":"角色ID","relationshipMemory":"","importantEvents":"","currentStatus":"","lastKnownScene":"","commitments":""}]}。只输出 JSON。`,
      },
      {
        role: "user",
        content: `永久角色名册：
${rosterText}

本轮需要更新的角色：
${activeRoles.map((role) => `${role.id}｜${role.name}`).join("\n")}

旧角色长期记忆：
${JSON.stringify(Object.fromEntries(activeRoles.map((role) => [role.id, roleMemories[role.id]]))).slice(0, 20000)}

压缩后的剧情摘要：
${rollingSummary}

压缩前对话：
${fullTranscript}`,
      },
    ],
    stream: false,
    temperature: 0.2,
    max_tokens: 5000,
    thinking: { type: "disabled" },
  });
  if (!memoryUpstream.ok) {
    const detail = await memoryUpstream.text();
    return Response.json(
      { error: "角色长期记忆整理失败，原对话已保留", detail: detail.slice(0, 400) },
      { status: memoryUpstream.status || 502 },
    );
  }
  const memoryResult = await memoryUpstream.json().catch(() => ({}));
  const parsed = parseLooseJsonObject(
    memoryResult?.choices?.[0]?.message?.content,
    (value) => Array.isArray(value?.roleMemories),
  );
  const updates = Array.isArray(parsed?.roleMemories) ? parsed.roleMemories : null;
  if (!updates) {
    return Response.json(
      { error: "模型没有返回有效的角色长期记忆，原对话已保留" },
      { status: 502 },
    );
  }
  const rosterById = new Map(roster.map((role) => [role.id, role]));
  for (const update of updates) {
    const id = cleanId(update?.id, "");
    const role = rosterById.get(id);
    if (!role) continue;
    const previous = roleMemories[id];
    roleMemories[id] = {
      ...previous,
      name: role.name,
      stableIdentity: baselineMemory(role).stableIdentity,
      relationshipMemory: cleanText(update.relationshipMemory, 1200) || previous.relationshipMemory,
      importantEvents: cleanText(update.importantEvents, 2400) || previous.importantEvents,
      currentStatus: cleanText(update.currentStatus, 1000) || previous.currentStatus,
      lastKnownScene: cleanText(update.lastKnownScene, 800) || previous.lastKnownScene,
      commitments: cleanText(update.commitments, 1200) || previous.commitments,
      updatedAt: new Date().toISOString(),
    };
  }

  return Response.json({
    summary: rollingSummary,
    roleMemories,
    roleMemoryCount: Object.keys(roleMemories).length,
    processedMessages: messages.length,
    chunks: chunks.length,
    model,
  });
}
