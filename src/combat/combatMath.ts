// =============================================================================
// COMBAT MATH - Unified damage calculation and combat utilities
// =============================================================================

import type { Unit, UnitData, EnemyStats, StatusEffect } from "../core/types";
import { POISON_DURATION, POISON_TICK_INTERVAL, POISON_DAMAGE_PER_TICK, COLORS } from "../core/constants";

// =============================================================================
// DISTANCE & POSITION UTILITIES
// =============================================================================

/** Calculate distance between two 2D points (x,z plane) */
export function calculateDistance(x1: number, z1: number, x2: number, z2: number): number {
    return Math.hypot(x2 - x1, z2 - z1);
}

/** Get direction vector and distance between two points. Returns normalized dx/dz and distance. */
export function getDirectionAndDistance(
    fromX: number, fromZ: number,
    toX: number, toZ: number
): { dx: number; dz: number; dist: number } {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return { dx: 0, dz: 0, dist: 0 };
    return { dx: dx / dist, dz: dz / dist, dist };
}

// =============================================================================
// GRID UTILITIES
// =============================================================================

/** Convert world position to grid cell coordinates */
export function getGridCell(x: number, z: number): { cellX: number; cellZ: number } {
    return { cellX: Math.floor(x), cellZ: Math.floor(z) };
}

// =============================================================================
// PROBABILITY & DAMAGE CALCULATIONS
// =============================================================================

/** Roll a percentage chance (0-100). Returns true if roll succeeds. */
export const rollChance = (percent: number): boolean =>
    Math.random() * 100 < percent;

// Roll random damage in a range (inclusive)
export const rollDamage = (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min;

// Roll hit based on accuracy percentage
export const rollHit = (accuracy: number): boolean =>
    rollChance(accuracy);

/**
 * Calculate final damage after armor reduction.
 * Always returns at least 1 damage.
 */
export function calculateDamage(rawMin: number, rawMax: number, armor: number): number {
    const rolled = rollDamage(rawMin, rawMax);
    return Math.max(1, rolled - armor);
}

/**
 * Calculate damage from a pre-rolled value (when you've already rolled).
 * Always returns at least 1 damage.
 */
export function applyArmor(rawDamage: number, armor: number): number {
    return Math.max(1, rawDamage - armor);
}

/**
 * Get damage color based on who is taking damage.
 * For AOE damage, enemies show neutral (orange) instead of player (green).
 */
export function getDamageColor(targetTeam: "player" | "enemy", isAoe: boolean = false): string {
    if (targetTeam === "player") return COLORS.damageEnemy;
    return isAoe ? COLORS.damageNeutral : COLORS.damagePlayer;
}

/**
 * Apply or refresh poison on a unit.
 * Returns the updated unit with poison effect, or the same unit if immune (cleansed).
 * @param customDamage - Optional custom damage per tick (defaults to POISON_DAMAGE_PER_TICK)
 */
export function applyPoison(unit: Unit, sourceId: number, now: number, customDamage?: number): Unit {
    // Check for poison immunity (cleansed effect)
    if (hasCleansedEffect(unit)) {
        return unit;  // Immune to poison, no change
    }

    const existingEffects = unit.statusEffects || [];
    const existingPoison = existingEffects.find(e => e.type === "poison");
    const damage = customDamage ?? POISON_DAMAGE_PER_TICK;

    if (existingPoison) {
        // Refresh existing poison (keep the stronger damage if re-poisoned with weaker)
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "poison"
                    ? { ...e, duration: POISON_DURATION, lastTick: now, damagePerTick: Math.max(e.damagePerTick, damage) }
                    : e
            )
        };
    } else {
        // Apply new poison
        const newPoison: StatusEffect = {
            type: "poison",
            duration: POISON_DURATION,
            tickInterval: POISON_TICK_INTERVAL,
            lastTick: now,
            damagePerTick: damage,
            sourceId
        };
        return {
            ...unit,
            statusEffects: [...existingEffects, newPoison]
        };
    }
}

/**
 * Check if an attacker should apply poison based on their poison chance.
 */
export function shouldApplyPoison(attackerData: UnitData | EnemyStats): boolean {
    if (!('poisonChance' in attackerData) || !attackerData.poisonChance) {
        return false;
    }
    return rollChance(attackerData.poisonChance);
}

/**
 * Check if a unit currently has the poison status effect.
 */
export function hasPoisonEffect(unit: Unit): boolean {
    return unit.statusEffects?.some(e => e.type === "poison") ?? false;
}

