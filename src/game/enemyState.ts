// =============================================================================
// ENEMY STATE - Module-level state for enemy units
// =============================================================================

// Enemy kite cooldowns - for ranged enemies retreating from melee
const enemyKiteCooldowns: Record<number, number> = {};

// Enemy kiting state - tracks when enemy is actively kiting (won't re-target until done)
const enemyKitingUntil: Record<number, number> = {};

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

// =============================================================================
// KITING STATE - Tracks when enemy is actively retreating
// =============================================================================

/**
 * Check if an enemy is currently kiting (should not re-acquire targets).
 */
export function isEnemyKiting(unitId: number, now: number): boolean {
    const until = enemyKitingUntil[unitId];
    return until !== undefined && now < until;
}

/**
 * Set when an enemy's kiting movement should end.
 */
export function setEnemyKitingUntil(unitId: number, endTime: number): void {
    enemyKitingUntil[unitId] = endTime;
}

/**
 * Clear kiting state for an enemy (call when kite path is complete or interrupted).
 */
export function clearEnemyKiting(unitId: number): void {
    delete enemyKitingUntil[unitId];
}

/**
 * Clean up all kiting state for a unit (call on unit death).
 */
export function cleanupEnemyKitingState(unitId: number): void {
    delete enemyKitingUntil[unitId];
}

/**
 * Reset all enemy kiting state (for game restart).
 */
export function resetAllEnemyKitingState(): void {
    Object.keys(enemyKitingUntil).forEach(k => delete enemyKitingUntil[Number(k)]);
}
