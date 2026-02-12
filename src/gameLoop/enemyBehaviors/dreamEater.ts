// =============================================================================
// OCCULTIST DREAMWALKER DREAM EATER - High damage nuke on sleeping targets
// =============================================================================

import type { EnemyStats } from "../../core/types";
import { COLORS } from "../../core/constants";
import { isCooldownReady, setSkillCooldown, rollHit, calculateDamageWithCrit, getEffectiveArmor, hasStatusEffect } from "../../combat/combatMath";
import { getAliveUnitsInRange, createAnimatedRing, applyDamageToUnit, buildDamageContext } from "../../combat/damageEffects";
import { getUnitStats } from "../../game/units";
import { soundFns } from "../../audio";
import type { DreamEaterContext } from "./types";

/**
 * Try to cast Dream Eater on a sleeping player unit.
 * Only targets units that are currently asleep. Deals high chaos damage.
 * The damage itself will wake the target via the wake-on-damage logic.
 * @returns true if the spell was cast
 */
export function tryDreamEater(ctx: DreamEaterContext): boolean {
    const {
        unit, g, dreamEaterSkill, unitsState, unitsRef, scene, setUnits,
        skillCooldowns, setSkillCooldowns, addLog, now,
        damageTexts, hitFlashRef, defeatedThisFrame
    } = ctx;

    if (!isCooldownReady(skillCooldowns, unit.id, dreamEaterSkill.name, now)) {
        return false;
    }

    // Find sleeping player units in range
    const targets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, dreamEaterSkill.range, defeatedThisFrame);
    const sleepingTargets = targets.filter(t => hasStatusEffect(t.unit, "sleep"));

    if (sleepingTargets.length === 0) {
        return false;
    }

    // Pick the closest sleeping target
    sleepingTargets.sort((a, b) => a.dist - b.dist);
    const target = sleepingTargets[0];
    const targetData = getUnitStats(target.unit);
    const casterStats = getUnitStats(unit) as EnemyStats;

    const cooldownKey = `${unit.id}-${dreamEaterSkill.name}`;
    setSkillCooldown(setSkillCooldowns, cooldownKey, dreamEaterSkill.cooldown, now, unit);

    // Roll hit
    if (!rollHit(casterStats.accuracy)) {
        addLog(`Occultist Dreamwalker's ${dreamEaterSkill.name} misses ${targetData.name}!`, COLORS.logNeutral);
        return true;
    }

    // Calculate damage
    const { damage: dmg, isCrit } = calculateDamageWithCrit(
        dreamEaterSkill.damage[0], dreamEaterSkill.damage[1],
        getEffectiveArmor(target.unit, targetData.armor),
        dreamEaterSkill.damageType, unit
    );

    // Apply damage (this also wakes the target from sleep)
    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);
    applyDamageToUnit(dmgCtx, target.unit.id, target.group, dmg, targetData.name, {
        color: COLORS.damageEnemy,
        targetUnit: target.unit,
        isCrit
    });

    // Visual — purple ring on target
    createAnimatedRing(scene, target.group.position.x, target.group.position.z, COLORS.sleepText, {
        innerRadius: 0.2, outerRadius: 0.6, maxScale: 1.5, duration: 300
    });

    soundFns.playMagicWave();
    addLog(`Occultist Dreamwalker's ${dreamEaterSkill.name} devours ${targetData.name}'s dreams for ${dmg} damage!`, COLORS.sleepText);

    return true;
}
