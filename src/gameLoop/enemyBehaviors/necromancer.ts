// =============================================================================
// NECROMANCER RAISE DEAD BEHAVIOR - Batch-spawns skeleton minions
// =============================================================================

import type { Unit } from "../../core/types";
import { ENEMY_STATS } from "../../game/enemyStats";
import { isPlayerVisible } from "../../game/unitQuery";
import { getNextUnitId } from "../../core/unitIds";
import { findSpawnPositions } from "../../ai/pathfinding";
import { setSkillCooldown } from "../../combat/combatMath";
import { createAnimatedRing } from "../../combat/damageEffects";
import type { RaiseContext } from "./types";

// =============================================================================
// RAISE DEAD BEHAVIOR
// =============================================================================

/**
 * Try to raise dead minions for a necromancer.
 * Spawns all minions at once. Only re-raises when ALL current minions are dead.
 * @returns true if a raise occurred
 */
export function tryRaiseDead(ctx: RaiseContext): boolean {
    const { unit, g, enemyStats, raiseSkill, unitsState, unitsRef, scene, skillCooldowns, setSkillCooldowns, setUnits, addLog, now } = ctx;

    const raiseCooldownKey = `${unit.id}-raise`;
    const raiseCooldownEnd = skillCooldowns[raiseCooldownKey]?.end ?? 0;

    const playerInSight = isPlayerVisible(g, enemyStats, unitsState, unitsRef);

    if (!playerInSight || now < raiseCooldownEnd) {
        return false;
    }

    // Count current alive minions from this necromancer
    const aliveMinions = unitsState.filter(u => u.spawnedBy === unit.id && u.hp > 0).length;

    // Only raise when ALL minions are dead (0 alive)
    if (aliveMinions > 0) {
        return false;
    }

    // Batch-spawn all minions at once, ensuring passable positions
    const spawnPositions = findSpawnPositions(g.position.x, g.position.z, raiseSkill.spawnCount, "north");
    const newMinions: Unit[] = spawnPositions.map(pos => ({
        id: getNextUnitId(),
        x: pos.x,
        z: pos.z,
        hp: ENEMY_STATS[raiseSkill.spawnType].maxHp,
        team: "enemy",
        enemyType: raiseSkill.spawnType,
        target: null,
        aiEnabled: true,
        spawnedBy: unit.id
    }));

    setUnits(prev => [...prev, ...newMinions]);
    for (const minion of newMinions) {
        createAnimatedRing(scene, minion.x, minion.z, "#8b5fbf", {
            innerRadius: 0.18,
            outerRadius: 0.4,
            maxScale: 1.25,
            duration: 280
        });
    }

    addLog(`${enemyStats.name} raises ${raiseSkill.spawnCount} ${ENEMY_STATS[raiseSkill.spawnType].name}s from the dead!`, "#8b5fbf");

    setSkillCooldown(setSkillCooldowns, raiseCooldownKey, raiseSkill.cooldown, now);

    return true;
}
