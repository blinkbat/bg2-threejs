// =============================================================================
// GAME CONSTANTS
// =============================================================================

export const GRID_SIZE = 50;
export const FOG_SCALE = 4;  // Higher = sharper fog edges with linear filtering
export const ATTACK_RANGE = 1.8;
export const MOVE_SPEED = 0.05;
export const DEFAULT_UNIT_RADIUS = 0.7;
export const DEFAULT_MOVE_SPEED = 1.0;  // Normal movement speed multiplier

// Debug speed multiplier (mutable for debug menu)
let debugSpeedMultiplier = 1.0;
export const getDebugSpeedMultiplier = () => debugSpeedMultiplier;
export const setDebugSpeedMultiplier = (mult: number) => { debugSpeedMultiplier = mult; };
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

// Status Effects - Chilled
export const CHILLED_DURATION = 5000;       // 5 seconds
export const CHILLED_COOLDOWN_MULT = 2.0;   // 2x cooldowns when chilled
export const CHILLED_MOVE_MULT = 0.5;       // 0.5x move speed when chilled
export const CHILLED_TINT_STRENGTH = 0.4;   // Color lerp for chilled visual

// Status Effects - Blind
export const BLIND_DURATION = 5000;         // 5 seconds
export const BLIND_ACCURACY_MULT = 0.45;    // 55% hit chance reduction while blinded

// Status Effects - Targeted shot debuffs
export const WEAKENED_COOLDOWN_MULT = 1.35; // 35% longer attack/skill cooldowns
export const HAMSTRUNG_MOVE_MULT = 0.6;     // 40% move speed reduction

// Status Effects - Defiance
export const DEFIANCE_COOLDOWN_MULT = 0.5; // 0.5x cooldowns when under defiance buff

// Status Effects - Sun Stance (bonus fire damage on attacks)
export const SUN_STANCE_BONUS_DAMAGE: [number, number] = [2, 3];
export const SUN_STANCE_TINT_STRENGTH = 0.3;

// Status Effects - Thorns (reflect melee damage)
export const THORNS_DURATION = 30000;       // 30 seconds
export const THORNS_DAMAGE_MIN = 2;
export const THORNS_DAMAGE_MAX = 4;

// Status Effects - Enrage (enemy low-HP buff)
export const ENRAGED_TINT_STRENGTH = 0.35;  // lerp blend toward red-orange when enraged

// Status Effects - Highland Defense (barbarian cantrip redirect)
export const HIGHLAND_DEFENSE_DURATION = Number.MAX_SAFE_INTEGER; // Effectively permanent until intercept pool is exhausted
export const HIGHLAND_DEFENSE_INTERCEPT_CAP = 50;        // max redirected damage before expiring
export const HIGHLAND_DEFENSE_INTERCEPT_COOLDOWN = 5000; // once per 5s
export const HIGHLAND_DEFENSE_RANGE = 4.5;               // nearby ally radius

// Summons - Ancestor Warrior aura
export const ANCESTOR_AURA_RANGE = 4.5;
export const ANCESTOR_AURA_DAMAGE_BONUS = 2;

// Summons - Visha's Eyes (cleric cantrip)
export const VISHAS_EYES_ORB_COUNT = 3;
export const VISHAS_EYES_ORB_DURATION = 18000;  // 18 seconds
export const VISHAS_EYES_ORB_FLY_HEIGHT = 0.75;
export const VISHAS_EYES_ORB_HEAL_RADIUS = 3;
export const VISHAS_EYES_ORB_HEAL_RANGE: [number, number] = [3, 5];

// Status Effects - Doom (kills unit after duration expires, cured by Restoration)
export const DOOM_DURATION = 10000;          // 10 seconds until death
export const DOOM_TICK_INTERVAL = 1000;      // Tick every 1 second (for countdown)

// Status Effects - Sleep (prevents action, wakes on damage or Restoration)
export const SLEEP_MIN_DURATION = 4000;       // 4 seconds minimum
export const SLEEP_MAX_DURATION = 7000;       // 7 seconds maximum

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

// Holy Tiles - Smiting ground created by Cleric
export const HOLY_TILE_DURATION = 12000;       // 12 seconds per tile
export const HOLY_TICK_INTERVAL = 1000;        // Damage every 1 second
export const HOLY_DAMAGE_PER_TICK = 3;         // 3 holy damage per tick
export const HOLY_MAX_TILES = 45;              // Max tiles in world

// Trap Projectile
export const TRAP_FLIGHT_DURATION = 600;   // ms for arc flight
export const TRAP_ARC_HEIGHT = 2.5;        // Peak height of thrown trap
export const TRAP_MESH_SIZE = 0.25;        // Size of trap mesh

// Visual Effects
export const HEAL_FLASH_DURATION = 200;    // ms for green healing flash
export const RING_EXPAND_DURATION = 400;   // ms for taunt ring animation
export const DEFAULT_CANDLE_LIGHT_COLOR = "#ffaa44";
export const DEFAULT_TORCH_LIGHT_COLOR = "#ff8844";

