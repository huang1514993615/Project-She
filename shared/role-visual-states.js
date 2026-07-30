export const DEFAULT_ROLE_VISUAL_STATES = [
  ["idle_neutral", "默认站立", "neutral", "idle", "自然站立，身体放松，双手自然垂落，平静看向镜头"],
  ["gentle_smile", "温柔微笑", "gentle", "listening", "温柔微笑，目光专注，轻轻侧头倾听"],
  ["happy_wave", "开心挥手", "happy", "wave", "开心地挥手问候，笑容明亮，姿态轻快"],
  ["excited_cheer", "兴奋庆祝", "excited", "cheer", "兴奋地举起双手庆祝，身体重心向前，充满活力"],
  ["coquettish_sleeve", "撒娇拉衣角", "coquettish", "hold_sleeve", "撒娇地靠近，一只手轻轻拉住画面外对象的衣角，眼神依赖"],
  ["coquettish_hug", "撒娇求抱", "coquettish", "open_arms", "张开双臂伸手求抱，身体微微前倾，表情期待"],
  ["shy_lookaway", "害羞侧脸", "shy", "look_away", "脸颊微红，视线害羞地移向侧下方，手指轻轻交握"],
  ["mischievous_grin", "调皮坏笑", "mischievous", "lean_close", "微微靠近，露出调皮坏笑，眼神灵动，像刚想到一个小主意"],
  ["proud_hands_hips", "得意叉腰", "proud", "hands_hips", "双手叉腰，微微扬起下巴，神情得意又自信"],
  ["disdain_arms_crossed", "嫌弃抱臂", "disdain", "arms_crossed", "抱起双臂，眉梢轻挑，略带嫌弃地侧目"],
  ["speechless_cold", "无语冷淡", "speechless", "idle", "面无表情地沉默注视，眼神冷淡，嘴角轻微压低"],
  ["jealous_sulk", "吃醋赌气", "jealous", "turn_away", "赌气地别过脸，双臂收紧，余光仍偷偷关注对方"],
  ["curious_tilt", "好奇歪头", "curious", "tilt_head", "好奇地歪头观察，眼睛睁大，身体轻微前倾"],
  ["thinking_chin", "思考托腮", "thinking", "touch_chin", "一手托住下巴认真思考，视线斜向上方"],
  ["confused_pause", "困惑停顿", "confused", "pause", "眉心轻蹙，手掌微抬，露出困惑而迟疑的神情"],
  ["sleepy_yawn", "困倦哈欠", "sleepy", "yawn", "困倦地打哈欠，一手掩住嘴，眼睛半睁"],
  ["tired_rest", "疲惫靠坐", "tired", "rest", "疲惫地靠坐休息，肩膀放松，目光柔和而倦怠"],
  ["aggrieved_down", "委屈低头", "aggrieved", "look_down", "委屈地低下头，嘴唇轻抿，双手不安地绞在一起"],
  ["sad_wipe_tears", "难过擦泪", "sad", "wipe_tears", "眼眶湿润，一手轻轻擦去眼泪，神情难过克制"],
  ["angry_hands_hips", "生气叉腰", "angry", "hands_hips", "生气地叉腰直视前方，眉头皱起，姿态有力量"],
  ["serious_focus", "严肃对视", "serious", "focus", "神情严肃，目光笔直而专注，身体重心稳定"],
  ["surprised_step_back", "惊讶后退", "surprised", "step_back", "惊讶地睁大眼睛，身体后退半步，双手下意识抬起"],
  ["afraid_hide", "害怕躲藏", "afraid", "hide", "紧张害怕地缩起肩膀，侧身躲向掩体或同伴身后"],
  ["alert_scan", "紧张警觉", "alert", "scan", "警觉地观察四周，身体微低，双手保持随时行动的姿势"],
  ["determined_ready", "坚定行动", "determined", "ready", "目光坚定，身体重心前移，已经做好立刻行动的准备"],
  ["reach_hand", "伸手邀请", "expectant", "reach_hand", "向镜头方向伸出一只手发出邀请，表情温柔期待"],
  ["hold_hands_close", "牵手靠近", "affectionate", "hold_hands", "牵住画面外对象的手并靠近，姿态自然亲密，神情安心"],
  ["comfort_open_arms", "张开双臂安慰", "comforting", "comfort", "张开双臂准备安慰拥抱，目光温柔可靠"],
  ["look_back", "回头观察", "alert", "look_back", "身体向前而头部回望，发丝随动作轻动，观察身后动静"],
  ["guard_defend", "警戒防御", "serious", "guard", "护在同伴前方，摆出警戒防御姿态，目光锁定威胁方向"],
  ["cast_spell", "施法", "focused", "cast_spell", "集中精神施展符合角色设定的能力，双手动作明确，有限特效环绕手部"],
  ["signature_action", "角色专属动作", "signature", "signature", "执行最能体现该角色身份、能力与性格的专属动作"],
].map(([id, name, emotion, action, prompt]) => ({
  id,
  name,
  emotion,
  action,
  tags: [emotion, action],
  prompt,
  finalPrompt: "",
  finalPromptVersion: 2,
  imageUrl: "",
  imageJobId: "",
  enabled: true,
  selected: true,
  custom: false,
}));

export function createDefaultRoleVisualStates() {
  return DEFAULT_ROLE_VISUAL_STATES.map((state) => ({
    ...state,
    tags: [...state.tags],
  }));
}

export const ROLE_VISUAL_EMOTIONS = [
  "neutral", "gentle", "happy", "excited", "expectant", "comforting",
  "coquettish", "shy", "mischievous", "proud", "disdain", "speechless",
  "jealous", "curious", "thinking", "confused", "sleepy", "tired",
  "aggrieved", "sad", "angry", "serious", "surprised", "afraid",
  "alert", "determined", "focused", "affectionate", "signature",
];

export const ROLE_VISUAL_ACTIONS = [
  "idle", "listening", "wave", "cheer", "hold_sleeve", "open_arms",
  "look_away", "lean_close", "hands_hips", "arms_crossed", "turn_away",
  "tilt_head", "touch_chin", "pause", "yawn", "rest", "look_down",
  "wipe_tears", "focus", "step_back", "hide", "scan", "ready",
  "reach_hand", "hold_hands", "comfort", "look_back", "guard",
  "cast_spell", "signature",
];
