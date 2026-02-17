// =============================================================================
// OCCULTIST DREAMWALKER SLEEP BEHAVIOR - Instant AoE sleep with hit chance
// =============================================================================

import { isCooldownReady, setSkillCooldown, rollHit, applySleep, hasStatusEffect } from "../../combat/combatMath";
import { getAliveUnitsInRange, createAnimatedRing } from "../../combat/damageEffects";
import { COLORS } from "../../core/constants";
import { soundFns } from "../../audio";
import type { SleepContext } from "./types";

/**
 * Try to cast AoE sleep on nearby player units.
 * Each target in the radius rolls independently against the skill's accuracy.
 * @returns true if the spell was cast (even if all targets resisted)
 */
export function trySleep(ctx: SleepContext): boolean {
    const { unit, g, sleepSkill, unitsState, unitsRef, scene, setUnits, skillCooldowns, setSkillCooldowns, addLog, now, defeatedThisFrame } = ctx;

    if (!isCooldownReady(skillCooldowns, unit.id, sleepSkill.name, now)) {
        return false;
    }

    // Find player targets within cast range
    const potentialTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, sleepSkill.range, defeatedThisFrame);
    if (potentialTargets.length === 0) {
        return false;
    }

    // Target the closest player — AoE centered on them
    potentialTargets.sort((a, b) => a.dist - b.dist);
    const primary = potentialTargets[0];
    const centerX = primary.group.position.x;
    const centerZ = primary.group.position.z;

    // Find all player units within the AoE radius of the target position
    const aoeTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", centerX, centerZ, sleepSkill.radius, defeatedThisFrame);

    let hitCount = 0;
    const hitIds: number[] = [];
    const adjustedAccuracy = Math.max(5, sleepSkill.accuracy - 20);

    for (const target of aoeTargets) {
        // Skip already-sleeping targets
        if (hasStatusEffect(target.unit, "sleep")) continue;

        if (rollHit(adjustedAccuracy, unit)) {
            hitIds.push(target.unit.id);
            hitCount++;
        }
    }

    // Apply sleep to all hit targets in one state update
    if (hitIds.length > 0) {
        const hitIdSet = new Set(hitIds);
        setUnits(prev => prev.map(u => {
            if (!hitIdSet.has(u.id)) return u;
            return applySleep(u, unit.id, now);
        }));
    }

    // Visual — purple pulse ring at AoE center
    createAnimatedRing(scene, g.position.x, g.position.z, COLORS.sleepText, {
        innerRadius: 0.2, outerRadius: 0.4, maxScale: 1.15, duration: 220
    });
    createAnimatedRing(scene, centerX, centerZ, COLORS.sleep, {
        innerRadius: 0.1, outerRadius: sleepSkill.radius, maxScale: 1.0, duration: 400
    });
    for (const targetId of hitIds) {
        const targetGroup = unitsRef[targetId];
        if (!targetGroup) continue;
        createAnimatedRing(scene, targetGroup.position.x, targetGroup.position.z, COLORS.sleepText, {
            innerRadius: 0.12, outerRadius: 0.28, maxScale: 1.0, duration: 180
        });
    }

    soundFns.playMagicWave();

    const cooldownKey = `${unit.id}-${sleepSkill.name}`;
    setSkillCooldown(setSkillCooldowns, cooldownKey, sleepSkill.cooldown, now, unit);

    if (hitCount > 0) {
        addLog(`Occultist Dreamwalker's ${sleepSkill.name} puts ${hitCount} target${hitCount > 1 ? "s" : ""} to sleep!`, COLORS.sleepText);
    } else {
        addLog(`Occultist Dreamwalker's ${sleepSkill.name} fails to affect anyone!`, COLORS.logNeutral);
    }

    return true;
}
