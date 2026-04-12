// =============================================================================
// ENEMY ATTACK - Handles enemy basic attack execution
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, SwingAnimation, FireballProjectile } from "../core/types";
import { BUFF_TICK_INTERVAL, COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamageWithCrit, rollHit, rollChance, rollDamage, getEffectiveArmor, getEffectiveDamage, shouldApplyPoison, shouldApplySlow, logHit, logLifestealHit, logMiss, logPoisoned, logSlowed, applyStatusEffect, logStunned, hasStatusEffect, applyArmor } from "../combat/combatMath";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, applyLifesteal, type DamageContext } from "../combat/damageEffects";
import { startAttackBump } from "./swingAnimations";
import { CRIT_MULTIPLIER } from "../game/statBonuses";
import { soundFns } from "../audio";
import { spawnSwingIndicator } from "./swingAnimations";
import { getGameTime } from "../core/gameClock";

// =============================================================================
// FIREBALL CONSTANTS
// =============================================================================

const FIREBALL_SPEED = 0.03;        // Very slow-moving projectile
const FIREBALL_MAX_DISTANCE = 12;   // Max travel distance before expiring

// Cached fireball geometries (shared across all fireballs, never disposed)
const fireballOuterGeo = new THREE.SphereGeometry(0.35, 12, 8);
const fireballInnerGeo = new THREE.SphereGeometry(0.25, 8, 6);

// =============================================================================
// TYPES
// =============================================================================

interface EnemyAttackContext {
    scene: THREE.Scene;
    attacker: Unit;
    attackerG: UnitGroup;
    target: Unit;
    targetG: UnitGroup;
    attackerStats: EnemyStats;
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    unitsStateRef: React.RefObject<Unit[]>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    defeatedThisFrame: Set<number>;
    swingAnimations: SwingAnimation[];
    projectilesRef: Projectile[];
}

// =============================================================================
// RANGED ATTACK
// =============================================================================

/**
 * Execute a ranged basic attack (spawns a projectile).
 */
function executeEnemyRangedAttack(ctx: EnemyAttackContext): void {
    const { scene, attackerG, target, attackerStats, projectilesRef, attacker } = ctx;

    const projectile = createProjectile(scene, "enemy", attackerG.position.x, attackerG.position.z, attackerStats.projectileColor!);
    projectilesRef.push({
        type: "basic",
        mesh: projectile,
        targetId: target.id,
        attackerId: attacker.id,
        speed: getProjectileSpeed("enemy")
    });
    soundFns.playAttack();
}

// =============================================================================
// FIREBALL ATTACK
// =============================================================================

/**
 * Create a fireball mesh - glowing orange sphere.
 */
