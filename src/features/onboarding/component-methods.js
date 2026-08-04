import { compactTextHash } from "../../utils/text-hash.js";
import {
  LOVER_WORLD_TEMPLATE,
  LOVER_ROLE_TEMPLATES,
  LOVER_ROLE_TEMPLATE_LIST,
  loverTemplateForGender,
} from "./templates.js";

/** First-run flow. Each step persists independently so refreshes are recoverable. */
export const onboardingMethods = {
  syncUserPronoun() {
    const pronouns = { 女性: "她", 男性: "他", 非二元: "TA", 未指定: "TA" };
    this.userProfile.pronoun = pronouns[this.userProfile.gender] || "TA";
  },
  goToOnboardingStep(step) {
    const target = Math.min(5, Math.max(1, Number(step) || 1));
    if (target > this.onboardingStep) return;
    this.onboardingStep = target;
    if (target === 3 && this.onboardingWorldTemplateId && !this.worldSetting.trim()) {
      this.applyLoverWorldTemplate(this.onboardingWorldTemplateId);
    }
    this.persist();
    this.saveSettings().catch(() => {});
  },
  applyLoverWorldTemplate(templateId, force = false) {
    const template = LOVER_WORLD_TEMPLATE.id === templateId ? LOVER_WORLD_TEMPLATE : null;
    if (!template) return;
    this.onboardingWorldTemplateId = template.id;
    if (force || !this.worldSeed.trim()) this.worldSeed = template.seed;
    if (force || !this.worldSetting.trim()) this.worldSetting = template.world || "";
  },
  applyLoverRoleTemplate(templateId) {
    const template = LOVER_ROLE_TEMPLATES[templateId] || null;
    if (!template) return;
    this.onboardingRoleTemplateId = template.id;
    this.roleAiInstruction = template.instruction;
    if (["女性", "男性", "非二元", "未指定"].includes(template.gender)) {
      this.profile.gender = template.gender;
      this.syncCoreAvatarToGender();
    }
    this.profile.prompt = template.prompt;
    this.profile.appearance = template.appearance;
  },
  ensureOnboardingRoleTemplate() {
    if (this.onboardingRoleTemplateId) return;
    const match = loverTemplateForGender(this.profile.gender);
    this.applyLoverRoleTemplate(match.defaultTemplate.id);
  },
  applyRoleTemplateForGender() {
    if (this.profile.gender !== "女性" && this.profile.gender !== "男性") {
      this.showToast("非二元/未指定可使用任意模板，也可自行填写");
      return;
    }
    const match = loverTemplateForGender(this.profile.gender);
    this.applyLoverRoleTemplate(match.defaultTemplate.id);
    this.showToast(`已按${match.defaultTemplate.gender}角色预填默认模板`);
  },
  clearOnboardingRoleTemplate() {
    this.onboardingRoleTemplateId = "";
    this.roleAiInstruction = "";
  },
  dismissOnboarding() {
    this.settingsOpen = false;
    this.onboardingDismissed = true;
    this.persist();
    this.saveSettings().catch(() => {});
  },
  onboardingRoleTemplateOptions() {
    return LOVER_ROLE_TEMPLATE_LIST.map((template) => ({
      id: template.id,
      label: template.label,
      gender: template.gender,
    }));
  },
  // ...existing code...
  registerWorldRevision() {
    const hash = compactTextHash(this.worldSetting);
    if (!hash || hash === this.savedWorldHash) return false;
    this.worldVersion = !this.onboardingCompleted ? 1 : (this.worldVersion > 0 ? this.worldVersion + 1 : 1);
    this.savedWorldHash = hash;
    if (this.onboardingCompleted) this.worldSyncPending = true;
    return true;
  },
  async advanceOnboarding() {
    if (this.onboardingStep === 1 && !this.chatConnectionVerified) {
      this.showToast("请先验证对话接口并选择模型");
      return;
    }
    if (this.onboardingStep === 2 && (!this.userProfile.name.trim() || !this.userProfile.pronoun.trim())) return;
    if (this.onboardingStep === 3) {
      if (this.worldSetting.trim().length < 60) {
        this.showToast("请先填写或生成较完整的世界设定");
        return;
      }
      const worldChanged = this.registerWorldRevision();
      // 已生成过人物又改过世界，提醒重新生成，避免人物与新世界不匹配
      if (worldChanged && this.profile.prompt.trim()) {
        this.showToast("世界设定已更新，建议回到人物步骤重新生成人物");
      }
    }
    if (this.onboardingStep === 4) {
      if (!this.onboardingRoleReady) {
        this.showToast("请先生成或填写完整的人物提示词与稳定外观");
        return;
      }
      this.profile.worldVersion = this.worldVersion;
      if (!this.profile.avatarUrl) this.profile.avatarUrl = this.defaultAvatarUrl;
    }
    this.onboardingStep = Math.min(5, this.onboardingStep + 1);
    if (this.onboardingStep === 3 && this.onboardingWorldTemplateId && !this.worldSeed.trim()) {
      this.applyLoverWorldTemplate(this.onboardingWorldTemplateId);
    }
    if (this.onboardingStep === 4) this.ensureOnboardingRoleTemplate();
    this.persist();
    await this.saveSettings().catch(() => this.showToast("初始化进度保存失败"));
  },
  async generateOnboardingRole() {
    if (!this.chatConnectionVerified || this.worldSetting.trim().length < 60) {
      this.showToast("请先验证模型并确认世界设定");
      return;
    }
    this.roleDetailTargetId = "primary";
    await this.generateRoleSetting("all");
  },
  async adaptCoreRoleToWorld() {
    if (!this.chatConnectionVerified || this.roleProfileGenerating) return;
    this.roleDetailTargetId = "primary";
    this.roleAiInstruction = "世界设定已经更新。请只适配与新世界冲突的身份、职业、背景、行为规则与外观细节；保留人物核心性格、与用户的既有关系、已经发生的经历和长期记忆。";
    await this.generateRoleSetting("all");
  },
  async keepCoreRoleAfterWorldChange() {
    this.profile.worldVersion = this.worldVersion;
    this.worldSyncPending = false;
    this.persist();
    await this.saveSettings().catch(() => this.showToast("世界版本状态保存失败"));
    this.showToast("已保留当前人物与记忆，仅使用新的世界规则继续");
  },
};
