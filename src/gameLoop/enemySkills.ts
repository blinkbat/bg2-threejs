// =============================================================================
// ENEMY SKILL EXECUTION - Swipe attacks, heals, spawning
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyStats, EnemySkill, EnemyHealSkill } from "../core/types";
import { COLORS, SWIPE_ANIMATE_DURATION } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamage, calculateDistance, rollHit, getEffectiveArmor, logAoeHit, logAoeMiss } from "../combat/combatMath";
import { applyDamageToUnit, animateExpandingMesh, getAliveUnitsInRange, spawnDamageNumber, type DamageContext } from "../combat/combat";
import { soundFns } from "../audio/sound";

// =============================================================================
// ENEMY SKILL EXECUTION
// =============================================================================

export function executeEnemySwipe(
    _unit: Unit,
    g: UnitGroup,
    skill: EnemySkill,
    enemyData: EnemyStats,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): boolean {
    // Find up to maxTargets player units within range
    const targets = getAliveUnitsInRange(unitsState, unitsRef, "player", g.position.x, g.position.z, skill.range, defeatedThisFrame);
    if (targets.length === 0) return false;

    // Sort by distance and take up to maxTargets
    targets.sort((a, b) => a.dist - b.dist);
    const hitTargets = targets.slice(0, skill.maxTargets);

    // Visual effect - wide arc swipe
    const swipeArc = new THREE.Mesh(
        new THREE.RingGeometry(0.3, skill.range, 32, 1, -Math.PI / 2, Math.PI),
        new THREE.MeshBasicMaterial({ color: "#ff4444", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    swipeArc.rotation.x = -Math.PI / 2;
    swipeArc.position.set(g.position.x, 0.2, g.position.z);

    // Rotate arc to face the primary target
    if (hitTargets.length > 0) {
        const angle = Math.atan2(
            hitTargets[0].group.position.z - g.position.z,
            hitTargets[0].group.position.x - g.position.x
        );
        swipeArc.rotation.z = angle;
    }
    scene.add(swipeArc);

    // Animate the swipe expanding and fading
    animateExpandingMesh(scene, swipeArc, {
        duration: SWIPE_ANIMATE_DURATION,
        initialOpacity: 0.6,
        maxScale: 1.3,
        baseRadius: 1
    });

    // Play sound
    soundFns.playHit();

    // Deal damage to all targets
    let hitCount = 0;
    let totalDamage = 0;
    const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame };
    hitTargets.forEach(({ unit: target, group: tg }) => {
        const targetData = getUnitStats(target);

        if (rollHit(enemyData.accuracy)) {
            const dmg = calculateDamage(skill.damage[0], skill.damage[1], getEffectiveArmor(target, targetData.armor));
            applyDamageToUnit(dmgCtx, target.id, tg, target.hp, dmg, targetData.name, { color: "#ff4444", targetUnit: target });
            hitCount++;
            totalDamage += dmg;
        }
    });

    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, skill.name, hitCount, totalDamage), "#ff4444");
    } else {
        addLog(logAoeMiss(enemyData.name, skill.name), COLORS.logNeutral);
    }

    return true;
}

/**
 * Execute an enemy heal skill - heals a nearby injured ally
 */
export function executeEnemyHeal(
    unit: Unit,
    g: UnitGroup,
    skill: EnemyHealSkill,
    enemyData: EnemyStats,
    unitsRef: Record<number, UnitGroup>,
    unitsState: Unit[],
    scene: THREE.Scene,
    damageTexts: DamageText[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void
): boolean {
    // Find injured allies within range
    const allies = unitsState.filter(u =>
        u.team === "enemy" &&
        u.id !== unit.id &&
        u.hp > 0
    );

    let bestTarget: { unit: Unit; group: UnitGroup; missingHp: number } | null = null;

    for (const ally of allies) {
        const allyG = unitsRef[ally.id];
        if (!allyG) continue;

        const dist = calculateDistance(g.position.x, g.position.z, allyG.position.x, allyG.position.z);
        if (dist > skill.range) continue;

        const allyStats = getUnitStats(ally) as EnemyStats;
        const missingHp = allyStats.maxHp - ally.hp;

        // Only heal if missing at least 25% HP
        if (missingHp < allyStats.maxHp * 0.25) continue;

        if (!bestTarget || missingHp > bestTarget.missingHp) {
            bestTarget = { unit: ally, group: allyG, missingHp };
        }
    }

    if (!bestTarget) return false;

    const healAmount = Math.floor(Math.random() * (skill.heal[1] - skill.heal[0] + 1)) + skill.heal[0];
    const targetStats = getUnitStats(bestTarget.unit) as EnemyStats;
    const newHp = Math.min(bestTarget.unit.hp + healAmount, targetStats.maxHp);
    const actualHeal = newHp - bestTarget.unit.hp;

    // Apply heal
    setUnits(prev => prev.map(u =>
        u.id === bestTarget!.unit.id ? { ...u, hp: newHp } : u
    ));

    // Spawn heal number (green)
    spawnDamageNumber(scene, bestTarget.group.position.x, bestTarget.group.position.z, actualHeal, "#22c55e", damageTexts, true);

    // Visual effect - purple healing ring on target
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#9932CC", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(bestTarget.group.position.x, 0.1, bestTarget.group.position.z);
    scene.add(ring);
    animateExpandingMesh(scene, ring, { maxScale: 1.5, baseRadius: 0.4, duration: 300 });

    soundFns.playHeal();
    addLog(`${enemyData.name} heals ${targetStats.name} for ${actualHeal}!`, "#9932CC");

    return true;
}
