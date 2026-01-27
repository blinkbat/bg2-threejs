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
    type: "damage" | "heal" | "buff" | "taunt" | "flurry" | "debuff" | "trap" | "sanctuary" | "mana_transfer";
    targetType: "enemy" | "ally" | "self" | "aoe";
    range: number;
    aoeRadius?: number;
    value: [number, number];  // damage/heal range, or taunt chance for taunt skills
    damageType: DamageType;  // Type of damage - armor only reduces physical
    projectileColor?: string;
    poisonChance?: number;  // 0-100 percent chance to apply poison on hit
    hitCount?: number;  // Number of hits for flurry-type skills
    stunChance?: number;  // 0-100 percent chance to apply stun on hit
    selfDamage?: [number, number];  // Damage range to apply to caster (for Qi Focus)
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
    // Arc trajectory properties (pause-safe with delta time accumulation)
    startX: number;
    startZ: number;
    elapsedTime: number;      // Accumulated flight time (pause-safe)
    lastUpdateTime: number;   // Last frame timestamp for delta calculation
    flightDuration: number;   // ms for the arc flight
    arcHeight: number;        // Peak height of the arc
    isLanded: boolean;        // Whether trap has landed and is active
}

export type Projectile = BasicProjectile | AoeProjectile | MagicMissileProjectile | TrapProjectile;