// Sprite Rendering
export const SPRITE_DEFAULT_BRIGHTNESS = 0.07;  // Emissive boost — feeds into emissiveIntensity formula

// Animation Durations
export const SWING_DURATION = 150;
export const SWING_ARC_ANGLE = Math.PI * 2 / 3;    // 120° swing arc
export const SWING_START_OFFSET = Math.PI / 3;      // Start 60° before facing
export const SWING_DOT_ORBIT_RADIUS = 0.5;          // Distance of swing dot from attacker
export const AOE_EXPAND_DURATION = 400;
export const SWIPE_ANIMATE_DURATION = 300;

// Leap Attack
export const LEAP_DURATION = 350;          // ms for leap animation
export const LEAP_ARC_HEIGHT = 2.5;        // Peak height of parabolic arc
export const LEAP_DAMAGE_RADIUS = 2.5;     // Landing damage radius
export const LEAP_MIN_LANDING_DIST = 1.2;  // Minimum landing distance from origin
export const LEAP_LANDING_OFFSET = 1.0;    // Distance short of target to land

// Tentacle Spawning
export const TENTACLE_EMERGE_DURATION = 600;   // ms for emerge/retreat animation
export const TENTACLE_START_Y = -1.5;          // Start position below ground
export const MAX_LIFETIME_TENTACLES = 8;       // Max tentacles per kraken per fight
export const TENTACLE_SPAWN_BUFFER = 1.5;      // Don't spawn right on top of target

// Loot Bags
export const LOOT_BAG_DROP_HEIGHT = 1.5;       // Initial drop Y position
export const LOOT_BAG_BOUNCE_DURATION = 500;   // ms for bounce animation
export const LOOT_BAG_DROP_PHASE = 0.7;        // Fraction of animation spent dropping (vs bouncing)
export const LOOT_BAG_BOUNCE_HEIGHT = 0.15;    // Bounce amplitude

// Fire Breath
export const FIRE_BREATH_BASE_OPACITY = 0.35;     // Cone resting opacity
export const FIRE_BREATH_OPACITY_AMPLITUDE = 0.1;  // Pulse oscillation range
export const FIRE_BREATH_PULSE_SPEED = 8;          // Sine wave speed

// Magic Wave
export const MAGIC_WAVE_TARGETING_BUFFER = 1;      // Extra radius for target detection
export const MAGIC_WAVE_FAN_SPREAD = Math.PI * 0.5; // 90° total fan angle
export const MAGIC_MISSILE_START_OFFSET = 0.3;      // Spawn offset from caster
export const MAGIC_MISSILE_SPEED = 0.07;            // Projectile speed
export const MAGIC_MISSILE_ZIGZAG_PHASE_STEP = 0.25; // Phase stagger per missile

// Glacial Whorl
export const GLACIAL_WHORL_SPEED = 0.05;           // Slow-moving piercing projectile
export const GLACIAL_WHORL_MAX_DISTANCE = 12;      // Max travel distance
export const GLACIAL_WHORL_HIT_RADIUS = 0.6;       // Collision radius

// Skill Defaults
export const DEFAULT_TAUNT_CHANCE = 80;    // % chance to taunt each enemy
export const DEFAULT_STUN_CHANCE = 75;     // % chance to stun on hit

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

// AI Kiting
export const DEFAULT_KITE_DISTANCE = 3;    // Grid cells to retreat
export const DEFAULT_KITE_COOLDOWN = 4000; // ms between kite attempts

