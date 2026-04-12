// =============================================================================
// ENEMY SILENCE BEHAVIOR - Single-target silence preventing spell casting
// =============================================================================

import { BUFF_TICK_INTERVAL, COLORS } from "../../core/constants";
import { isCooldownReady, setSkillCooldown, rollHit, hasStatusEffect, applyStatusEffect } from "../../combat/combatMath";
import { getAliveUnitsInRange, createAnimatedRing } from "../../combat/damageEffects";
import { getEnemyUnitStats } from "../../game/units";
import { soundFns } from "../../audio";
import type { SilenceContext } from "./types";

/**
 * Try to cast Silence on the nearest player caster (has mana) within range.
 * Single-target: picks the best target (prefers units with mana / spell users).
 */
export function trySilence(ctx: SilenceContext): boolean {
    const { unit, g, silenceSkill, unitsState, unitsRef, scene, setUnits, skillCooldowns, setSkillCooldowns, addLog, now, defeatedThisFrame } = ctx;

    if (!isCooldownReady(skillCooldowns, unit.id, silenceSkill.name, now)) {
        return false;
    }

    // Find player targets within cast range
    const potentialTargets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, silenceSkill.range, defeatedThisFrame);
    if (potentialTargets.length === 0) {
        return false;
    }

    // Prefer targets that have mana (casters) and aren't already silenced
    potentialTargets.sort((a, b) => {
        const aSilenced = hasStatusEffect(a.unit, "silenced") ? 1 : 0;
        const bSilenced = hasStatusEffect(b.unit, "silenced") ? 1 : 0;
        if (aSilenced !== bSilenced) return aSilenced - bSilenced;
        const aMana = a.unit.mana ?? 0;
        const bMana = b.unit.mana ?? 0;
        if (aMana !== bMana) return bMana - aMana;
        return a.dist - b.dist;
    });

    const target = potentialTargets[0];

    // Skip if target is already silenced
    if (hasStatusEffect(target.unit, "silenced")) {
        return false;
    }

    // Set cooldown regardless of hit/miss
    const cooldownKey = `${unit.id}-${silenceSkill.name}`;
    setSkillCooldown(setSkillCooldowns, cooldownKey, silenceSkill.cooldown, now, unit);

    const casterName = getEnemyUnitStats(unit).name;

    // Visual — purple pulse from caster
    createAnimatedRing(scene, g.position.x, g.position.z, COLORS.silencedText, {
        innerRadius: 0.2, outerRadius: 0.4, maxScale: 1.15, duration: 220
    });

    // Roll hit
    if (!rollHit(silenceSkill.accuracy, unit)) {
        addLog(`${casterName}'s Silence fails to affect ${target.unit.team === "player" ? (target.unit.id <= 6 ? ["", "Barbarian", "Paladin", "Thief", "Wizard", "Monk", "Cleric"][target.unit.id] : "ally") : "target"}!`, COLORS.logNeutral);
        soundFns.playMiss();
        return true;
    }

    // Apply silence
    const targetId = target.unit.id;
    const silenceEffect = {
        type: "silenced" as const,
        duration: silenceSkill.duration,
        tickInterval: BUFF_TICK_INTERVAL,
        timeSinceTick: 0,
        lastUpdateTime: now,
        damagePerTick: 0,
        sourceId: unit.id
    };

    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        return { ...u, statusEffects: applyStatusEffect(u.statusEffects ?? [], silenceEffect) };
    }));

    // Visual — ring on target
    createAnimatedRing(scene, target.group.position.x, target.group.position.z, COLORS.silenced, {
        innerRadius: 0.12, outerRadius: 0.3, maxScale: 1.0, duration: 200
    });

    soundFns.playMagicWave();

    // Get target name for log
    const targetNames = ["", "Barbarian", "Paladin", "Thief", "Wizard", "Monk", "Cleric"];
    const targetName = target.unit.id <= 6 ? targetNames[target.unit.id] : "ally";
    addLog(`${casterName} silences ${targetName}!`, COLORS.silencedText);

    return true;
}
