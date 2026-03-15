// =============================================================================
// SKILL SYSTEM - Main entry point and skill router
// =============================================================================

import * as THREE from "three";
import type { Skill } from "../../core/types";
import { COLORS } from "../../core/constants";
import { UNIT_DATA, getEffectiveUnitData } from "../../game/playerUnits";
import { hasStatusEffect } from "../combatMath";

// Re-export types
export type { SkillExecutionContext } from "./types";

// Import for internal use
import type { SkillExecutionContext } from "./types";
import { executeAoeSkill, executeMeleeSkill, executeSmiteSkill, executeRangedSkill, executeFlurrySkill, executeMagicWaveSkill, executeChainLightningSkill, executeForcePushSkill, executeWellOfGravitySkill, executeHolyCrossSkill, executeHolyStrikeSkill, executeGlacialWhorlSkill, executeCleaveSkill, executeSmiteStrikeSkill, executeLeapStrikeSkill, executeWallOfFireSkill } from "./damage";
import { executeHealSkill, executeMassHealSkill, executeManaTransferSkill, executeBuffSkill, executeAoeBuffSkill, executeEnergyShieldSkill, executeCleanseSkill, executeRestorationSkill, executeReviveSkill, executeSunStanceSkill, executePangolinStanceSkill, executeHighlandDefenseSkill, executeDivineLatticeSkill, executeVanquishingLightSkill } from "./support";
import { executeTauntSkill, executeDebuffSkill, executeBloodMarkSkill, executeElorasGraspSkill, executeTrapSkill, executeSanctuarySkill, executeSummonSkill, executeTurnUndeadSkill, executeSmokeBombSkill, executeIntimidateSkill, executeFivePointPalmSkill, executeDimMakSkill } from "./utility";
import { executeDodgeSkill, executeBodySwapSkill, executeDisplacementSkill } from "./movement";

// =============================================================================
// MAIN SKILL ROUTER
// =============================================================================

/**
 * Execute a skill based on its type
 * @param targetId Optional target unit ID for unit-targeted skills (tracks moving targets)
 */
