// =============================================================================
// UNIT TYPES - Units, enemies, and status effects
// =============================================================================

// Enemy type identifiers
export type EnemyType = "kobold" | "kobold_archer" | "kobold_witch_doctor" | "ogre" | "brood_mother" | "broodling" | "giant_amoeba" | "acid_slug" | "bat" | "undead_knight" | "ancient_construct" | "feral_hound" | "corrupt_druid" | "skeleton_warrior" | "baby_kraken" | "kraken_tentacle" | "magma_imp" | "necromancer" | "skeleton_minion";

// Status effect types
export type StatusEffectType = "poison" | "regen" | "shielded" | "stunned" | "cleansed" | "pinned" | "slowed" | "qi_drain" | "energyShield" | "defiance" | "doom" | "invul";

export interface StatusEffect {
    type: StatusEffectType;
    duration: number;         // remaining duration in ms
    tickInterval: number;     // ms between damage ticks
    timeSinceTick: number;    // accumulated time since last tick (pause-safe)
    lastUpdateTime: number;   // last frame timestamp for delta calculation
    damagePerTick: number;    // damage dealt each tick
    sourceId: number;         // who applied the effect
    shieldAmount?: number;    // for energyShield: remaining shield HP
}

// =============================================================================
// UNIT DATA
// =============================================================================

// Character stats type
export interface CharacterStats {
    strength: number;     // +1 physical damage per 2 points
    dexterity: number;    // +1% hit chance per 2 points, +1% crit chance per 2 points
    vitality: number;     // +1 HP per point
    intelligence: number; // +1 MP per point, +1 elemental/chaos damage per 2 points
    faith: number;        // +1 holy damage per 2 points, +1 healing power per 2 points
}

export interface Unit {
    id: number;
    x: number;
    z: number;
    hp: number;
    mana?: number;
    level?: number;       // Character level (player units only)
    exp?: number;         // Current experience points (player units only)
    stats?: CharacterStats;  // Allocated stat points (player units only)
    statPoints?: number;  // Unspent stat points (player units only)
    team: "player" | "enemy";
    enemyType?: EnemyType;  // Only set for enemies
    target: number | null;
    aiEnabled: boolean;
    statusEffects?: StatusEffect[];  // Active status effects
    spawnedBy?: number;  // ID of the unit that spawned this one (for broodlings)
    splitCount?: number;  // For amoebas - how many times this lineage has split (affects size)
    facing?: number;  // Direction unit is facing in radians (for front-shielded enemies)
    cantripUses?: Record<string, number>;  // Remaining cantrip charges keyed by skill name
}

import type { Skill } from "./combat";

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
    baseCrit?: number;  // base crit chance percentage (added to dexterity bonus)
}

// =============================================================================
// ENEMY DATA
// =============================================================================

import type { DamageType } from "./combat";

export interface EnemySkill {
    name: string;
    cooldown: number;      // ms
    damage: [number, number];
    maxTargets: number;    // how many units it can hit
    range: number;         // activation range
    damageType: DamageType;  // Type of damage - armor only reduces physical
}

export interface EnemyHealSkill {
    name: string;
    cooldown: number;      // ms
    heal: [number, number];
    range: number;         // range to find hurt allies
}

export interface EnemySpawnSkill {
    spawnType: EnemyType;    // What enemy type to spawn
    cooldown: number;        // ms between spawns
    maxSpawns: number;       // Maximum active spawns at once
    spawnRange: number;      // How far from the spawner to place the spawn
}

export interface EnemyChargeAttack {
    name: string;
    cooldown: number;        // ms between charge attacks
    chargeTime: number;      // ms to charge before attack fires
    damage: [number, number];
    crossWidth: number;      // Width of cross arms in grid cells
    crossLength: number;     // Length of cross arms in grid cells
    damageType: DamageType;  // Type of damage - armor only reduces physical
}

export interface EnemyLeapSkill {
    cooldown: number;        // ms between leaps
    minRange: number;        // Minimum distance to target to trigger leap
    maxRange: number;        // Maximum leap distance
    damage: [number, number];  // Bonus damage on landing
}

export interface EnemyVinesSkill {
    cooldown: number;        // ms between casts
    range: number;           // Cast range
    duration: number;        // How long target is immobilized (ms)
    damage: [number, number];  // Damage dealt when vines grab
}

export interface EnemyTentacleSkill {
    cooldown: number;        // ms between tentacle spawns
    maxTentacles: number;    // Maximum active tentacles at once
    spawnRange: number;      // How far from the kraken to spawn tentacles (toward targets)
    tentacleDuration: number; // How long tentacles last before despawning (ms)
    damageToParent: number;  // Damage dealt to kraken when tentacle is killed
}

export interface EnemyRaiseSkill {
    spawnType: EnemyType;    // What enemy type to raise
    cooldown: number;        // ms after all minions die before re-raising
    spawnCount: number;      // How many to raise at once
    spawnRange: number;      // Placement radius around the raiser
}

export interface EnemyCurseSkill {
    name: string;
    cooldown: number;        // ms between casts
    range: number;           // Targeting range
    radius: number;          // AoE radius in tiles
    delay: number;           // ms warning before detonation
    damage: [number, number];
    damageType: DamageType;
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
    expReward: number;  // Experience points awarded on death
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
    // Movement speed multiplier (1.0 = normal speed)
    moveSpeed: number;
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
    // Optional charge attack - boss winds up a large attack with visual warning
    chargeAttack?: EnemyChargeAttack;
    // Aggressive targeting - immediately retargets to damage sources, bypasses scan cooldowns
    aggressiveTargeting?: boolean;
    // Optional leap skill - jump to close distance with targets
    leapSkill?: EnemyLeapSkill;
    // Optional vines skill - immobilizes target
    vinesSkill?: EnemyVinesSkill;
    // Optional block chance - percent chance to block physical damage
    blockChance?: number;
    // Optional tentacle skill - spawns tentacles toward targets
    tentacleSkill?: EnemyTentacleSkill;
    // Optional fireball attack - slow projectile that hurts everything it touches
    fireballAttack?: boolean;
    // Base crit chance percentage (0 by default, enemies can crit too)
    baseCrit?: number;
    // Optional raise skill - batch-spawns minions, re-raises when all die
    raiseSkill?: EnemyRaiseSkill;
    // Optional curse skill - delayed AoE at target position
    curseSkill?: EnemyCurseSkill;
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
