// =============================================================================
// SKILL HELPERS - Reusable utility functions for skill execution
// =============================================================================

import type { Unit, UnitGroup, Skill } from "../../core/types";
import { COLORS, CHANNELED_MANA_MULT } from "../../core/constants";
import { UNIT_DATA } from "../../game/playerUnits";
import { hasStatusEffect, getCooldownMultiplier } from "../combatMath";
import { distanceToPoint } from "../../game/geometry";
import { getAliveUnits } from "../../game/unitQuery";
import { updateUnitWith } from "../../core/stateUtils";
import { trySpellBark } from "../barks";
import type { SkillExecutionContext } from "./types";

// =============================================================================
// TARGET FINDING
// =============================================================================

/** Find the closest unit to a target position (within maxDist) */
export function findClosestUnit(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    targetX: number,
    targetZ: number,
    maxDist: number = 2
): { unit: Unit; group: UnitGroup } | null {
    let closest: { unit: Unit; group: UnitGroup } | null = null;
    let closestDist = maxDist;

    for (const unit of units) {
        const g = unitsRef[unit.id];
        if (!g) continue;
        const d = distanceToPoint(g.position, targetX, targetZ);
        if (d < closestDist) {
            closestDist = d;
            closest = { unit, group: g };
        }
    }
    return closest;
}

/** Find closest unit of a specific team to target position - combines getAliveUnits + findClosestUnit */
function findClosestTargetByTeam(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    team: "player" | "enemy",
    targetX: number,
    targetZ: number,
    maxDist: number = 2
): { unit: Unit; group: UnitGroup } | null {
    const aliveUnits = getAliveUnits(units, team);
    return findClosestUnit(aliveUnits, unitsRef, targetX, targetZ, maxDist);
}

// =============================================================================
// ALLY TARGET VALIDATION
// =============================================================================

/**
 * Find and validate an ally target at a position.
 * Consolidates the repeated pattern across heal/cleanse/restoration/mana_transfer:
 *   findClosestTargetByTeam → null guard → "No ally at that location!" log.
 *
 * Returns the target unit + group, or null if none found (with log emitted).
 */
export function findAndValidateAllyTarget(
    ctx: SkillExecutionContext,
    casterId: number,
    targetX: number,
    targetZ: number
): { unit: Unit; group: UnitGroup } | null {
    const closest = findClosestTargetByTeam(ctx.unitsStateRef.current, ctx.unitsRef.current, "player", targetX, targetZ);
    if (!closest) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No ally at that location!`, COLORS.logNeutral);
        return null;
    }
    return { unit: closest.unit, group: closest.group };
}

// =============================================================================
// ENEMY TARGET VALIDATION
// =============================================================================

/**
 * Find and validate an enemy target at a position.
 * Consolidates the repeated pattern across debuff/targeted-damage:
 *   findClosestTargetByTeam → null guard → "No enemy at that location!" log.
 *
 * Returns the target unit + group, or null if none found (with log emitted).
 */
export function findAndValidateEnemyTarget(
    ctx: SkillExecutionContext,
    casterId: number,
    targetX: number,
    targetZ: number
): { unit: Unit; group: UnitGroup } | null {
    const closest = findClosestTargetByTeam(ctx.unitsStateRef.current, ctx.unitsRef.current, "enemy", targetX, targetZ);
    if (!closest) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: No enemy at that location!`, COLORS.logNeutral);
        return null;
    }
    return { unit: closest.unit, group: closest.group };
}

// =============================================================================
// SKILL CONSUMPTION
// =============================================================================

/**
 * Consume skill resources: set cooldown for the used skill and deduct mana.
 * Call this at the START of every skill execution (after validation, before effects).
 * If the caster has shielded effect, cooldowns are doubled (defensive stance penalty).
 * Slowed increases cooldowns by 1.5x, Defiance decreases cooldowns by 0.5x.
 *
 * Note: actionCooldownRef tracks when the UNIT can act again (blocks standard actions).
 * Cantrips use their own per-skill cooldown ref so they can be woven between longer skill lockouts.
 * skillCooldowns tracks per-skill UI animation (only the used skill shows cooldown bar).
 */
export function consumeSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill): void {
    const { unitsStateRef, actionCooldownRef, cantripCooldownRef, setSkillCooldowns, setUnits, addLog } = ctx;
    const now = Date.now();
    const skillCooldownKey = `${casterId}-${skill.name}`;

    if (skill.isCantrip) {
        // Cantrips: fixed per-skill lockout that does not consume the unit-wide action lock.
        const cooldownEnd = now + skill.cooldown;
        cantripCooldownRef.current[skillCooldownKey] = cooldownEnd;
        setSkillCooldowns(prev => ({
            ...prev,
            [skillCooldownKey]: { end: cooldownEnd, duration: skill.cooldown }
        }));
        updateUnitWith(setUnits, casterId, u => ({
            mana: Math.max(0, (u.mana ?? 0) - skill.manaCost),
            cantripUses: { ...u.cantripUses, [skill.name]: Math.max(0, (u.cantripUses?.[skill.name] ?? 0) - 1) }
        }));
        return;
    }

    // Get caster and calculate cooldown multipliers
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    // Shielded doubles cooldowns (defensive stance penalty)
    const shieldedMult = caster && hasStatusEffect(caster, "shielded") ? 2 : 1;
    // Status effects affect cooldowns (slow/chilled increase; defiance/channeled decrease depending on kind)
    const statusMult = caster ? getCooldownMultiplier(caster, skill.kind) : 1;

    const effectiveCooldown = skill.cooldown * shieldedMult * statusMult;
    const cooldownEnd = now + effectiveCooldown;

    // Set internal cooldown ref (unit-level lock)
    actionCooldownRef.current[casterId] = cooldownEnd;

    // Set UI cooldown ONLY for the skill that was used
    setSkillCooldowns(prev => ({
        ...prev,
        [skillCooldownKey]: { end: cooldownEnd, duration: effectiveCooldown }
    }));

    // Deduct mana (clamped to 0 minimum; channeled reduces spell mana costs)
    const manaCost = (skill.kind === "spell" && caster && hasStatusEffect(caster, "channeled"))
        ? Math.floor(skill.manaCost * CHANNELED_MANA_MULT)
        : skill.manaCost;
    updateUnitWith(setUnits, casterId, u => ({ mana: Math.max(0, (u.mana ?? 0) - manaCost) }));

    // Bark on mana-costing spell (damage spells only)
    if (skill.manaCost > 0 && skill.type === "damage") {
        trySpellBark(UNIT_DATA[casterId].name, addLog);
    }
}
