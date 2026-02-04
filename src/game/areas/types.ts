// =============================================================================
// AREA TYPES - Interfaces and type definitions
// =============================================================================

import type { CandlePosition, MergedObstacle, EnemyType } from "../../core/types";

// Built-in areas (for autocomplete)
export type BuiltInAreaId = "dungeon" | "forest" | "coast" | "ruins" | "sanctum" | "cliffs" | "magma_cave";

// AreaId allows any string (for custom areas) while preserving autocomplete for built-in ones
export type AreaId = BuiltInAreaId | (string & {});

// Default game start configuration - single source of truth
export const DEFAULT_STARTING_AREA: AreaId = "coast";
export const DEFAULT_SPAWN_POINT = { x: 25, z: 12 };  // Near water's edge

export interface EnemySpawn {
    x: number;
    z: number;
    type: EnemyType;
}

export interface AreaTransition {
    x: number;
    z: number;
    w: number;
    h: number;
    targetArea: AreaId;
    targetSpawn: { x: number; z: number };  // Where party spawns in target area
    direction: "north" | "south" | "east" | "west";  // Which way door faces
}

export interface ChestContents {
    itemId: string;
    quantity: number;
}

export interface ChestLocation {
    x: number;
    z: number;
    contents: ChestContents[];
    gold?: number;
    locked?: boolean;
    requiredKeyId?: string;  // keyId from KeyItem to unlock
}

export interface TreeLocation {
    x: number;
    z: number;
    size: number;  // Scale multiplier (0.5 = small, 1 = medium, 1.5 = large)
}

export interface Decoration {
    x: number;
    z: number;
    type: "column" | "broken_column" | "broken_wall" | "rock" | "small_rock" | "mushroom" | "small_mushroom" | "seaweed" | "small_seaweed" | "fern" | "small_fern";
    rotation?: number;  // Rotation in radians (for broken walls)
    size?: number;      // Scale multiplier
}

export interface SecretDoor {
    x: number;
    z: number;
    // The wall segment that blocks entry (removed when opened)
    blockingWall: { x: number; z: number; w: number; h: number };
    hint?: string;  // Optional hint text when inspected
}

export interface LavaZone {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface AreaData {
    id: AreaId;
    name: string;
    flavor: string;              // Short atmospheric description
    gridSize: number;            // Deprecated: use gridWidth/gridHeight
    gridWidth: number;
    gridHeight: number;
    backgroundColor: string;
    groundColor: string;
    geometry: string[][];        // Raw geometry grid (# = wall, . = floor, ^v<> = doors)
    terrain: string[][];         // Terrain grid (~ = lava, . = empty)
    floor: string[][];           // Floor type grid (s = sand, d = dirt, g = grass, w = water, t = stone, . = default)
    enemySpawns: EnemySpawn[];
    transitions: AreaTransition[];
    chests: ChestLocation[];
    trees: TreeLocation[];
    decorations?: Decoration[];  // Columns, broken walls, etc.
    secretDoors?: SecretDoor[];  // Hidden doors that require inspection to use
    candles?: CandlePosition[];  // Manual candle placements
    ambientLight: number;        // Ambient light intensity
    directionalLight: number;    // Directional light intensity
    hasFogOfWar: boolean;
    defaultSpawn: { x: number; z: number };  // Default spawn point for debug warps
}

export interface ComputedAreaData {
    blocked: boolean[][];
    mergedObstacles: MergedObstacle[];
    candlePositions: CandlePosition[];
    treeBlocked: Set<string>;  // Set of "x,z" keys for tree-blocked cells (for LOS)
    lavaBlocked: Set<string>;  // Set of "x,z" keys for lava-blocked cells (movement only, not LOS)
}
