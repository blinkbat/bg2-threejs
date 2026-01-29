// =============================================================================
// ENEMY ATTACK - Handles enemy basic attack execution
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, Projectile, EnemyStats, SwingAnimation } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { calculateDamage, rollHit, shouldApplyPoison, shouldApplySlow, getEffectiveArmor, getEffectiveDamage, logHit, logLifestealHit, logMiss, logPoisoned, logSlowed } from "../combat/combatMath";
import { createProjectile, getProjectileSpeed, applyDamageToUnit, spawnDamageNumber, type DamageContext } from "../combat/combat";
import { soundFns } from "../audio/sound";
import { spawnSwingIndicator } from "./swingAnimations";

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

    if (attackerStats.projectileColor) {
        executeEnemyRangedAttack(ctx);
    } else {
        executeEnemyMeleeAttack(ctx);
    }
}
