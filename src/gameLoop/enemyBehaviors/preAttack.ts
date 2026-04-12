// =============================================================================
// PRE-ATTACK BEHAVIOR DISPATCH — fire-and-forget behaviors run before attack phase
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, DamageText } from "../../core/types";
import { isSkillBlockedBySilence } from "../../combat/combatMath";
import { trySpawnMinion } from "./broodMother";
import { tryRaiseDead } from "./necromancer";
import { trySpawnTentacle } from "./tentacle";
import { tryCurse } from "./curse";
import { tryBasiliskGlare } from "./basiliskGlare";
import { tryDreamEater } from "./dreamEater";
import { trySleep } from "./sleep";
import { tryShadePhase } from "./shadePhase";
import { trySilence } from "./silence";

// =============================================================================
// CONTEXT — superset of fields needed by all pre-attack behaviors
// =============================================================================

interface PreAttackContext {
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
    // Damage context fields — needed by behaviors that deal damage (e.g. Dream Eater)
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsStateRef: React.RefObject<Unit[]>;
    defeatedThisFrame: Set<number>;
}

// =============================================================================
// SHARED ACTION COOLDOWN — prevents enemies from burst-casting multiple skills
// =============================================================================

const ENEMY_ACTION_COOLDOWN_MS = 2000;
const lastActionTime: Record<number, number> = {};

/** Check if the enemy can use a skill (shared cooldown between all skills). */
function canAct(unitId: number, now: number): boolean {
    return (lastActionTime[unitId] ?? 0) <= now;
}

/** Mark the enemy as having just used a skill. */
function markAction(unitId: number, now: number): void {
    lastActionTime[unitId] = now + ENEMY_ACTION_COOLDOWN_MS;
}

/** Clean up action cooldown for a unit (call on death/restart). */
export function cleanupEnemyActionCooldown(unitId: number): void {
    delete lastActionTime[unitId];
}

/** Reset all action cooldowns (call on game restart). */
export function resetAllEnemyActionCooldowns(): void {
    Object.keys(lastActionTime).forEach(k => delete lastActionTime[Number(k)]);
}

// =============================================================================
// DISPATCH
// =============================================================================

/**
 * Run pre-attack behaviors for an enemy, stopping after the first skill fires.
 * After a skill fires, the enemy enters a 2s shared action cooldown before it
 * can use any other skill. This prevents burst-casting multiple skills per frame.
 *
 * To add a new fire-and-forget behavior:
 * 1. Create `tryMyBehavior(ctx)` in its own file
 * 2. Add the check + call below
 * 3. Export from index.ts
 */
export function runPreAttackBehaviors(ctx: PreAttackContext): void {
    const { unit, g, enemyStats, unitsState, unitsRef, scene, setUnits, skillCooldowns, setSkillCooldowns, addLog, now, damageTexts, hitFlashRef, unitsStateRef, defeatedThisFrame } = ctx;

    if (!canAct(unit.id, now)) return;

    const base = { unit, g, enemyStats, skillCooldowns, setSkillCooldowns, addLog, now };

    if (enemyStats.spawnSkill && !isSkillBlockedBySilence(unit, enemyStats.spawnSkill.kind)) {
        if (trySpawnMinion({ ...base, spawnSkill: enemyStats.spawnSkill, unitsState, unitsRef, scene, setUnits })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.raiseSkill && !isSkillBlockedBySilence(unit, enemyStats.raiseSkill.kind)) {
        if (tryRaiseDead({ ...base, raiseSkill: enemyStats.raiseSkill, unitsState, unitsRef, scene, setUnits })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.tentacleSkill && !isSkillBlockedBySilence(unit, enemyStats.tentacleSkill.kind)) {
        if (trySpawnTentacle({ ...base, tentacleSkill: enemyStats.tentacleSkill, unitsState, unitsRef, scene, setUnits })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.curseSkill && !isSkillBlockedBySilence(unit, enemyStats.curseSkill.kind)) {
        if (tryCurse({ ...base, curseSkill: enemyStats.curseSkill, unitsState, unitsRef, scene })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.glareSkill && !isSkillBlockedBySilence(unit, enemyStats.glareSkill.kind)) {
        if (tryBasiliskGlare({ ...base, glareSkill: enemyStats.glareSkill, unitsState, unitsRef, scene })) { markAction(unit.id, now); return; }
    }

    // Dream Eater before Sleep — prioritize nuking sleeping targets over casting more sleep
    if (enemyStats.dreamEaterSkill && !isSkillBlockedBySilence(unit, enemyStats.dreamEaterSkill.kind)) {
        if (tryDreamEater({ ...base, dreamEaterSkill: enemyStats.dreamEaterSkill, unitsState, unitsRef, scene, setUnits, damageTexts, hitFlashRef, unitsStateRef, defeatedThisFrame })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.sleepSkill && !isSkillBlockedBySilence(unit, enemyStats.sleepSkill.kind)) {
        if (trySleep({ ...base, sleepSkill: enemyStats.sleepSkill, unitsState, unitsRef, scene, setUnits, defeatedThisFrame })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.silenceSkill && !isSkillBlockedBySilence(unit, enemyStats.silenceSkill.kind)) {
        if (trySilence({ ...base, silenceSkill: enemyStats.silenceSkill, unitsState, unitsRef, scene, setUnits, defeatedThisFrame })) { markAction(unit.id, now); return; }
    }

    if (enemyStats.phaseShiftSkill && !isSkillBlockedBySilence(unit, enemyStats.phaseShiftSkill.kind)) {
        if (tryShadePhase({ ...base, phaseShiftSkill: enemyStats.phaseShiftSkill, unitsState, unitsRef, setUnits })) { markAction(unit.id, now); }
    }
}