function createFireballMesh(scene: THREE.Scene, x: number, z: number): THREE.Mesh {
    const material = new THREE.MeshPhongMaterial({
        color: "#ff4500",
        emissive: "#9a2400",
        emissiveIntensity: 0.62,
        specular: new THREE.Color("#ffd080"),
        shininess: 70,
        transparent: true,
        opacity: 0.9
    });
    const mesh = new THREE.Mesh(fireballOuterGeo, material);
    mesh.position.set(x, 0.5, z);
    mesh.userData.visualPhase = Math.random() * Math.PI * 2;
    mesh.userData.sharedGeometry = true;
    scene.add(mesh);

    const innerGlow = new THREE.Mesh(
        fireballInnerGeo,
        new THREE.MeshBasicMaterial({
            color: "#ffcc00",
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    innerGlow.userData.sharedGeometry = true;
    mesh.add(innerGlow);

    return mesh;
}

/**
 * Execute a fireball attack (slow-moving projectile that damages opposing-team units).
 */
function executeEnemyFireballAttack(ctx: EnemyAttackContext): void {
    const { scene, attacker, attackerG, targetG, attackerStats, projectilesRef } = ctx;

    // Calculate direction to target
    const dx = targetG.position.x - attackerG.position.x;
    const dz = targetG.position.z - attackerG.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.1) return;  // Too close, skip

    const dirX = dx / dist;
    const dirZ = dz / dist;

    const mesh = createFireballMesh(scene, attackerG.position.x, attackerG.position.z);

    const fireballProj: FireballProjectile = {
        type: "fireball",
        mesh,
        attackerId: attacker.id,
        speed: FIREBALL_SPEED,
        damage: attackerStats.damage,
        damageType: "fire",
        startX: attackerG.position.x,
        startZ: attackerG.position.z,
        directionX: dirX,
        directionZ: dirZ,
        maxDistance: FIREBALL_MAX_DISTANCE,
        hitUnits: new Set<number>()
    };

    projectilesRef.push(fireballProj);
    soundFns.playAttack();
}

// =============================================================================
// MELEE ATTACK
// =============================================================================

/**
 * Execute a melee basic attack with damage, poison, slow, and lifesteal handling.
 */
function executeEnemyMeleeAttack(ctx: EnemyAttackContext): void {
    const {
        scene, attacker, attackerG, target, targetG, attackerStats,
        damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now,
        defeatedThisFrame, swingAnimations
    } = ctx;

    const targetData = getUnitStats(target);
    spawnSwingIndicator(scene, attackerG, targetG, false, swingAnimations, getGameTime());

    if (rollHit(attackerStats.accuracy, attacker)) {
        // Check for bite attack (random chance to bite instead of claw)
        const isBite = attackerStats.biteChance && attackerStats.biteDamage && rollChance(attackerStats.biteChance);
        const baseDamage = isBite ? attackerStats.biteDamage! : attackerStats.damage;
        const enrageMult = hasStatusEffect(attacker, "enraged") && attackerStats.enrage ? attackerStats.enrage.damageMultiplier : 1;
        const effectiveDamage = getEffectiveDamage(attacker, baseDamage, enrageMult);

        let dmg: number;
        let isCrit: boolean;
        if (isBite && attackerStats.biteCrit) {
            // Bite has its own crit chance (not from baseCrit)
            const rawDmg = rollDamage(effectiveDamage[0], effectiveDamage[1]);
            isCrit = rollChance(attackerStats.biteCrit);
            const critDmg = isCrit ? Math.floor(rawDmg * CRIT_MULTIPLIER) : rawDmg;
            dmg = applyArmor(critDmg, getEffectiveArmor(target, targetData.armor), "physical");
        } else {
            ({ damage: dmg, isCrit } = calculateDamageWithCrit(effectiveDamage[0], effectiveDamage[1], getEffectiveArmor(target, targetData.armor), "physical", attacker));
        }

        const attackName = isBite ? "Bite" : "Attack";
        const willPoison = shouldApplyPoison(attackerStats);
        const willSlow = shouldApplySlow(attackerStats);
        const poisonDmg = willPoison ? attackerStats.poisonDamage : undefined;
        const lifesteal = attackerStats.lifesteal;
        const getLifestealHealAmount = (totalHpDamage: number): number => {
            if (!lifesteal || lifesteal <= 0) return 0;
            return Math.floor(totalHpDamage * lifesteal);
        };

        const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };
        const damageResult = applyDamageToUnit(dmgCtx, target.id, targetG, dmg, targetData.name, {
            color: COLORS.damageEnemy,
            poison: willPoison ? { sourceId: attacker.id, damagePerTick: poisonDmg } : undefined,
            slow: willSlow ? { sourceId: attacker.id } : undefined,
            hitMessage: result => {
                const healAmount = getLifestealHealAmount(result.totalHpDamage);
                return {
                    text: healAmount > 0
                        ? logLifestealHit(attackerStats.name, targetData.name, result.hpDamage, healAmount)
                        : logHit(attackerStats.name, attackName, targetData.name, result.hpDamage),
                    color: COLORS.damageEnemy
                };
            },
            targetUnit: target,
            isCrit,
            attackerId: attacker.id,
            isMeleeHit: true
        }) ?? { hpDamage: 0, totalHpDamage: 0, shieldAbsorbed: 0, shieldDepleted: false, wasDefeated: false };

        soundFns.playHit();
        if (willPoison) {
            addLog(logPoisoned(targetData.name), COLORS.poisonText);
        }
        if (willSlow) {
            addLog(logSlowed(targetData.name), "#5599ff");
        }
        const willStun = !damageResult.wasDefeated
            && !hasStatusEffect(target, "stunned")
            && !!attackerStats.stunChance
            && rollChance(attackerStats.stunChance);
        if (willStun) {
            const stunDuration = attackerStats.stunDuration ?? 1800;
            setUnits(prev => prev.map(u => {
                if (u.id !== target.id || u.hp <= 0) return u;
                const stunnedEffect = {
                    type: "stunned" as const,
                    duration: stunDuration,
                    tickInterval: BUFF_TICK_INTERVAL,
                    timeSinceTick: 0,
                    lastUpdateTime: now,
                    damagePerTick: 0,
                    sourceId: attacker.id
                };
                return { ...u, statusEffects: applyStatusEffect(u.statusEffects, stunnedEffect) };
            }));
            addLog(logStunned(targetData.name), COLORS.stunnedText);
        }

        // Apply lifesteal heal using fresh state to avoid race condition
        const healAmount = getLifestealHealAmount(damageResult.totalHpDamage);
        if (healAmount > 0) {
            applyLifesteal(scene, damageTexts, setUnits, attacker.id, attackerG.position.x, attackerG.position.z, healAmount);
        }
    } else {
        soundFns.playMiss();
        addLog(logMiss(attackerStats.name, "Attack", targetData.name), COLORS.logNeutral);
    }
}

// =============================================================================
// COMBINED ATTACK HANDLER
// =============================================================================

/**
 * Execute an enemy basic attack (ranged or melee based on stats).
 */
export function executeEnemyBasicAttack(ctx: EnemyAttackContext): void {
    const { attackerStats, attackerG, targetG } = ctx;

    startAttackBump(attackerG, targetG.position.x, targetG.position.z, getGameTime());

    if (attackerStats.fireballAttack) {
        executeEnemyFireballAttack(ctx);
    } else if (attackerStats.projectileColor) {
        executeEnemyRangedAttack(ctx);
    } else {
        executeEnemyMeleeAttack(ctx);
    }
}
