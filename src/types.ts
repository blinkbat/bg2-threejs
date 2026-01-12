import * as THREE from "three";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface Unit {
    id: number;
    x: number;
    z: number;
    hp: number;
    mana?: number;
    team: "player" | "enemy";
    target: number | null;
    aiEnabled: boolean;
}

export interface Skill {
    name: string;
    manaCost: number;
    cooldown: number;  // ms
    type: "damage" | "heal" | "buff";
    targetType: "enemy" | "ally" | "self" | "aoe";
    range: number;
    aoeRadius?: number;
    value: [number, number];  // damage/heal range
    projectileColor?: string;
}

export interface UnitData {
    name: string;
    class: string;
    hp: number;
    maxHp: number;
    mana?: number;
    maxMana?: number;
    damage: [number, number];
    accuracy: number;  // hit chance percentage (0-100)
    armor: number;     // flat damage reduction
    color: string;
    skills: Skill[];
    items: string[];
    range?: number;
    projectileColor?: string;
    attackCooldown: number;  // ms - cooldown for basic attack (also global cooldown)
}

export interface KoboldStats {
    name: string;
    hp: number;
    maxHp: number;
    damage: [number, number];
    accuracy: number;  // hit chance percentage (0-100)
    armor: number;     // flat damage reduction
    color: string;
    aggroRange: number;
    attackCooldown: number;  // ms - cooldown for basic attack
}

export interface Room {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface CandlePosition {
    x: number;
    z: number;
    dx: number;
    dz: number;
}

export interface MergedObstacle {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface PathNode {
    x: number;
    z: number;
    g: number;
    h: number;
    parent: PathNode | null;
}

export interface CombatLogEntry {
    text: string;
    color?: string;
}

export interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface HpBar {
    bg: THREE.Mesh;
    fill: THREE.Mesh;
    maxHp: number;
}

export interface DamageText {
    mesh: THREE.Mesh;
    life: number;
}

export interface FogTexture {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
}

export interface UnitGroup extends THREE.Group {
    userData: {
        unitId: number;
        targetX: number;
        targetZ: number;
        attackTarget: number | null;
    };
}

// Projectile types - basic (single target) vs AOE (area effect)
export interface BaseProjectile {
    mesh: THREE.Mesh;
    attackerId: number;
    speed: number;
}

export interface BasicProjectile extends BaseProjectile {
    type: "basic";
    targetId: number;
}

export interface AoeProjectile extends BaseProjectile {
    type: "aoe";
    targetPos: { x: number; z: number };
    aoeRadius: number;
    damage: [number, number];
}

export type Projectile = BasicProjectile | AoeProjectile;
