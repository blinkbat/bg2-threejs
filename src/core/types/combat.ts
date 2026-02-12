import * as THREE from "three";

// =============================================================================
// COMBAT TYPES - Damage, skills, projectiles
// =============================================================================

// Damage types - armor only reduces physical damage
export type DamageType = "physical" | "fire" | "cold" | "lightning" | "chaos" | "holy";

export interface Skill {
    name: string;
    description?: string;  // Short description for tooltip
    flavor?: string;       // Flavor text for tooltip
    manaCost: number;
    cooldown: number;  // ms
    type: "damage" | "heal" | "buff" | "taunt" | "flurry" | "debuff" | "trap" | "sanctuary" | "mana_transfer" | "smite" | "energy_shield" | "aoe_buff" | "restoration" | "revive" | "dodge";
    targetType: "enemy" | "ally" | "self" | "aoe";
    range: number;
    aoeRadius?: number;
    damageType: DamageType;  // Type of damage - armor only reduces physical
    projectileColor?: string;

    // Explicit value properties (replaces overloaded 'value' array)
    damageRange?: [number, number];   // [min, max] damage for damage/smite/flurry skills
    healRange?: [number, number];     // [min, max] heal for heal skills
    manaRange?: [number, number];     // [min, max] mana transfer for mana_transfer skills
    duration?: number;                // Duration in ms for buffs/debuffs
    shieldAmount?: number;            // Shield HP for energy_shield
    armorBonus?: number;              // Armor bonus for defiance
    tauntChance?: number;             // 0-100 percent chance to taunt each enemy
    healPerTick?: number;             // Heal per tick for sanctuary

    // Additional optional properties
    poisonChance?: number;            // 0-100 percent chance to apply poison on hit
    hitCount?: number;                // Number of hits for flurry-type skills
    stunChance?: number;              // 0-100 percent chance to apply stun on hit
    selfDamage?: [number, number];    // Damage range to apply to caster (for Qi Focus)
    trapDamage?: [number, number];    // Damage dealt when trap triggers
    lineWidth?: number;               // Width of line-shaped AOE (rectangle instead of circle)
    chillChance?: number;             // 0-100 percent chance to apply chilled on hit

    // Cantrip properties
    isCantrip?: boolean;              // Uses charges instead of cooldowns, bypasses action cooldown
    maxUses?: number;                 // Max charges per day
}

export interface CombatLogEntry {
    text: string;
    color?: string;
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

// =============================================================================
// PROJECTILES
// =============================================================================

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
    damageType: DamageType;
}

export interface MagicMissileProjectile extends BaseProjectile {
    type: "magic_missile";
    targetId: number;          // -1 if no enemy target (position-based)
    targetPos?: { x: number; z: number };  // Used when targetId is -1
    damage: [number, number];
    damageType: DamageType;
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
    trapDamage?: [number, number];  // Damage dealt when trap triggers
    // Arc trajectory properties (pause-safe with delta time accumulation)
    startX: number;
    startZ: number;
    elapsedTime: number;      // Accumulated flight time (pause-safe)
    lastUpdateTime: number;   // Last frame timestamp for delta calculation
    flightDuration: number;   // ms for the arc flight
    arcHeight: number;        // Peak height of the arc
    isLanded: boolean;        // Whether trap has landed and is active
}

export interface FireballProjectile extends BaseProjectile {
    type: "fireball";
    damage: [number, number];
    damageType: DamageType;
    startX: number;
    startZ: number;
    directionX: number;      // Normalized direction vector
    directionZ: number;
    maxDistance: number;     // Expire after this distance traveled
    hitUnits: Set<number>;   // Track units already hit to avoid multi-hit
}

export interface PiercingProjectile extends BaseProjectile {
    type: "piercing";
    damage: [number, number];
    damageType: DamageType;
    startX: number;
    startZ: number;
    directionX: number;
    directionZ: number;
    maxDistance: number;
    hitUnits: Set<number>;
    chillChance: number;       // 0-100 percent chance to apply chilled on hit
    attackerTeam: "player" | "enemy";
}

export type Projectile = BasicProjectile | AoeProjectile | MagicMissileProjectile | TrapProjectile | FireballProjectile | PiercingProjectile;
