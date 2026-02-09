// =============================================================================
// PRE-ATTACK BEHAVIOR DISPATCH — fire-and-forget behaviors run before attack phase
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, DamageText, Projectile } from "../../core/types";
import { trySpawnMinion } from "./broodMother";
import { tryRaiseDead } from "./necromancer";
import { trySpawnTentacle } from "./tentacle";
import { tryCurse } from "./curse";
import { tryBasiliskGlare } from "./basiliskGlare";

// =============================================================================
// CONTEXT — superset of fields needed by all pre-attack behaviors
// =============================================================================

export interface PreAttackContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

// =============================================================================
// DISPATCH
// =============================================================================

/**
 * Run all fire-and-forget pre-attack behaviors for an enemy.
 * These behaviors don't block normal attack flow — they check conditions and
 * fire independently (spawning, raising, tentacles, curses, glares).
 *
 * To add a new fire-and-forget behavior:
 * 1. Create `tryMyBehavior(ctx)` in its own file
 * 2. Add the check + call below
 * 3. Export from index.ts
 */
export function runPreAttackBehaviors(ctx: PreAttackContext): void {
    const { unit, g, enemyStats, unitsState, unitsRef, scene, setUnits, skillCooldowns, setSkillCooldowns, addLog, now } = ctx;
    const base = { unit, g, enemyStats, skillCooldowns, setSkillCooldowns, addLog, now };

    if (enemyStats.spawnSkill) {
        trySpawnMinion({ ...base, spawnSkill: enemyStats.spawnSkill, unitsState, unitsRef, setUnits });
    }

    if (enemyStats.raiseSkill) {
        tryRaiseDead({ ...base, raiseSkill: enemyStats.raiseSkill, unitsState, unitsRef, setUnits });
    }

    if (enemyStats.tentacleSkill) {
        trySpawnTentacle({ ...base, tentacleSkill: enemyStats.tentacleSkill, unitsState, unitsRef, scene, setUnits });
    }

    if (enemyStats.curseSkill) {
        tryCurse({ ...base, curseSkill: enemyStats.curseSkill, unitsState, unitsRef, scene });
    }

    if (enemyStats.glareSkill) {
        tryBasiliskGlare({ ...base, glareSkill: enemyStats.glareSkill, unitsState, unitsRef, scene });
    }
}
