// =============================================================================
// ENEMY BEHAVIORS - Main entry point and re-exports
// =============================================================================

// Pre-attack dispatch (fire-and-forget behaviors)
export { runPreAttackBehaviors, cleanupEnemyActionCooldown, resetAllEnemyActionCooldowns } from "./preAttack";

// Construct Charge
export { tryStartChargeAttack } from "./charge";

// Feral Hound Leap
export { tryLeapToTarget, isUnitLeaping, updateLeaps, clearLeaps } from "./leap";

// Corrupt Druid Vines
export { tryVinesSkill } from "./vines";

// Baby Kraken Tentacle
export {
    updateTentacles,
    clearTentacles
} from "./tentacle";

// Acid Slug Patrol
export { tryAcidSlugPatrol, processAcidTrailAndAura } from "./acidSlug";

// Basilisk Glare
export { processGlares, clearGlares, isUnitCastingGlare } from "./basiliskGlare";

// Baby Kraken Submerge
export {
    updateSubmergedKrakens,
    clearSubmergedKrakens
} from "./submerge";

// Wandering Shade Phase Shift
export { isShadePhased, processShadePhases, clearShadePhases } from "./shadePhase";

// Shared untargetable/hidden state helpers
export { isEnemyUntargetable, isEnemyHiddenFromView } from "./untargetable";
