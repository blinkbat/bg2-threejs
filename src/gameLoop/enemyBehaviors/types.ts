// =============================================================================
// ENEMY BEHAVIOR TYPES - Context interfaces for special enemy abilities
// =============================================================================

import * as THREE from "three";
import type {
    Unit,
    UnitGroup,
    EnemyStats,
    EnemySpawnSkill,
    EnemyChargeAttack,
    EnemyLeapSkill,
    EnemyVinesSkill,
    EnemyTentacleSkill,
    EnemyRaiseSkill,
    EnemyCurseSkill,
    EnemyGlareSkill,
    EnemySleepSkill,
    EnemyDreamEaterSkill,
    EnemyPhaseShiftSkill,
    DamageText
} from "../../core/types";

// =============================================================================
// BASE CONTEXT — shared fields across all enemy behaviors
// =============================================================================

interface BehaviorBaseContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

// =============================================================================
// PER-BEHAVIOR CONTEXTS — extend base with behavior-specific fields
// =============================================================================

export interface SpawnContext extends BehaviorBaseContext {
    spawnSkill: EnemySpawnSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

export interface ChargeContext extends BehaviorBaseContext {
    chargeAttack: EnemyChargeAttack;
    scene: THREE.Scene;
}

export interface LeapContext extends BehaviorBaseContext {
    leapSkill: EnemyLeapSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

export interface VinesContext extends BehaviorBaseContext {
    vinesSkill: EnemyVinesSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    // Damage context for proper death handling
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    unitsStateRef: React.RefObject<Unit[]>;
    defeatedThisFrame: Set<number>;
}

export interface TentacleContext extends BehaviorBaseContext {
    tentacleSkill: EnemyTentacleSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

export interface RaiseContext extends BehaviorBaseContext {
    raiseSkill: EnemyRaiseSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

export interface CurseContext extends BehaviorBaseContext {
    curseSkill: EnemyCurseSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
}

export interface GlareContext extends BehaviorBaseContext {
    glareSkill: EnemyGlareSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
}

export interface SleepContext extends BehaviorBaseContext {
    sleepSkill: EnemySleepSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    defeatedThisFrame: Set<number>;
}

export interface DreamEaterContext extends BehaviorBaseContext {
    dreamEaterSkill: EnemyDreamEaterSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsStateRef: React.RefObject<Unit[]>;
    defeatedThisFrame: Set<number>;
}

export interface PhaseShiftContext extends BehaviorBaseContext {
    phaseShiftSkill: EnemyPhaseShiftSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}
