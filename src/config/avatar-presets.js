/** Built-in avatars are distribution assets; user uploads always take precedence. */
function bundledAvatarAsset(id, filename) {
  return window.__NIGHT_MAILBOX_CORE_AVATARS__?.[id] || `./avatars/${filename}`;
}

export const CORE_AVATAR_PRESETS = [
  { id: "woman-coral", label: "暖珊瑚", gender: "女性", url: bundledAvatarAsset("woman-coral", "companion-woman-coral.jpg") },
  { id: "woman-mist", label: "薄雾蓝", gender: "女性", url: bundledAvatarAsset("woman-mist", "companion-woman-mist.jpg") },
  { id: "man-sage", label: "暖松绿", gender: "男性", url: bundledAvatarAsset("man-sage", "companion-man-sage.jpg") },
  { id: "man-night", label: "夜航蓝", gender: "男性", url: bundledAvatarAsset("man-night", "companion-man-night.jpg") },
  { id: "neutral-coast", label: "海岸灰", gender: "非二元", url: bundledAvatarAsset("neutral-coast", "companion-neutral-coast.jpg") },
];
