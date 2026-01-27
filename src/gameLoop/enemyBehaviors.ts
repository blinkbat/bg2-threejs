// =============================================================================
// ENEMY BEHAVIORS - Special behaviors for specific enemy types
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, EnemySpawnSkill, EnemyChargeAttack } from "../core/types";
import { ENEMY_STATS } from "../game/units";
import { getNextUnitId } from "../core/unitIds";
import { soundFns } from "../audio/sound";
import { hasBroodMotherScreeched, markBroodMotherScreeched } from "../game/enemyState";
import { hasStatusEffect } from "../combat/combatMath";
import { SLOW_COOLDOWN_MULT } from "../core/constants";
import { startChargeAttack } from "./constructCharge";

// =============================================================================
// TYPES
// =============================================================================

export interface SpawnContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    spawnSkill: EnemySpawnSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

export interface ChargeContext {
    unit: Unit;
    g: UnitGroup;
    chargeAttack: EnemyChargeAttack;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

// =============================================================================
// BROOD MOTHER SPAWN BEHAVIOR
// =============================================================================

/**
 * Check if any player is visible to the spawner (within aggro range).
 */
function isPlayerVisible(
    g: UnitGroup,
    enemyStats: EnemyStats,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): boolean {
    return unitsState.some(u => {
        if (u.team !== "player" || u.hp <= 0) return false;
        const playerG = unitsRef[u.id];
        if (!playerG) return false;
        const dx = playerG.position.x - g.position.x;
        const dz = playerG.position.z - g.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= enemyStats.aggroRange;
    });
}

/**
 * Try to spawn a minion for a spawner enemy (like Brood Mother).
 * Handles visibility check, spawn limit, cooldown, and unit creation.
 * @returns true if a spawn occurred
 */
export function trySpawnMinion(ctx: SpawnContext): boolean {
    const { unit, g, enemyStats, spawnSkill, unitsState, unitsRef, skillCooldowns, setSkillCooldowns, setUnits, addLog, now } = ctx;

    const spawnCooldownKey = `${unit.id}-spawn`;
    const spawnCooldownEnd = skillCooldowns[spawnCooldownKey]?.end ?? 0;

    const playerInSight = isPlayerVisible(g, enemyStats, unitsState, unitsRef);

    // Play Brood Mother screech on first sight of player
    if (playerInSight && unit.enemyType === "brood_mother" && !hasBroodMotherScreeched(unit.id)) {
        markBroodMotherScreeched(unit.id);
        soundFns.playBroodMotherScreech();
        addLog("The Brood Mother lets out a piercing screech!", "#cc6600");
    }

    if (!playerInSight || now < spawnCooldownEnd) {
        return false;
    }

    // Count current spawns from this unit
    const currentSpawns = unitsState.filter(u => u.spawnedBy === unit.id && u.hp > 0).length;
    if (currentSpawns >= spawnSkill.maxSpawns) {
        return false;
    }

    // Spawn a new minion
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnX = g.position.x + Math.cos(spawnAngle) * spawnSkill.spawnRange;
    const spawnZ = g.position.z + Math.sin(spawnAngle) * spawnSkill.spawnRange;

    const newId = getNextUnitId();
    const spawnedUnit: Unit = {
        id: newId,
        x: spawnX,
        z: spawnZ,
        hp: ENEMY_STATS[spawnSkill.spawnType].maxHp,
        team: "enemy",
        enemyType: spawnSkill.spawnType,
        target: null,
        aiEnabled: true,
        spawnedBy: unit.id
    };

    setUnits(prev => [...prev, spawnedUnit]);

    // Play screech sound for broodling spawns
    if (spawnSkill.spawnType === "broodling") {
        soundFns.playScreech();
    }

    addLog(`${enemyStats.name} spawns a ${ENEMY_STATS[spawnSkill.spawnType].name}!`, "#cc6600");

    setSkillCooldowns(prev => ({
        ...prev,
        [spawnCooldownKey]: { end: now + spawnSkill.cooldown, duration: spawnSkill.cooldown }
    }));

    return true;
}

// =============================================================================
// CONSTRUCT CHARGE ATTACK BEHAVIOR
// =============================================================================

/**
 * Try to start a charge attack for an enemy with chargeAttack capability.
 * Handles cooldown check and initiates the charge.
 * @returns true if a charge was started
 */
export function tryStartChargeAttack(ctx: ChargeContext): boolean {
    const { unit, g, chargeAttack, scene, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;

    const chargeKey = `${unit.id}-${chargeAttack.name}`;
    const chargeCooldownEnd = skillCooldowns[chargeKey]?.end ?? 0;

    if (now < chargeCooldownEnd) {
        return false;
    }

    // Start the charge attack
    startChargeAttack(scene, unit, g, chargeAttack, now, addLog);

    const cooldownMult = hasStatusEffect(unit, "slowed") ? SLOW_COOLDOWN_MULT : 1;
    setSkillCooldowns(prev => ({
        ...prev,
        [chargeKey]: { end: now + chargeAttack.cooldown * cooldownMult, duration: chargeAttack.cooldown }
    }));

    return true;
}
