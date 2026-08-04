import { limitEnsembleTurns } from "../../shared/ensemble-turns.js";
import {
  createDefaultRoleVisualStates,
  DEFAULT_ROLE_VISUAL_STATES,
} from "../../shared/role-visual-states.js";
import {
  STORY_TIME_SEGMENTS,
  advanceStoryClock,
  normalizeStoryClock,
  normalizeStoryEvent,
  normalizeStoryEvents,
  storyMomentValue,
} from "../../shared/story-time.js";
import { shouldAnalyzeStoryEvent } from "../../shared/story-event-ai.js";
import {
  imageModelAdapterLabel,
  imageModelLabel,
  imageModelSpec,
} from "../../shared/image-models.js";
import { currentRoleDerivedState } from "../domain/roles/derived-state.js";
import { compactTextHash } from "../utils/text-hash.js";
import { connectionMethods } from "../features/connections/component-methods.js";
import { onboardingMethods } from "../features/onboarding/component-methods.js";
import { avatarMethods } from "../features/characters/avatar-methods.js";

/** Vue 业务方法集合。高频功能继续拆到 features 目录，跨功能编排留在这里。 */
export const appMethods = {
    imageModelAdapterLabel,
    imageModelLabel,
    imageModelSpec,
    async copyText(value, label = "内容") {
      const content = String(value || "").trim();
      if (!content) {
        this.showToast("没有可复制的内容", false);
        return false;
      }
      try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(content);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = content;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          textarea.style.top = "0";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
          let copied = false;
          try {
            copied = document.execCommand("copy");
          } finally {
            textarea.remove();
          }
          if (!copied) throw new Error("浏览器未允许复制");
        }
        this.showToast(`${label}已复制`, false);
        return true;
      } catch (error) {
        this.recordError("复制内容", error, { label });
        this.showToast("复制失败，请长按文本手动复制", false);
        return false;
      }
    },
    sanitizeErrorText(value, maxLength = 8000) {
      return String(value || "")
        .replace(/\b(?:sk|key)-[a-zA-Z0-9_-]{8,}\b/gi, "[已隐藏密钥]")
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[已隐藏密钥]")
        .replace(/("(?:apiKey|token|key)"\s*:\s*")[^"]+(")/gi, "$1[已隐藏密钥]$2")
        .slice(0, Math.max(1000, Number(maxLength) || 8000));
    },
    loadErrorLogs() {
      try {
        const saved = JSON.parse(localStorage.getItem("night-mailbox-error-logs") || "[]");
        this.errorLogs = Array.isArray(saved) ? saved.slice(0, 100) : [];
      } catch {
        this.errorLogs = [];
      }
    },
    recordError(source, error, context = {}) {
      const message = this.sanitizeErrorText(error?.message || error || "未知错误");
      if (!message) return;
      const diagnostic = error?.diagnostic && typeof error.diagnostic === "object"
        ? error.diagnostic
        : null;
      const detail = this.sanitizeErrorText([
        error?.stack || "",
        diagnostic ? `返参诊断：\n${JSON.stringify(diagnostic, null, 2)}` : "",
        context && Object.keys(context).length ? `调用上下文：\n${JSON.stringify(context, null, 2)}` : "",
      ].filter(Boolean).join("\n\n"), 120000);
      const latest = this.errorLogs[0];
      if (latest?.source === source && latest?.message === message && Date.now() - latest.id < 2000) return;
      this.errorLogs.unshift({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        source: String(source || "应用").slice(0, 40),
        message,
        detail,
        page: this.mobileTab,
        provider: this.chatProvider,
        model: this.chatModel,
        userAgent: navigator.userAgent.slice(0, 500),
      });
      this.errorLogs = this.errorLogs.slice(0, 100);
      try {
        localStorage.setItem("night-mailbox-error-logs", JSON.stringify(this.errorLogs));
      } catch {}
    },
    exportErrorLogs() {
      if (!this.errorLogs.length) return;
      const payload = {
        app: "夜航信箱",
        exportedAt: new Date().toISOString(),
        count: this.errorLogs.length,
        logs: this.errorLogs,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `夜航信箱-错误日志-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.showToast("错误日志已导出", false);
    },
    clearErrorLogs() {
      if (!this.errorLogs.length || !window.confirm("确认清除当前设备上的全部错误日志吗？")) return;
      this.errorLogs = [];
      localStorage.removeItem("night-mailbox-error-logs");
      this.showToast("错误日志已清除", false);
    },
    async refreshTokenUsage() {
      if (this.tokenUsageLoading) return;
      this.tokenUsageLoading = true;
      try {
        const response = await fetch("/api/usage", { cache: "no-store" });
        if (!response.ok) throw new Error("usage unavailable");
        const data = await response.json();
        this.tokenUsage = data;
        if (this.tokenPriceInput === "" && Number.isFinite(Number(data?.pricePerMillionInput))) {
          this.tokenPriceInput = Number(data.pricePerMillionInput) > 0 ? String(data.pricePerMillionInput) : "";
        }
        if (this.tokenPriceOutput === "" && Number.isFinite(Number(data?.pricePerMillionOutput))) {
          this.tokenPriceOutput = Number(data.pricePerMillionOutput) > 0 ? String(data.pricePerMillionOutput) : "";
        }
      } catch {
        this.tokenUsage = null;
      } finally {
        this.tokenUsageLoading = false;
      }
    },
    async saveTokenPrice() {
      try {
        const response = await fetch("/api/usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pricePerMillionInput: Number(this.tokenPriceInput) || 0,
            pricePerMillionOutput: Number(this.tokenPriceOutput) || 0,
          }),
        });
        if (!response.ok) throw new Error("save usage price failed");
        const data = await response.json();
        this.tokenUsage = data;
        this.showToast("Token 单价已保存，费用为估算值");
      } catch {
        this.showToast("Token 单价保存失败");
      }
    },
    formatTokenCount(count) {
      return Number(count) >= 1000
        ? `${(Number(count) / 1000).toFixed(1)}k`
        : String(Math.max(0, Math.round(Number(count) || 0)));
    },
    formatCost(value, usage) {
      const hasPrice = Number(usage?.pricePerMillionInput) > 0 || Number(usage?.pricePerMillionOutput) > 0;
      const number = Number(value) || 0;
      if (!hasPrice) return "未设置单价";
      return number >= 1 ? `¥${number.toFixed(2)}` : `¥${number.toFixed(4)}`;
    },
    now() {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    },
    roleById(roleId) {
      if (roleId === "primary") return this.profile;
      if (roleId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === roleId)
        || this.ensemble.temporaryRoles.find((role) => role.id === roleId)
        || null;
    },
    roleDerivedState(role) {
      return currentRoleDerivedState(role, this.storyClock.day);
    },
    roleDerivedSummary(role) {
      const state = this.roleDerivedState(role);
      const age = state.actualAge === null
        ? "年龄未设置"
        : state.apparentAge !== null && state.apparentAge !== state.actualAge
          ? `实际 ${state.actualAge} 岁 / 外表约 ${state.apparentAge} 岁`
          : `${state.actualAge} 岁`;
      return [age, state.corePersonality || "性格待 AI 提取"].filter(Boolean).join(" · ");
    },
    roleDerivedDetail(role) {
      const state = this.roleDerivedState(role);
      const ruleLabels = {
        normal: "随剧情每 365 天增长一岁",
        fixed: "实际年龄增长，外表年龄固定",
        "long-lived": "长生种：实际年龄增长，外表变化缓慢或固定",
        ageless: "年龄与外表均不随剧情时间变化",
        unknown: "等待 AI 从人物提示词判断成长规则",
      };
      return `${ruleLabels[state.agingRule] || ruleLabels.unknown}。可在下方直接填写实际年龄，或修改人物提示词后保存，由 AI 重新提取。`;
    },
    ensureRoleDerivedProfile(role) {
      if (!role) return {};
      if (role.derivedProfile && typeof role.derivedProfile === "object") return role.derivedProfile;
      const derivedProfile = {};
      this.$set(role, "derivedProfile", derivedProfile);
      return derivedProfile;
    },
    normalizeRoleAge(role) {
      const profile = role?.derivedProfile;
      if (!profile || typeof profile !== "object") return;
      const normalize = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
      };
      profile.initialActualAge = normalize(profile.initialActualAge);
      profile.initialApparentAge = normalize(profile.initialApparentAge);
    },
    roleRecordByName(name) {
      if (!name || name === this.profile.name) return { id: "primary", role: this.profile };
      if (name === this.ensemble.friend.name) return { id: "friend", role: this.ensemble.friend };
      const role = this.ensemble.customRoles.find((item) => item.name === name)
        || this.ensemble.temporaryRoles.find((item) => item.name === name);
      return role ? { id: role.id, role } : null;
    },
    normalizeVisualLibrary(role) {
      if (!role) return [];
      const stored = Array.isArray(role.visualStates) ? role.visualStates : [];
      const byId = new Map(stored.map((state) => [String(state?.id || ""), state]));
      const defaults = createDefaultRoleVisualStates().map((state) => {
        const savedState = byId.get(state.id) || {};
        const oldAutomaticPrompt = !savedState.finalPromptVersion
          && /图片1是该角色唯一基底图|角色资料仅用于补充/.test(String(savedState.finalPrompt || ""));
        return {
          ...state,
          ...savedState,
          finalPrompt: oldAutomaticPrompt ? "" : String(savedState.finalPrompt || state.finalPrompt || ""),
          finalPromptVersion: oldAutomaticPrompt ? 2 : Number(savedState.finalPromptVersion || state.finalPromptVersion || 2),
          tags: Array.isArray(savedState.tags) ? savedState.tags : state.tags,
        };
      });
      const custom = stored
        .filter((state) => state?.custom && !DEFAULT_ROLE_VISUAL_STATES.some((item) => item.id === state.id))
        .map((state, index) => ({
          id: String(state.id || `custom-${Date.now()}-${index}`),
          name: String(state.name || `自定义动作${index + 1}`),
          emotion: String(state.emotion || "neutral"),
          action: String(state.action || "idle"),
          tags: Array.isArray(state.tags) ? state.tags : [],
          prompt: String(state.prompt || ""),
          finalPrompt: String(state.finalPrompt || ""),
          finalPromptVersion: Number(state.finalPromptVersion || 2),
          imageUrl: String(state.imageUrl || ""),
          imageJobId: String(state.imageJobId || ""),
          enabled: state.enabled !== false,
          selected: state.selected === true,
          custom: true,
        }));
      const states = [...defaults, ...custom];
      this.$set(role, "visualStates", states);
      if (typeof role.visualEnabled !== "boolean") this.$set(role, "visualEnabled", true);
      if (!role.visualDefaultStateId) this.$set(role, "visualDefaultStateId", "idle_neutral");
      if (!role.visualBaseSource) this.$set(role, "visualBaseSource", "");
      if (!role.visualBaseImageUrl) this.$set(role, "visualBaseImageUrl", "");
      if (!role.visualBaseImageJobId) this.$set(role, "visualBaseImageJobId", "");
      return states;
    },
    openRoleDetail(targetId, tab = "profile") {
      const role = targetId === "primary"
        ? this.profile
        : targetId === "friend"
        ? this.ensemble.friend
        : this.ensemble.customRoles.find((item) => item.id === targetId)
          || this.ensemble.temporaryRoles.find((item) => item.id === targetId);
      if (!role) return;
      this.ensureRoleDerivedProfile(role);
      this.settingsOpen = false;
      this.characterPromptOpen = false;
      this.roleDetailTargetId = targetId;
      this.roleDetailTab = ["image", "album"].includes(tab)
        ? tab
        : tab === "visual" && this.standaloneMode && this.motionDisplayEnabled
          ? "visual"
          : "profile";
      this.characterPromptFallback = false;
      this.roleDetailOpen = true;
      this.roleAiInstruction = "";
      this.selectedRoleReferenceImage = null;
      this.roleReferencePickerOpen = false;
      if (this.roleDetailTab === "visual") this.openVisualLibrary();
    },
    openVisualLibrary() {
      if (!this.motionDisplayEnabled || !this.standaloneMode || !this.selectedRole) return;
      const states = this.normalizeVisualLibrary(this.selectedRole);
      this.roleDetailTab = "visual";
      if (!states.some((state) => state.id === this.visualStateEditorId)) {
        this.visualStateEditorId = states[0]?.id || "";
      }
      this.preloadRoleVisuals(this.selectedRole);
    },
    openSpeakerDetail(name) {
      if (!name || name === this.profile.name) {
        this.openRoleDetail("primary");
        return;
      }
      if (name === this.ensemble.friend.name) {
        this.openRoleDetail("friend");
        return;
      }
      const role = this.ensemble.customRoles.find((item) => item.name === name);
      if (role) {
        this.openRoleDetail(role.id);
        return;
      }
      const firstRoleMessage = this.messages.find((item) =>
        item.role === "assistant" && item.speaker === name
      );
      const discovered = this.ensureTemporaryRoleFromMessage(firstRoleMessage || {
        role: "assistant",
        speaker: name,
        content: "",
      });
      if (!discovered?.role) return;
      if (discovered.created) this.autoGenerateTemporaryRoles([discovered.role.id]);
      this.openRoleDetail(discovered.role.id);
    },
    ensureTemporaryRoleFromMessage(message) {
      const name = String(message?.speaker || "").trim().slice(0, 20);
      if (
        !name
        || name === this.profile.name
        || ["用户", "系统", "旁白"].includes(name)
        || this.fixedRoleByName(name)
      ) {
        return null;
      }
      const existing = this.temporaryRoleByName(name);
      if (existing) return { role: existing, created: false };
      if (this.ensemble.temporaryRoles.length >= 80) return null;
      const firstAppearanceEvidence = String(message?.content || "")
        .replace(/\s+/g, " ")
        .slice(0, 700);
      const temporaryRole = {
        id: `temporary-${Date.now()}-${this.ensemble.temporaryRoles.length + 1}`,
        name,
        age: 24,
        gender: "未指定",
        personality: "根据首次登场时的言行与情绪表现建立",
        relation: "根据当前场景与人物互动判断",
        prompt: `依据“${name}”的首次登场与后续对话，保持身份、语气、目标和行为逻辑连续。首次登场证据：${firstAppearanceEvidence || "暂无更多细节"}`,
        appearance: `依据“${name}”的首次登场片段提取五官、发型、体态、服装与标志物；未明确的细节保持可编辑。视觉证据：${firstAppearanceEvidence || "暂无更多细节"}`,
        imagePrompt: "",
        avatarUrl: "",
        worldVersion: this.worldVersion,
      };
      this.ensemble.temporaryRoles.push(temporaryRole);
      return { role: temporaryRole, created: true };
    },
    closeRoleDetail() {
      this.portraitPreviewOpen = false;
      this.visualStatePreview = null;
      this.roleDetailOpen = false;
    },
    backToCharacterManager() {
      this.closeRoleDetail();
      this.settingsOpen = true;
    },
    async saveRoleDetail() {
      if (!this.selectedRole) return;
      const role = this.selectedRole;
      try {
        await this.saveSettings();
        this.persist();
        this.showToast(`${role.name}的资料已保存`);
      } catch (error) {
        this.recordError("人物资料保存", error, { roleId: this.roleDetailTargetId });
        this.showToast("人物资料保存失败");
      }
    },
    async readLocalImageFile(file) {
      if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
      if (file.size > 18 * 1024 * 1024) throw new Error("图片不能超过 18MB");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
      if (!this.standaloneMode) return dataUrl;
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", dataUrl, category: "character" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.reference) throw new Error(result.error || "图片保存失败");
      return result.reference;
    },
    async uploadRoleAvatar(event, roleId = "primary") {
      const input = event?.target;
      const file = input?.files?.[0];
      const role = this.roleById(roleId);
      if (!file || !role || this.avatarUploadingId) return;
      this.avatarUploadingId = roleId;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.$set(role, "avatarUrl", imageUrl);
        this.persist();
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.showToast(`${role.name || "人物"}的头像已保存在当前设备`);
      } catch (error) {
        this.recordError("头像上传", error, { roleId, filename: file.name || "" });
        this.showToast(String(error?.message || "头像上传失败").slice(0, 48));
      } finally {
        this.avatarUploadingId = "";
        if (input) input.value = "";
      }
    },
    async useAvatarAsVisualBase() {
      const role = this.selectedRole;
      if (!role?.avatarUrl) return;
      const matchingJob = this.imageJobs.find((job) =>
        job.kind === "character"
        && job.targetId === this.roleDetailTargetId
        && job.status === "completed"
        && job.imageUrl === role.avatarUrl
      );
      this.$set(role, "visualBaseSource", "avatar");
      this.$set(role, "visualBaseImageUrl", "");
      this.$set(role, "visualBaseImageJobId", matchingJob?.id || "");
      await this.saveSettings().catch(() => {});
      this.preloadImageUrl(role.avatarUrl);
      this.showToast("当前头像已设为动作基底图");
    },
    async uploadVisualBaseImage(event) {
      const file = event?.target?.files?.[0];
      if (!file || !this.selectedRole) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.$set(this.selectedRole, "visualBaseSource", "upload");
        this.$set(this.selectedRole, "visualBaseImageUrl", imageUrl);
        this.$set(this.selectedRole, "visualBaseImageJobId", "");
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.showToast("基底图已导入并保存在当前设备");
      } catch (error) {
        this.showToast(String(error?.message || "基底图读取失败"));
      } finally {
        event.target.value = "";
      }
    },
    async clearVisualBaseImage() {
      if (!this.selectedRole) return;
      this.$set(this.selectedRole, "visualBaseSource", "");
      this.$set(this.selectedRole, "visualBaseImageUrl", "");
      this.$set(this.selectedRole, "visualBaseImageJobId", "");
      await this.saveSettings().catch(() => {});
      this.showToast("动作基底图已清除，已有动作图不会删除");
    },
    visualStateJob(state) {
      if (!state?.imageJobId) return null;
      const job = this.imageJobs.find((item) => item.id === state.imageJobId);
      return job && (job.status === "queued" || job.status === "running") ? job : null;
    },
    visualStateImage(state) {
      if (!state) return "";
      if (state.imageUrl) return state.imageUrl;
      if (!state.imageJobId) return "";
      const job = this.imageJobs.find((item) => item.id === state.imageJobId);
      return job?.status === "completed" ? String(job.imageUrl || "") : "";
    },
    openVisualStatePreview(state) {
      const imageUrl = this.visualStateImage(state);
      if (!imageUrl || !this.selectedRole) return;
      this.visualStatePreview = {
        imageUrl,
        roleName: this.selectedRole.name,
        stateName: state.name,
      };
    },
    closeVisualStatePreview() {
      this.visualStatePreview = null;
    },
    selectVisualStates(mode) {
      this.selectedRoleVisualStates.forEach((state) => {
        const selected = mode === "all"
          ? true
          : mode === "missing"
          ? !this.visualStateImage(state)
          : false;
        this.$set(state, "selected", selected);
      });
    },
    async uploadVisualStateImage(event, state) {
      const file = event?.target?.files?.[0];
      if (!file || !state) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.$set(state, "imageUrl", imageUrl);
        this.$set(state, "imageJobId", "");
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.applyStageCue({
          speaker: this.selectedRole.name,
          visual: {
            preferredStateId: state.id,
            emotion: state.emotion,
            action: state.action,
          },
        });
        this.showToast(`${state.name}已导入并保存在当前设备`);
      } catch {
        this.showToast("本地图片读取失败");
      } finally {
        event.target.value = "";
      }
    },
    async clearVisualStateImage(state) {
      if (!state) return;
      this.$set(state, "imageUrl", "");
      this.$set(state, "imageJobId", "");
      await this.saveSettings().catch(() => {});
      this.showToast(`${state.name}的图片已移除`);
    },
    addCustomVisualState() {
      const states = this.normalizeVisualLibrary(this.selectedRole);
      const index = states.filter((state) => state.custom).length + 1;
      const state = {
        id: `custom-${Date.now()}`,
        name: `自定义动作${index}`,
        emotion: "neutral",
        action: "idle",
        tags: [],
        prompt: "符合当前人物性格的自然表情与动作，正面全身，人物居中",
        finalPrompt: "",
        finalPromptVersion: 2,
        imageUrl: "",
        imageJobId: "",
        enabled: true,
        selected: true,
        custom: true,
      };
      states.push(state);
      this.visualStateEditorId = state.id;
      this.$nextTick(() => this.$el.querySelector(".visual-state-editor")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      }));
    },
    removeSelectedVisualState() {
      const state = this.selectedVisualState;
      if (!state?.custom || !window.confirm(`确认删除“${state.name}”吗？`)) return;
      const index = this.selectedRoleVisualStates.findIndex((item) => item.id === state.id);
      if (index >= 0) this.selectedRoleVisualStates.splice(index, 1);
      this.visualStateEditorId = this.selectedRoleVisualStates[0]?.id || "";
      this.saveSettings().catch(() => {});
    },
    buildVisualStatePrompt(role, state) {
      const actionPrompt = String(state.prompt || `${state.name}，${state.emotion}情绪，${state.action}动作`)
        .replace(/\s+/g, " ")
        .slice(0, 520);
      return `${actionPrompt}，纯白色背景。以图片1为基底，只改变上述表情和动作；人物必须还是图片1中的同一个人。人物形象、脸型、五官、发型、发色、瞳色、发饰、衣服、衣服颜色与材质、配饰、鞋子、身材比例、画风、镜头距离和构图全部不要变。不要增加其他人物、道具、文字、水印或边框。`.slice(0, 1200);
    },
    refreshSelectedVisualFinalPrompt() {
      if (!this.selectedRole || !this.selectedVisualState) return;
      this.$set(
        this.selectedVisualState,
        "finalPrompt",
        this.buildVisualStatePrompt(this.selectedRole, this.selectedVisualState),
      );
      this.$set(this.selectedVisualState, "finalPromptVersion", 2);
      this.showToast("最终图生图提示词已重新合成，可继续修改");
    },
    async submitVisualStateJob(state, silent = false) {
      const role = this.selectedRole;
      if (!role || !state || this.visualStateJob(state)) return false;
      if (!this.selectedRoleVisualBaseUrl) throw new Error("请先确认角色基底图");
      const finalPrompt = String(state.finalPrompt || this.buildVisualStatePrompt(role, state)).trim().slice(0, 1200);
      this.$set(state, "finalPrompt", finalPrompt);
      this.$set(state, "finalPromptVersion", 2);
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-async",
          enabled: true,
          kind: "visual-state",
          targetId: this.roleDetailTargetId,
          targetName: `${role.name} · ${state.name}`,
          visualStateId: state.id,
          imageModel: this.imageModel,
          prompt: finalPrompt,
          referenceMode: "role-base",
          archive: {
            title: `${role.name} · ${state.name}`,
            roleId: this.roleDetailTargetId,
            roleName: role.name,
            stateId: state.id,
            stateName: state.name,
            emotion: state.emotion,
            action: state.action,
            appearance: role.appearance || "",
            capturedAt: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.job?.id) {
        throw new Error(result.detail || result.error || "动作图任务创建失败");
      }
      this.$set(state, "imageJobId", result.job.id);
      this.$set(state, "imageUrl", "");
      if (!silent) this.showToast(`${state.name}已加入后台队列`);
      return true;
    },
    async generateVisualState(state) {
      if (!this.currentImageKeyConfigured) {
        this.showToast("请先验证图片接口并选择模型");
        return;
      }
      if (!this.selectedRoleVisualBaseUrl) {
        this.showToast("请先生成、导入或确认角色基底图");
        return;
      }
      try {
        await this.submitVisualStateJob(state);
        await this.saveSettings();
        await this.pollImageJobs();
      } catch (error) {
        this.showToast(String(error?.message || "动作图任务创建失败").slice(0, 48));
      }
    },
    async generateSelectedVisualStates() {
      if (!this.selectedRoleVisualBaseUrl) {
        this.showToast("请先确认角色基底图，再批量生成动作");
        return;
      }
      const states = this.selectedRoleVisualStates.filter((state) =>
        state.enabled !== false && state.selected && !this.visualStateJob(state)
      );
      if (!states.length || this.visualBatchSubmitting) return;
      const estimated = (states.length * 0.03).toFixed(2);
      if (!window.confirm(`将为${this.selectedRole.name}生成 ${states.length} 张动作图，按每张约 0.03 元估算约 ${estimated} 元。最多同时生成 6 张，超出的任务自动排队，确认继续吗？`)) return;
      this.visualBatchSubmitting = true;
      let submitted = 0;
      try {
        for (const state of states) {
          if (await this.submitVisualStateJob(state, true)) submitted += 1;
        }
        await this.saveSettings();
        await this.pollImageJobs();
        this.showToast(`已加入 ${submitted} 张动作图，最多 6 张正在同时生成`);
      } catch (error) {
        await this.saveSettings().catch(() => {});
        this.showToast(`已加入 ${submitted} 张，随后失败：${String(error?.message || "").slice(0, 24)}`);
      } finally {
        this.visualBatchSubmitting = false;
      }
    },
    async saveVisualLibrary() {
      if (!this.selectedRole) return;
      this.normalizeVisualLibrary(this.selectedRole);
      await this.saveSettings()
        .then(() => this.showToast(`${this.selectedRole.name}的动作图库已保存`))
        .catch(() => this.showToast("动作图库保存失败"));
    },
    openBackgroundComposer() {
      this.backgroundComposerOpen = true;
    },
    async prepareStageBackground() {
      if (this.backgroundPromptPreparing || this.backgroundGenerating) return;
      this.backgroundPromptPreparing = true;
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare-background",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatModel,
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            messages: this.messages
              .filter((message) => !message.typing && message.content)
              .slice(-10)
              .map(({ role, speaker, content }) => ({ role, speaker, content })),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "背景提示词整理失败");
        }
        const value = String(result.prompt).slice(0, 1200);
        this.openAiProposal({
          type: "background-prompt",
          title: "舞台背景提示词差异预览",
          fields: [{ key: "prompt", label: "背景提示词", before: this.stageBackground.prompt, after: value }],
          payload: { value },
        });
      } catch (error) {
        this.showToast(String(error?.message || "背景提示词整理失败").slice(0, 48));
      } finally {
        this.backgroundPromptPreparing = false;
      }
    },
    async uploadStageBackground(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.stageBackground.imageUrl = imageUrl;
        this.stageBackground.imageJobId = "";
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.showToast("本地背景已导入，不产生生图费用");
      } catch (error) {
        this.showToast(String(error?.message || "背景图片读取失败"));
      } finally {
        event.target.value = "";
      }
    },
    async clearStageBackground() {
      this.stageBackground.imageUrl = "";
      this.stageBackground.imageJobId = "";
      this.stageBackground.prompt = "";
      await this.saveSettings().catch(() => {});
      this.showToast("对话舞台背景已清空");
    },
    async generateStageBackground() {
      const prompt = this.stageBackground.prompt.trim();
      if (this.backgroundGenerating || prompt.length < 20) return;
      if (!window.confirm("这会调用一次付费图片生成接口，按当前价格预计约 0.03 元。确认生成这个背景吗？")) return;
      this.backgroundGenerating = true;
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "stage-background",
            targetName: "当前对话舞台背景",
            imageModel: this.imageModel,
            prompt,
            archive: {
              title: "对话舞台背景",
              scene: prompt,
              eventSummary: "由用户主动选择生成，用于与本地角色立绘前端组合。",
              capturedAt: new Date().toISOString(),
            },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "背景任务创建失败");
        }
        this.stageBackground.imageJobId = result.job.id;
        this.stageBackground.imageUrl = "";
        await this.saveSettings();
        await this.pollImageJobs();
        this.showToast("背景已加入后台队列，请保持页面打开");
      } catch (error) {
        this.showToast(String(error?.message || "背景任务创建失败").slice(0, 48));
      } finally {
        this.backgroundGenerating = false;
      }
    },
    preloadImageUrl(url) {
      if (!url || this.preloadedVisualUrls.includes(url)) return;
      const image = new Image();
      image.src = url;
      this.preloadedVisualUrls.push(url);
      this.preloadedVisualUrls = this.preloadedVisualUrls.slice(-96);
    },
    preloadRoleVisuals(role) {
      if (!role) return;
      const states = this.normalizeVisualLibrary(role);
      states
        .filter((state) => state.id === this.stageStateId || state.id === role.visualDefaultStateId)
        .slice(0, 2)
        .map((state) => this.visualStateImage(state))
        .filter(Boolean)
        .forEach((url) => this.preloadImageUrl(url));
    },
    matchVisualState(role, cue = {}) {
      if (!role || role.visualEnabled === false) return null;
      const states = this.normalizeVisualLibrary(role).filter((state) => state.enabled !== false);
      if (!states.length) return null;
      const visual = cue.visual && typeof cue.visual === "object" ? cue.visual : {};
      const preferred = String(visual.preferredStateId || cue.preferredStateId || "");
      const emotion = String(visual.emotion || cue.mood || "").toLowerCase();
      const action = String(visual.action || cue.action || "").toLowerCase();
      const content = String(cue.content || "").toLowerCase();
      return states
        .map((state) => {
          let score = state.id === preferred ? 120 : 0;
          if (emotion && state.emotion.toLowerCase() === emotion) score += 36;
          if (action && state.action.toLowerCase() === action) score += 42;
          if (content.includes(state.name)) score += 24;
          for (const tag of state.tags || []) {
            if (tag && (emotion.includes(tag) || action.includes(tag) || content.includes(tag))) score += 8;
          }
          if (state.id === role.visualDefaultStateId) score += 2;
          if (this.visualStateImage(state)) score += 1;
          return { state, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.state || states[0];
    },
    inferVisualCue(message) {
      if (message?.visual) return message;
      const text = `${message?.mood || ""} ${message?.action || ""} ${message?.content || ""}`;
      const mappings = [
        [/撒娇|求抱|黏|衣角/, ["coquettish", "hold_sleeve", "coquettish_sleeve"]],
        [/嫌弃|白眼|不屑/, ["disdain", "arms_crossed", "disdain_arms_crossed"]],
        [/坏笑|调皮|狡黠/, ["mischievous", "lean_close", "mischievous_grin"]],
        [/困|哈欠|睡眼/, ["sleepy", "yawn", "sleepy_yawn"]],
        [/牵手|拉住.*手/, ["affectionate", "hold_hands", "hold_hands_close"]],
        [/警戒|戒备|危险|脚步声/, ["alert", "scan", "alert_scan"]],
        [/施法|法则|魔力|神力/, ["focused", "cast_spell", "cast_spell"]],
        [/生气|愤怒/, ["angry", "hands_hips", "angry_hands_hips"]],
        [/伤心|流泪|哭/, ["sad", "wipe_tears", "sad_wipe_tears"]],
        [/开心|笑|庆祝/, ["happy", "cheer", "excited_cheer"]],
        [/害羞|脸红/, ["shy", "look_away", "shy_lookaway"]],
        [/害怕|躲到|缩在/, ["afraid", "hide", "afraid_hide"]],
      ];
      const match = mappings.find(([pattern]) => pattern.test(text));
      return {
        ...message,
        visual: match
          ? { emotion: match[1], action: match[2], preferredStateId: match[3], intensity: 0.65 }
          : { emotion: "neutral", action: "idle", preferredStateId: "idle_neutral", intensity: 0.4 },
      };
    },
    replayMessageVisual(message) {
      if (!this.standaloneMode || message?.role !== "assistant" || message?.typing) return;
      this.applyStageCue({
        ...message,
        speaker: message.speaker || this.profile.name,
      }, true);
    },
    replayCurrentStageVisual() {
      if (!this.standaloneMode || !this.stageSpeaker) return;
      this.applyStageCue({
        role: "assistant",
        speaker: this.stageSpeaker,
        visual: {
          preferredStateId: this.stageStateId,
          emotion: this.stageEmotion,
          action: this.stageAction,
          intensity: this.stageIntensity,
        },
      }, true);
    },
    clearStageVisualSequence() {
      this.stageSequenceTimers.forEach((timer) => window.clearTimeout(timer));
      this.stageSequenceTimers = [];
    },
    async applyStageCue(message, forceReplay = false, sequenceFrame = false) {
      if (!this.motionDisplayEnabled || !this.standaloneMode || !message?.speaker) return;
      const sequence = Array.isArray(message.visual?.sequence)
        ? message.visual.sequence.slice(0, 4)
        : [];
      if (!sequenceFrame && sequence.length > 1) {
        this.clearStageVisualSequence();
        let elapsed = 0;
        sequence.forEach((frame, index) => {
          const durationMs = Math.min(2600, Math.max(700, Number(frame?.durationMs) || 1200));
          const play = () => this.applyStageCue({
            ...message,
            visual: { ...message.visual, ...frame, sequence: [] },
          }, forceReplay || index > 0, true);
          if (index === 0) play();
          else this.stageSequenceTimers.push(window.setTimeout(play, elapsed));
          elapsed += durationMs;
        });
        return;
      }
      const record = this.roleRecordByName(message.speaker);
      if (!record) return;
      const cue = this.inferVisualCue(message);
      const state = this.matchVisualState(record.role, cue);
      const previousRoleId = this.stageRoleId;
      const url = state
        ? this.visualStateImage(state)
        : record.role.visualEnabled === false
          ? record.role.avatarUrl || ""
          : "";
      this.stageSpeaker = record.role.name;
      this.stageRoleId = record.id;
      this.stageStateId = state?.id || "";
      this.stageEmotion = cue.visual?.emotion || cue.mood || state?.emotion || "neutral";
      this.stageAction = cue.visual?.action || cue.action || state?.action || "idle";
      this.stageIntensity = Math.min(1, Math.max(0, Number(cue.visual?.intensity) || 0.45));
      this.preloadRoleVisuals(record.role);
      if (!url) {
        if (previousRoleId !== record.id) {
          this.stageLayers = [{ url: "" }, { url: "" }];
          this.stageActiveLayer = 0;
        }
        return;
      }
      if (url === this.stageImageUrl) {
        if (forceReplay) this.stageMotionNonce += 1;
        return;
      }
      this.preloadImageUrl(url);
      const inactive = this.stageActiveLayer === 0 ? 1 : 0;
      this.$set(this.stageLayers, inactive, { url });
      await this.$nextTick();
      window.clearTimeout(this.stageTransitionTimer);
      if (forceReplay) this.stageMotionNonce += 1;
      this.stageActiveLayer = inactive;
      this.stageTransitionTimer = window.setTimeout(() => {
        const old = inactive === 0 ? 1 : 0;
        this.$set(this.stageLayers, old, { url: "" });
      }, 420);
    },
    roleHistoryContext(name) {
      const relatedIndexes = new Set();
      this.messages.forEach((message, index) => {
        if (
          !message.typing
          && typeof message.content === "string"
          && (message.speaker === name || message.content.includes(name))
        ) {
          relatedIndexes.add(index);
          if (index > 0) relatedIndexes.add(index - 1);
          if (index + 1 < this.messages.length) relatedIndexes.add(index + 1);
        }
      });
      return this.messages
        .filter((message, index) =>
          relatedIndexes.has(index)
          && !message.typing
          && (message.role === "user" || message.role === "assistant")
          && typeof message.content === "string"
          && message.content.trim()
        )
        .slice(-30)
        .map(({ role, content, speaker }) => ({ role, content, speaker }));
    },
    openAiProposal({ type, title, targetId = "", fields = [], payload = {} }) {
      const normalizedFields = fields
        .filter((field) => String(field?.after ?? "") !== String(field?.before ?? ""))
        .map((field) => ({
          key: String(field.key || ""),
          label: String(field.label || field.key || "内容"),
          before: String(field.before ?? ""),
          after: String(field.after ?? ""),
          selected: field.selected !== false,
        }));
      if (!normalizedFields.length) {
        this.showToast("AI 返回内容与当前内容没有差异");
        return false;
      }
      this.aiProposalView = "after";
      this.aiProposal = { type, title, targetId, fields: normalizedFields, payload };
      return true;
    },
    cancelAiProposal() {
      this.aiProposal = null;
    },
    async confirmAiProposal() {
      const proposal = this.aiProposal;
      if (!proposal) return;
      const selected = new Set(proposal.fields.filter((field) => field.selected).map((field) => field.key));
      try {
        if (proposal.type === "role") {
          const role = this.roleById(proposal.targetId);
          const generated = proposal.payload.generated || {};
          if (!role) throw new Error("角色已经不存在");
          for (const key of ["name", "gender", "relation", "prompt", "appearance", "personality", "age"]) {
            if (!selected.has(key) || generated[key] === undefined) continue;
            role[key] = key === "age" ? Number(generated[key]) || role[key] : String(generated[key]);
          }
          if (generated.derivedProfile && selected.size) {
            role.derivedProfile = {
              ...generated.derivedProfile,
              anchorStoryDay: Math.max(1, Number(generated.derivedProfile.anchorStoryDay) || this.storyClock.day),
              sourcePromptHash: compactTextHash(`${role.prompt || ""}\n${role.appearance || ""}`),
              updatedAt: new Date().toISOString(),
            };
          }
          if (selected.size) {
            role.worldVersion = this.worldVersion;
            if (proposal.targetId === "primary") this.worldSyncPending = false;
          }
          this.roleAiInstruction = "";
        } else if (proposal.type === "world" && selected.has("worldSetting")) {
          this.worldSetting = proposal.payload.value;
          this.registerWorldRevision();
        } else if (proposal.type === "scene-prompt" && selected.has("imagePrompt")) {
          this.imagePrompt = proposal.payload.value;
          this.imageModel = proposal.payload.model || this.imageModel;
        } else if (proposal.type === "character-prompt" && selected.has("imagePrompt")) {
          const role = this.roleById(proposal.targetId);
          if (!role) throw new Error("角色已经不存在");
          role.imagePrompt = proposal.payload.value;
          this.characterPrompt = proposal.payload.value;
          this.imageModel = proposal.payload.model || this.imageModel;
        } else if (proposal.type === "background-prompt" && selected.has("prompt")) {
          this.stageBackground.prompt = proposal.payload.value;
        }
        this.aiProposal = null;
        this.persist();
        await this.saveSettings();
        this.showToast("已应用并保存所选 AI 修改");
      } catch (error) {
        this.showToast(String(error?.message || "AI 修改保存失败").slice(0, 48));
      }
    },
    async generateRoleSetting(mode = "all") {
      const role = this.selectedRole;
      if (!role || this.roleProfileGenerating) return;
      if (this.roleProfileGenerationIds.includes(this.roleDetailTargetId)) {
        this.showToast("新角色档案正在自动生成，请稍等片刻");
        return;
      }
      this.roleProfileGenerating = true;
      try {
        const generated = await this.generateRoleProfileFor(role, mode, this.roleDetailTargetId, this.roleAiInstruction, false);
        const label = mode === "prompt"
          ? "人物提示词"
          : mode === "appearance"
          ? "稳定外观"
          : "完整档案";
        const fields = [];
        if (mode === "all") {
          fields.push(
            { key: "name", label: "名字", before: role.name, after: generated.name },
            { key: "gender", label: "性别", before: role.gender, after: generated.gender },
            { key: "relation", label: "关系", before: role.relation, after: generated.relation },
            { key: "personality", label: "核心性格", before: role.personality, after: generated.personality || generated.derivedProfile?.corePersonality },
            { key: "age", label: "资料年龄", before: role.age, after: generated.age || generated.derivedProfile?.initialActualAge },
          );
        }
        if (mode === "all" || mode === "prompt") fields.push({ key: "prompt", label: "人物提示词", before: role.prompt, after: generated.prompt });
        if (mode === "all" || mode === "appearance") fields.push({ key: "appearance", label: "稳定外观", before: role.appearance, after: generated.appearance });
        this.openAiProposal({
          type: "role",
          title: `${role.name} · ${label}差异预览`,
          targetId: this.roleDetailTargetId,
          fields,
          payload: { generated },
        });
      } catch (error) {
        const rawDetail = error instanceof Error ? error.message : "角色设定生成失败";
        const isBusy = /503|too busy|service_unavailable|429|繁忙/.test(rawDetail);
        const detail = isBusy ? "上游模型服务繁忙，已自动重试仍失败，请稍后再试或更换模型" : rawDetail;
        this.showToast(detail.length > 42 ? "角色设定生成失败，请检查对话模型" : detail);
      } finally {
        this.roleProfileGenerating = false;
      }
    },
    async generateRoleProfileFor(role, mode = "all", roleId = role?.id || "", instruction = "", applyResult = true) {
      if (!role) throw new Error("角色不存在");
      const response = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: this.chatProvider,
          model: this.chatModel,
          roleId,
          role,
          instruction: String(instruction || "").trim().slice(0, 1000),
          roleMemory: this.roleMemories?.[roleId] || null,
          messages: this.roleHistoryContext(role.name),
          storySummary: this.storySummary,
          worldSetting: this.worldSetting,
          storyClock: this.storyClock,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.role?.prompt || !result.role?.appearance) {
        throw new Error(result.detail || result.error || "角色设定生成失败");
      }
      const generated = result.role;
      if (!applyResult) return generated;
      if (mode === "all") {
        const isTemporary = this.ensemble.temporaryRoles.some((item) => item.id === roleId);
        if (!isTemporary && generated.name) role.name = generated.name.slice(0, 20);
        role.gender = ["女性", "男性", "非二元", "未指定"].includes(generated.gender)
          ? generated.gender
          : role.gender || "未指定";
        role.relation = String(generated.relation || role.relation || "").slice(0, 80);
      }
      if (generated.derivedProfile && typeof generated.derivedProfile === "object") {
        role.derivedProfile = {
          ...generated.derivedProfile,
          anchorStoryDay: Math.max(1, Number(generated.derivedProfile.anchorStoryDay) || this.storyClock.day),
          sourcePromptHash: compactTextHash(`${generated.prompt || role.prompt || ""}\n${generated.appearance || role.appearance || ""}`),
          updatedAt: new Date().toISOString(),
        };
        role.age = Number(generated.derivedProfile.initialActualAge) || role.age || 24;
        role.personality = String(generated.derivedProfile.corePersonality || role.personality || "").slice(0, 120);
      }
      if (mode === "all" || mode === "prompt") {
        role.prompt = String(generated.prompt || role.prompt || "").slice(0, 2000);
      }
      if (mode === "all" || mode === "appearance") {
        role.appearance = String(generated.appearance || role.appearance || "").slice(0, 2000);
      }
      await this.saveSettings();
      this.persist();
      return role;
    },
    async autoGenerateTemporaryRoles(roleIds) {
      for (const roleId of [...new Set(roleIds || [])]) {
        if (this.roleProfileGenerationIds.includes(roleId)) continue;
        const role = this.ensemble.temporaryRoles.find((item) => item.id === roleId);
        if (!role) continue;
        this.roleProfileGenerationIds.push(roleId);
        try {
          await this.generateRoleProfileFor(role, "all", roleId);
          this.showToast(`新角色「${role.name}」的档案已根据登场剧情自动生成`);
        } catch {
          this.showToast(`已建立「${role.name}」的临时档案，可稍后用 AI 继续完善`);
        } finally {
          this.roleProfileGenerationIds = this.roleProfileGenerationIds.filter((id) => id !== roleId);
        }
      }
    },
    promoteSelectedTemporaryRole() {
      const role = this.selectedRole;
      if (!role || !this.selectedRoleIsTemporary || this.ensemble.customRoles.length >= 30) return;
      const temporaryIndex = this.ensemble.temporaryRoles.findIndex((item) => item.id === role.id);
      if (temporaryIndex < 0) return;
      const fixedRole = {
        ...role,
        id: `role-${Date.now()}-${this.ensemble.customRoles.length + 1}`,
      };
      if (this.roleMemories[role.id]) {
        this.$set(this.roleMemories, fixedRole.id, {
          ...this.roleMemories[role.id],
          name: fixedRole.name,
        });
        this.$delete(this.roleMemories, role.id);
      }
      this.ensemble.temporaryRoles.splice(temporaryIndex, 1);
      this.ensemble.customRoles.push(fixedRole);
      this.roleDetailTargetId = fixedRole.id;
      this.ensemble.enabled = true;
      this.saveSettings().then(() => this.showToast(`已将「${fixedRole.name}」加入固定角色库`))
        .catch(() => this.showToast("加入固定角色库失败"));
    },
    generateSavedCharacterImage() {
      const role = this.selectedRole;
      if (!role?.imagePrompt?.trim()) return;
      this.characterTargetId = this.roleDetailTargetId;
      this.characterPrompt = role.imagePrompt.trim().slice(0, 1200);
      this.generateCharacterImage();
    },
    pickRoleReferenceImage(item) {
      this.selectedRoleReferenceImage = {
        imageUrl: String(item?.imageUrl || ""),
        jobId: String(item?.id || ""),
      };
      this.roleReferencePickerOpen = false;
    },
    openPromptSection(section = "") {
      this.settingsOpen = false;
      this.roleDetailOpen = false;
      this.promptSection = section;
      this.mobileTab = "prompt";
      this.$nextTick(() => {
        const target = section === "world"
          ? this.$refs.worldEditor
          : section === "memory"
          ? this.$refs.memoryEditor
          : section === "roles"
          ? this.$refs.roleEditor
          : null;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    openSetupReminder() {
      if (!this.directApiMode) return;
      if (!this.onboardingCompleted) {
        this.settingsOpen = true;
        return;
      }
      if (String(this.worldSetting || "").trim().length < 60) {
        this.openPromptSection("world");
        return;
      }
      if (!String(this.profile?.name || "").trim() || !String(this.profile?.prompt || "").trim()) {
        this.openPromptSection("roles");
        return;
      }
      if (!this.storyInitialized) {
        this.switchMobileTab("chat");
        if (this.chatApiMode === "configured" && this.chatConnectionVerified) {
          this.showToast("正在为你生成开场…");
          void this.initializeStoryOpening();
        } else {
          this.settingsOpen = true;
        }
      }
    },
    dismissSetupReminder() {
      if (!this.directApiMode) return;
      this.storyInitialized = true;
      this.persist();
      this.saveSettings().catch(() => this.showToast("剧情提醒关闭失败"));
      this.showToast("已关闭剧情提醒，可在需要时从菜单继续");
    },
    async generateWorldSetting() {
      if (this.worldGenerating) return;
      if (this.directApiMode && !this.chatConnectionVerified) {
        this.showToast("请先在连接步骤验证可用的对话模型");
        return;
      }
      this.worldGenerating = true;
      try {
        const response = await fetch("/api/world", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: this.chatProvider,
            model: this.chatModel,
            seed: this.worldSeed || this.worldSetting,
            existing: this.worldSetting,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.worldSetting !== "string") {
          throw new Error(result.detail || result.error || "世界设定生成失败");
        }
        const value = result.worldSetting.slice(0, 12000);
        this.openAiProposal({
          type: "world",
          title: "世界设定差异预览",
          fields: [{ key: "worldSetting", label: "世界设定", before: this.worldSetting, after: value }],
          payload: { value },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "世界设定生成失败";
        this.showToast(detail.length > 42 ? "世界设定生成失败，请检查对话模型" : detail);
      } finally {
        this.worldGenerating = false;
      }
    },
    async saveWorldSetting() {
      this.randomRoleInterval = Math.min(60, Math.max(8, Number(this.randomRoleInterval) || 18));
      this.registerWorldRevision();
      try {
        this.persist();
        await this.saveSettings();
        this.showToast(this.worldSyncPending ? "世界已保存，请选择如何适配现有人物" : "世界设定与角色加入规则已保存");
      } catch {
        this.showToast("世界设定保存失败");
      }
    },
    async saveActionStyle() {
      this.persist();
      try {
        await this.saveSettings();
        this.showToast(`主角行动倾向已设为“${this.actionStyle}”`);
      } catch {
        this.showToast("行动倾向保存失败");
      }
    },
    async pollImageJobs() {
      window.clearTimeout(this.imageJobPollTimer);
      try {
        const response = await fetch("/api/image", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];
        const failedJobs = Array.isArray(result.failedJobs)
          ? result.failedJobs
          : jobs.filter((job) => job.status === "failed");
        this.imageJobs = [...new Map([...jobs, ...failedJobs].map((job) => [job.id, job])).values()]
          .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
        this.activeImageJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
        const recentCutoff = Date.now() - 15 * 60 * 1000;
        const finished = [...jobs, ...failedJobs].filter((job) =>
          (job.status === "completed" || job.status === "failed")
          && new Date(job.updatedAt).getTime() >= recentCutoff
          && !this.notifiedImageJobIds.includes(job.id)
        );
        for (const job of finished) {
          this.notifiedImageJobIds.push(job.id);
          if (job.status === "completed") {
            if (job.kind !== "visual-state") await this.syncSettingsFromStorage(true);
            if (job.kind === "visual-state") {
              const role = this.roleById(job.targetId);
              if (role) this.preloadRoleVisuals(role);
              const latestAssistant = [...this.messages].reverse().find((message) => message.role === "assistant" && message.speaker);
              if (latestAssistant) this.applyStageCue(latestAssistant);
            }
            if (job.kind === "stage-background") {
              this.preloadImageUrl(job.imageUrl);
              this.showToast("对话舞台背景已生成并保存在本地");
            } else {
              this.showToast(`${job.targetName || "角色"}的形象已生成并保存在本地`);
            }
          } else {
            this.recordError("图片生成", job.error || "图片生成失败", {
              jobId: job.id,
              kind: job.kind,
              targetId: job.targetId,
              targetName: job.targetName,
              model: job.model || job.request?.imageModel || this.imageModel,
              attempt: job.attempt,
              maxAttempts: job.maxAttempts,
              prompt: job.failedPrompt || job.prompt,
              diagnostic: job.diagnostic || null,
            });
            this.showToast(`${job.targetName || "角色"}生图失败：${String(job.error || "请检查接口").slice(0, 28)}`);
          }
        }
        this.notifiedImageJobIds = this.notifiedImageJobIds.slice(-60);
      } catch (error) {
        this.recordError("图片任务轮询", error);
      }
      const delay = this.activeImageJobs.length ? 3500 : (this.mobileTab === "image" ? 12000 : 30000);
      this.imageJobPollTimer = window.setTimeout(() => this.pollImageJobs(), delay);
    },
    applyEnsemble(value) {
      if (!value || typeof value !== "object") return;
      this.ensemble = {
        enabled: value.enabled !== false,
        autoGuests: value.autoGuests !== false,
        maxTurns: Math.min(10, Math.max(1, Number(value.maxTurns) || 3)),
        friend: {
          ...this.ensemble.friend,
          ...(value.friend && typeof value.friend === "object" ? value.friend : {}),
          gender: ["女性", "男性", "非二元", "未指定"].includes(value.friend?.gender)
            ? value.friend.gender
            : "女性",
        },
        customRoles: Array.isArray(value.customRoles)
          ? value.customRoles.slice(0, 30).map((role, index) => ({
              id: role?.id || `role-${Date.now()}-${index}`,
              name: role?.name || `角色${index + 1}`,
              age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
              gender: ["女性", "男性", "非二元", "未指定"].includes(role?.gender) ? role.gender : "未指定",
              personality: role?.personality || "自然、友善",
              relation: role?.relation || "成年朋友",
              prompt: role?.prompt || "",
              appearance: role?.appearance || "",
              imagePrompt: role?.imagePrompt || "",
              avatarUrl: role?.avatarUrl || "",
              worldVersion: Math.max(0, Number(role?.worldVersion) || 0),
              derivedProfile: role?.derivedProfile && typeof role.derivedProfile === "object"
                ? role.derivedProfile
                : null,
              visualEnabled: role?.visualEnabled !== false,
              visualDefaultStateId: role?.visualDefaultStateId || "idle_neutral",
              visualStates: Array.isArray(role?.visualStates) ? role.visualStates : [],
              visualBaseSource: role?.visualBaseSource || "",
              visualBaseImageUrl: role?.visualBaseImageUrl || "",
              visualBaseImageJobId: role?.visualBaseImageJobId || "",
            }))
          : [],
        temporaryRoles: Array.isArray(value.temporaryRoles)
          ? value.temporaryRoles.slice(0, 80).map((role, index) => ({
              id: role?.id || `temporary-${Date.now()}-${index}`,
              name: role?.name || `临时角色${index + 1}`,
              age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
              gender: ["女性", "男性", "非二元", "未指定"].includes(role?.gender) ? role.gender : "未指定",
              personality: role?.personality || "延续对话中已经表现出的性格",
              relation: role?.relation || "场景中认识的成年角色",
              prompt: role?.prompt || "",
              appearance: role?.appearance || "",
              imagePrompt: role?.imagePrompt || "",
              avatarUrl: role?.avatarUrl || "",
              worldVersion: Math.max(0, Number(role?.worldVersion) || 0),
              derivedProfile: role?.derivedProfile && typeof role.derivedProfile === "object"
                ? role.derivedProfile
                : null,
              visualEnabled: role?.visualEnabled !== false,
              visualDefaultStateId: role?.visualDefaultStateId || "idle_neutral",
              visualStates: Array.isArray(role?.visualStates) ? role.visualStates : [],
              visualBaseSource: role?.visualBaseSource || "",
              visualBaseImageUrl: role?.visualBaseImageUrl || "",
              visualBaseImageJobId: role?.visualBaseImageJobId || "",
            }))
          : [],
      };
    },
    async syncSettingsFromStorage(force = false) {
      if (!force && (
        this.settingsOpen
        || this.roleDetailOpen
        || this.characterPromptOpen
        || this.characterPromptPreparing
        || this.characterGenerating
        || this.mobileTab === "prompt"
      )) return;
      try {
        const response = await fetch("/api/storage?scope=settings", { cache: "no-store" });
        if (!response.ok) return;
        const saved = await response.json();
        this.settingsReady = false;
        if (saved?.userProfile) this.userProfile = { ...this.userProfile, ...saved.userProfile };
        if (this.directApiMode && this.standaloneMode && typeof saved?.onboardingCompleted === "boolean") {
          this.onboardingCompleted = saved.onboardingCompleted;
        }
        if (Number.isFinite(Number(saved?.onboardingStep))) this.onboardingStep = Math.min(5, Math.max(1, Number(saved.onboardingStep)));
        if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
        if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
        if (typeof saved?.systemPrompt === "string") this.systemPrompt = saved.systemPrompt;
        if (typeof saved?.storySummary === "string") this.storySummary = saved.storySummary;
        if (saved?.storyClock) {
          this.storyClock = normalizeStoryClock(saved.storyClock);
          this.dayCount = this.storyClock.day;
        }
        if (Array.isArray(saved?.storyEvents)) this.storyEvents = normalizeStoryEvents(saved.storyEvents);
        if (saved?.roleMemories && typeof saved.roleMemories === "object") this.roleMemories = saved.roleMemories;
        if (typeof saved?.worldSetting === "string") this.worldSetting = saved.worldSetting;
        this.worldVersion = Math.max(0, Number(saved?.worldVersion) || (this.worldSetting.trim() ? 1 : 0));
        this.worldSyncPending = saved?.worldSyncPending === true;
        this.savedWorldHash = compactTextHash(this.worldSetting);
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
        this.$nextTick(() => { this.settingsReady = true; });
      } catch {}
    },
    addCustomRole() {
      if (this.ensemble.customRoles.length >= 30) return;
      const index = this.ensemble.customRoles.length + 1;
      const role = {
        id: `role-${Date.now()}-${index}`,
        name: `新角色${index}`,
        age: 24,
        gender: "未指定",
        personality: "自然、友善",
        relation: "成年朋友",
        prompt: "",
        appearance: "",
        imagePrompt: "",
        avatarUrl: "",
        worldVersion: this.worldVersion,
      };
      this.ensemble.customRoles.push(role);
      this.persist();
      this.saveSettings().catch(() => this.showToast("新角色暂未同步到本地文件"));
      this.$nextTick(() => {
        this.openRoleDetail(role.id);
        this.showToast("新角色已创建，可手动填写或交给 AI 整理");
      });
    },
    removeCustomRole(index) {
      if (!window.confirm("确认删除这个自定义角色吗？已保存的历史消息不会被删除。")) return;
      const roleId = this.ensemble.customRoles[index]?.id;
      this.ensemble.customRoles.splice(index, 1);
      if (roleId && this.roleMemories[roleId]) this.$delete(this.roleMemories, roleId);
      this.persist();
      this.saveSettings()
        .then(() => this.showToast("角色档案已删除，历史消息与已有图片仍保留"))
        .catch(() => this.showToast("角色已从当前页面移除，但本地文件同步失败"));
    },
    removeManagedRole(entry) {
      if (!entry?.canDelete) return;
      const customIndex = this.ensemble.customRoles.findIndex((role) => role.id === entry.id);
      if (customIndex >= 0) {
        this.removeCustomRole(customIndex);
        return;
      }
      const temporaryIndex = this.ensemble.temporaryRoles.findIndex((role) => role.id === entry.id);
      if (temporaryIndex < 0) return;
      if (!window.confirm("确认删除这个临时角色档案吗？已保存的历史消息和图片不会被删除。")) return;
      this.ensemble.temporaryRoles.splice(temporaryIndex, 1);
      if (this.roleMemories[entry.id]) this.$delete(this.roleMemories, entry.id);
      this.persist();
      this.saveSettings()
        .then(() => this.showToast("临时角色档案已删除"))
        .catch(() => this.showToast("角色已从当前页面移除，但本地文件同步失败"));
    },
    roleSetupStatus(role) {
      const hasPrompt = Boolean(String(role?.prompt || "").trim());
      const hasAppearance = Boolean(String(role?.appearance || "").trim());
      if (hasPrompt && hasAppearance) return "设定完整";
      if (hasPrompt || hasAppearance) return "待继续完善";
      return "尚未填写";
    },
    roleAlbumCountFor(targetId, role) {
      if (!targetId || !role) return 0;
      const urls = new Set();
      const add = (value) => {
        const url = String(value || "").trim();
        if (url) urls.add(url);
      };
      add(role.avatarUrl);
      add(role.visualBaseImageUrl);
      (Array.isArray(role.visualStates) ? role.visualStates : []).forEach((state) => add(state?.imageUrl));
      this.imageJobs
        .filter((job) =>
          job?.status === "completed"
          && job.imageUrl
          && ["character", "visual-state"].includes(job.kind)
          && (
            job.targetId === targetId
            || (!job.targetId && String(job.targetName || "").startsWith(role.name))
          )
        )
        .forEach((job) => add(job.imageUrl));
      return urls.size;
    },
    fixedRoleByName(name) {
      if (!name) return null;
      if (name === this.ensemble.friend.name) return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.name === name) || null;
    },
    temporaryRoleByName(name) {
      if (!name) return null;
      return this.ensemble.temporaryRoles.find((role) => role.name === name) || null;
    },
    roleAvatar(name) {
      return this.fixedRoleByName(name)?.avatarUrl
        || this.temporaryRoleByName(name)?.avatarUrl
        || "";
    },
    canPromoteSpeaker(name) {
      return Boolean(
        name
        && name !== this.profile.name
        && !this.fixedRoleByName(name)
        && this.ensemble.customRoles.length < 30
      );
    },
    promoteSpeaker(message) {
      const name = String(message?.speaker || "").trim();
      if (!this.canPromoteSpeaker(name)) return;
      const existingTemporary = this.temporaryRoleByName(name);
      if (existingTemporary) {
        this.roleDetailTargetId = existingTemporary.id;
        this.promoteSelectedTemporaryRole();
        return;
      }
      this.ensemble.customRoles.push({
        id: `role-${Date.now()}-${this.ensemble.customRoles.length + 1}`,
        name,
        age: 24,
        gender: "未指定",
        personality: "延续首次登场时表现出的性格",
        relation: "场景中认识的成年角色",
        prompt: `保持“${name}”在首次登场时的身份、说话方式和行为逻辑。参考首次片段：${String(message.content || "").slice(0, 700)}`,
        appearance: "根据首次登场片段延续稳定外观；请在设置中补充发型、五官、体态和穿搭。",
        imagePrompt: "",
        avatarUrl: "",
        worldVersion: this.worldVersion,
      });
      this.ensemble.enabled = true;
      this.showToast(`已将「${name}」加入固定角色库`);
    },
    persist() {
      try {
        const compactRole = (role) => {
          const { visualStates, visualBaseImageUrl, ...rest } = role || {};
          return {
            ...rest,
            visualStateCount: Array.isArray(visualStates) ? visualStates.length : 0,
          };
        };
        localStorage.setItem("night-mailbox-state", JSON.stringify({
          onboardingStep: this.onboardingStep,
          worldVersion: this.worldVersion,
          worldSyncPending: this.worldSyncPending,
          userProfile: this.userProfile,
          profile: compactRole(this.profile),
          ensemble: {
            ...this.ensemble,
            friend: compactRole(this.ensemble.friend),
            customRoles: this.ensemble.customRoles.map(compactRole),
            temporaryRoles: this.ensemble.temporaryRoles.map(compactRole),
          },
          tasks: this.tasks,
          chatProvider: this.chatProvider,
          chatModel: this.chatModel,
          imageModel: this.imageModel,
          imageEnabled: this.imageEnabled,
          imageQuality: this.imageQuality,
          imagePrompt: this.imagePrompt,
          suggestions: this.suggestions,
          nextGuestAt: this.nextGuestAt,
          actionStyle: this.actionStyle,
          storyClock: this.storyClock,
          storyEvents: this.storyEvents,
        }));
      } catch {
        this.showToast("界面偏好保存失败");
      }
    },
    async saveHistory() {
      const roleIdsByName = new Map([
        [this.profile.name, "primary"],
        [this.ensemble.friend.name, "friend"],
        ...this.ensemble.customRoles.map((role) => [role.name, role.id]),
        ...this.ensemble.temporaryRoles.map((role) => [role.name, role.id]),
      ]);
      const messages = this.messages
        .filter((message) => !message.typing && typeof message.content === "string" && message.content.trim())
        .slice(-1000)
        .map((message) => {
          if (!message.createdAt) this.$set(message, "createdAt", new Date(Number(message.id) || Date.now()).toISOString());
          if (!message.storyDay) this.$set(message, "storyDay", this.storyClock.day);
          if (!message.storySegment) this.$set(message, "storySegment", this.storyClock.segment);
          if (!message.speakerId) {
            this.$set(message, "speakerId", message.role === "user"
              ? "user"
              : roleIdsByName.get(message.speaker || this.profile.name) || "");
          }
          const {
            id,
            role,
            content,
            speaker,
            speakerId,
            time,
            createdAt,
            storyDay,
            storySegment,
            imageUrl,
            imageModel,
            imageQuality,
            mood,
            action,
            visual,
          } = message;
          return {
            id,
            role,
            content,
            speaker,
            speakerId,
            time,
            createdAt,
            storyDay,
            storySegment,
            imageUrl,
            imageModel,
            imageQuality,
            mood,
            action,
            visual,
          };
        });
      const response = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "history", messages }),
      });
      if (!response.ok) throw new Error("history save failed");
    },
    showToast(text, autoLog = true) {
      if (autoLog && /失败|错误|不可用|未连接|没有连通|超时|中断/.test(String(text || ""))) {
        this.recordError("界面提示", text, { page: this.mobileTab });
      }
      this.toast = text;
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => { this.toast = ""; }, 2400);
    },
    scrollBottom() {
      this.$nextTick(() => {
        if (this.$refs.messages) this.$refs.messages.scrollTop = this.$refs.messages.scrollHeight;
      });
    },
    loadEarlierMessages() {
      const container = this.$refs.messages;
      if (!container || !this.hiddenEarlierMessageCount) return;
      const previousHeight = container.scrollHeight;
      const previousTop = container.scrollTop;
      this.messageDisplayLimit = Math.min(
        this.messages.length,
        this.messageDisplayLimit + this.messageDisplayBatch
      );
      this.$nextTick(() => {
        const addedHeight = container.scrollHeight - previousHeight;
        container.scrollTop = previousTop + Math.max(0, addedHeight);
      });
    },
    scrollToMessage(messageId) {
      if (!messageId) return;
      const messageIndex = this.messages.findIndex((message) => message.id === messageId);
      if (messageIndex >= 0) {
        this.messageDisplayLimit = Math.max(
          this.messageDisplayLimit,
          this.messages.length - messageIndex
        );
      }
      this.$nextTick(() => {
        const container = this.$refs.messages;
        const target = container?.querySelector(`[data-message-id="${messageId}"]`);
        if (!container || !target) return;
        container.scrollTop = Math.max(0, target.offsetTop - 12);
      });
    },
    quickSend(text) {
      if (this.sending || this.summarizing || this.suggestionsLoading || this.editingMessageId !== null) return;
      this.draft = text;
      this.suggestionsVisible = false;
      this.$nextTick(() => this.$el.querySelector(".composer textarea")?.focus());
    },
    requestSuggestions() {
      if (this.suggestionsLoading || this.sending || this.summarizing || this.ensemblePlaying || this.editingMessageId !== null) return;
      this.suggestionsVisible = true;
      this.suggestions = [];
      this.refreshSuggestions(this.chatProvider);
    },
    dismissSuggestions() {
      this.suggestionRequestId += 1;
      this.suggestionsLoading = false;
      this.suggestionsVisible = false;
      this.suggestions = [];
    },
    startEditMessage(message) {
      if (this.sending || message?.role !== "user") return;
      this.editingMessageId = message.id;
      this.editingMessageContent = message.content;
      this.$nextTick(() => {
        const editor = this.$el.querySelector(".message-editor textarea");
        if (editor) {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
        }
      });
    },
    cancelEditMessage() {
      this.editingMessageId = null;
      this.editingMessageContent = "";
    },
    submitEditedMessage(message) {
      const content = this.editingMessageContent.trim();
      if (!content || this.sending || message?.role !== "user") return;
      const messageIndex = this.messages.findIndex((item) => item.id === message.id);
      if (messageIndex < 0) {
        this.cancelEditMessage();
        return;
      }
      this.suggestionRequestId += 1;
      window.clearTimeout(this.suggestionRefreshTimer);
      this.suggestionsLoading = false;
      this.messages = this.messages.slice(0, messageIndex);
      this.cancelEditMessage();
      this.draft = content;
      this.persist();
      this.sendMessage();
    },
    async refreshSuggestions(provider = this.chatProvider, style = "") {
      const requestId = ++this.suggestionRequestId;
      this.suggestionsLoading = true;
      try {
        const contextMessages = this.messages
          .filter((item) => !item.typing && typeof item.content === "string" && item.content.trim())
          .slice(-8)
          .map(({ role, content, speaker }) => ({ role, content, speaker }));
        const response = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: this.chatModel,
            userProfile: this.userProfile,
            profile: this.profile,
            ensemble: this.ensemble,
            storySummary: this.storySummary,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            worldSetting: this.worldSetting,
            actionStyle: this.actionStyle,
            style,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.suggestions) || result.suggestions.length !== 3) {
          throw new Error("suggestions unavailable");
        }
        if (requestId === this.suggestionRequestId) {
          this.suggestions = result.suggestions;
          this.currentSuggestionStyle = style;
        }
      } catch {
        if (requestId === this.suggestionRequestId) {
          this.suggestions = ["追问刚才被回避的细节", "提议去线索指向的地点看看", "从现场物品中找一个可验证的证据"];
        }
      } finally {
        if (requestId === this.suggestionRequestId) {
          this.suggestionsLoading = false;
          this.persist();
        }
      }
    },
    rerollSuggestions() {
      if (this.suggestionsLoading || this.sending || this.summarizing || this.ensemblePlaying || this.editingMessageId !== null) return;
      const styles = ["冒险", "保守", "幽默"];
      const style = styles[Math.floor(Math.random() * styles.length)];
      this.refreshSuggestions(this.chatProvider, style);
    },
    imageQualityLabel(quality) {
      return { low: "低质量", medium: "中质量", high: "高质量", standard: "标准质量" }[quality] || "场景图";
    },
    formatImageJobElapsed(job) {
      const started = new Date(job?.startedAt || job?.createdAt || 0).getTime();
      const ended = job?.status === "completed" || job?.status === "failed"
        ? new Date(job.updatedAt || Date.now()).getTime()
        : Date.now();
      if (!Number.isFinite(started) || started <= 0) return "";
      const seconds = Math.max(0, Math.round((ended - started) / 1000));
      if (seconds < 60) return `${seconds} 秒`;
      return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    },
    friendlyImageJobError(job) {
      const detail = String(job?.error || job?.statusMessage || "图片生成失败");
      if (/timeout|超时|timed out|abort/i.test(detail)) return "网络响应超时，请检查连接后手动重试";
      if (/sensitive|safety|policy|moderation|content.?filter|违规|敏感|审核/i.test(detail)) return "提示词可能包含接口不接受的内容，请修改后重试";
      if (/401|403|unauthorized|forbidden|权限|余额|quota|credit|billing/i.test(detail)) return "当前密钥可能无图片权限或余额不足，请检查接口账户";
      if (/429|rate.?limit|频繁|限流/i.test(detail)) return "接口请求过于频繁，请稍后手动重试";
      if (/model|模型.*(?:不存在|不可用)|not found/i.test(detail)) return "所选图片模型当前不可用，请重新选择模型";
      if (/network|fetch|连接|dns/i.test(detail)) return "网络连接失败，请检查 API 地址和当前网络";
      return `生成失败：${detail.replace(/\s+/g, " ").slice(0, 120)}`;
    },
    imageJobStatusText(job) {
      const elapsed = this.formatImageJobElapsed(job);
      if (job?.status === "queued") return `等待开始${elapsed ? ` · 已等待 ${elapsed}` : ""}`;
      if (job?.status === "running") return `正在生成图片，通常需要 1–2 分钟${elapsed ? ` · 已用时 ${elapsed}` : ""}`;
      if (job?.status === "failed") return this.friendlyImageJobError(job);
      if (job?.status === "completed") return `生成完成并已保存${elapsed ? ` · 用时 ${elapsed}` : ""}`;
      return String(job?.statusMessage || "等待任务状态");
    },
    imageJobTitle(job) {
      if (!job || job?.status !== "failed") {
        return job?.archive?.title || job?.targetName || (this.isCharacterAlbumItem(job) ? "角色形象" : "当前剧情场景");
      }
      if (String(job?.targetName || "").trim()) return String(job.targetName).slice(0, 40);
      const promptSummary = String(job?.prompt || "").replace(/\s+/g, " ").trim().slice(0, 40);
      return promptSummary || "生成失败";
    },
    async retryImageJob(job) {
      if (!job?.request || job.status !== "failed") {
        this.showToast("这条旧记录缺少重试参数，请重新整理提示词后生成");
        return;
      }
      if (!window.confirm("重试会重新调用一次可能收费的图片接口，不会自动重复提交。确认继续吗？")) return;
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...job.request, action: "generate-async", enabled: true }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) throw new Error(result.error || "重试任务创建失败");
        await this.pollImageJobs();
        this.showToast("已创建一次新的图片任务，正在等待生成");
      } catch (error) {
        this.showToast(String(error?.message || "重试任务创建失败").slice(0, 48));
      }
    },
    narrativeSection(content, label) {
      const match = String(content || "").match(
        new RegExp(`【${label}(?:：|:)?([^】]*)】\\s*([\\s\\S]*?)(?=\\n\\s*【|$)`),
      );
      if (!match) return "";
      return [match[1], match[2]]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    },
    sceneArchiveSnapshot() {
      const isFailedReply = (message) =>
        message.role === "assistant"
        && /^(?:本轮请求失败|请求失败|对话接口 \d+)/.test(String(message.content || "").trim());
      const recent = this.messages
        .filter((message) =>
          !message.typing
          && (message.role === "user" || message.role === "assistant")
          && typeof message.content === "string"
          && message.content.trim()
          && !isFailedReply(message)
        )
        .slice(-8);
      const latestAssistant = [...recent].reverse().find((message) => message.role === "assistant");
      const latestUser = [...recent].reverse().find((message) => message.role === "user");
      const scene = this.narrativeSection(latestAssistant?.content, "场景")
        || String(latestAssistant?.content || "").replace(/\s+/g, " ").slice(0, 180)
        || "当前剧情场景";
      const action = this.narrativeSection(latestAssistant?.content, "动作");
      const dialogue = this.narrativeSection(latestAssistant?.content, "对话");
      const progression = this.narrativeSection(latestAssistant?.content, "剧情推进");
      const eventSummary = [
        latestUser?.content ? `用户刚刚：${latestUser.content.replace(/\s+/g, " ").trim()}` : "",
        action ? `正在发生：${action}` : "",
        dialogue ? `角色回应：${dialogue}` : "",
        progression ? `剧情进展：${progression}` : "",
      ].filter(Boolean).join("\n");
      const participants = [...new Set([
        this.profile.name,
        ...recent.filter((message) => message.role === "assistant" && message.speaker)
          .map((message) => message.speaker),
      ].filter(Boolean))];
      return {
        type: "scene",
        title: scene.slice(0, 80),
        scene: scene.slice(0, 800),
        eventSummary: (eventSummary || String(latestAssistant?.content || "").trim()).slice(0, 3000),
        contextSnapshot: recent.map((message) =>
          `${message.role === "user" ? "用户" : message.speaker || this.profile.name}：${message.content.trim().slice(0, 1200)}`
        ).join("\n\n").slice(0, 8000),
        participants,
        capturedAt: new Date().toISOString(),
      };
    },
    characterArchiveSnapshot(role) {
      return {
        type: "character",
        title: `${role.name}的人物形象`,
        characterId: this.characterTargetId,
        name: role.name,
        age: role.age,
        gender: role.gender || "未指定",
        relation: role.relation,
        personality: role.personality,
        introduction: role.prompt || `${role.name}是${role.relation || "当前剧情中的角色"}，性格${role.personality || "自然鲜明"}。`,
        appearance: role.appearance || role.imagePrompt || "",
        capturedAt: new Date().toISOString(),
      };
    },
    async resolveGalleryPreviewSource(imageUrl) {
      const source = String(imageUrl || "").trim();
      if (!source) throw new Error("图片地址为空");
      if (/^(?:data:|blob:|https?:)/i.test(source)) return source;
      if (window.__NIGHT_MAILBOX_NATIVE_IMAGE__?.resolvePreviewSource) {
        return window.__NIGHT_MAILBOX_NATIVE_IMAGE__.resolvePreviewSource(source);
      }
      const plus = window.plus;
      if (!plus?.io?.resolveLocalFileSystemURL || /^file:/i.test(source)) return source;
      return new Promise((resolve, reject) => {
        const rejectMissingFile = () => {
          reject(new Error("本地图片路径已经失效"));
        };
        plus.io.resolveLocalFileSystemURL(source, (entry) => {
          entry.file((file) => {
            const reader = new plus.io.FileReader();
            reader.onloadend = (event) => {
              const result = String(event?.target?.result || reader.result || "");
              if (result) resolve(result);
              else reject(new Error("本地图片读取结果为空"));
            };
            reader.onerror = () => reject(new Error("本地图片文件读取失败"));
            reader.readAsDataURL(file);
          }, () => reject(new Error("无法打开本地图片文件")));
        }, rejectMissingFile);
      });
    },
    async openGalleryPreview(job, preserveCollection = false) {
      if (!job?.imageUrl) return;
      if (!preserveCollection) {
        const roleCollection = this.selectedRoleAlbumItems?.some((item) => item.imageUrl === job.imageUrl)
          ? this.selectedRoleAlbumItems
          : [];
        const fallbackCollection = this.isCharacterAlbumItem(job)
          ? this.characterImageJobs
          : this.sceneImageJobs;
        this.imagePreviewItems = (roleCollection.length ? roleCollection : fallbackCollection)
          .filter((item) => item?.imageUrl)
          .map((item) => ({ ...item, archive: { ...(item.archive || {}) } }));
        if (!this.imagePreviewItems.some((item) => item.imageUrl === job.imageUrl)) {
          this.imagePreviewItems = [{ ...job, archive: { ...(job.archive || {}) } }];
        }
      }
      const previewId = String(job.id || `preview-${Date.now()}`);
      this.imagePreviewJob = {
        ...job,
        id: previewId,
        archive: { ...(job.archive || {}) },
      };
      this.imagePreviewSrc = "";
      this.imagePreviewError = "";
      this.imagePreviewScale = 1;
      this.imagePreviewOffsetX = 0;
      this.imagePreviewOffsetY = 0;
      this.imagePreviewDetailsVisible = false;
      this.imagePreviewPointers = {};
      this.imagePreviewGesture = null;
      this.imagePreviewLoading = true;
      try {
        const source = await this.resolveGalleryPreviewSource(job.imageUrl);
        if (this.imagePreviewJob?.id === previewId) this.imagePreviewSrc = source;
      } catch (error) {
        if (this.imagePreviewJob?.id === previewId) {
          this.imagePreviewError = String(error?.message || "图片读取失败");
        }
      } finally {
        if (this.imagePreviewJob?.id === previewId) this.imagePreviewLoading = false;
      }
    },
    openMessageImagePreview(message) {
      return this.openGalleryPreview({
        id: `message-image-${message.id}`,
        kind: "scene",
        imageUrl: message.imageUrl,
        model: message.imageModel,
        size: "",
        prompt: "",
        updatedAt: message.time,
        deletable: false,
        archive: {
          title: "对话场景图",
          scene: "保存在这条对话中的场景图片。",
          capturedAt: message.time,
        },
      });
    },
    handleGalleryPreviewError() {
      this.imagePreviewSrc = "";
      this.imagePreviewError = "图片地址存在，但浏览器无法解码或访问该文件";
    },
    retryGalleryPreview() {
      if (!this.imagePreviewJob) return;
      this.openGalleryPreview(this.imagePreviewJob);
    },
    changeGalleryZoom(delta) {
      this.imagePreviewScale = Math.min(4, Math.max(1, Math.round((this.imagePreviewScale + delta) * 100) / 100));
      if (this.imagePreviewScale === 1) {
        this.imagePreviewOffsetX = 0;
        this.imagePreviewOffsetY = 0;
      }
    },
    resetGalleryZoom() {
      this.imagePreviewScale = 1;
      this.imagePreviewOffsetX = 0;
      this.imagePreviewOffsetY = 0;
    },
    toggleGalleryZoom() {
      this.imagePreviewScale = this.imagePreviewScale > 1 ? 1 : 2;
    },
    handleGalleryZoomWheel(event) {
      this.changeGalleryZoom(event.deltaY < 0 ? 0.25 : -0.25);
    },
    galleryPointerDistance(points) {
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    },
    handleGalleryPointerDown(event) {
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // 合成事件或异常指针没有 active pointer 时会抛错，忽略即可
      }
      this.imagePreviewPointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      const points = Object.values(this.imagePreviewPointers);
      if (points.length >= 2) {
        this.imagePreviewGesture = {
          type: "pinch",
          distance: this.galleryPointerDistance(points),
          scale: this.imagePreviewScale,
          offsetX: this.imagePreviewOffsetX,
          offsetY: this.imagePreviewOffsetY,
        };
      } else {
        this.imagePreviewGesture = {
          type: "drag",
          startX: event.clientX,
          startY: event.clientY,
          offsetX: this.imagePreviewOffsetX,
          offsetY: this.imagePreviewOffsetY,
        };
      }
    },
    handleGalleryPointerMove(event) {
      if (!this.imagePreviewPointers[event.pointerId]) return;
      this.imagePreviewPointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      const points = Object.values(this.imagePreviewPointers);
      if (points.length >= 2) {
        if (this.imagePreviewGesture?.type !== "pinch") {
          this.imagePreviewGesture = {
            type: "pinch",
            distance: this.galleryPointerDistance(points),
            scale: this.imagePreviewScale,
            offsetX: this.imagePreviewOffsetX,
            offsetY: this.imagePreviewOffsetY,
          };
        }
        const baseDistance = Math.max(1, this.imagePreviewGesture.distance || 1);
        this.imagePreviewScale = Math.min(4, Math.max(1, this.imagePreviewGesture.scale * this.galleryPointerDistance(points) / baseDistance));
        return;
      }
      if (this.imagePreviewGesture?.type !== "drag") return;
      const dx = event.clientX - this.imagePreviewGesture.startX;
      const dy = event.clientY - this.imagePreviewGesture.startY;
      this.imagePreviewOffsetX = this.imagePreviewGesture.offsetX + dx;
      this.imagePreviewOffsetY = this.imagePreviewScale > 1 ? this.imagePreviewGesture.offsetY + dy : 0;
    },
    handleGalleryPointerUp(event) {
      const gesture = this.imagePreviewGesture;
      delete this.imagePreviewPointers[event.pointerId];
      const remaining = Object.values(this.imagePreviewPointers);
      if (remaining.length) {
        this.imagePreviewGesture = {
          type: "drag",
          startX: remaining[0].x,
          startY: remaining[0].y,
          offsetX: this.imagePreviewOffsetX,
          offsetY: this.imagePreviewOffsetY,
        };
        return;
      }
      if (this.imagePreviewScale <= 1.03 && gesture?.type === "drag") {
        const dx = event.clientX - gesture.startX;
        if (Math.abs(dx) >= 58 && this.imagePreviewItems.length > 1) {
          this.showAdjacentPreview(dx < 0 ? 1 : -1);
        }
        this.resetGalleryZoom();
      }
      this.imagePreviewGesture = null;
    },
    showAdjacentPreview(direction) {
      if (!this.imagePreviewJob || this.imagePreviewItems.length < 2) return;
      const currentIndex = this.imagePreviewItems.findIndex((item) =>
        item.id === this.imagePreviewJob.id || item.imageUrl === this.imagePreviewJob.imageUrl
      );
      const nextIndex = (Math.max(0, currentIndex) + direction + this.imagePreviewItems.length) % this.imagePreviewItems.length;
      this.openGalleryPreview(this.imagePreviewItems[nextIndex], true);
    },
    isCharacterAlbumItem(item) {
      return ["character", "visual-state"].includes(item?.kind);
    },
    closeGalleryPreview() {
      this.imagePreviewJob = null;
      this.imagePreviewSrc = "";
      this.imagePreviewLoading = false;
      this.imagePreviewError = "";
      this.imagePreviewScale = 1;
      this.imagePreviewOffsetX = 0;
      this.imagePreviewOffsetY = 0;
      this.imagePreviewDetailsVisible = false;
      this.imagePreviewItems = [];
      this.imagePreviewPointers = {};
      this.imagePreviewGesture = null;
    },
    clearAlbumItemReferences(item) {
      const role = this.roleById(item?.targetId);
      if (!role) return false;
      const imageUrl = String(item.imageUrl || "");
      const jobId = String(item.albumSource === "job" || this.imageJobs.some((job) => job.id === item.id)
        ? item.id
        : "");
      let changed = false;
      if (imageUrl && role.avatarUrl === imageUrl) {
        const fallback = this.imageJobs
          .filter((job) =>
            job.status === "completed"
            && job.kind === "character"
            && job.targetId === item.targetId
            && job.imageUrl
            && job.imageUrl !== imageUrl
            && job.id !== jobId
          )
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
        this.$set(role, "avatarUrl", fallback?.imageUrl || "");
        changed = true;
      }
      if (
        (jobId && role.visualBaseImageJobId === jobId)
        || (imageUrl && role.visualBaseImageUrl === imageUrl)
        || item.albumSource === "role-base"
      ) {
        this.$set(role, "visualBaseImageJobId", "");
        this.$set(role, "visualBaseImageUrl", "");
        this.$set(role, "visualBaseSource", "");
        changed = true;
      }
      for (const state of Array.isArray(role.visualStates) ? role.visualStates : []) {
        if (
          (item.visualStateId && state.id === item.visualStateId)
          || (jobId && state.imageJobId === jobId)
          || (imageUrl && state.imageUrl === imageUrl)
        ) {
          this.$set(state, "imageJobId", "");
          this.$set(state, "imageUrl", "");
          changed = true;
        }
      }
      return changed;
    },
    async deleteAlbumImage(item) {
      if (!item?.imageUrl || this.imageDeletingId) return;
      const title = item.archive?.title || item.targetName || "这张图片";
      if (!window.confirm(`确认从本地相册删除“${title}”吗？此操作不会删除角色或对话记录。`)) return;
      this.imageDeletingId = item.id;
      try {
        const jobBacked = this.imageJobs.some((job) => job.id === item.id);
        const query = jobBacked ? `?jobId=${encodeURIComponent(item.id)}` : "";
        const response = await fetch(`/api/image${query}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: jobBacked ? item.id : "",
            imageUrl: String(item.imageUrl || "").startsWith("data:") ? "" : item.imageUrl,
            targetId: item.targetId || "",
            visualStateId: item.visualStateId || "",
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "图片删除失败");
        this.imageJobs = this.imageJobs.filter((job) => job.id !== item.id);
        this.activeImageJobs = this.activeImageJobs.filter((job) => job.id !== item.id);
        const settingsChanged = this.clearAlbumItemReferences(item);
        if (settingsChanged) await this.saveSettings();
        if (this.imagePreviewJob?.id === item.id || this.imagePreviewJob?.imageUrl === item.imageUrl) {
          this.closeGalleryPreview();
        }
        this.showToast("图片已从本地相册删除");
      } catch (error) {
        this.recordError("相册删除", error, {
          imageId: item.id,
          kind: item.kind,
          targetId: item.targetId,
        });
        this.showToast(String(error?.message || "图片删除失败").slice(0, 48));
      } finally {
        this.imageDeletingId = "";
      }
    },
    applySceneImageStyle(preset) {
      this.imageStylePreset = preset;
      this.imageStyleCustom = "";
      this.prepareScenePrompt();
    },
    applySceneCustomStyle() {
      this.imageStylePreset = "";
      this.prepareScenePrompt();
    },
    clearSceneImageStyle() {
      this.imageStylePreset = "";
      this.imageStyleCustom = "";
    },
    applyCharacterImageStyle(preset) {
      this.characterImageStylePreset = preset;
      this.characterImageStyleCustom = "";
      this.prepareCharacterPrompt(this.roleDetailTargetId);
    },
    applyCharacterCustomStyle() {
      this.characterImageStylePreset = "";
      this.prepareCharacterPrompt(this.roleDetailTargetId);
    },
    clearCharacterImageStyle() {
      this.characterImageStylePreset = "";
      this.characterImageStyleCustom = "";
    },
    async prepareCharacterPrompt(targetId) {
      if (this.characterPromptPreparing || this.characterGenerating) return;
      const role = targetId === "primary"
        ? this.profile
        : targetId === "friend"
        ? this.ensemble.friend
        : this.ensemble.customRoles.find((item) => item.id === targetId)
          || this.ensemble.temporaryRoles.find((item) => item.id === targetId);
      if (!role) return;
      this.characterTargetId = targetId;
      this.characterPromptPreparing = true;
      try {
        const contextMessages = this.roleHistoryContext(role.name).slice(-10);
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare-character",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatModel,
            imageModel: this.imageModel,
            roleId: targetId,
            role,
            style: this.characterImageStylePreset || this.characterImageStyleCustom,
            storyClock: this.storyClock,
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            roleMemories: this.roleMemories,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "角色形象提示词整理失败");
        }
        const value = result.prompt.slice(0, 1200);
        this.characterPromptFallback = result.fallback === "local";
        this.settingsOpen = false;
        this.roleDetailTargetId = targetId;
        this.roleDetailTab = "image";
        this.roleDetailOpen = true;
        this.openAiProposal({
          type: "character-prompt",
          title: `${role.name} · 生图提示词差异预览`,
          targetId,
          fields: [{ key: "imagePrompt", label: "人物生图提示词", before: role.imagePrompt, after: value }],
          payload: { value, model: result.model || this.imageModel },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "角色形象提示词整理失败";
        this.showToast(detail.length > 42 ? "角色形象提示词整理失败，请检查对话模型" : detail);
      } finally {
        this.characterPromptPreparing = false;
      }
    },
    closeCharacterPrompt() {
      if (this.characterGenerating) return;
      this.characterPromptOpen = false;
      this.openRoleDetail(this.characterTargetId);
    },
    async generateCharacterImage() {
      if (this.characterGenerating || this.characterPrompt.trim().length < 80) return;
      if (!this.currentImageKeyConfigured) {
        this.showToast(`${this.activeImageKeyStatus}，请先打开接口连接设置`);
        return;
      }
      const role = this.activeCharacterRole;
      if (!role) return;
      this.characterGenerating = true;
      role.imagePrompt = this.characterPrompt.trim().slice(0, 1200);
      this.showToast(`正在创建${role.name}的后台生图任务`);
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "character",
            targetId: this.characterTargetId,
            targetName: role.name,
            imageModel: this.imageModel,
            prompt: this.characterPrompt,
            ...(this.standaloneMode && this.selectedRoleReferenceImage?.imageUrl
              ? {
                  referenceImage: {
                    imageUrl: this.selectedRoleReferenceImage.imageUrl,
                    jobId: this.selectedRoleReferenceImage.jobId || "",
                  },
                }
              : {}),
            archive: this.characterArchiveSnapshot(role),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "角色形象生成失败");
        }
        await this.saveSettings();
        this.persist();
        this.characterPromptOpen = false;
        this.roleDetailOpen = true;
        this.roleDetailTab = "image";
        this.showToast(this.standaloneMode
          ? `${role.name}已在后台生成，请保持页面打开，可继续聊天`
          : `${role.name}已在后台生成，可关闭页面或继续聊天`);
        await this.pollImageJobs();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "角色形象生成失败";
        this.showToast(detail.length > 42 ? "角色形象生成失败，请检查图片接口或内容限制" : detail);
      } finally {
        this.characterGenerating = false;
      }
    },
    async prepareScenePrompt() {
      if (!this.imageEnabled || this.imagePromptPreparing || this.imageGenerating) return;
      if (!this.chatConnectionVerified) {
        this.showToast("请先验证对话接口并选择模型");
        return;
      }

      this.mobileTab = "image";
      this.imagePromptPreparing = true;
      this.showToast("正在用对话模型整理场景提示词");
      try {
        const contextMessages = this.messages
          .filter((item) => !item.typing && typeof item.content === "string" && item.content.trim())
          .slice(-10)
          .map(({ role, content, speaker }) => ({ role, content, speaker }));
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatModel,
            imageModel: this.imageModel,
            profile: this.profile,
            ensemble: this.ensemble,
            style: this.imageStylePreset || this.imageStyleCustom,
            storyClock: this.storyClock,
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            roleMemories: this.roleMemories,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "场景提示词整理失败");
        }
        const value = result.prompt.slice(0, 1200);
        this.openAiProposal({
          type: "scene-prompt",
          title: "场景生图提示词差异预览",
          fields: [{ key: "imagePrompt", label: "场景生图提示词", before: this.imagePrompt, after: value }],
          payload: { value, model: result.model || this.imageModel },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "场景提示词整理失败";
        this.showToast(detail.length > 42 ? "提示词整理失败，请检查对话模型配置" : detail);
      } finally {
        this.imagePromptPreparing = false;
      }
    },
    async generateSceneImage() {
      if (!this.imageEnabled || this.imageGenerating || this.imagePrompt.trim().length < 40) return;
      if (!this.currentImageKeyConfigured) {
        this.showToast(`${this.activeImageKeyStatus}，请先打开接口连接设置`);
        return;
      }

      this.imageGenerating = true;
      this.showToast("正在把场景图提交到后台");
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "scene",
            targetName: "当前剧情场景",
            quality: this.imageQuality,
            imageModel: this.imageModel,
            prompt: this.imagePrompt,
            archive: this.sceneArchiveSnapshot(),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "图片生成失败");
        }
        this.persist();
        await this.pollImageJobs();
        this.showToast(this.standaloneMode
          ? "已在后台生成，请保持页面打开，可继续聊天"
          : "已在后台生成，可继续聊天或关闭页面");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "图片生成失败";
        this.showToast(detail.length > 42 ? "图片生成失败，请检查接口配置或内容限制" : detail);
      } finally {
        this.imageGenerating = false;
      }
    },
    formatStoryEventMoment(event) {
      if (!event || event.day === null) return "日期待确认";
      return formatStoryMoment({
        ...this.storyClock,
        day: event.day,
        segment: event.segment,
      });
    },
    segmentName(segment) {
      return storySegmentLabel(segment);
    },
    storyMomentValue(day, segment) {
      return storyMomentValue(day, segment);
    },
    storyEventStatusLabel(status) {
      return {
        "pending-confirmation": "待确认",
        confirmed: "待发生",
        accepted: "准备参加",
        declined: "决定不去",
        completed: "已完成",
        missed: "已错过",
        cancelled: "已取消",
      }[status] || "待处理";
    },
    patchStoryEvent(eventOrId, patch) {
      const id = typeof eventOrId === "string" ? eventOrId : eventOrId?.id;
      if (!id) return null;
      let updated = null;
      this.storyEvents = normalizeStoryEvents(this.storyEvents.map((event) => {
        if (event.id !== id) return event;
        updated = normalizeStoryEvent({
          ...event,
          ...patch,
          id,
          updatedAt: new Date().toISOString(),
        });
        return updated;
      }));
      return updated;
    },
    async detectAndRecordStoryEvent(content, sourceMessageId) {
      if (!shouldAnalyzeStoryEvent(content)) return null;
      if (this.storyEvents.some((event) => event.sourceMessageId === sourceMessageId)) return null;
      try {
        const provider = this.chatProvider;
        const response = await fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: this.chatModel,
            message: content,
            role: "user",
            speaker: "用户",
            sourceMessageId,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            recentMessages: this.messages
              .filter((message) => !message.typing && message.content)
              .slice(-8)
              .map(({ role, speaker, content: messageContent }) => ({
                role,
                speaker,
                content: messageContent,
              })),
          }),
        });
        const decision = await response.json().catch(() => ({}));
        if (!this.messages.some((message) => message.id === sourceMessageId && message.role === "user")) {
          return null;
        }
        if (!response.ok || !decision || decision.operation === "none") return null;
        if (decision.operation === "cancel" || decision.operation === "complete") {
          const updated = this.patchStoryEvent(decision.targetEventId, {
            status: decision.operation === "cancel" ? "cancelled" : "completed",
            sourceMessageId,
            sourceText: content,
          });
          if (!updated) return null;
          await this.saveSettings().catch(() => {});
          this.showToast(decision.operation === "cancel" ? "AI 已取消对应约定" : "AI 已标记对应约定完成");
          return updated;
        }
        const aiEvent = normalizeStoryEvent({
          ...decision.event,
          sourceMessageId,
          sourceText: content,
          status: "pending-confirmation",
        });
        if (decision.operation === "update" && decision.targetEventId) {
          const updated = this.patchStoryEvent(decision.targetEventId, {
            ...aiEvent,
            id: decision.targetEventId,
            status: "pending-confirmation",
          });
          if (!updated) return null;
          await this.saveSettings().catch(() => {});
          this.showToast("AI 已根据对话更新约定，请确认");
          return updated;
        }
        const duplicate = this.storyEvents.find((event) =>
          ["pending-confirmation", "confirmed", "accepted"].includes(event.status)
          && event.title === aiEvent.title
          && event.day === aiEvent.day
          && event.segment === aiEvent.segment
        );
        if (duplicate) {
          const updated = this.patchStoryEvent(duplicate, {
            ...aiEvent,
            id: duplicate.id,
            status: "pending-confirmation",
          });
          await this.saveSettings().catch(() => {});
          this.showToast("AI 已合并重复约定，请确认");
          return updated;
        }
        this.storyEvents = normalizeStoryEvents([...this.storyEvents, aiEvent]);
        await this.saveSettings().catch(() => {});
        this.showToast("AI 识别到一条明确约定，请确认");
        return aiEvent;
      } catch (error) {
        this.recordError("日程判定", error, {
          sourceMessageId,
          message: String(content || "").slice(0, 300),
        });
        return null;
      }
    },
    openSchedule() {
      this.timeSheetOpen = false;
      this.mobileTab = "schedule";
    },
    openTopMenu() {
      this.mobileMenuOpen = true;
    },
    openMobileDestination(destination) {
      this.mobileMenuOpen = false;
      if (destination === "chat") {
        this.switchMobileTab("chat");
        return;
      }
      if (destination === "roles") {
        this.settingsOpen = true;
        return;
      }
      if (destination === "schedule") {
        this.openSchedule();
        return;
      }
      if (destination === "image") {
        this.openImageStudio();
        return;
      }
      if (destination === "data") {
        this.openBackupManager();
        return;
      }
      if (destination === "connection") {
        this.settingsOpen = false;
        this.switchMobileTab("connection");
        return;
      }
      this.openPrompt();
    },
    openBackupManager() {
      this.mobileMenuOpen = false;
      this.settingsOpen = false;
      this.mobileTab = "data";
      this.refreshAssetStorage();
      this.refreshHistoryStorage();
      this.refreshMemoryStorage();
    },
    openStoryEventEditor(event = null) {
      const base = event
        ? normalizeStoryEvent(event)
        : normalizeStoryEvent({
            id: `story-event-${Date.now()}`,
            title: "",
            day: this.storyClock.day + 1,
            segment: "morning",
            status: "confirmed",
          });
      if (!event) base.title = "";
      this.eventDraft = { ...base, participants: [...base.participants] };
      this.editingStoryEventId = event?.id || "";
      this.eventParticipantText = base.participants.join("、");
      this.eventEditorOpen = true;
    },
    saveStoryEventDraft() {
      const title = String(this.eventDraft.title || "").trim();
      if (!title) {
        this.showToast("请填写约定内容");
        return;
      }
      const participants = String(this.eventParticipantText || "")
        .split(/[、,，/]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const next = normalizeStoryEvent({
        ...this.eventDraft,
        title,
        day: Math.max(1, Number(this.eventDraft.day) || this.storyClock.day),
        participants,
        status: ["completed", "declined", "missed", "cancelled"].includes(this.eventDraft.status)
          ? this.eventDraft.status
          : "confirmed",
        needsDateConfirmation: false,
        updatedAt: new Date().toISOString(),
      });
      const index = this.storyEvents.findIndex((event) => event.id === next.id);
      if (index >= 0) this.$set(this.storyEvents, index, next);
      else this.storyEvents.push(next);
      this.storyEvents = normalizeStoryEvents(this.storyEvents);
      this.eventEditorOpen = false;
      this.editingStoryEventId = "";
      this.saveSettings().catch(() => this.showToast("日程保存失败"));
      this.showToast("约定已保存");
    },
    confirmStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, {
        status: "confirmed",
        needsDateConfirmation: false,
      });
      this.saveSettings().catch(() => {});
      this.showToast("约定已经确认");
    },
    cancelStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, { status: "cancelled" });
      this.saveSettings().catch(() => {});
      this.showToast("这条约定已忽略");
    },
    completeStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, { status: "completed" });
      this.saveSettings().catch(() => {});
      this.showToast("事件已标记完成");
    },
    openTimeJump(days = 1, segment = "dawn") {
      this.timeSheetOpen = false;
      const normalizedSegment = STORY_TIME_SEGMENTS.some((item) => item.id === segment)
        ? segment
        : "dawn";
      const requestedDays = Math.max(0, Number(days) || 0);
      const currentValue = storyMomentValue(this.storyClock.day, this.storyClock.segment);
      const sameDayTarget = storyMomentValue(this.storyClock.day, normalizedSegment);
      this.timeJumpDays = requestedDays === 0 && sameDayTarget <= currentValue ? 1 : requestedDays;
      this.timeJumpSegment = normalizedSegment;
      this.timeJumpOpen = true;
    },
    advanceToNextSegment() {
      const index = STORY_TIME_SEGMENTS.findIndex((item) => item.id === this.storyClock.segment);
      if (index >= 0 && index < STORY_TIME_SEGMENTS.length - 1) {
        this.openTimeJump(0, STORY_TIME_SEGMENTS[index + 1].id);
      } else {
        this.openTimeJump(1, "dawn");
      }
    },
    confirmTimeJump() {
      const previous = formatStoryMoment(this.storyClock);
      const target = advanceStoryClock(
        this.storyClock,
        this.timeJumpTargetDay,
        this.timeJumpSegment,
      );
      if (!this.timeJumpKeepOverdue) {
        const affectedIds = new Set(this.timeJumpAffectedEvents.map((event) => event.id));
        this.storyEvents = normalizeStoryEvents(this.storyEvents.map((event) =>
          affectedIds.has(event.id)
            ? { ...event, status: "missed", updatedAt: new Date().toISOString() }
            : event
        ));
      }
      this.storyClock = target;
      this.dayCount = target.day;
      this.timeJumpOpen = false;
      this.saveSettings().catch(() => this.showToast("剧情时间保存失败"));
      this.mobileTab = "chat";
      if (this.timeJumpAddTransition) {
        this.sendMessage({
          hiddenDriver: true,
          driverContent: `时间已经推进：从“${previous}”到“${formatStoryMoment(target)}”。请先以自然的口吻，简短交代这期间之前正在进行的事、未聊完的话题或手头事务的合理结果（日常收尾即可），再描述新时间点的场景变化、角色状态和正在发生的小事，让剧情自然衔接并继续向前推进一小步；不要擅自替我拿主意，说完自然停下等我。`,
        });
      } else {
        this.$nextTick(() => this.scrollBottom());
      }
      this.showToast(`已推进到第${target.day}日·${storySegmentLabel(target.segment)}`);
    },
    respondToDueEvent(event, action) {
      if (!event || this.sending) return;
      if (action === "snooze") {
        this.patchStoryEvent(event, {
          snoozedUntil: storyMomentValue(this.storyClock.day, this.storyClock.segment) + 1,
          reminderCount: Math.min(20, Number(event.reminderCount || 0) + 1),
        });
        this.saveSettings().catch(() => {});
        this.showToast("会在下一个时间段再次提醒");
        return;
      }
      if (action === "delay") {
        this.openStoryEventEditor(event);
        return;
      }
      if (action === "go") {
        this.patchStoryEvent(event, { status: "accepted" });
        this.saveSettings().catch(() => {});
        this.draft = `按之前的约定，现在开始“${event.title}”。请从当前地点自然承接并推动这件事。`;
        this.sendMessage();
        return;
      }
      if (action === "decline") {
        this.patchStoryEvent(event, { status: "declined" });
        this.saveSettings().catch(() => {});
        this.draft = `我决定这次不去做“${event.title}”，请让相关角色自然回应，并讨论是否取消或改期。`;
        this.sendMessage();
      }
    },
    switchMobileTab(tab) {
      this.mobileTab = tab;
      if (tab === "image") {
        this.galleryDisplayLimit = 18;
        this.pollImageJobs();
      }
      if (tab === "data") this.refreshTokenUsage();
      if (tab === "chat") this.scrollBottom();
    },
    openImageStudio() {
      this.settingsOpen = false;
      this.roleDetailOpen = false;
      this.mobileTab = "image";
      this.pollImageJobs();
    },
    openPrompt() {
      this.openPromptSection("");
    },
    formatSummaryTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    },
    async saveStorySummary() {
      if (this.summarySaving || this.summarizing) return;
      this.summarySaving = true;
      this.autoCompressThreshold = Math.min(120, Math.max(20, Number(this.autoCompressThreshold) || 40));
      try {
        await this.saveSettings();
        this.showToast("剧情摘要与自动压缩设置已保存");
      } catch {
        this.showToast("剧情摘要保存失败");
      } finally {
        this.summarySaving = false;
      }
    },
    maybeAutoCompress() {
      if (!this.autoCompress || this.summarizing || this.sending) return;
      const backoff = this.autoCompressFailStreak > 0
        ? Math.min(120, this.autoCompressFailStreak * 15)
        : 0;
      if (this.compressibleMessageCount < this.autoCompressThreshold + backoff) return;
      void this.summarizeConversation(true);
    },
    async summarizeConversation(automatic = false) {
      if (this.summarizing || this.sending) return false;
      const contextMessages = this.messages
        .filter((item) =>
          !item.typing
          && (item.role === "user" || item.role === "assistant")
          && typeof item.content === "string"
          && item.content.trim()
        )
        .slice(-240)
        .map(({ id, role, content, speaker, time, createdAt, storyDay, storySegment }) => ({
          id,
          role,
          content,
          speaker,
          time,
          createdAt,
          storyDay,
          storySegment,
        }));
      if (contextMessages.length < 4) {
        if (!automatic) this.showToast("当前有效对话太少，暂时不需要总结");
        return false;
      }

      const snapshot = this.messages.slice();
      this.stopEnsemblePlayback();
      this.summarizing = true;
      if (automatic) this.showToast("正在后台整理剧情记忆…");
      try {
        const response = await fetch("/api/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userProfile: this.userProfile,
            profile: this.profile,
            ensemble: this.ensemble,
            existingSummary: this.storySummary,
            existingRoleMemories: this.roleMemories,
            worldSetting: this.worldSetting,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            provider: this.chatProvider,
            model: this.chatModel,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (
          !response.ok
          || typeof result.summary !== "string"
          || result.summary.length < 120
          || !result.roleMemories
          || typeof result.roleMemories !== "object"
        ) {
          throw new Error(result.detail || result.error || "剧情总结失败");
        }
        this.autoCompressFailStreak = 0;
        this.storySummary = result.summary.slice(0, 20000);
        this.roleMemories = result.roleMemories;
        this.summaryUpdatedAt = new Date().toISOString();
        const snapshotIds = new Set(snapshot.map((item) => item.id));
        const preserved = this.messages.filter((item) => !snapshotIds.has(item.id));
        this.messages = [{
          id: Date.now(),
          role: "assistant",
          speaker: this.profile.name,
          content: `【剧情记忆已整理】\n已将 ${result.processedMessages || contextMessages.length} 条消息整理为剧情摘要和可检索章节，提取 ${result.factCount || 0} 条长期事实，并为 ${result.roleMemoryCount || Object.keys(this.roleMemories).length} 位角色保留独立记忆。原始对话仍在本地历史库中。`,
          time: this.now(),
        }, ...preserved];
        this.suggestions = ["我马上落实刚才的决定", "带上需要的东西，现在就换地点", "联系相关角色，把新线索带进现场"];
        await Promise.all([this.saveSettings(), this.saveHistory()]);
        this.scrollBottom();
        this.showToast(automatic ? "旧对话已压缩并归档" : "剧情已总结，原始对话已归档");
        return true;
      } catch (error) {
        this.autoCompressFailStreak += 1;
        if (!automatic) {
          const detail = error instanceof Error ? error.message : "剧情总结失败";
          this.showToast(detail.length > 42 ? "剧情总结失败，原记录已保留" : detail);
        }
        return false;
      } finally {
        this.summarizing = false;
      }
    },
    stopEnsemblePlayback() {
      this.ensemblePlaybackToken += 1;
      this.ensemblePlaying = false;
    },
    async playEnsembleTurns(turns, requestId) {
      const playbackToken = ++this.ensemblePlaybackToken;
      this.ensemblePlaying = true;
      let displayed = 0;
      const newTemporaryRoleIds = [];
      const limitedTurns = limitEnsembleTurns(turns, this.ensemble.maxTurns);
      for (const turn of limitedTurns) {
        if (playbackToken !== this.ensemblePlaybackToken || requestId !== this.chatRequestId) return false;
        const message = {
          id: Date.now() + displayed,
          role: "assistant",
          speaker: turn.speaker,
          content: turn.content,
          mood: turn.mood || "",
          action: turn.action || "",
          visual: turn.visual || null,
          time: this.now(),
        };
        this.messages.push(message);
        this.applyStageCue(message);
        const discovered = this.ensureTemporaryRoleFromMessage(message);
        if (discovered?.created) newTemporaryRoleIds.push(discovered.role.id);
        if (displayed === 0) {
          this.lastReplyStartId = message.id;
          this.scrollToMessage(message.id);
        }
        displayed += 1;
        this.persist();
        this.saveHistory().catch(() => {});
        if (displayed < limitedTurns.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 1600));
        }
      }
      if (playbackToken === this.ensemblePlaybackToken && requestId === this.chatRequestId) {
        this.ensemblePlaying = false;
        if (newTemporaryRoleIds.length) {
          this.saveSettings().catch(() => {});
          void this.autoGenerateTemporaryRoles(newTemporaryRoleIds);
        }
        return displayed > 0;
      }
      return false;
    },
    async sendMessage(options = {}) {
      const content = String(options?.driverContent || this.draft || "").trim();
      const hiddenDriver = options?.hiddenDriver === true;
      const forceSingle = options?.forceSingle === true;
      if (!content || this.sending || this.editingMessageId !== null) return;
      this.stopEnsemblePlayback();
      const requestId = ++this.chatRequestId;
      const provider = this.chatProvider;
      const allowGuestIntroduction = Boolean(
        this.randomRoleEnabled
        && this.ensemble.enabled
        && this.ensemble.autoGuests
        && this.compressibleMessageCount >= this.nextGuestAt
      );
      this.suggestionRequestId += 1;
      window.clearTimeout(this.suggestionRefreshTimer);
      this.suggestionsLoading = false;
      this.suggestionsVisible = false;
      this.suggestions = [];
      if (!hiddenDriver) this.draft = "";
      this.sending = true;
      const userMessage = { id: Date.now(), role: "user", content, time: this.now() };
      if (!hiddenDriver) this.messages.push(userMessage);
      const moodTask = this.tasks.find((task) => task.id === 2);
      if (moodTask) moodTask.done = true;
      const reply = { id: Date.now() + 1, role: "assistant", content: "", time: this.now(), typing: true };
      this.messages.push(reply);
      this.lastReplyStartId = reply.id;
      this.persist();
      this.saveHistory().catch(() => {});
      this.scrollBottom();

      let chatCompleted = false;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: this.chatModel,
            userProfile: this.userProfile,
            profile: this.profile,
            ensemble: this.ensemble,
            responseMode: forceSingle ? "single" : (this.ensemble.enabled ? "multi" : "single"),
            systemPrompt: this.systemPrompt,
            storySummary: this.storySummary,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            roleMemories: this.roleMemories,
            worldSetting: this.worldSetting,
            allowGuestIntroduction,
            messages: (() => {
              const contextMessages = this.messages
                .filter((item) => !item.typing && typeof item.content === "string" && item.content.trim())
                .slice(-13)
                .map(({ role, content: messageContent, speaker }) => ({ role, content: messageContent, speaker }));
              if (hiddenDriver) contextMessages.push({ role: "user", content, speaker: "" });
              return contextMessages.slice(-14);
            })(),
          }),
        });
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          const parsed = (() => {
            try { return JSON.parse(detail); } catch { return null; }
          })();
          const error = new Error(`对话接口 ${response.status || "不可用"}：${String(parsed?.error || detail || "空响应").slice(0, 500)}`);
          error.diagnostic = {
            stage: "local-api-response",
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            upstream: parsed?.diagnostic || null,
            rawResponse: detail.slice(0, 100000),
            rawResponseLength: detail.length,
            rawResponseTruncated: detail.length > 100000,
          };
          throw error;
        }
        const contentType = response.headers.get("content-type") || "";
        if (this.ensemble.enabled && contentType.includes("application/json")) {
          const result = await response.json();
          if (requestId !== this.chatRequestId) return;
          if (!Array.isArray(result.turns) || !result.turns.length) throw new Error("multi chat unavailable");
          if (result.fallback) {
            this.showToast("模型返回不完整，本轮已停止，可重新发送");
            if (result.fallback === "empty-content" && result.diagnostic) {
              const providerName = "对话模型";
              const warning = new Error(`${providerName} 连续返回空白或不完整内容，已停止本轮`);
              warning.diagnostic = result.diagnostic;
              this.recordError("对话模型自动恢复", warning, {
                provider,
                model: result.model || (this.chatModel),
                recovered: true,
              });
            }
          } else if (result.repaired) {
            this.showToast("已自动修复模型回复格式");
          }
          const replyIndex = this.messages.findIndex((item) => item.id === reply.id);
          if (replyIndex >= 0) this.messages.splice(replyIndex, 1);
          this.sending = false;
          chatCompleted = await this.playEnsembleTurns(result.turns, requestId);
        } else {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          reply.typing = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.content += decoder.decode(value, { stream: true });
          }
          if (!reply.content) reply.content = "我在。你可以慢一点说，我会认真听。";
          reply.speaker = this.profile.name;
          this.applyStageCue(reply);
          chatCompleted = true;
        }
      } catch (error) {
        if (requestId !== this.chatRequestId) return;
            this.recordError("对话模型", error, { provider, model: this.chatModel });
            reply.typing = false;
            reply.content = `本轮请求失败：${String(error?.message || "网络或模型暂时不可用").slice(0, 220)}`;
      } finally {
        if (requestId === this.chatRequestId) {
          this.sending = false;
          this.refreshTokenUsage();
          this.ensemblePlaying = false;
          this.persist();
          this.saveHistory().catch(() => this.showToast("聊天记录写入失败"));
          this.scrollToMessage(this.lastReplyStartId);
          const eventDecisionTask = hiddenDriver
            ? Promise.resolve()
            : this.detectAndRecordStoryEvent(content, userMessage.id);
          if (chatCompleted) {
            if (allowGuestIntroduction) {
              this.nextGuestAt = this.compressibleMessageCount + this.randomRoleInterval;
            }
            this.persist();
            void eventDecisionTask;
            void this.maybeAutoCompress();
          }
        }
      }
      return chatCompleted;
    },
    async initializeStoryOpening() {
      if (this.storyInitialized || this.storyInitializing || !this.onboardingCompleted || this.chatApiMode !== "configured" || !this.chatConnectionVerified) return false;
      this.storyInitializing = true;
      try {
        const completed = await this.sendMessage({
          hiddenDriver: true,
          forceSingle: true,
          driverContent: `这是新剧情的不可见启动指令。不要提及设置、提示词、初始化、AI 或系统。请结合当前世界设定、剧情时间、用户身份，以及核心伙伴“${this.profile.name}”与用户“${this.userProfile.name}”的关系“${this.profile.relation}”，由${this.profile.name}发出第一条真实剧情消息。必须给出具体地点、可感知的环境、正在进行的动作和一个刚发生的事件；先让角色主动做出推进，再留下用户可以自然介入的位置。不要替用户说话。`,
        });
        if (!completed) return false;
        this.storyInitialized = true;
        await this.saveSettings();
        this.showToast(`${this.profile.name}已经在场景中等你了`);
        return true;
      } finally {
        this.storyInitializing = false;
      }
    },
    async clearConversation() {
      if (!window.confirm("清空当前聊天窗口？原始消息仍会保留在“备份迁移 → 对话历史库”中；需要永久删除时可在那里按时间清理。")) return;
      this.stopEnsemblePlayback();
      this.chatRequestId += 1;
      this.sending = false;
      this.cancelEditMessage();
      this.messages = [{
        id: Date.now(),
        role: "assistant",
        content: "【场景】当前对话已经清空，地点与时间仍沿用现有世界设定。\n\n【动作】我合上记录册，重新确认手边的线索和物品。\n\n【对话】记录已经清空。我们从现在这一刻重新开始吧。\n\n【剧情推进】我停在原地等待你的第一句话，没有替你决定新的行动。",
        time: this.now(),
      }];
      this.persist();
      await this.saveHistory().catch(() => this.showToast("清空记录失败"));
      this.scrollBottom();
      this.showToast("当前窗口已清空，原始消息仍在历史库");
    },
    toggleTask(task) {
      task.done = !task.done;
      this.persist();
      this.showToast(task.done ? `完成「${task.title}」+${task.points}` : "已恢复为待完成");
    },
    sendEncouragement() {
      this.mobileTab = "chat";
      this.draft = "可以认真和我说一句晚安吗？";
      this.sendMessage();
    },
    async completeOnboarding() {
      if (!this.chatConnectionVerified || this.worldSetting.trim().length < 60 || !this.onboardingRoleReady) {
        this.showToast("模型、世界或核心人物尚未完成确认");
        return;
      }
      this.profile.worldVersion = this.worldVersion;
      this.worldSyncPending = false;
      this.roleMemories = {
        ...this.roleMemories,
        primary: {
          ...(this.roleMemories.primary || {}),
          name: this.profile.name,
          stableIdentity: `${this.profile.name}是当前世界中的核心人物，与用户的初始关系是“${this.profile.relation}”。人物提示词中的身份与稳定外观高于剧情摘要。`,
          relationshipMemory: `与${this.userProfile.name}的关系从“${this.profile.relation}”开始，后续变化只依据真实对话与事件。`,
          importantEvents: this.roleMemories.primary?.importantEvents || "故事尚未正式开始。",
          currentStatus: "等待在已确认世界中开始第一次正式场景。",
          lastKnownScene: "尚未生成开场场景。",
          commitments: this.roleMemories.primary?.commitments || "",
          updatedAt: new Date().toISOString(),
        },
      };
      await this.saveProfile();
    },
    async saveProfile() {
      if (!this.userProfile.name) this.userProfile.name = "旅行者";
      if (!["女性", "男性", "非二元", "未指定"].includes(this.userProfile.gender)) this.userProfile.gender = "未指定";
      if (!this.userProfile.pronoun) this.syncUserPronoun();
      if (!this.profile.name) this.profile.name = "伙伴";
      if (!this.profile.avatarUrl) this.profile.avatarUrl = this.defaultAvatarUrl;
      if (this.ensemble.friend.name) this.ensemble.friend.age = Math.min(80, Math.max(18, Number(this.ensemble.friend.age) || 24));
      this.ensemble.maxTurns = Math.min(10, Math.max(1, Number(this.ensemble.maxTurns) || 3));
      const setupComplete = this.chatConnectionVerified
        && this.worldSetting.trim().length >= 60
        && this.onboardingRoleReady;
      const wasOnboarding = !this.onboardingCompleted;
      if (setupComplete) {
        this.onboardingCompleted = true;
        this.onboardingStep = 5;
        this.onboardingDismissed = false;
        if (wasOnboarding) this.storyInitialized = false;
      }
      this.ensemble.customRoles = this.ensemble.customRoles
        .filter((role) => role?.name?.trim())
        .slice(0, 30)
        .map((role, index) => ({
          ...role,
          id: role.id || `role-${Date.now()}-${index}`,
          age: Math.min(80, Math.max(18, Number(role.age) || 24)),
          gender: ["女性", "男性", "非二元", "未指定"].includes(role.gender) ? role.gender : "未指定",
          personality: role.personality?.trim() || "自然、友善",
          relation: role.relation?.trim() || "成年朋友",
          prompt: role.prompt?.trim() || "",
        }));
      this.ensemble.temporaryRoles = this.ensemble.temporaryRoles
        .filter((role) => role?.name?.trim())
        .slice(0, 80)
        .map((role, index) => ({
          ...role,
          id: role.id || `temporary-${Date.now()}-${index}`,
          age: Math.min(80, Math.max(18, Number(role.age) || 24)),
          gender: ["女性", "男性", "非二元", "未指定"].includes(role.gender) ? role.gender : "未指定",
          personality: role.personality?.trim() || "延续对话中已经表现出的性格",
          relation: role.relation?.trim() || "场景中认识的成年角色",
          prompt: role.prompt?.trim() || "",
        }));
      this.persist();
      await this.saveSettings().catch(() => this.showToast("角色设定写入失败"));
      this.settingsOpen = false;
      if (wasOnboarding && setupComplete && this.directApiMode) {
        this.switchMobileTab("chat");
        this.showToast("世界与人物档案已确认，正在生成第一幕");
        if (this.chatConnectionVerified) void this.initializeStoryOpening();
      } else if (wasOnboarding && !setupComplete) {
        this.showToast("请继续完成模型、世界与人物配置");
      } else {
        this.showToast("人物与关系设定已保存");
      }
    },
    saveEnsembleParticipantLimit() {
      this.ensemble.maxTurns = Math.min(10, Math.max(1, Number(this.ensemble.maxTurns) || 3));
      this.persist();
      this.saveSettings()
        .then(() => this.showToast(`每轮最多 ${this.ensemble.maxTurns} 位不同角色，已保存`))
        .catch(() => this.showToast("人数上限保存失败"));
    },
    backupFilename() {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return `夜航信箱-完整备份-${stamp}.json`;
    },
    formatStorageBytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
    async refreshAssetStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/assets", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "图片存储状态读取失败");
        this.assetStorage = result;
        if (this.backupBusy === "migration" && result.migration) {
          this.backupStatus = `正在迁移 ${result.migration.completed || 0}/${result.migration.total || 0}，请保持页面打开…`;
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "图片存储状态读取失败");
        this.recordError("本地图片存储", error);
      }
    },
    async refreshHistoryStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/history?limit=120", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "历史记录统计失败");
        this.historyStorage = result;
      } catch (error) {
        this.backupStatus = String(error?.message || "历史记录统计失败");
        this.recordError("本地历史存储", error);
      }
    },
    async refreshMemoryStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/memory", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "长期记忆统计失败");
        this.memoryStorage = result;
      } catch (error) {
        this.backupStatus = String(error?.message || "长期记忆统计失败");
        this.recordError("本地记忆存储", error);
      }
    },
    async archiveActiveHistory() {
      if (this.backupBusy || !this.standaloneMode) return;
      if (!window.confirm("只清空当前聊天窗口？原始消息仍保留在本地历史库，可继续用于长期记忆。")) return;
      this.backupBusy = "history";
      try {
        const response = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive-active" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "当前窗口清理失败");
        this.messages = [];
        await this.refreshHistoryStorage();
        this.backupStatus = "当前聊天窗口已清空，原始消息仍保留在本地历史库。";
      } catch (error) {
        this.backupStatus = String(error?.message || "当前窗口清理失败");
        this.recordError("历史存储", error, { action: "archive-active" });
      } finally {
        this.backupBusy = "";
      }
    },
    async deleteOldHistory() {
      if (this.backupBusy || !this.standaloneMode) return;
      const days = Math.max(1, Number(this.historyRetentionDays) || 90);
      if (!window.confirm(`永久删除 ${days} 天以前、且不在当前聊天窗口中的原始消息？这个操作无法撤销，建议先导出完整备份。`)) return;
      this.backupBusy = "history";
      try {
        const response = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete-older-than", days }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "历史记录清理失败");
        this.historyStorage = result;
        this.backupStatus = `已永久清理 ${result.removed || 0} 条旧归档消息；当前窗口和长期记忆未改动。`;
      } catch (error) {
        this.backupStatus = String(error?.message || "历史记录清理失败");
        this.recordError("历史存储", error, { action: "delete-older-than", days });
      } finally {
        this.backupBusy = "";
      }
    },
    async migrateImageAssets() {
      if (this.backupBusy || !this.standaloneMode) return;
      this.backupBusy = "migration";
      await this.yieldBackupUi("正在按内容去重并迁移图片；每张图片写入校验成功后才会替换旧引用…");
      try {
        const response = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "migrate" }),
        });
        const result = await response.json().catch(() => ({}));
        this.assetStorage = result.storage || null;
        let migration = result.migration || {};
        if (!response.ok && response.status !== 207) {
          const error = new Error(result.error || "图片迁移失败");
          if (result.diagnostic && typeof result.diagnostic === "object") {
            error.diagnostic = result.diagnostic;
          }
          throw error;
        }
        if (response.status === 202 || result.accepted) {
          for (let poll = 0; poll < 1000; poll += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            await this.refreshAssetStorage();
            migration = this.assetStorage?.migration || {};
            if (["completed", "partial", "paused"].includes(migration.status)) break;
          }
          if (!["completed", "partial", "paused"].includes(migration.status)) {
            throw new Error("图片迁移后台任务等待超过20分钟，已停止前端等待；已完成数据仍然保留");
          }
        }
        if (migration.failed) {
          this.backupStatus = `已迁移 ${migration.completed || 0}/${migration.total || 0} 张，${migration.failed} 张读取失败；原图片未删除，可稍后继续。`;
          for (const entry of migration.errors || []) {
            this.recordError("图片迁移", entry.error || "图片迁移失败", {
              source: entry.source || "",
              migrationStatus: migration.status,
            });
          }
          this.showToast("部分图片未迁移，原图仍保留", false);
          await this.loadStorage();
          await this.loadImageJobs();
        } else {
          this.backupStatus = `图片迁移完成：${migration.completed || 0} 张已校验并统一去重。`;
          this.showToast("图片迁移完成");
          await this.loadStorage();
          await this.loadImageJobs();
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "图片迁移失败");
        this.recordError("图片迁移", error);
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
        await this.refreshAssetStorage();
      }
    },
    async yieldBackupUi(message) {
      this.backupStatus = message;
      await this.$nextTick();
      await new Promise((resolve) => window.setTimeout(resolve, 24));
    },
    async exportAllData() {
      if (this.backupBusy) return;
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      this.backupBusy = "export";
      await this.yieldBackupUi("正在收集人物、对话和图片，请保持页面打开…");
      try {
        await Promise.all([this.saveSettings(), this.saveHistory()]);
        await this.yieldBackupUi("本地数据已保存，正在打包图片…");
        const response = await fetch("/api/backup", { cache: "no-store" });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || "备份导出失败");
        }
        const text = await response.text();
        const filename = this.backupFilename();
        const byteSize = new Blob([text], { type: "application/json;charset=utf-8" }).size;
        if (this.appShellMode && window.__NIGHT_MAILBOX_NATIVE_BACKUP__?.save) {
          const saved = await window.__NIGHT_MAILBOX_NATIVE_BACKUP__.save(text, filename);
          this.backupStatus = `完整备份已保存到 ${saved.visiblePath || saved.privatePath || "App 备份目录"}，约 ${(byteSize / 1024 / 1024).toFixed(1)} MB。`;
          this.showToast("App 备份已保存");
        } else {
          const blob = new Blob([text], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 4000);
          this.backupStatus = `完整备份已导出，文件大小约 ${(byteSize / 1024 / 1024).toFixed(1)} MB。`;
          this.showToast("完整备份已下载");
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导出失败");
        this.recordError("备份导出", error);
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    triggerBackupImport() {
      if (this.backupBusy) return;
      const input = this.$refs.backupFileInput;
      if (!input || typeof input.click !== "function") {
        this.showToast("当前环境无法打开文件选择器");
        return;
      }
      input.value = "";
      input.click();
    },
    prepareBackupImport(backup) {
      if (backup?.format !== "night-mailbox-backup" || Number(backup?.version) !== 1) {
        throw new Error("这不是可识别的夜航信箱完整备份");
      }
      const messageCount = Array.isArray(backup.archive?.messages)
        ? backup.archive.messages.length
        : Array.isArray(backup.messages) ? backup.messages.length : 0;
      const imageCount = Array.isArray(backup.imageJobs)
        ? backup.imageJobs.filter((job) => job?.status === "completed" && job?.imageUrl).length
        : 0;
      const settings = backup.settings && typeof backup.settings === "object" ? backup.settings : {};
      const roleCount = 2
        + (Array.isArray(settings.ensemble?.customRoles) ? settings.ensemble.customRoles.length : 0)
        + (Array.isArray(settings.ensemble?.temporaryRoles) ? settings.ensemble.temporaryRoles.length : 0);
      this.pendingBackup = backup;
      this.pendingBackupMeta = { messageCount, imageCount, roleCount };
      this.backupStatus = "备份已读取。请核对数量后确认导入。";
      return this.pendingBackupMeta;
    },
    cancelBackupImport() {
      if (this.backupBusy) return;
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      this.backupStatus = "已取消导入，当前数据没有变化。";
    },
    async confirmBackupImport() {
      if (!this.pendingBackup || this.backupBusy) return;
      const backup = this.pendingBackup;
      this.backupBusy = "import";
      await this.yieldBackupUi("正在写入人物、剧情、对话和图片…");
      try {
        await this.applyBackupPayload(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导入失败");
        this.recordError("备份导入", error, { stage: "apply" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async applyBackupPayload(backup) {
      const response = await fetch("/api/backup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "备份导入失败");
      this.backupStatus = `导入完成：${result.roleCount || 0} 位角色、${result.archivedMessageCount || result.messageCount || 0} 条历史对话、${result.imageCount || 0} 张图片。`;
      this.showToast("完整备份已恢复，正在重新载入");
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      window.setTimeout(() => window.location.reload(), 900);
      return true;
    },
    readBackupFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("备份文件读取失败"));
        reader.readAsText(file, "utf-8");
      });
    },
    async importAllData(event) {
      const file = event?.target?.files?.[0];
      if (!file || this.backupBusy) return;
      event.target.value = "";
      this.backupBusy = "import";
      await this.yieldBackupUi(`正在读取备份文件：${file.name || "未命名文件"}…`);
      try {
        const backup = JSON.parse(await this.readBackupFile(file));
        this.prepareBackupImport(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导入失败");
        this.recordError("备份导入", error, { stage: "file-read", filename: file.name || "" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async importLatestNativeBackup() {
      if (this.backupBusy || !window.__NIGHT_MAILBOX_NATIVE_BACKUP__?.readLatest) return;
      this.backupBusy = "import";
      await this.yieldBackupUi("正在读取 App 最近备份…");
      try {
        const result = await window.__NIGHT_MAILBOX_NATIVE_BACKUP__.readLatest();
        if (!result?.text) throw new Error("App 中还没有可恢复的备份，请先导出一次或从设备选择文件");
        const backup = JSON.parse(result.text);
        this.prepareBackupImport(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "读取 App 备份失败");
        this.recordError("备份导入", error, { stage: "native-latest" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async saveSettings() {
      const response = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          onboardingCompleted: this.onboardingCompleted,
          onboardingStep: this.onboardingStep,
          onboardingDismissed: this.onboardingDismissed,
          onboardingWorldTemplateId: this.onboardingWorldTemplateId,
          onboardingRoleTemplateId: this.onboardingRoleTemplateId,
          storyInitialized: this.storyInitialized,
          worldVersion: this.worldVersion,
          worldSyncPending: this.worldSyncPending,
          userProfile: this.userProfile,
          profile: this.profile,
          ensemble: this.ensemble,
          systemPrompt: this.systemPrompt,
          storySummary: this.storySummary,
          storyClock: this.storyClock,
          storyEvents: this.storyEvents,
          roleMemories: this.roleMemories,
          worldSetting: this.worldSetting,
          autoCompress: this.autoCompress,
          autoCompressThreshold: this.autoCompressThreshold,
          randomRoleEnabled: this.randomRoleEnabled,
          randomRoleInterval: this.randomRoleInterval,
          actionStyle: this.actionStyle,
          stageBackground: this.stageBackground,
          summaryUpdatedAt: this.summaryUpdatedAt,
        }),
      });
      if (!response.ok) throw new Error("settings save failed");
    },
    async savePrompt() {
      if (!this.systemPrompt.trim() || this.promptSaving) return;
      this.promptSaving = true;
      try {
        await this.saveSettings();
        this.showToast("系统提示词已写入本地文件");
      } catch {
        this.showToast("系统提示词保存失败");
      } finally {
        this.promptSaving = false;
      }
    },
    resetPrompt() {
      if (!this.defaultSystemPrompt) return;
      if (!window.confirm("确认恢复默认系统提示词吗？保存后才会生效。")) return;
      this.systemPrompt = this.defaultSystemPrompt;
      this.showToast("已恢复默认内容，请点击保存");
    },
    // Connection methods live in their feature module and override legacy aliases above.
    ...avatarMethods,
    ...onboardingMethods,
    ...connectionMethods,
};
