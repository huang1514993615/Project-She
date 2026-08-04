/**
 * 新安装使用的空白档案。
 * 发行版不预装作者的世界观、角色或剧情；用户完成世界设定后再由 AI 建立人物。
 */
export const STANDALONE_DEFAULT_HISTORY = [];

export const STANDALONE_DEFAULT_SETTINGS = {
  scenarioVersion: "world-first-onboarding-v2",
  onboardingCompleted: false,
  onboardingStep: 1,
  onboardingDismissed: false,
  storyInitialized: false,
  worldVersion: 0,
  worldSyncPending: false,
  userProfile: {
    name: "",
    gender: "未指定",
    pronoun: "TA",
  },
  profile: {
    name: "",
    age: 24,
    gender: "女性",
    personality: "",
    relation: "旅伴",
    prompt: "",
    appearance: "",
    imagePrompt: "",
    avatarUrl: "",
    worldVersion: 0,
    derivedProfile: {},
  },
  ensemble: {
    enabled: false,
    autoGuests: true,
    maxTurns: 3,
    friend: {
      name: "",
      age: 24,
      gender: "未指定",
      personality: "",
      relation: "",
      prompt: "",
      appearance: "",
      imagePrompt: "",
      avatarUrl: "",
      derivedProfile: {},
    },
    customRoles: [],
    temporaryRoles: [],
  },
  roleMemories: {},
  storySummary: "",
  storyClock: { day: 1, segment: "morning", location: "" },
  storyEvents: [],
  worldSetting: "",
};
