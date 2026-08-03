import { compactTextHash } from "../../utils/text-hash.js";

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
    this.persist();
    this.saveSettings().catch(() => {});
  },
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
      this.registerWorldRevision();
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
