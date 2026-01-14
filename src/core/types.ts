import * as THREE from "three";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type EnemyType = "kobold" | "kobold_archer" | "ogre";

// =============================================================================
// STATUS EFFECTS
// =============================================================================

export type StatusEffectType = "poison" | "regen";

export interface StatusEffect {
    type: StatusEffectType;
    duration: number;      // remaining duration in ms
    tickInterval: number;  // ms between damage ticks
    lastTick: number;      // timestamp of last tick
    damagePerTick: number; // damage dealt each tick
    sourceId: number;      // who applied the effect
}

export interface Unit {
    id: number;
    x: number;
    z: number;
    hp: number;
    mana?: number;
    team: "player" | "enemy";
    enemyType?: EnemyType;  // Only set for enemies
    target: number | null;
    aiEnabled: boolean;
    statusEffects?: StatusEffect[];  // Active status effects
}

export interface Skill {
    name: string;
    manaCost: number;
    cooldown: number;  // ms
    type: "damage" | "heal" | "buff" | "taunt";
    targetType: "enemy" | "ally" | "self" | "aoe";
    range: number;
    aoeRadius?: number;
    value: [number, number];  // damage/heal range, or taunt chance for taunt skills
    projectileColor?: string;
    poisonChance?: number;  // 0-100 percent chance to apply poison on hit
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
    size?: number;  // hitbox size multiplier (default 1)
}

export interface EnemySkill {
    name: string;
    cooldown: number;      // ms
    damage: [number, number];
    maxTargets: number;    // how many units it can hit
    range: number;         // activation range
}

export interface EnemyStats {
    name: string;
    hp: number;
    maxHp: number;
    damage: [number, number];
    accuracy: number;
    armor: number;
    color: string;
    aggroRange: number;
    attackCooldown: number;
    // Optional for ranged enemies
    range?: number;
    projectileColor?: string;
    // Optional for large enemies
    size?: number;
    // Optional status effect on hit
    poisonChance?: number;  // 0-100 percent chance to apply poison
    // Optional special skill
    skill?: EnemySkill;
    // Optional kiting behavior for ranged enemies
    kiteDistance?: number;   // Distance to retreat when player gets too close
    kiteCooldown?: number;   // Minimum ms between kite attempts
    kiteTrigger?: number;    // Distance at which kiting triggers (melee range)
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

export interface SwingAnimation {
    mesh: THREE.Mesh;
    attackerX: number;
    attackerZ: number;
    startAngle: number;
    startTime: number;
    duration: number;
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
        alerted?: boolean;  // Set when enemy is hit - makes them seek nearest player
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
