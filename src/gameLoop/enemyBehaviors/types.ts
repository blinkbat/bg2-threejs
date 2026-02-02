// =============================================================================
// ENEMY BEHAVIOR TYPES - Context interfaces for special enemy abilities
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, EnemySpawnSkill, EnemyChargeAttack, EnemyLeapSkill, EnemyVinesSkill, EnemyTentacleSkill, DamageText } from "../../core/types";

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

export interface LeapContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    leapSkill: EnemyLeapSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}

export interface VinesContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    vinesSkill: EnemyVinesSkill;
    targetUnit: Unit;
    targetG: UnitGroup;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    // Damage context for proper death handling
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    unitsStateRef: React.RefObject<Unit[]>;
    defeatedThisFrame: Set<number>;
}

export interface TentacleContext {
    unit: Unit;
    g: UnitGroup;
    enemyStats: EnemyStats;
    tentacleSkill: EnemyTentacleSkill;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
}
