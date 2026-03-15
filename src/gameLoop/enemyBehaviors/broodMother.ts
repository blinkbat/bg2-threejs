// =============================================================================
// BROOD MOTHER SPAWN BEHAVIOR - Spawns broodling minions
// =============================================================================

import type { Unit } from "../../core/types";
import { ENEMY_STATS } from "../../game/enemyStats";
import { isPlayerVisible } from "../../game/unitQuery";
import { getNextUnitId } from "../../core/unitIds";
import { soundFns } from "../../audio";
import { hasBroodMotherScreeched, markBroodMotherScreeched } from "../../game/enemyState";
import { setSkillCooldown } from "../../combat/combatMath";
import { createAnimatedRing } from "../../combat/damageEffects";
import type { SpawnContext } from "./types";

// =============================================================================
// SPAWN BEHAVIOR
// =============================================================================

/**
 * Try to spawn a minion for a spawner enemy (like Brood Mother).
 * Handles visibility check, spawn limit, cooldown, and unit creation.
 * @returns true if a spawn occurred
 */
export function trySpawnMinion(ctx: SpawnContext): boolean {
    const { unit, g, enemyStats, spawnSkill, unitsState, unitsRef, scene, skillCooldowns, setSkillCooldowns, setUnits, addLog, now } = ctx;

    const spawnCooldownKey = `${unit.id}-${spawnSkill.name}`;
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

    createAnimatedRing(scene, spawnX, spawnZ, "#cc6600", {
        innerRadius: 0.2,
        outerRadius: 0.45,
        maxScale: 1.35,
        duration: 320
    });

    // Play screech sound for broodling spawns
    if (spawnSkill.spawnType === "broodling") {
        soundFns.playScreech();
    }

    addLog(`${enemyStats.name} spawns a ${ENEMY_STATS[spawnSkill.spawnType].name}!`, "#cc6600");

    setSkillCooldown(setSkillCooldowns, spawnCooldownKey, spawnSkill.cooldown, now);

    return true;
}
