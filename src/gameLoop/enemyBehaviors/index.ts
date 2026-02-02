// =============================================================================
// ENEMY BEHAVIORS - Main entry point and re-exports
// =============================================================================

// Types
export type { SpawnContext, ChargeContext, LeapContext, VinesContext, TentacleContext } from "./types";

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

// Baby Kraken Submerge
export {
    trySubmergeKraken,
    isKrakenSubmerged,
    isKrakenFullySubmerged,
    updateSubmergedKrakens,
    clearSubmergedKrakens
} from "./submerge";
