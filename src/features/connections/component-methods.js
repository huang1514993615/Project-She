import { imageModelLabel } from "../../../shared/image-models.js";

/**
 * Vue methods for connection status, model discovery and explicit model choice.
 * Keeping them together makes API-configuration changes independent from chat/UI code.
 */
export const connectionMethods = {
  async loadChatModels() {
    if (this.chatApiMode !== "configured" || this.chatModelsLoading) return;
    this.chatModelsLoading = true;
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      const models = Array.isArray(result.models)
        ? result.models.filter((model) => typeof model === "string" && /^[a-zA-Z0-9._:/-]{2,160}$/.test(model))
        : [];
      if (!response.ok || !models.length) throw new Error(result.error || result.discoveryError || "模型列表为空");
      this.availableChatModels = models;
      this.chatCatalogVerified = result.source === "direct-api" && result.authConfigured === true;
      this.modelConnectionWarning = String(result.discoveryError || "");
      if (!models.includes(this.chatModel)) this.chatModel = "";
      this.chatConnectionVerified = this.chatCatalogVerified && Boolean(this.chatModel);
      this.persist();
      // 读取到模型但尚未选择时，主动提醒用户选择，避免新手困惑
      if (this.chatCatalogVerified && !this.chatModel) {
        this.showToast(`已读取 ${models.length} 个模型，请选择要使用的对话模型`);
      }
    } catch (error) {
      this.chatCatalogVerified = false;
      this.chatConnectionVerified = false;
      this.availableChatModels = [];
      this.modelConnectionWarning = String(error?.message || "无法读取对话模型列表");
    } finally {
      this.chatModelsLoading = false;
    }
  },

  setChatModel(model) {
    if (this.sending || !this.chatCatalogVerified || !this.availableChatModels.includes(model)) return;
    this.chatModel = model;
    this.chatModelPreferenceLoaded = true;
    this.chatProvider = "chat";
    this.chatConnectionVerified = true;
    this.persist();
    this.showToast(`${model} 对话已启用`);
  },

  async loadImageModels() {
    if (this.imageModelsLoading) return;
    this.imageModelsLoading = true;
    try {
      const response = await fetch("/api/image-models", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      const models = Array.isArray(result.models)
        ? result.models.filter((model) => typeof model === "string" && /^[a-zA-Z0-9._:/-]{2,160}$/.test(model))
        : [];
      if (!response.ok || !models.length) throw new Error(result.error || result.discoveryError || "图片模型列表为空");
      this.availableImageModels = models;
      this.imageCatalogVerified = result.source === "direct-api" && result.authConfigured === true;
      this.imageConnectionWarning = String(result.discoveryError || "");
      if (!models.includes(this.imageModel)) this.imageModel = "";
      this.imageConnectionVerified = this.imageCatalogVerified && Boolean(this.imageModel);
      this.persist();
    } catch (error) {
      this.availableImageModels = [];
      this.imageCatalogVerified = false;
      this.imageConnectionVerified = false;
      this.imageConnectionWarning = String(error?.message || "无法读取图片模型列表");
    } finally {
      this.imageModelsLoading = false;
    }
  },

  setImageModel(model) {
    if (this.imageGenerating || this.characterGenerating || !this.imageCatalogVerified || !this.availableImageModels.includes(model)) return;
    this.imageModel = model;
    this.imageModelPreferenceLoaded = true;
    this.imageConnectionVerified = true;
    this.persist();
    this.showToast(`${imageModelLabel(model)} 已启用`);
  },

  useCustomImageModel() {
    const model = String(this.customImageModel || "").trim();
    if (!/^[a-zA-Z0-9._:/-]{2,160}$/.test(model)) {
      this.showToast("模型名称只能包含字母、数字和 . _ : / -");
      return;
    }
    if (!this.availableImageModels.includes(model)) this.availableImageModels.push(model);
    this.imageModel = model;
    this.imageModelPreferenceLoaded = true;
    this.imageConnectionVerified = false;
    this.persist();
    this.showToast(`${model} 已保存为未验证的兼容模型`);
    this.customImageModel = "";
  },

  saveImagePreference() {
    this.persist();
    if (this.imageEnabled && !this.currentImageKeyConfigured) {
      this.imageEnabled = false;
      this.showToast("请先验证图片接口并选择模型");
    }
  },

  openDirectApiSettings() {
    window.dispatchEvent(new Event("night-mailbox:open-api-settings"));
  },
};
