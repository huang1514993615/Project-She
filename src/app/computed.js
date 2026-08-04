import { maxEnsembleMessages } from "../../shared/ensemble-turns.js";
import {
  dueStoryEvents,
  normalizeStoryEvents,
  storyMomentValue,
  storySegmentLabel,
} from "../../shared/story-time.js";

/** Derived-only Vue state. Functions here must not mutate saved data. */
export const appComputed = {
    fixedFriendAvailable() {
      return Boolean(String(this.ensemble.friend?.name || "").trim());
    },
    onboardingRoleReady() {
      return Boolean(
        String(this.profile.name || "").trim()
        && String(this.profile.prompt || "").trim().length >= 60
        && String(this.profile.appearance || "").trim().length >= 30
      );
    },
    setupReminder() {
      if (!this.directApiMode) return "";
      if (!this.onboardingCompleted) {
        return `初始化尚未完成（第 ${Math.max(1, Math.min(5, Number(this.onboardingStep) || 1))}/5 步）`;
      }
      if (String(this.worldSetting || "").trim().length < 60) return "世界设定尚未完成，请继续配置";
      if (!String(this.profile?.name || "").trim() || !String(this.profile?.prompt || "").trim()) {
        return "核心人物尚未创建，请继续配置";
      }
      if (!this.storyInitialized) return "尚未开始剧情，请继续配置";
      return "";
    },
    matchingCoreAvatarPresets() {
      if (this.profile.gender === "女性" || this.profile.gender === "男性" || this.profile.gender === "非二元") {
        return this.coreAvatarPresets.filter((preset) => preset.gender === this.profile.gender);
      }
      return this.coreAvatarPresets;
    },
    defaultCoreAvatarPreset() {
      return this.coreAvatarPresets.find((preset) => preset.gender === this.profile.gender)
        || this.coreAvatarPresets.find((preset) => preset.id === "neutral-coast")
        || this.coreAvatarPresets[0];
    },
    defaultAvatarUrl() {
      return this.defaultCoreAvatarPreset?.url
        || window.__NIGHT_MAILBOX_DEFAULT_AVATAR__
        || (window.__NIGHT_MAILBOX_MOBILE__ ? "./og.png" : "/og.png");
    },
    ensembleMessageLimit() {
      return maxEnsembleMessages(this.ensemble.maxTurns);
    },
    currentImageKeyConfigured() {
      return this.directApiMode ? this.imageConnectionVerified : this.imageMode === "configured";
    },
    activeImageKeyStatus() {
      if (this.currentImageKeyConfigured) return "图片接口与模型已就绪";
      if (this.imageCatalogVerified) return "请选择图片模型";
      return "图片接口尚未验证";
    },
    storySegmentLabel() {
      return storySegmentLabel(this.storyClock.segment);
    },
    activeScheduleEvents() {
      return normalizeStoryEvents(this.storyEvents)
        .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status));
    },
    pendingConfirmationEvents() {
      return this.activeScheduleEvents.filter((event) => event.status === "pending-confirmation");
    },
    dueReminderEvent() {
      return dueStoryEvents(this.storyEvents, this.storyClock)[0] || null;
    },
    upcomingStoryEvents() {
      const current = storyMomentValue(this.storyClock.day, this.storyClock.segment);
      return this.activeScheduleEvents
        .filter((event) =>
          event.day === null
          || storyMomentValue(event.day, event.segment) >= current
          || event.status === "accepted"
        )
        .slice(0, 30);
    },
    roleMemoryCount() {
      return Object.keys(this.roleMemories || {}).length;
    },
    displayedMessages() {
      const limit = Math.max(1, Number(this.messageDisplayLimit) || 40);
      return this.messages.slice(-limit);
    },
    hiddenEarlierMessageCount() {
      return Math.max(0, this.messages.length - this.displayedMessages.length);
    },
    filteredErrorLogs() {
      const filter = this.errorLogFilter;
      if (!filter || filter === "all") return this.errorLogs;
      const patterns = {
        image: /图片|生图|image/i,
        migration: /迁移|migration/i,
        backup: /备份|导入|导出|backup/i,
        chat: /对话|模型|deepseek|grok|chat/i,
        storage: /存储|文件|indexeddb|storage/i,
      };
      const pattern = patterns[filter];
      return pattern
        ? this.errorLogs.filter((entry) => pattern.test(`${entry.source || ""} ${entry.message || ""}`))
        : this.errorLogs;
    },
    selectedRoleMemory() {
      return this.roleMemories?.[this.roleDetailTargetId] || null;
    },
    historyRecentGroups() {
      const groups = new Map();
      for (const message of this.historyStorage?.messages || []) {
        const label = `剧情第 ${Math.max(1, Number(message.storyDay) || 1)} 天`;
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(message);
      }
      return [...groups.entries()]
        .slice(0, 12)
        .map(([label, messages]) => ({ label, messages: messages.slice(0, 20) }));
    },
    visibleImageJobs() {
      return this.imageJobs.filter((job) =>
        job
        && (
          job.status === "queued"
          || job.status === "running"
          || job.status === "failed"
          || (job.status === "completed" && job.imageUrl)
        )
      );
    },
    sceneImageJobs() {
      return this.visibleImageJobs.filter((job) => ["scene", "stage-background"].includes(job.kind));
    },
    characterImageJobs() {
      return this.visibleImageJobs.filter((job) => ["character", "visual-state"].includes(job.kind));
    },
    sceneAlbumCount() {
      return this.sceneImageJobs.filter((job) => job.status === "completed" && job.imageUrl).length;
    },
    characterAlbumCount() {
      return this.characterImageJobs.filter((job) => job.status === "completed" && job.imageUrl).length;
    },
    galleryJobs() {
      return this.galleryTab === "character" ? this.characterImageJobs : this.sceneImageJobs;
    },
    displayedGalleryJobs() {
      return this.galleryJobs.slice(0, this.galleryDisplayLimit);
    },
    compressibleMessageCount() {
      return this.messages.filter((message) =>
        !message.typing
        && (message.role === "user" || message.role === "assistant")
        && typeof message.content === "string"
        && message.content.trim()
      ).length;
    },
    activeCharacterRole() {
      if (this.characterTargetId === "primary") return this.profile;
      if (this.characterTargetId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === this.characterTargetId)
        || this.ensemble.temporaryRoles.find((role) => role.id === this.characterTargetId)
        || null;
    },
    managedRoleCards() {
      return [
        { id: "primary", role: this.profile, typeLabel: "主角色", canDelete: false },
        ...(this.fixedFriendAvailable ? [{ id: "friend", role: this.ensemble.friend, typeLabel: "固定角色", canDelete: false }] : []),
        ...this.ensemble.customRoles.map((role) => ({
          id: role.id,
          role,
          typeLabel: "固定角色",
          canDelete: true,
        })),
        ...this.ensemble.temporaryRoles.map((role) => ({
          id: role.id,
          role,
          typeLabel: "临时角色",
          canDelete: true,
        })),
      ].filter((entry) => entry.role);
    },
    selectedRole() {
      if (this.roleDetailTargetId === "primary") return this.profile;
      if (this.roleDetailTargetId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === this.roleDetailTargetId)
        || this.ensemble.temporaryRoles.find((role) => role.id === this.roleDetailTargetId)
        || null;
    },
    selectedRoleIsTemporary() {
      return this.ensemble.temporaryRoles.some((role) => role.id === this.roleDetailTargetId);
    },
    selectedRoleVisualStates() {
      return Array.isArray(this.selectedRole?.visualStates) ? this.selectedRole.visualStates : [];
    },
    selectedRoleAlbumItems() {
      const role = this.selectedRole;
      const targetId = this.roleDetailTargetId;
      if (!role || !targetId) return [];
      const items = [];
      const seenUrls = new Set();
      const add = (item) => {
        const imageUrl = String(item?.imageUrl || "");
        if (!imageUrl || seenUrls.has(imageUrl)) return;
        seenUrls.add(imageUrl);
        items.push(item);
      };
      const states = Array.isArray(role.visualStates) ? role.visualStates : [];
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
        .forEach((job) => {
          const state = states.find((item) =>
            item.imageJobId === job.id
            || (job.visualStateId && item.id === job.visualStateId)
          );
          add({
            ...job,
            albumSource: "job",
            visualStateId: job.visualStateId || state?.id || "",
            albumTypeLabel: job.kind === "visual-state"
              ? `动作图 · ${state?.name || job.archive?.stateName || "表情动作"}`
              : "人物形象",
            archive: {
              title: job.archive?.title
                || (job.kind === "visual-state"
                  ? `${role.name} · ${state?.name || "动作图"}`
                  : `${role.name}的人物形象`),
              name: role.name,
              age: role.age,
              relation: role.relation,
              personality: role.personality,
              introduction: role.prompt,
              appearance: role.appearance,
              capturedAt: job.updatedAt,
              ...(job.archive || {}),
            },
          });
        });
      states.forEach((state) => {
        const imageUrl = this.visualStateImage(state);
        add({
          id: `role-state-${targetId}-${state.id}`,
          kind: "visual-state",
          targetId,
          targetName: role.name,
          visualStateId: state.id,
          imageUrl,
          prompt: state.finalPrompt || state.prompt || "",
          albumSource: "role-state",
          albumTypeLabel: `动作图 · ${state.name}`,
          updatedAt: state.updatedAt || "",
          archive: {
            title: `${role.name} · ${state.name}`,
            name: role.name,
            age: role.age,
            relation: role.relation,
            personality: `${state.emotion || "自然"} · ${state.action || "自然动作"}`,
            introduction: role.prompt,
            appearance: role.appearance,
            capturedAt: state.updatedAt || "",
          },
        });
      });
      add({
        id: `role-avatar-${targetId}`,
        kind: "character",
        targetId,
        targetName: role.name,
        imageUrl: role.avatarUrl,
        prompt: role.imagePrompt || "",
        albumSource: "role-avatar",
        albumTypeLabel: "当前人物头像",
        updatedAt: "",
        archive: {
          title: `${role.name}的当前头像`,
          name: role.name,
          age: role.age,
          relation: role.relation,
          personality: role.personality,
          introduction: role.prompt,
          appearance: role.appearance,
        },
      });
      add({
        id: `role-base-${targetId}`,
        kind: "visual-state",
        targetId,
        targetName: role.name,
        imageUrl: role.visualBaseImageUrl,
        albumSource: "role-base",
        albumTypeLabel: "动作基底图",
        updatedAt: "",
        archive: {
          title: `${role.name}的动作基底图`,
          name: role.name,
          age: role.age,
          relation: role.relation,
          personality: role.personality,
          introduction: role.prompt,
          appearance: role.appearance,
        },
      });
      return items.sort((left, right) =>
        String(right.archive?.capturedAt || right.updatedAt || "")
          .localeCompare(String(left.archive?.capturedAt || left.updatedAt || ""))
      );
    },
    selectedRoleVisualBaseUrl() {
      const role = this.selectedRole;
      if (!role) return "";
      if (role.visualBaseSource === "upload" && role.visualBaseImageUrl) {
        return role.visualBaseImageUrl;
      }
      if (role.visualBaseImageJobId) {
        const job = this.imageJobs.find((item) =>
          item.id === role.visualBaseImageJobId
          && item.status === "completed"
          && item.imageUrl
        );
        if (job?.imageUrl) return job.imageUrl;
      }
      return role.visualBaseSource === "avatar" ? role.avatarUrl || "" : "";
    },
    selectedVisualState() {
      return this.selectedRoleVisualStates.find((state) => state.id === this.visualStateEditorId) || null;
    },
    selectedVisualGenerateCount() {
      return this.selectedRoleVisualStates.filter((state) =>
        state.enabled !== false && state.selected && !this.visualStateJob(state)
      ).length;
    },
    stageImageUrl() {
      return this.stageLayers[this.stageActiveLayer]?.url || "";
    },
    stageBackgroundJob() {
      if (!this.stageBackground.imageJobId) return null;
      return this.activeImageJobs.find((job) => job.id === this.stageBackground.imageJobId) || null;
    },
    stageBackgroundUrl() {
      if (this.stageBackground.imageUrl) return this.stageBackground.imageUrl;
      if (!this.stageBackground.imageJobId) return "";
      const job = this.imageJobs.find((item) =>
        item.id === this.stageBackground.imageJobId
        && item.status === "completed"
      );
      return job?.imageUrl || "";
    },
    stageStateLabel() {
      const role = this.roleById(this.stageRoleId);
      const state = Array.isArray(role?.visualStates)
        ? role.visualStates.find((item) => item.id === this.stageStateId)
        : null;
      return state?.name || "默认形象";
    },
    stageEmotionLabel() {
      return `情绪 · ${this.stageEmotion || "neutral"}`;
    },
    stageActionLabel() {
      return `动作 · ${this.stageAction || "idle"}`;
    },
    stageMotionClass() {
      if (this.stageIntensity >= 0.72) return "motion-active";
      if (this.stageIntensity <= 0.34) return "motion-calm";
      return "motion-natural";
    },
    selectedRoleImageJob() {
      return this.activeImageJobs.find((job) =>
        job.kind === "character" && job.targetId === this.roleDetailTargetId
      ) || null;
    },
    completedCount() {
      return this.tasks.filter((task) => task.done).length;
    },
    progress() {
      return Math.round((this.completedCount / this.tasks.length) * 100);
    },
    points() {
      return 86 + this.tasks.filter((task) => task.done).reduce((sum, task) => sum + task.points, 0);
    },
};