export function executeSkill(
    ctx: SkillExecutionContext,
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    targetId?: number,
    dragLinePositions?: { x: number; z: number }[]
): boolean {
    const caster = ctx.unitsStateRef.current.find(u => u.id === casterId);
    const casterG = ctx.unitsRef.current[casterId];

    if (!caster || !casterG || caster.hp <= 0) return false;
    if (hasStatusEffect(caster, "divine_lattice")) {
        ctx.addLog(`${UNIT_DATA[casterId].name} cannot act while in Divine Lattice.`, COLORS.divineLatticeText);
        return false;
    }
    if ((caster.mana ?? 0) < skill.manaCost) {
        ctx.addLog(`${UNIT_DATA[casterId].name}: Not enough mana!`, COLORS.logNeutral);
        return false;
    }

    if (skill.type === "cleave" && skill.targetType === "self") {
        return executeCleaveSkill(ctx, casterId, skill);
    } else if (skill.type === "intimidate" && skill.targetType === "self") {
        return executeIntimidateSkill(ctx, casterId, skill);
    } else if (skill.type === "leap_strike" && skill.targetType === "enemy") {
        return executeLeapStrikeSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "damage" && skill.targetType === "aoe") {
        // Magic Wave - multi-target zig-zag projectiles that fan out
        if (skill.name === "Magic Wave") {
            return executeMagicWaveSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Force Push - line-wave with knockback and stun
        if (skill.name === "Force Push") {
            return executeForcePushSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Well of Gravity - circular AoE pull + stun
        if (skill.name === "Well of Gravity") {
            return executeWellOfGravitySkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Holy Cross - cross-shaped detonation that leaves holy ground
        if (skill.name === "Holy Cross") {
            return executeHolyCrossSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Holy Strike - line-shaped cone AOE
        if (skill.name === "Holy Strike") {
            return executeHolyStrikeSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Glacial Whorl - piercing projectile
        if (skill.name === "Glacial Whorl") {
            return executeGlacialWhorlSkill(ctx, casterId, skill, targetX, targetZ);
        }
        // Standard AOE like Fireball
        executeAoeSkill(ctx, casterId, skill, targetX, targetZ);
        return true;
    } else if (skill.type === "heal" && skill.targetType === "self") {
        return executeMassHealSkill(ctx, casterId, skill);
    } else if (skill.type === "heal" && skill.targetType === "ally") {
        return executeHealSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "damage" && skill.targetType === "enemy") {
        if (skill.delivery === "ranged") {
            return executeRangedSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        if (skill.name === "Smite") {
            return executeSmiteStrikeSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        if (skill.delivery === "melee") {
            return executeMeleeSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }

        // Check if this is a ranged skill (basic attack for ranged units)
        // Melee range is typically <= 2, ranged is > 2
        // Use effective stats to get equipment-derived range
        const effectiveData = getEffectiveUnitData(casterId);
        const isRanged = effectiveData.range && effectiveData.range > 2;

        // For basic attacks (name === "Attack"), use ranged if unit has range
        if (skill.name === "Attack" && isRanged) {
            return executeRangedSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        return executeMeleeSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "taunt" && skill.targetType === "self") {
        return executeTauntSkill(ctx, casterId, skill);
    } else if (skill.type === "buff" && skill.targetType === "self") {
        if (skill.name === "Sun Stance") {
            return executeSunStanceSkill(ctx, casterId, skill);
        }
        if (skill.name === "Pangolin Stance") {
            return executePangolinStanceSkill(ctx, casterId, skill);
        }
        if (skill.name === "Highland Defense") {
            return executeHighlandDefenseSkill(ctx, casterId, skill);
        }
        if (skill.name === "Vanquishing Light") {
            return executeVanquishingLightSkill(ctx, casterId, skill);
        }
        return executeBuffSkill(ctx, casterId, skill);
    } else if (skill.type === "energy_shield" && skill.targetType === "self") {
        return executeEnergyShieldSkill(ctx, casterId, skill);
    } else if (skill.type === "buff" && skill.targetType === "ally") {
        return executeCleanseSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "buff" && skill.targetType === "unit") {
        if (skill.name === "Divine Lattice") {
            return executeDivineLatticeSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        return false;
    } else if (skill.type === "buff" && skill.targetType === "aoe") {
        return false;
    } else if (skill.type === "flurry" && skill.targetType === "self") {
        return executeFlurrySkill(ctx, casterId, skill);
    } else if (skill.type === "debuff" && skill.targetType === "enemy") {
        if (skill.name === "Blood Mark") {
            return executeBloodMarkSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        if (skill.name === "Five-Point Palm") {
            return executeFivePointPalmSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        if (skill.name === "Dim Mak") {
            return executeDimMakSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        return executeDebuffSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "debuff" && skill.targetType === "aoe") {
        if (skill.name === "Elora's Grasp") {
            return executeElorasGraspSkill(ctx, casterId, skill, targetX, targetZ);
        }
        return false;
    } else if (skill.type === "trap" && skill.targetType === "aoe") {
        return executeTrapSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "sanctuary" && skill.targetType === "aoe") {
        return executeSanctuarySkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "mana_transfer" && skill.targetType === "ally") {
        return executeManaTransferSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "smite" && skill.targetType === "enemy") {
        if (skill.name === "Chain Lightning") {
            return executeChainLightningSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        return executeSmiteSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "aoe_buff" && skill.targetType === "self") {
        return executeAoeBuffSkill(ctx, casterId, skill);
    } else if (skill.type === "restoration" && skill.targetType === "ally") {
        return executeRestorationSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "revive" && skill.targetType === "ally") {
        return executeReviveSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "dodge") {
        if (skill.name === "Body Swap") {
            return executeBodySwapSkill(ctx, casterId, skill, targetX, targetZ, targetId);
        }
        return executeDodgeSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "summon" && skill.targetType === "self") {
        return executeSummonSkill(ctx, casterId, skill);
    } else if (skill.type === "turn_undead" && skill.targetType === "self") {
        return executeTurnUndeadSkill(ctx, casterId, skill);
    } else if (skill.type === "displacement" && skill.targetType === "unit") {
        return executeDisplacementSkill(ctx, casterId, skill, targetX, targetZ, targetId);
    } else if (skill.type === "smoke" && skill.targetType === "aoe") {
        return executeSmokeBombSkill(ctx, casterId, skill, targetX, targetZ);
    } else if (skill.type === "wall_of_fire" && skill.targetType === "drag_line") {
        return executeWallOfFireSkill(ctx, casterId, skill, dragLinePositions ?? []);
    }

    return false;
}

// =============================================================================
// TARGETING MODE
// =============================================================================

/**
 * Clear targeting mode and hide indicators
 */
export function clearTargetingMode(
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>>,
    rangeIndicatorRef: React.RefObject<THREE.Mesh | null>,
    aoeIndicatorRef: React.RefObject<THREE.Mesh | null>
): void {
    setTargetingMode(null);
    if (rangeIndicatorRef.current) rangeIndicatorRef.current.visible = false;
    if (aoeIndicatorRef.current) {
        aoeIndicatorRef.current.visible = false;
        aoeIndicatorRef.current.rotation.z = 0;
        // Don't clear isLine here — setupTargetingMode reads it to detect
        // shape transitions (line→circle) and force geometry recreation.
    }
}
