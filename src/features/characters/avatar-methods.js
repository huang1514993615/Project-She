/** Avatar preset behavior. Uploaded images are never overwritten by gender changes. */
export const avatarMethods = {
  syncCoreAvatarToGender() {
    const preset = this.coreAvatarPresets.find((item) => item.gender === this.profile.gender)
      || this.coreAvatarPresets.find((item) => item.id === "neutral-coast")
      || this.coreAvatarPresets[0];
    const currentUsesPreset = this.coreAvatarPresets.some((item) => item.url === this.profile.avatarUrl);
    if (!this.profile.avatarUrl || currentUsesPreset) this.profile.avatarUrl = preset.url;
  },
  migrateLegacyCoreAvatar() {
    if (!/^data:image\/svg\+xml/i.test(String(this.profile.avatarUrl || ""))) return false;
    this.profile.avatarUrl = this.defaultCoreAvatarPreset.url;
    return true;
  },
  selectCoreAvatar(preset) {
    if (preset?.url) this.profile.avatarUrl = preset.url;
  },
};
