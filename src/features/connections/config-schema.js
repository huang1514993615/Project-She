/**
 * 浏览器端 API 配置的数据结构。
 *
 * 安全边界：纯前端无法把 Key 变成服务器密钥；这里只将它保存在当前设备，
 * 不会写入构建产物。公开部署时应提醒用户只在自己的设备填写个人 Key。
 */
export const API_CONFIG_STORAGE_KEY = "night-mailbox-mobile-api-config";

export const DEFAULT_API_CONFIG = Object.freeze({
  chatBaseUrl: "",
  chatApiKey: "",
  imageBaseUrl: "",
  imageApiKey: "",
  chatStream: true,
});

const trimUrl = (value) => String(value || "").trim().replace(/\/$/, "");
const trimKey = (value) => String(value || "").trim();

/** 读取配置，并一次性兼容迁移早期版本的字段名。 */
export function normalizeApiConfig(value = {}) {
  const legacyBaseUrl = value.apiBaseUrl || value.downstreamBaseUrl || value.deepseekBaseUrl || "";
  const legacyChatKey = value.apiKey || value.downstreamKey || value.deepseekKey || "";
  const legacyImageKey = value.imageKey || value.gptImageKey || value.grokImageKey || "";
  const chatBaseUrl = trimUrl(value.chatBaseUrl || legacyBaseUrl);
  const chatApiKey = trimKey(value.chatApiKey || legacyChatKey);

  return {
    chatBaseUrl,
    chatApiKey,
    imageBaseUrl: trimUrl(value.imageBaseUrl || chatBaseUrl),
    imageApiKey: trimKey(value.imageApiKey || legacyImageKey || chatApiKey),
    chatStream: value.chatStream !== false && value.chatStream !== "false",
  };
}

/** 保存时只输出当前字段，不把旧版双 Key/供应商字段继续写回。 */
export function serializeApiConfig(value = {}, previous = DEFAULT_API_CONFIG) {
  return normalizeApiConfig({
    chatBaseUrl: value.chatBaseUrl ?? previous.chatBaseUrl,
    chatApiKey: value.chatApiKey ?? previous.chatApiKey,
    imageBaseUrl: value.imageBaseUrl || value.chatBaseUrl || previous.imageBaseUrl || previous.chatBaseUrl,
    imageApiKey: value.imageApiKey || value.chatApiKey || previous.imageApiKey || previous.chatApiKey,
    chatStream: value.chatStream,
  });
}