/**
 * Check if a unit currently has the shielded status effect.
 */
export function hasShieldedEffect(unit: Unit): boolean {
    return unit.statusEffects?.some(e => e.type === "shielded") ?? false;
}

/**
 * Check if a unit currently has the stunned status effect.
 */
export function hasStunnedEffect(unit: Unit): boolean {
    return unit.statusEffects?.some(e => e.type === "stunned") ?? false;
}

/**
 * Check if a unit currently has the cleansed (poison immune) status effect.
 */
export function hasCleansedEffect(unit: Unit): boolean {
    return unit.statusEffects?.some(e => e.type === "cleansed") ?? false;
}

/**
 * Get effective armor for a unit, applying shielded buff (doubles armor).
 */
export function getEffectiveArmor(unit: Unit, baseArmor: number): number {
    return hasShieldedEffect(unit) ? baseArmor * 2 : baseArmor;
}

/**
 * Get HP percentage for a unit.
 */
export function getHpPercentage(hp: number, maxHp: number): number {
    return (hp / maxHp) * 100;
}

/**
 * Get HP bar color based on percentage.
 */
export function getHpColor(hpPct: number): string {
    if (hpPct > 50) return COLORS.hpHigh;
    if (hpPct > 25) return COLORS.hpMedium;
    return COLORS.hpLow;
}

/**
 * Get mana value safely with fallback to 0.
 */
export function getMana(unit: Unit): number {
    return unit.mana ?? 0;
}

/**
 * Check if unit has enough mana for a skill.
 */
export function hasEnoughMana(unit: Unit, manaCost: number): boolean {
    return getMana(unit) >= manaCost;
}

// =============================================================================
// COMBAT LOG MESSAGES - Centralized for consistency
// =============================================================================

/** "{unit}'s {skill} hits {target} for {dmg} damage!" */
export function logHit(attackerName: string, skillName: string, targetName: string, damage: number): string {
    return `${attackerName}'s ${skillName} hits ${targetName} for ${damage} damage!`;
}

/** "{unit}'s {skill} misses {target}." */
export function logMiss(attackerName: string, skillName: string, targetName: string): string {
    return `${attackerName}'s ${skillName} misses ${targetName}.`;
}

/** "{unit}'s {skill} heals {target} for {amount}!" */
export function logHeal(casterName: string, skillName: string, targetName: string, amount: number): string {
    return `${casterName}'s ${skillName} heals ${targetName} for ${amount}!`;
}

/** "{target} is poisoned!" */
export function logPoisoned(targetName: string): string {
    return `${targetName} is poisoned!`;
}

/** "{target} is defeated!" */
export function logDefeated(targetName: string): string {
    return `${targetName} is killed!`;
}

/** "{unit} casts {skill}!" */
export function logCast(casterName: string, skillName: string): string {
    return `${casterName} casts ${skillName}!`;
}

/** "{unit}'s {skill} hits {count} target(s) for {damage} total damage!" */
export function logAoeHit(casterName: string, skillName: string, hitCount: number, totalDamage?: number): string {
    if (totalDamage !== undefined) {
        return `${casterName}'s ${skillName} hits ${hitCount} target${hitCount !== 1 ? 's' : ''} for ${totalDamage} total damage!`;
    }
    return `${casterName}'s ${skillName} hits ${hitCount} target${hitCount !== 1 ? 's' : ''}!`;
}

/** "{unit}'s {skill} misses!" (for AOE that hits nothing) */
export function logAoeMiss(casterName: string, skillName: string): string {
    return `${casterName}'s ${skillName} misses!`;
}

/** "{unit}'s {skill} taunts {count} enemies!" */
export function logTaunt(casterName: string, skillName: string, tauntedCount: number): string {
    return `${casterName}'s ${skillName} taunts ${tauntedCount} enem${tauntedCount !== 1 ? 'ies' : 'y'}!`;
}

/** "{unit}'s {skill} echoes... but no enemies are affected." */
export function logTauntMiss(casterName: string, skillName: string): string {
    return `${casterName}'s ${skillName} echoes... but no enemies are affected.`;
}

/** "{unit} activates {skill}!" */
export function logBuff(casterName: string, skillName: string): string {
    return `${casterName} activates ${skillName}!`;
}

/** "{target} is stunned!" */
export function logStunned(targetName: string): string {
    return `${targetName} is stunned!`;
}

/** "{caster} cleanses {target}!" */
export function logCleanse(casterName: string, targetName: string): string {
    return `${casterName} cleanses ${targetName}!`;
}
