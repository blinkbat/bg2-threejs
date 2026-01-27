// =============================================================================
// COMBAT MATH - Unified damage calculation and combat utilities
// =============================================================================

import type { Unit, UnitData, EnemyStats, StatusEffect, StatusEffectType, DamageType } from "../core/types";
import { POISON_DURATION, POISON_TICK_INTERVAL, POISON_DAMAGE_PER_TICK, SLOW_DURATION, BUFF_TICK_INTERVAL, COLORS } from "../core/constants";

// =============================================================================
// DISTANCE & POSITION UTILITIES
// =============================================================================

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

/**
 * Check if an attack is blocked by a front shield.
 * Returns true if the attack is from the front (within 90 degrees of facing).
 * @param attackerX - Attacker's X position
 * @param attackerZ - Attacker's Z position
 * @param targetX - Target's X position
 * @param targetZ - Target's Z position
 * @param targetFacing - Target's facing direction in radians (0 = +Z direction)
 */
export function isBlockedByFrontShield(
    attackerX: number, attackerZ: number,
    targetX: number, targetZ: number,
    targetFacing: number
): boolean {
    // Direction from target to attacker (where the attack is coming from)
    const dx = attackerX - targetX;
    const dz = attackerZ - targetZ;

    // Angle from target to attacker
    const attackAngle = Math.atan2(dx, dz);

    // Calculate angle difference
    let angleDiff = attackAngle - targetFacing;

    // Normalize to -PI to PI
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // If angle difference is within 90 degrees (PI/2), attack is from the front
    return Math.abs(angleDiff) < Math.PI / 2;
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
 * Armor only reduces physical damage - magic bypasses armor entirely.
 * Always returns at least 1 damage.
 */
export function calculateDamage(rawMin: number, rawMax: number, armor: number, damageType: DamageType): number {
    const rolled = rollDamage(rawMin, rawMax);
    // Only physical damage is reduced by armor
    if (damageType === "physical") {
        return Math.max(1, rolled - armor);
    }
    return rolled;
}

/**
 * Calculate damage from a pre-rolled value (when you've already rolled).
 * Armor only reduces physical damage - magic bypasses armor entirely.
 * Always returns at least 1 damage.
 */
export function applyArmor(rawDamage: number, armor: number, damageType: DamageType): number {
    // Only physical damage is reduced by armor
    if (damageType === "physical") {
        return Math.max(1, rawDamage - armor);
    }
    return rawDamage;
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
    if (hasStatusEffect(unit, "cleansed")) {
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
                    ? { ...e, duration: POISON_DURATION, timeSinceTick: 0, lastUpdateTime: now, damagePerTick: Math.max(e.damagePerTick, damage) }
                    : e
            )
        };
    } else {
        // Apply new poison
        const newPoison: StatusEffect = {
            type: "poison",
            duration: POISON_DURATION,
            tickInterval: POISON_TICK_INTERVAL,
            timeSinceTick: 0,
            lastUpdateTime: now,
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
 * Check if a unit currently has a specific status effect.
 */
export function hasStatusEffect(unit: Unit, effectType: StatusEffectType): boolean {
    return unit.statusEffects?.some(e => e.type === effectType) ?? false;
}

/**
 * Apply the slowed debuff to a unit (1.5x cooldowns, 0.5x move speed for 10s).
 */
export function applySlowed(unit: Unit, sourceId: number, now: number): Unit {
    const existingEffects = unit.statusEffects || [];
    const existingSlowed = existingEffects.find(e => e.type === "slowed");

    if (existingSlowed) {
        // Refresh existing slow
        return {
            ...unit,
            statusEffects: existingEffects.map(e =>
                e.type === "slowed"
                    ? { ...e, duration: SLOW_DURATION, timeSinceTick: 0, lastUpdateTime: now }
                    : e
            )
        };
    }

    // Apply new slow effect
    const slowEffect: StatusEffect = {
        type: "slowed",
        duration: SLOW_DURATION,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,  // Slow doesn't deal damage
        sourceId
    };

    return {
        ...unit,
        statusEffects: [...existingEffects, slowEffect]
    };
}

/**
 * Check if an attacker should apply slow based on their slow chance.
 */
export function shouldApplySlow(attackerData: UnitData | EnemyStats): boolean {
    if (!('slowChance' in attackerData) || !attackerData.slowChance) {
        return false;
    }
    return rollChance(attackerData.slowChance);
}

/**
 * Get effective armor for a unit, applying shielded buff (doubles armor).
 */
export function getEffectiveArmor(unit: Unit, baseArmor: number): number {
    return hasStatusEffect(unit, "shielded") ? baseArmor * 2 : baseArmor;
}

/**
 * Get effective damage range for a unit, accounting for amoeba split weakening.
 * Each split reduces damage by 15%.
 */
export function getEffectiveDamage(unit: Unit, baseDamage: [number, number]): [number, number] {
    if (unit.enemyType === "giant_amoeba" && unit.splitCount !== undefined && unit.splitCount > 0) {
        const scaleFactor = Math.pow(0.85, unit.splitCount);
        return [
            Math.max(1, Math.floor(baseDamage[0] * scaleFactor)),
            Math.max(1, Math.floor(baseDamage[1] * scaleFactor))
        ];
    }
    return baseDamage;
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

/** "{unit} bites {target} for {dmg} damage, draining {heal} life!" - for lifesteal attacks */
export function logLifestealHit(attackerName: string, targetName: string, damage: number, healAmount: number): string {
    return `${attackerName} bites ${targetName} for ${damage} damage, draining ${healAmount} life!`;
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

/** "{target} is slowed!" */
export function logSlowed(targetName: string): string {
    return `${targetName} is slowed!`;
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
        return `${casterName}'s ${skillName} hits ${hitCount} time${hitCount !== 1 ? 's' : ''} for ${totalDamage} total damage!`;
    }
    return `${casterName}'s ${skillName} hits ${hitCount} time${hitCount !== 1 ? 's' : ''}!`;
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

/** "{caster} throws {skill}!" */
export function logTrapThrown(casterName: string, skillName: string): string {
    return `${casterName} throws ${skillName}!`;
}

/** "{skill} triggers, pinning {count} enemies!" */
export function logTrapTriggered(skillName: string, pinnedCount: number): string {
    return `${skillName} triggers, pinning ${pinnedCount} enem${pinnedCount !== 1 ? 'ies' : 'y'}!`;
}

// =============================================================================
// UNIT STATE HELPERS
// =============================================================================

/**
 * Check if a unit is alive (HP > 0 and not defeated this frame).
 * Consolidates the common pattern: `if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) continue;`
 */
export function isUnitAlive(unit: Unit, defeatedThisFrame?: Set<number>): boolean {
    if (unit.hp <= 0) return false;
    if (defeatedThisFrame && defeatedThisFrame.has(unit.id)) return false;
    return true;
}

// =============================================================================
// STATUS EFFECT HELPERS
// =============================================================================

/**
 * Apply a status effect to a unit, optionally replacing an existing effect of the same type.
 * Returns a new statusEffects array (does not mutate).
 *
 * @param existingEffects - Current status effects array (or undefined)
 * @param newEffect - The effect to apply
 * @param replaceExisting - If true, removes any existing effect of the same type first (default: true)
 */
export function applyStatusEffect(
    existingEffects: StatusEffect[] | undefined,
    newEffect: StatusEffect,
    replaceExisting: boolean = true
): StatusEffect[] {
    const effects = existingEffects || [];
    const filtered = replaceExisting
        ? effects.filter(e => e.type !== newEffect.type)
        : effects;
    return [...filtered, newEffect];
}
