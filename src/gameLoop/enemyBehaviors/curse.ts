// =============================================================================
// NECROMANCER CURSE BEHAVIOR - Delayed AoE at player position
// =============================================================================

import { isCooldownReady, setSkillCooldown } from "../../combat/combatMath";
import { getAliveUnitsInRange } from "../../combat/damageEffects";
import { startCurse } from "../necromancerCurse";
import type { CurseContext } from "./types";

/**
 * Try to cast a curse at the closest visible player within range.
 * @returns true if a curse was started
 */
export function tryCurse(ctx: CurseContext): boolean {
    const { unit, g, curseSkill, unitsState, unitsRef, scene, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const cooldownKey = `${unit.id}-${curseSkill.name}`;
    if (!isCooldownReady(skillCooldowns, unit.id, curseSkill.name, now)) {
        return false;
    }

    // Find a visible player target within curse range
    const curseTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, curseSkill.range, new Set());
    if (curseTargets.length === 0) {
        return false;
    }

    // Target the closest player
    curseTargets.sort((a, b) => a.dist - b.dist);
    const curseTarget = curseTargets[0];
    startCurse(scene, unit.id, curseSkill, curseTarget.group.position.x, curseTarget.group.position.z, now, addLog);
    setSkillCooldown(setSkillCooldowns, cooldownKey, curseSkill.cooldown, now, unit);

    return true;
}
