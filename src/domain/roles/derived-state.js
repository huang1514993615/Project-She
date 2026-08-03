/** Calculates age/personality display state without mutating the saved role. */
export function currentRoleDerivedState(role, storyDay = 1) {
  const source = role?.derivedProfile && typeof role.derivedProfile === "object" ? role.derivedProfile : {};
  const initialActualAge = source.initialActualAge !== null
    && source.initialActualAge !== ""
    && Number.isFinite(Number(source.initialActualAge))
    ? Number(source.initialActualAge)
    : Number.isFinite(Number(role?.age))
      ? Number(role.age)
      : null;
  const initialApparentAge = source.initialApparentAge !== null
    && source.initialApparentAge !== ""
    && Number.isFinite(Number(source.initialApparentAge))
    ? Number(source.initialApparentAge)
    : initialActualAge;
  const anchorStoryDay = Math.max(1, Number(source.anchorStoryDay) || 1);
  const elapsedYears = Math.max(0, Math.floor((Math.max(1, Number(storyDay) || 1) - anchorStoryDay) / 365));
  const agingRule = ["normal", "fixed", "long-lived", "ageless", "unknown"].includes(source.agingRule)
    ? source.agingRule
    : "unknown";
  return {
    ...source,
    agingRule,
    actualAge: initialActualAge === null ? null : agingRule === "ageless" ? initialActualAge : initialActualAge + elapsedYears,
    apparentAge: initialApparentAge === null ? null : agingRule === "normal" ? initialApparentAge + elapsedYears : initialApparentAge,
    corePersonality: String(source.corePersonality || role?.personality || "").trim(),
  };
}
