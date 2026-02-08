// =============================================================================
// ENEMY BEHAVIORS - Main entry point and re-exports
// =============================================================================

// Types
export type { SpawnContext, ChargeContext, LeapContext, VinesContext, TentacleContext, RaiseContext, CurseContext } from "./types";

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

// Baby Kraken Submerge
export {
    trySubmergeKraken,
    isKrakenSubmerged,
    isKrakenFullySubmerged,
    updateSubmergedKrakens,
    clearSubmergedKrakens
} from "./submerge";
