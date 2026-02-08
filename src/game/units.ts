import type { UnitData, EnemyStats, Unit } from "../core/types";
import { getEffectiveUnitData } from "./playerUnits";
import { ENEMY_STATS } from "./enemyStats";

// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Default melee attack range (used when unit has no range specified) */
export const DEFAULT_MELEE_RANGE = 1.8;

/**
 * Get stats for any unit (player or enemy).
 * For player units, returns effective stats with equipment and stat bonuses applied.
 */
export function getUnitStats(unit: Unit): UnitData | EnemyStats {
    if (unit.team === "player") {
        // Return effective stats including equipment and character stat bonuses
        return getEffectiveUnitData(unit.id, unit);
    }
    // Safely handle missing enemyType - fallback to kobold stats
    if (!unit.enemyType) return ENEMY_STATS.kobold;
    return ENEMY_STATS[unit.enemyType];
}

/** Get the attack range for any unit (player or enemy) */
export function getAttackRange(unit: Unit): number {
    const stats = getUnitStats(unit);
    return stats.range ?? DEFAULT_MELEE_RANGE;
}
