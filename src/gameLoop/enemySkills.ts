// =============================================================================
// ENEMY SKILL EXECUTION - Swipe attacks, heals, spawning
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, EnemyStats, EnemySkill, EnemyHealSkill } from "../core/types";
import { COLORS, SWIPE_ANIMATE_DURATION } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamageWithCrit, rollHit, getEffectiveArmor, logAoeHit, logAoeMiss } from "../combat/combatMath";
import { distance } from "../game/geometry";
import { applyDamageToUnit, animateExpandingMesh, getAliveUnitsInRange, spawnDamageNumber, buildDamageContext, createAnimatedRing } from "../combat/damageEffects";
import { soundFns } from "../audio";

// =============================================================================
// ENEMY SKILL EXECUTION
// =============================================================================

export function executeEnemySwipe(
    unit: Unit,
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
        swipeArc.rotation.z = -angle;
    }
    scene.add(swipeArc);

    // Animate the swipe expanding and fading
    animateExpandingMesh(scene, swipeArc, {
        duration: SWIPE_ANIMATE_DURATION,
        initialOpacity: 0.6,
        maxScale: 1.3,
        baseRadius: 1
    });
    createAnimatedRing(scene, g.position.x, g.position.z, "#ff4444", {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.2,
        duration: 220
    });

    // Play sound
    soundFns.playHit();

    // Deal damage to all targets
    let hitCount = 0;
    let totalDamage = 0;
    const dmgCtx = buildDamageContext(scene, damageTexts, hitFlashRef, unitsRef, unitsState, setUnits, addLog, now, defeatedThisFrame);
    hitTargets.forEach(({ unit: target, group: tg }) => {
        if (target.hp <= 0 || defeatedThisFrame.has(target.id)) return;

        const targetData = getUnitStats(target);

        if (rollHit(enemyData.accuracy)) {
            const { damage: dmg } = calculateDamageWithCrit(skill.damage[0], skill.damage[1], getEffectiveArmor(target, targetData.armor), skill.damageType, unit);
            applyDamageToUnit(dmgCtx, target.id, tg, dmg, targetData.name, {
                color: COLORS.damageEnemy,
                targetUnit: target,
                attackerId: unit.id,
                isMeleeHit: true
            });
            createAnimatedRing(scene, tg.position.x, tg.position.z, COLORS.damageEnemy, {
                innerRadius: 0.14,
                outerRadius: 0.3,
                maxScale: 1.05,
                duration: 180
            });
            hitCount++;
            totalDamage += dmg;
        }
    });

    if (hitCount > 0) {
        addLog(logAoeHit(enemyData.name, skill.name, hitCount, totalDamage), COLORS.damageEnemy);
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

        const dist = distance(g.position.x, g.position.z, allyG.position.x, allyG.position.z);
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
    const targetId = bestTarget.unit.id;
    const maxHp = targetStats.maxHp;

    // Estimate heal for visual (actual heal uses fresh state inside callback)
    const estimatedHeal = Math.min(healAmount, maxHp - bestTarget.unit.hp);

    // Apply heal using fresh state to avoid stale HP race condition
    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        if (u.hp <= 0) return u; // Don't heal dead units
        return { ...u, hp: Math.min(u.hp + healAmount, maxHp) };
    }));

    // Spawn heal number (green) - uses snapshot estimate
    spawnDamageNumber(scene, bestTarget.group.position.x, bestTarget.group.position.z, estimatedHeal, "#22c55e", damageTexts, true);

    // Visual effect - purple healing ring on target
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#9932CC", transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(bestTarget.group.position.x, 0.1, bestTarget.group.position.z);
    scene.add(ring);
    animateExpandingMesh(scene, ring, { maxScale: 1.5, baseRadius: 0.4, duration: 300 });
    createAnimatedRing(scene, g.position.x, g.position.z, "#9932CC", {
        innerRadius: 0.2,
        outerRadius: 0.4,
        maxScale: 1.1,
        duration: 220
    });
    createAnimatedRing(scene, bestTarget.group.position.x, bestTarget.group.position.z, "#b56de0", {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.5,
        duration: 260
    });

    soundFns.playHeal();
    addLog(`${enemyData.name} heals ${targetStats.name} for ${estimatedHeal}!`, "#9932CC");

    return true;
}
