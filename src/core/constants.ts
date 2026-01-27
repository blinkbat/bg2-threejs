// =============================================================================
// GAME CONSTANTS
// =============================================================================

export const GRID_SIZE = 50;
export const FOG_SCALE = 4;  // Higher = sharper fog edges with linear filtering
export const ATTACK_RANGE = 1.8;
export const MOVE_SPEED = 0.05;
export const DEFAULT_UNIT_RADIUS = 0.7;
export const VISION_RADIUS = 10;
export const PAN_SPEED = 0.4;

// Combat
export const HIT_DETECTION_RADIUS = 0.3;
export const ALLY_CLICK_RADIUS = 2;
export const FLASH_DURATION = 200;

// Status Effects - Poison
export const POISON_DURATION = 8000;       // 8 seconds
export const POISON_TICK_INTERVAL = 1000;  // tick every 1 second
export const POISON_DAMAGE_PER_TICK = 2;   // 2 damage per tick
export const POISON_TINT_STRENGTH = 0.4;   // Color lerp amount for poison visual

// Status Effects - Buffs (shielded, stunned, cleansed, pinned)
export const BUFF_TICK_INTERVAL = 100;     // tick every 100ms for smooth duration countdown

// Status Effects - Slow
export const SLOW_DURATION = 10000;        // 10 seconds
export const SLOW_COOLDOWN_MULT = 1.5;     // 1.5x cooldowns when slowed
export const SLOW_MOVE_MULT = 0.5;         // 0.5x move speed when slowed

// Status Effects - Qi Drain (self-damage from Qi Focus)
export const QI_DRAIN_DURATION = 10000;    // 10 seconds
export const QI_DRAIN_TICK_INTERVAL = 1000; // tick every 1 second

// Acid Tiles - Ground hazard from acid slugs
export const ACID_TILE_DURATION = 8000;    // 8 seconds per tile
export const ACID_TICK_INTERVAL = 1000;    // Damage every 1 second
export const ACID_DAMAGE_PER_TICK = 4;     // 4 damage per tick
export const ACID_AURA_COOLDOWN = 3000;    // 3 seconds between aura creation
export const ACID_AURA_RADIUS = 1.5;       // Grid cells around slug for aura
export const ACID_MAX_TILES = 40;          // Max tiles in world to prevent spam

// Sanctuary Tiles - Healing ground created by Paladin
export const SANCTUARY_TILE_DURATION = 20000;  // 20 seconds per tile
export const SANCTUARY_TICK_INTERVAL = 2000;   // Heal every 2 seconds
export const SANCTUARY_HEAL_PER_TICK = 3;      // 3 HP per tick
export const SANCTUARY_MAX_TILES = 25;         // Max tiles in world

// Trap Projectile
export const TRAP_FLIGHT_DURATION = 600;   // ms for arc flight
export const TRAP_ARC_HEIGHT = 2.5;        // Peak height of thrown trap
export const TRAP_MESH_SIZE = 0.25;        // Size of trap mesh

// Visual Effects
export const HEAL_FLASH_DURATION = 200;    // ms for green healing flash
export const RING_EXPAND_DURATION = 400;   // ms for taunt ring animation

// Animation Durations
export const SWING_DURATION = 150;
export const AOE_EXPAND_DURATION = 400;
export const SWIPE_ANIMATE_DURATION = 300;

// Projectile Configuration
export const PROJECTILE_CONFIG = {
    aoe: { radius: 0.2, segments: 12, height: 0.8, speed: 0.25, defaultColor: "#ff4400" },
    ranged: { radius: 0.15, segments: 8, height: 0.6, speed: 0.3, defaultColor: "#a0522d" },
    enemy: { radius: 0.1, segments: 8, height: 0.7, speed: 0.3 }
} as const;

// AI Timing
export const TARGET_SCAN_INTERVAL = 500;   // ms between target scans
export const UNREACHABLE_COOLDOWN = 5000;  // Don't retry unreachable target for 5 seconds
export const SKILL_SINGLE_TARGET_CHANCE = 0.3; // 30% chance to use skill on single target

