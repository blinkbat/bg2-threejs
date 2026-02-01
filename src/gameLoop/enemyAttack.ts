// =============================================================================
// ENEMY ATTACK - Handles enemy basic attack execution
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, SwingAnimation, FireballProjectile } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamage, rollHit, shouldApplyPoison, shouldApplySlow, getEffectiveArmor, getEffectiveDamage, logHit, logLifestealHit, logMiss, logPoisoned, logSlowed } from "../combat/combatMath";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, spawnDamageNumber, type DamageContext } from "../combat/combat";
import { soundFns } from "../audio/sound";
import { spawnSwingIndicator } from "./swingAnimations";

// =============================================================================
// FIREBALL CONSTANTS
// =============================================================================

const FIREBALL_SPEED = 0.04;        // Very slow-moving projectile
const FIREBALL_MAX_DISTANCE = 12;   // Max travel distance before expiring

// =============================================================================
// TYPES
// =============================================================================

export interface EnemyAttackContext {
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
export function executeEnemyRangedAttack(ctx: EnemyAttackContext): void {
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
    const geometry = new THREE.SphereGeometry(0.35, 12, 8);
    const material = new THREE.MeshBasicMaterial({
        color: "#ff4500",
        transparent: true,
        opacity: 0.9
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.5, z);
    scene.add(mesh);

    // Add inner glow
    const innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 6),
        new THREE.MeshBasicMaterial({ color: "#ffcc00", transparent: true, opacity: 0.7 })
    );
    mesh.add(innerGlow);

    return mesh;
}

/**
 * Execute a fireball attack (slow-moving projectile that hurts everything).
 */
export function executeEnemyFireballAttack(ctx: EnemyAttackContext): void {
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
export function executeEnemyMeleeAttack(ctx: EnemyAttackContext): void {
    const {
        scene, attacker, attackerG, target, targetG, attackerStats,
        damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now,
        defeatedThisFrame, swingAnimations
    } = ctx;

    const targetData = getUnitStats(target);
    spawnSwingIndicator(scene, attackerG, targetG, false, swingAnimations, now);

    if (rollHit(attackerStats.accuracy)) {
        const effectiveDamage = getEffectiveDamage(attacker, attackerStats.damage);
        const dmg = calculateDamage(effectiveDamage[0], effectiveDamage[1], getEffectiveArmor(target, targetData.armor), "physical");
        const willPoison = shouldApplyPoison(attackerStats);
        const willSlow = shouldApplySlow(attackerStats);
        const poisonDmg = willPoison ? attackerStats.poisonDamage : undefined;
        const lifesteal = attackerStats.lifesteal;

        // Calculate lifesteal heal amount for log message (estimate based on current snapshot)
        const healAmount = lifesteal && lifesteal > 0 ? Math.floor(dmg * lifesteal) : 0;

        // Custom log for lifesteal attacks
        const hitText = healAmount > 0
            ? logLifestealHit(attackerStats.name, targetData.name, dmg, healAmount)
            : logHit(attackerStats.name, "Attack", targetData.name, dmg);

        const dmgCtx: DamageContext = { scene, damageTexts, hitFlashRef, unitsRef, unitsStateRef, setUnits, addLog, now, defeatedThisFrame };
        applyDamageToUnit(dmgCtx, target.id, targetG, target.hp, dmg, targetData.name, {
            color: COLORS.damageEnemy,
            poison: willPoison ? { sourceId: attacker.id, damagePerTick: poisonDmg } : undefined,
            slow: willSlow ? { sourceId: attacker.id } : undefined,
            hitMessage: { text: hitText, color: COLORS.damageEnemy },
            targetUnit: target
        });

        soundFns.playHit();
        if (willPoison) {
            addLog(logPoisoned(targetData.name), COLORS.poisonText);
        }
        if (willSlow) {
            addLog(logSlowed(targetData.name), "#5599ff");
        }

        // Apply lifesteal heal using fresh state to avoid race condition
        if (healAmount > 0) {
            setUnits(prev => prev.map(u => {
                if (u.id !== attacker.id) return u;
                // Calculate actual heal from fresh HP state
                return { ...u, hp: Math.min(u.hp + healAmount, attackerStats.maxHp) };
            }));
            spawnDamageNumber(scene, attackerG.position.x, attackerG.position.z, healAmount, COLORS.logHeal, damageTexts, true);
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
    const { attackerStats } = ctx;

    if (attackerStats.fireballAttack) {
        executeEnemyFireballAttack(ctx);
    } else if (attackerStats.projectileColor) {
        executeEnemyRangedAttack(ctx);
    } else {
        executeEnemyMeleeAttack(ctx);
    }
}
