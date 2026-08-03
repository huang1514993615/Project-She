import Vue from "vue/dist/vue.esm.js";
import {
  normalizeStoryClock,
  normalizeStoryEvents,
} from "../../shared/story-time.js";
import { localImageDirective } from "../platform/local-images.js";
import { compactTextHash } from "../utils/text-hash.js";
import { createAppState } from "./create-state.js";
import { appComputed } from "./computed.js";
import { appMethods } from "./methods.js";
import { appTemplate } from "./template.js";

export const CompanionApp = Vue.extend({
  directives: {
    "local-image": localImageDirective,
  },
  template: appTemplate,
  data: createAppState,
  computed: appComputed,
  watch: {
    ensemble: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.roleAutoSaveTimer);
        this.roleAutoSaveTimer = window.setTimeout(() => {
          this.persist();
          this.saveSettings().catch(() => this.showToast("角色资料自动同步失败"));
        }, 900);
      },
    },
    storyClock: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.storyAutoSaveTimer);
        this.storyAutoSaveTimer = window.setTimeout(() => {
          this.dayCount = this.storyClock.day;
          this.persist();
          this.saveSettings().catch(() => this.showToast("剧情时间自动保存失败"));
        }, 500);
      },
    },
    storyEvents: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.storyAutoSaveTimer);
        this.storyAutoSaveTimer = window.setTimeout(() => {
          this.persist();
          this.saveSettings().catch(() => this.showToast("日程自动保存失败"));
        }, 500);
      },
    },
  },
  async mounted() {
    this.loadErrorLogs();
    this.globalErrorHandler = (event) => {
      this.recordError("页面运行", event?.error || event?.message || "未知脚本错误", {
        file: event?.filename,
        line: event?.lineno,
        column: event?.colno,
      });
    };
    this.rejectionErrorHandler = (event) => {
      this.recordError("异步任务", event?.reason || "未处理的异步错误");
    };
    window.addEventListener("error", this.globalErrorHandler);
    window.addEventListener("unhandledrejection", this.rejectionErrorHandler);
    let localMessages = [];
    try {
      const saved = JSON.parse(localStorage.getItem("night-mailbox-state") || "null");
      if (saved?.userProfile) this.userProfile = { ...this.userProfile, ...saved.userProfile };
      if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
      if (Number.isFinite(Number(saved?.onboardingStep))) this.onboardingStep = Math.min(5, Math.max(1, Number(saved.onboardingStep)));
      if (Number.isFinite(Number(saved?.worldVersion))) this.worldVersion = Math.max(0, Number(saved.worldVersion));
      if (typeof saved?.worldSyncPending === "boolean") this.worldSyncPending = saved.worldSyncPending;
      if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
      this.chatProvider = "chat";
      const savedChatModel = saved?.chatModel || saved?.grokModel || "";
      if (typeof savedChatModel === "string" && /^[a-zA-Z0-9._:/-]{2,100}$/.test(savedChatModel)) {
        this.chatModel = savedChatModel;
        this.chatModelPreferenceLoaded = true;
      }
      if (typeof saved?.imageModel === "string" && /^[a-zA-Z0-9._:/-]{2,100}$/.test(saved.imageModel)) {
        this.imageModel = saved.imageModel;
        this.imageModelPreferenceLoaded = true;
      }
      if (Array.isArray(saved?.suggestions) && saved.suggestions.length === 3) {
        this.suggestions = saved.suggestions.filter((item) => typeof item === "string").slice(0, 3);
      }
      this.nextGuestAt = Math.max(8, Number(saved?.nextGuestAt) || this.nextGuestAt);
      this.imageEnabled = saved?.imageEnabled === true;
      this.imageQuality = "standard";
      if (typeof saved?.imagePrompt === "string") this.imagePrompt = saved.imagePrompt.slice(0, 1200);
      if (["观察型", "行动型", "幽默型", "谨慎型"].includes(saved?.actionStyle)) {
        this.actionStyle = saved.actionStyle;
      }
      if (saved?.storyClock) this.storyClock = normalizeStoryClock(saved.storyClock);
      if (Array.isArray(saved?.storyEvents)) this.storyEvents = normalizeStoryEvents(saved.storyEvents);
      if (saved?.tasks) {
        this.tasks = saved.tasks.map((task) => task.id === 4
          ? { ...task, title: "认真说一句晚安", detail: "用一句话结束今天的故事", icon: "☾" }
          : task);
      }
      if (Array.isArray(saved?.messages)) {
        const restoredMessages = saved.messages
          .filter((message) =>
            (message?.role === "user" || message?.role === "assistant")
            && typeof message?.content === "string"
            && message.content.trim()
          )
          .slice(-120)
          .map((message, index) => ({
            id: Number.isFinite(message.id) ? message.id : Date.now() + index,
            role: message.role,
            content: message.content,
            speaker: typeof message.speaker === "string" ? message.speaker : "",
            time: typeof message.time === "string" ? message.time : "",
            imageUrl: typeof message.imageUrl === "string" ? message.imageUrl : "",
            imageModel: typeof message.imageModel === "string" ? message.imageModel : "",
            imageQuality: typeof message.imageQuality === "string" ? message.imageQuality : "",
            mood: typeof message.mood === "string" ? message.mood : "",
            action: typeof message.action === "string" ? message.action : "",
            visual: message.visual && typeof message.visual === "object" ? message.visual : null,
          }));
        if (restoredMessages.length) this.messages = restoredMessages;
        localMessages = restoredMessages;
      }
    } catch {}
    try {
      const response = await fetch("/api/storage");
      if (!response.ok) throw new Error("storage unavailable");
      const saved = await response.json();
      if (saved?.userProfile) this.userProfile = { ...this.userProfile, ...saved.userProfile };
      if (this.directApiMode) this.onboardingCompleted = saved?.onboardingCompleted === true;
      if (Number.isFinite(Number(saved?.onboardingStep))) this.onboardingStep = Math.min(5, Math.max(1, Number(saved.onboardingStep)));
      if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
      if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
      this.systemPrompt = typeof saved?.systemPrompt === "string" ? saved.systemPrompt : "";
      this.storySummary = typeof saved?.storySummary === "string" ? saved.storySummary : "";
      this.storyClock = normalizeStoryClock(saved?.storyClock || this.storyClock);
      this.storyEvents = normalizeStoryEvents(saved?.storyEvents || this.storyEvents);
      this.dayCount = this.storyClock.day;
      this.roleMemories = saved?.roleMemories && typeof saved.roleMemories === "object"
        ? saved.roleMemories
        : {};
      this.worldSetting = typeof saved?.worldSetting === "string" ? saved.worldSetting : "";
      this.worldVersion = Math.max(0, Number(saved?.worldVersion) || (this.worldSetting.trim() ? 1 : 0));
      this.worldSyncPending = saved?.worldSyncPending === true;
      this.autoCompress = saved?.autoCompress !== false;
      this.autoCompressThreshold = Math.min(120, Math.max(20, Number(saved?.autoCompressThreshold) || 40));
      this.randomRoleEnabled = saved?.randomRoleEnabled !== false;
      this.randomRoleInterval = Math.min(60, Math.max(8, Number(saved?.randomRoleInterval) || 18));
      if (["观察型", "行动型", "幽默型", "谨慎型"].includes(saved?.actionStyle)) {
        this.actionStyle = saved.actionStyle;
      }
      if (saved?.stageBackground && typeof saved.stageBackground === "object") {
        this.stageBackground = {
          ...this.stageBackground,
          ...saved.stageBackground,
        };
      }
      this.summaryUpdatedAt = typeof saved?.summaryUpdatedAt === "string" ? saved.summaryUpdatedAt : "";
      this.defaultSystemPrompt = typeof saved?.defaultSystemPrompt === "string" ? saved.defaultSystemPrompt : "";
      if (Array.isArray(saved?.messages) && saved.messages.length) {
        this.messages = saved.messages;
      } else if (localMessages.length) {
        await this.saveHistory();
      }
      this.storyInitialized = saved?.storyInitialized === true || this.messages.length > 0 || localMessages.length > 0;
    } catch {
      this.showToast("本地文件服务暂时不可用");
    }
    if (!Number(this.profile.worldVersion) && this.worldVersion && !this.worldSyncPending) {
      this.profile.worldVersion = this.worldVersion;
    }
    this.savedWorldHash = compactTextHash(this.worldSetting);
    const coreAvatarMigrated = this.migrateLegacyCoreAvatar();
    this.settingsReady = true;
    if (coreAvatarMigrated) {
      this.persist();
      this.saveSettings().catch(() => this.showToast("新版预设头像保存失败"));
    }
    if (this.directApiMode && !this.onboardingCompleted) {
      this.$nextTick(() => { this.settingsOpen = true; });
    }
    this.settingsSyncTimer = window.setInterval(() => this.syncSettingsFromStorage(), 12000);
    fetch("/api/health").then((response) => response.json()).then(async (data) => {
      this.apiMode = data.chat === "saved" ? "live" : "demo";
      this.chatApiMode = data.chat === "saved" ? "configured" : "disabled";
      this.chatProvider = "chat";
      this.imageMode = data.image === "saved" ? "configured" : "disabled";
      await Promise.all([this.loadChatModels(), this.loadImageModels()]);
      if (this.directApiMode && this.onboardingCompleted && !this.storyInitialized) {
        void this.initializeStoryOpening();
      }
    }).catch((error) => this.recordError("接口健康检查", error));
    this.pollImageJobs();
    const latestAssistant = [...this.messages].reverse().find((message) => message.role === "assistant" && message.speaker)
      || { role: "assistant", speaker: this.profile.name, content: "" };
    this.applyStageCue(latestAssistant);
    this.scrollBottom();
  },
  beforeDestroy() {
    window.clearTimeout(this.roleAutoSaveTimer);
    window.clearTimeout(this.storyAutoSaveTimer);
    window.clearTimeout(this.stageTransitionTimer);
    window.clearTimeout(this.suggestionRefreshTimer);
    window.clearInterval(this.settingsSyncTimer);
    window.clearTimeout(this.imageJobPollTimer);
    window.removeEventListener("error", this.globalErrorHandler);
    window.removeEventListener("unhandledrejection", this.rejectionErrorHandler);
    this.clearStageVisualSequence();
    this.stopEnsemblePlayback();
  },
  methods: appMethods,
});