// Pathfinding - Stuck Detection
export const STUCK_REALLY_STUCK_MS = 1000;     // Time threshold for "really stuck" (moved < 0.2 in 1s)
export const STUCK_REALLY_STUCK_DIST = 0.2;    // Distance threshold for "really stuck"
export const STUCK_MS = 2000;                  // Time threshold for normal stuck (moved < 0.5 in 2s)
export const STUCK_DIST = 0.5;                 // Distance threshold for normal stuck
export const STUCK_RECOVERY_COOLDOWN = 1500;   // ms before retrying path after giving up
export const JITTER_DETECTION_MS = 300;        // Give up if jittering in place for this long
export const JITTER_DIRECTION_CHANGES = 3;    // Number of direction reversals to count as jittering

// Pathfinding - Path Following
export const PATH_WAYPOINT_REACH_DIST = 0.3;   // Distance to waypoint to consider it reached
export const PATH_MAX_DEVIATION = 2;           // Max distance path end can be from target before recalculating
export const PATH_RECURSION_LIMIT = 3;         // Max recursion depth for findPath blocked target search

// Pathfinding - A* Algorithm
export const ASTAR_BLOCKED_TARGET_SEARCH = 2;  // Radius to search for unblocked cell near blocked target
export const ASTAR_DIAGONAL_COST = Math.SQRT2; // Cost for diagonal movement (√2 ≈ 1.414)

// Movement - Unit Avoidance
export const AVOIDANCE_RANGE_MULTIPLIER = 1.3;  // How far to start avoiding (combinedRadius * multiplier)
export const AVOIDANCE_OVERLAP_STRENGTH = 3;    // Push strength when overlapping (stronger to prevent clipping)
export const AVOIDANCE_STEER_THRESHOLD = 0.4;   // Dot product threshold to start steering
export const AVOIDANCE_STEER_STRENGTH = 0.5;    // Steering force multiplier
export const MOVEMENT_MIN_DIST = 0.1;          // Minimum distance to target before stopping
export const MOVEMENT_MIN_MAGNITUDE = 0.01;    // Minimum movement vector magnitude

// Colors
export const COLORS = {
    // Damage text
    damagePlayer: "#4ade80",    // Green - damage dealt by player
    damageEnemy: "#f87171",     // Red - damage dealt to player
    damageNeutral: "#ff6600",   // Orange - enemy taking damage

    // Status effects
    poison: "#4a7c4a",
    poisonText: "#7cba7c",
    poisonBg: "#1a2a1a",
    shielded: "#d4a017",
    shieldedText: "#f1c40f",
    shieldedBg: "#2a2510",
    stunned: "#8b4513",
    stunnedText: "#cd853f",
    stunnedBg: "#2a1a10",
    cleansed: "#b8c4d0",
    cleansedText: "#ecf0f1",
    cleansedBg: "#1a1a2a",
    pinned: "#8b0000",
    pinnedText: "#ff4444",
    pinnedBg: "#2a1010",
    acid: "#9acd32",            // Yellow-green for acid tiles
    acidText: "#b8e060",        // Brighter for damage text
    sanctuary: "#ffd700",       // Golden for sanctuary tiles
    sanctuaryText: "#ffe44d",   // Brighter gold for heal text

    // HP bar colors
    hpHigh: "#22c55e",          // > 50%
    hpMedium: "#eab308",        // 25-50%
    hpLow: "#ef4444",           // < 25%
    mana: "#3b82f6",

    // Log colors
    logWarning: "#f59e0b",
    logSuccess: "#4ade80",
    logNeutral: "#888",
    logHeal: "#7cba7c",

    // Damage types
    dmgPhysical: "#c0c0c0",    // Silver/grey - physical damage
    dmgFire: "#ff6b35",        // Orange-red - fire damage
    dmgCold: "#5dade2",        // Ice blue - cold damage
    dmgLightning: "#f4d03f",   // Yellow - lightning damage
    dmgChaos: "#9b59b6",       // Purple - chaos/arcane damage
    dmgHoly: "#f1c40f",        // Golden - holy damage
};
