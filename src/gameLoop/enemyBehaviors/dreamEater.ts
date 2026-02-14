// =============================================================================
// OCCULTIST DREAMWALKER DREAM EATER - High damage nuke on sleeping targets
// =============================================================================

import * as THREE from "three";
import type { EnemyStats } from "../../core/types";
import { COLORS } from "../../core/constants";
import { isCooldownReady, setSkillCooldown, rollHit, calculateDamageWithCrit, getEffectiveArmor, hasStatusEffect } from "../../combat/combatMath";
import { getAliveUnitsInRange, createAnimatedRing, applyDamageToUnit, buildDamageContext } from "../../combat/damageEffects";
import { getUnitStats } from "../../game/units";
import { soundFns } from "../../audio";
import { getGameTime } from "../../core/gameClock";
import type { DreamEaterContext } from "./types";

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function createDreamBeam(
    scene: THREE.Scene,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    duration: number = 300
): void {
    const from = new THREE.Vector3(fromX, 0.8, fromZ);
    const to = new THREE.Vector3(toX, 0.8, toZ);
    const direction = new THREE.Vector3().subVectors(to, from);
    const beamLength = direction.length();
    if (beamLength < 0.05) return;

    direction.normalize();

    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, beamLength, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: COLORS.sleepText, transparent: true, opacity: 0.82 })
    );
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(UP_AXIS, direction);
    scene.add(beam);

    const startTime = getGameTime();
    const animate = () => {
        const t = Math.min(1, (getGameTime() - startTime) / duration);
        const material = beam.material as THREE.MeshBasicMaterial;
        material.opacity = 0.82 * (1 - t);

        const pulseScale = 1 + Math.sin(t * Math.PI) * 0.3;
        beam.scale.set(pulseScale, 1, pulseScale);

        if (t < 1) {
            requestAnimationFrame(animate);
            return;
        }

        scene.remove(beam);
        beam.geometry.dispose();
        material.dispose();
    };

    requestAnimationFrame(animate);
}

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

    createAnimatedRing(scene, g.position.x, g.position.z, COLORS.sleepText, {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: 1.15,
        duration: 220
    });

    // Roll hit
    if (!rollHit(casterStats.accuracy)) {
        createAnimatedRing(scene, target.group.position.x, target.group.position.z, COLORS.logNeutral, {
            innerRadius: 0.1,
            outerRadius: 0.25,
            maxScale: 1.0,
            duration: 160
        });
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

    createDreamBeam(scene, g.position.x, g.position.z, target.group.position.x, target.group.position.z);
    createAnimatedRing(scene, target.group.position.x, target.group.position.z, COLORS.sleepText, {
        innerRadius: 0.2,
        outerRadius: 0.6,
        maxScale: 1.5,
        duration: 300
    });

    soundFns.playMagicWave();
    addLog(`Occultist Dreamwalker's ${dreamEaterSkill.name} devours ${targetData.name}'s dreams for ${dmg} damage!`, COLORS.sleepText);

    return true;
}
