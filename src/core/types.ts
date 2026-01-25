import * as THREE from "three";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type EnemyType = "kobold" | "kobold_archer" | "kobold_witch_doctor" | "ogre" | "brood_mother" | "broodling" | "giant_amoeba" | "acid_slug" | "bat" | "undead_knight";

// =============================================================================
// STATUS EFFECTS
// =============================================================================

export type StatusEffectType = "poison" | "regen" | "shielded" | "stunned" | "cleansed" | "pinned" | "slowed" | "qi_drain";

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
    spawnedBy?: number;  // ID of the unit that spawned this one (for broodlings)
    splitCount?: number;  // For amoebas - how many times this lineage has split (affects size)
    facing?: number;  // Direction unit is facing in radians (for front-shielded enemies)
}

export interface Skill {
    name: string;
    description?: string;  // Short description for tooltip
    flavor?: string;       // Flavor text for tooltip
    manaCost: number;
    cooldown: number;  // ms
    type: "damage" | "heal" | "buff" | "taunt" | "flurry" | "debuff" | "trap" | "sanctuary" | "mana_transfer";
    targetType: "enemy" | "ally" | "self" | "aoe";
    range: number;
    aoeRadius?: number;
    value: [number, number];  // damage/heal range, or taunt chance for taunt skills
    projectileColor?: string;
    poisonChance?: number;  // 0-100 percent chance to apply poison on hit
    hitCount?: number;  // Number of hits for flurry-type skills
    stunChance?: number;  // 0-100 percent chance to apply stun on hit
    selfDamage?: [number, number];  // Damage range to apply to caster (for Qi Focus)
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

export interface EnemyHealSkill {
    name: string;
    cooldown: number;      // ms
    heal: [number, number];
    range: number;         // range to find hurt allies
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
    poisonDamage?: number;  // Custom poison damage per tick (default POISON_DAMAGE_PER_TICK)
    slowChance?: number;    // 0-100 percent chance to apply slow (1.5x cooldowns, 0.5x move speed)
    // Optional special skill
    skill?: EnemySkill;
    // Optional heal skill for support enemies
    healSkill?: EnemyHealSkill;
    // Optional kiting behavior for ranged enemies
    kiteDistance?: number;   // Distance to retreat when player gets too close
    kiteCooldown?: number;   // Minimum ms between kite attempts
    kiteTrigger?: number;    // Distance at which kiting triggers (melee range)
    // Optional spawn skill for spawner enemies (like Brood Mother)
    spawnSkill?: EnemySpawnSkill;
    // Optional movement speed multiplier (default 1.0)
    moveSpeed?: number;
    // Optional max split count for splitting enemies (like Giant Amoeba)
    maxSplitCount?: number;
    // Optional acid trail for acid slug enemies
    acidTrail?: boolean;       // Creates acid on grid cells when moving
    acidAura?: boolean;        // Periodically creates acid around itself
    acidAuraCooldown?: number; // ms between aura acid creation
    acidAuraRadius?: number;   // Radius in grid cells for aura
    // Optional flying behavior (floats above ground)
    flying?: boolean;
    // Optional lifesteal (heals for percentage of damage dealt, 0-1)
    lifesteal?: number;
    // Optional front shield - blocks all damage from the front
    frontShield?: boolean;
    // Turn speed multiplier (default 1.0, lower = slower turning)
    turnSpeed?: number;
}

export interface EnemySpawnSkill {
    spawnType: EnemyType;    // What enemy type to spawn
    cooldown: number;        // ms between spawns
    maxSpawns: number;       // Maximum active spawns at once
    spawnRange: number;      // How far from the spawner to place the spawn
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
        lastHitTime?: number;  // Timestamp when unit last took damage (for kiting AI)
        lastDamageSource?: { x: number; z: number; time: number };  // Position of last attacker (for shield facing)
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

export interface MagicMissileProjectile extends BaseProjectile {
    type: "magic_missile";
    targetId: number;          // -1 if no enemy target (position-based)
    targetPos?: { x: number; z: number };  // Used when targetId is -1
    damage: [number, number];
    // Zig-zag properties
    zigzagOffset: number;      // Current lateral offset
    zigzagDirection: number;   // 1 or -1
    zigzagPhase: number;       // Phase offset for varied movement
    // Fan-out properties
    fanAngle: number;          // Angle offset from center (-0.5 to 0.5 range, scaled)
    startX: number;            // Starting position for calculating travel distance
    startZ: number;
    // Volley tracking
    volleyId: number;          // Unique ID to group missiles from same cast
    missileIndex: number;      // Index within the volley (0 to missileCount-1)
    totalMissiles: number;     // Total missiles in this volley
}

export interface TrapProjectile extends BaseProjectile {
    type: "trap";
    targetPos: { x: number; z: number };
    aoeRadius: number;
    pinnedDuration: number;  // Duration of pinned effect in ms
    // Arc trajectory properties
    startX: number;
    startZ: number;
    startTime: number;
    flightDuration: number;  // ms for the arc flight
    arcHeight: number;       // Peak height of the arc
    isLanded: boolean;       // Whether trap has landed and is active
}

export type Projectile = BasicProjectile | AoeProjectile | MagicMissileProjectile | TrapProjectile;

// Acid tile - ground hazard created by acid slugs
export interface AcidTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    createdAt: number;   // Timestamp
    duration: number;    // Total duration in ms
    lastDamageTick: number;  // When damage was last applied
    sourceId: number;    // ID of the slug that created it
}

// Sanctuary tile - healing ground created by Paladin
export interface SanctuaryTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    createdAt: number;   // Timestamp
    duration: number;    // Total duration in ms
    lastHealTick: number;  // When healing was last applied
    sourceId: number;    // ID of the unit that created it
    healPerTick: number; // How much to heal each tick
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/** Check if a unit is on the player team */
export const isPlayerTeam = (unit: Unit): boolean => unit.team === "player";

/** Check if a unit is on the enemy team */
export const isEnemyTeam = (unit: Unit): boolean => unit.team === "enemy";

/** Check if an enemy has a front shield (requires EnemyStats) */
export const hasFrontShield = (stats: EnemyStats): boolean => stats.frontShield === true;
