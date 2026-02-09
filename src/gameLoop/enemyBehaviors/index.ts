// =============================================================================
// ENEMY BEHAVIORS - Main entry point and re-exports
// =============================================================================

// Types
export type { BehaviorBaseContext, SpawnContext, ChargeContext, LeapContext, VinesContext, TentacleContext, RaiseContext, CurseContext, GlareContext } from "./types";
export type { PreAttackContext } from "./preAttack";

// Pre-attack dispatch (fire-and-forget behaviors)
export { runPreAttackBehaviors } from "./preAttack";

// Brood Mother
export { trySpawnMinion } from "./broodMother";

// Construct Charge
export { tryStartChargeAttack } from "./charge";

// Feral Hound Leap
export { tryLeapToTarget, isUnitLeaping, updateLeaps, clearLeaps } from "./leap";

// Corrupt Druid Vines
export { tryVinesSkill } from "./vines";

// Baby Kraken Tentacle
export {
    trySpawnTentacle,
    updateTentacles,
    handleTentacleDeath,
    isTentacleUnit,
    clearTentacles
} from "./tentacle";

// Necromancer Raise Dead
export { tryRaiseDead } from "./necromancer";

// Necromancer Curse
export { tryCurse } from "./curse";

// Acid Slug Patrol
export { tryAcidSlugPatrol, processAcidTrailAndAura } from "./acidSlug";
export type { AcidSlugContext } from "./acidSlug";

// Basilisk Glare
export { tryBasiliskGlare, processGlares, clearGlares } from "./basiliskGlare";

// Baby Kraken Submerge
export {
    trySubmergeKraken,
    isKrakenSubmerged,
    isKrakenFullySubmerged,
    updateSubmergedKrakens,
    clearSubmergedKrakens
} from "./submerge";
