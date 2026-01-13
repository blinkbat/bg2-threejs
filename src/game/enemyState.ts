// =============================================================================
// ENEMY STATE - Module-level state for enemy units
// =============================================================================

// Enemy skill cooldowns - tracked separately from basic attack
const enemySkillCooldowns: Record<number, number> = {};

/**
 * Get the cooldown end time for an enemy's skill.
 */
export function getEnemySkillCooldown(unitId: number): number {
    return enemySkillCooldowns[unitId] || 0;
}

/**
 * Set the cooldown end time for an enemy's skill.
 */
export function setEnemySkillCooldown(unitId: number, cooldownEnd: number): void {
    enemySkillCooldowns[unitId] = cooldownEnd;
}

/**
 * Clean up enemy skill cooldown state for a unit (call on unit death).
 */
export function cleanupEnemySkillCooldown(unitId: number): void {
    delete enemySkillCooldowns[unitId];
}

/**
 * Reset all enemy skill cooldowns (for game restart).
 */
export function resetAllEnemySkillCooldowns(): void {
    Object.keys(enemySkillCooldowns).forEach(k => delete enemySkillCooldowns[Number(k)]);
}
