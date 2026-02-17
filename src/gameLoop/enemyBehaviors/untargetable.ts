// =============================================================================
// UNTARGETABLE ENEMY STATE HELPERS - Shared checks for damage/AI/visibility
// =============================================================================

import { isKrakenFullySubmerged, isKrakenSubmerged } from "./submerge";
import { isShadePhased } from "./shadePhase";

/**
 * True when an enemy should not be targetable or damageable.
 */
export function isEnemyUntargetable(unitId: number): boolean {
    return isKrakenSubmerged(unitId) || isShadePhased(unitId);
}

/**
 * True when an enemy should be hidden from view.
 */
export function isEnemyHiddenFromView(unitId: number): boolean {
    return isKrakenFullySubmerged(unitId) || isShadePhased(unitId);
}