// Pathfinding - Stuck Detection
export const STUCK_REALLY_STUCK_MS = 1000;     // Time threshold for "really stuck" (moved < 0.2 in 1s)
export const STUCK_REALLY_STUCK_DIST = 0.2;    // Distance threshold for "really stuck"
export const STUCK_MS = 2000;                  // Time threshold for normal stuck (moved < 0.5 in 2s)
export const STUCK_DIST = 0.5;                 // Distance threshold for normal stuck
export const STUCK_RECOVERY_COOLDOWN = 1500;   // ms before retrying path after giving up
export const PLAYER_MOVE_TIMEOUT_MS = 5000;    // Absolute timeout for player move commands (formation moves)
export const FORMATION_SLOW_SPEED = 0.1;       // Speed multiplier while leader hasn't progressed (ramps to 1.0)
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
    damageCrit: "#ffd700",      // Gold - critical hit

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
    defiance: "#c0392b",
    defianceText: "#e74c3c",
    defianceBg: "#2a1515",
    doom: "#1a0a2a",
    doomText: "#8b5fbf",
    doomBg: "#120820",
    sleep: "#4a0080",
    sleepText: "#9b59b6",
    sleepBg: "#1a0033",
    sunStance: "#ff6b35",
    sunStanceText: "#ff8c5a",
    sunStanceBg: "#2a1508",
    thorns: "#7f8c2f",
    thornsText: "#c8da4b",
    thornsBg: "#1f240f",
    highlandDefense: "#6b4f2a",
    highlandDefenseText: "#d4a56a",
    highlandDefenseBg: "#24180c",
    divineLattice: "#d8e6ff",
    divineLatticeText: "#ffffff",
    divineLatticeBg: "#1a2333",
    weakened: "#7f5f4a",
    weakenedText: "#d9ad84",
    weakenedBg: "#2a1f18",
    hamstrung: "#355c7d",
    hamstrungText: "#7fb3d5",
    hamstrungBg: "#132230",
    blind: "#7f8c8d",
    blindText: "#c7d0d3",
    blindBg: "#1f2629",
    chilled: "#5dade2",             // Ice blue
    chilledText: "#85c1e9",         // Lighter ice blue
    slowedText: "#5dade2",          // Blue - movement debuff
    energyShieldText: "#bb86fc",    // Purple glow - arcane shield
    qiDrainText: "#ff6b6b",        // Red - life drain
    invulText: "#d2b4ff",           // Light purple - divine protection
    regenText: "#6bef8a",           // Bright green - healing over time
    enragedText: "#ff6633",         // Orange-red - fury
    fireBreath: "#ff4400",       // Orange-red for fire breath cone
    acid: "#9acd32",            // Yellow-green for acid tiles
    acidText: "#b8e060",        // Brighter for damage text
    holyGround: "#f0e6a8",      // Pale gold for holy ground tiles
    holyGroundText: "#fff3c9",  // Bright holy text for smiting tiles
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
    skillHeal: "#7fcf99",

    // Damage types
    dmgPhysical: "#c0c0c0",    // Silver/grey - physical damage
    dmgFire: "#ff6b35",        // Orange-red - fire damage
    dmgCold: "#5dade2",        // Ice blue - cold damage
    dmgLightning: "#f4d03f",   // Yellow - lightning damage
    dmgChaos: "#9b59b6",       // Purple - chaos/arcane damage
    dmgHoly: "#ffffff",        // White - holy damage
};

// =============================================================================
// SKILL COLOR HELPERS - shared palette for UI + combat logs
// =============================================================================

type DamageTypeForColor = "physical" | "fire" | "cold" | "lightning" | "chaos" | "holy";
export type SkillTypeForColor = "damage" | "heal" | "buff" | "taunt" | "flurry" | "debuff" | "trap" | "sanctuary" | "mana_transfer" | "smite" | "energy_shield" | "aoe_buff" | "restoration" | "revive" | "dodge" | "summon";

/** Canonical color for a raw damage type */
export function getDamageTypeColor(damageType: DamageTypeForColor | undefined): string {
    switch (damageType) {
        case "fire":
            return COLORS.dmgFire;
        case "cold":
            return COLORS.dmgCold;
        case "lightning":
            return COLORS.dmgLightning;
        case "chaos":
            return COLORS.dmgChaos;
        case "holy":
            return COLORS.dmgHoly;
        case "physical":
            return COLORS.dmgPhysical;
        default:
            return COLORS.dmgPhysical;
    }
}

/** Shared accent color for a skill (used in skill UI text and skill-related log lines) */
export function getSkillTextColor(
    skillType: SkillTypeForColor | undefined,
    damageType?: DamageTypeForColor
): string {
    switch (skillType) {
        case "heal":
        case "sanctuary":
        case "restoration":
        case "revive":
            return COLORS.skillHeal;
        case "mana_transfer":
            return COLORS.mana;
        case "taunt":
            return COLORS.defianceText;
        case "dodge":
        case "energy_shield":
            return COLORS.dmgChaos;
        case "buff":
        case "aoe_buff":
        case "summon":
            return damageType && damageType !== "physical"
                ? getDamageTypeColor(damageType)
                : COLORS.shieldedText;
        case "damage":
        case "smite":
        case "flurry":
        case "debuff":
        case "trap":
            return getDamageTypeColor(damageType);
        default:
            return COLORS.logNeutral;
    }
}

/** Map skill type to CSS class for styling (kept for existing class hooks) */
export function getSkillColorClass(skillType: SkillTypeForColor | undefined): string {
    switch (skillType) {
        case "damage":
        case "smite":
            return "skill-damage";
        case "heal":
        case "sanctuary":
        case "restoration":
        case "revive":
            return "skill-heal";
        case "taunt":
        case "debuff":
        case "trap":
            return "skill-taunt";
        case "flurry":
            return "skill-flurry";
        case "dodge":
            return "skill-dodge";
        case "summon":
            return "skill-buff";
        default:
            return "skill-buff";
    }
}

/** Border color uses the same canonical skill accent color */
export function getSkillBorderColor(
    skillType: SkillTypeForColor | undefined,
    damageType?: DamageTypeForColor
): string {
    const color = getSkillTextColor(skillType, damageType);
    return color === COLORS.logNeutral ? "#555" : color;
}
