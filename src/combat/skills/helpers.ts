// =============================================================================
// SKILL HELPERS - Reusable utility functions for skill execution
// =============================================================================

import type { Unit, UnitGroup, Skill } from "../../core/types";
import { UNIT_DATA } from "../../game/units";
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
export function findClosestTargetByTeam(
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
// SKILL CONSUMPTION
// =============================================================================

/**
 * Consume skill resources: set cooldown for the used skill and deduct mana.
 * Call this at the START of every skill execution (after validation, before effects).
 * If the caster has shielded effect, cooldowns are doubled (defensive stance penalty).
 * Slowed increases cooldowns by 1.5x, Defiance decreases cooldowns by 0.5x.
 *
 * Note: actionCooldownRef tracks when the UNIT can act again (blocks all actions).
 * skillCooldowns tracks per-skill UI animation (only the used skill shows cooldown bar).
 */
export function consumeSkill(ctx: SkillExecutionContext, casterId: number, skill: Skill): void {
    const { unitsStateRef, actionCooldownRef, setSkillCooldowns, setUnits, addLog } = ctx;
    const now = Date.now();

    // Get caster and calculate cooldown multipliers
    const caster = unitsStateRef.current.find(u => u.id === casterId);
    // Shielded doubles cooldowns (defensive stance penalty)
    const shieldedMult = caster && hasStatusEffect(caster, "shielded") ? 2 : 1;
    // Slow/Defiance affect cooldowns (slow increases, defiance decreases)
    const statusMult = caster ? getCooldownMultiplier(caster) : 1;

    const effectiveCooldown = skill.cooldown * shieldedMult * statusMult;
    const cooldownEnd = now + effectiveCooldown;

    // Set internal cooldown ref (unit-level lock)
    actionCooldownRef.current[casterId] = cooldownEnd;

    // Set UI cooldown ONLY for the skill that was used
    setSkillCooldowns(prev => ({
        ...prev,
        [`${casterId}-${skill.name}`]: { end: cooldownEnd, duration: effectiveCooldown }
    }));

    // Deduct mana (clamped to 0 minimum)
    updateUnitWith(setUnits, casterId, u => ({ mana: Math.max(0, (u.mana ?? 0) - skill.manaCost) }));

    // Bark on mana-costing spell (damage spells only)
    if (skill.manaCost > 0 && skill.type === "damage") {
        trySpellBark(UNIT_DATA[casterId].name, addLog);
    }
}
