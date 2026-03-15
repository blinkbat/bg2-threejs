import * as THREE from "three";

// =============================================================================
// WORLD TYPES - Map, tiles, rendering, pathfinding
// =============================================================================

export interface CandlePosition {
    x: number;
    z: number;
    dx: number;
    dz: number;
    kind?: "candle" | "torch";
    lightColor?: string;
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

// =============================================================================
// RENDERING
// =============================================================================

export interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
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
        flyHeight: number;  // Y offset for airborne/floating units (0 for ground units)
        alerted?: boolean;  // Set when enemy is hit - makes them seek nearest player
        lastHitTime?: number;  // Timestamp when unit last took damage (for kiting AI)
        lastDamageSource?: { x: number; z: number; time: number };  // Position of last attacker (for shield facing)
        pendingMove?: boolean;  // Set when formation move is queued with delay, cleared on execution
        moveTarget?: { x: number; z: number };  // Last commanded move destination (used for regroup/path retries)
        formationRamp?: {               // Crawl until row-ahead unit is further along
            leaderId: number;           // Unit in the row ahead to watch
            leaderTargetX: number;      // That unit's formation target X
            leaderTargetZ: number;      // That unit's formation target Z
            leaderStartDist?: number;   // Leader's initial distance to destination
            myStartDist?: number;       // This unit's initial distance to destination
        };
        formationRegroupAttempted?: boolean;  // True after one forced regroup repath
        facingRight?: boolean;  // Sprite facing direction (true = right, default)
        attackMoveTarget?: { x: number; z: number };  // Attack-move destination (resume after combat)
        visualFacing?: number;  // Smooth per-frame shield facing (decoupled from React state)
        viewFadeOpacity?: number;  // Runtime fog visibility fade (0-1)
        attackBump?: { startTime: number; dx: number; dz: number; appliedX: number; appliedZ: number };  // Forward bump on attack
    };
}

// =============================================================================
// GROUND TILES
// =============================================================================

// Acid tile - ground hazard created by acid slugs
export interface AcidTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    elapsedTime: number;     // Accumulated elapsed time (pause-safe)
    lastUpdateTime: number;  // Last frame timestamp for delta calculation
    duration: number;        // Total duration in ms
    timeSinceTick: number;   // Accumulated time since last damage tick (pause-safe)
    sourceId: number;        // ID of the slug that created it
}

// Sanctuary tile - healing ground created by Paladin
export interface SanctuaryTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    elapsedTime: number;     // Accumulated elapsed time (pause-safe)
    lastUpdateTime: number;  // Last frame timestamp for delta calculation
    duration: number;        // Total duration in ms
    timeSinceTick: number;   // Accumulated time since last heal tick (pause-safe)
    sourceId: number;        // ID of the unit that created it
    healPerTick: number;     // How much to heal each tick
}

// Holy tile - smiting ground created by Cleric
export interface HolyTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    elapsedTime: number;     // Accumulated elapsed time (pause-safe)
    lastUpdateTime: number;  // Last frame timestamp for delta calculation
    duration: number;        // Total duration in ms
    timeSinceTick: number;   // Accumulated time since last damage tick (pause-safe)
    sourceId: number;        // ID of the unit that created it
    damagePerTick: number;   // Holy damage dealt each tick
}

// Fire tile - burning ground created by Wizard
export interface FireTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    elapsedTime: number;     // Accumulated elapsed time (pause-safe)
    lastUpdateTime: number;  // Last frame timestamp for delta calculation
    duration: number;        // Total duration in ms
    timeSinceTick: number;   // Accumulated time since last damage tick (pause-safe)
    sourceId: number;        // ID of the unit that created it
    damagePerTick: number;   // Fire damage dealt each tick
}

// Smoke tile - blind zone created by Thief
export interface SmokeTile {
    mesh: THREE.Mesh;
    x: number;           // Grid cell X
    z: number;           // Grid cell Z
    elapsedTime: number;     // Accumulated elapsed time (pause-safe)
    lastUpdateTime: number;  // Last frame timestamp for delta calculation
    duration: number;        // Total duration in ms
    timeSinceTick: number;   // Accumulated time since last blind tick (pause-safe)
    sourceId: number;        // ID of the unit that created it
}

// =============================================================================
// LOOT
// =============================================================================

// Loot bag - dropped by enemies, contains gold/items
export interface LootBag {
    id: number;
    mesh: THREE.Group;
    x: number;           // World X position
    z: number;           // World Z position
    gold: number;        // Gold contained in bag
    items?: string[];    // Optional item IDs contained in bag
}

export type LootPickupSourceLabel = "Chest" | "Looted Corpse";

export interface LootPickupEntry {
    label: string;
    tone: "gold" | "item";
    itemId?: string;
}

export interface LootPickupRequest {
    sourceLabel: LootPickupSourceLabel;
    entries: LootPickupEntry[];
    onTake: () => void;
}
