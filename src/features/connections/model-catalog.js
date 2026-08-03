/**
 * 把不同 OpenAI 兼容服务的 `/models` 返回值整理为稳定字符串列表。
 * 该模块无界面、无存储、无网络副作用，便于单独测试和扩展供应商兼容。
 */
export function normalizeModelCatalog(payload) {
  const entries = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];

  return [...new Set(entries
    .map((entry) => String(typeof entry === "string" ? entry : entry?.id || "").trim())
    .filter((id) => /^[a-zA-Z0-9._:/-]{2,160}$/.test(id)))];
}

const IMAGE_MODEL_PATTERN = /(?:image|imagine|flux|dall|imagen|sdxl|stable[-_.]?diffusion|recraft|ideogram)/i;
const NON_CHAT_MODEL_PATTERN = /(?:embedding|rerank|moderation|whisper|speech|tts|audio)/i;

export function isLikelyImageModel(modelId) {
  return IMAGE_MODEL_PATTERN.test(String(modelId || ""));
}

export function isLikelyChatModel(modelId) {
  const id = String(modelId || "");
  return Boolean(id) && !IMAGE_MODEL_PATTERN.test(id) && !NON_CHAT_MODEL_PATTERN.test(id);
}

export function chatModelCandidates(models) {
  return models.filter(isLikelyChatModel);
}

export function imageModelCandidates(models) {
  return models.filter(isLikelyImageModel);
}

/** 用户修改地址或 Key 后，旧验证结果必须作废。 */
export function connectionFingerprint(baseUrl, apiKey) {
  const normalizedUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const key = String(apiKey || "").trim();
  return `${normalizedUrl}|${key.length}|${key.slice(-4)}`;
}
