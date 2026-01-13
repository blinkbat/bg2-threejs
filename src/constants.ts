// =============================================================================
// GAME CONSTANTS
// =============================================================================

export const GRID_SIZE = 50;
export const ATTACK_RANGE = 1.8;
export const MOVE_SPEED = 0.05;
export const DEFAULT_UNIT_RADIUS = 0.7;
export const VISION_RADIUS = 10;
export const PAN_SPEED = 0.4;

// Combat
export const HIT_DETECTION_RADIUS = 0.3;
export const ALLY_CLICK_RADIUS = 2;
export const FORMATION_SPACING = 1.2;
export const FLASH_DURATION = 200;

// Status Effects - Poison
export const POISON_DURATION = 8000;       // 8 seconds
export const POISON_TICK_INTERVAL = 1000;  // tick every 1 second
export const POISON_DAMAGE_PER_TICK = 2;   // 2 damage per tick

// Animation Durations
export const SWING_DURATION = 150;
export const AOE_EXPAND_DURATION = 400;

// AI Timing
export const TARGET_SCAN_INTERVAL = 500;   // ms between target scans
export const UNREACHABLE_COOLDOWN = 5000;  // Don't retry unreachable target for 5 seconds

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
};
