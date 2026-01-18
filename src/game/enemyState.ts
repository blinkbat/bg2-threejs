// =============================================================================
// ENEMY STATE - Module-level state for enemy units
// =============================================================================

// Enemy kite cooldowns - for ranged enemies retreating from melee
const enemyKiteCooldowns: Record<number, number> = {};

// =============================================================================
// KITE COOLDOWNS
// =============================================================================

/**
 * Get the cooldown end time for an enemy's kite ability.
 */
export function getEnemyKiteCooldown(unitId: number): number {
    return enemyKiteCooldowns[unitId] || 0;
}

/**
 * Set the cooldown end time for an enemy's kite ability.
 */
export function setEnemyKiteCooldown(unitId: number, cooldownEnd: number): void {
    enemyKiteCooldowns[unitId] = cooldownEnd;
}

/**
 * Clean up enemy kite cooldown state for a unit (call on unit death).
 */
export function cleanupEnemyKiteCooldown(unitId: number): void {
    delete enemyKiteCooldowns[unitId];
}

/**
 * Reset all enemy kite cooldowns (for game restart).
 */
export function resetAllEnemyKiteCooldowns(): void {
    Object.keys(enemyKiteCooldowns).forEach(k => delete enemyKiteCooldowns[Number(k)]);
}
