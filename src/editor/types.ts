// =============================================================================
// EDITOR TYPES
// =============================================================================

import type { AreaId, TreeType } from "../game/areas/types";
import type { EnemyType } from "../core/types";

export type Tool = "paint" | "erase" | "select";
export type Layer = "geometry" | "terrain" | "floor" | "props" | "entities";

export interface MapMetadata {
    id: string;
    name: string;
    flavor: string;
    width: number;
    height: number;
    background: string;
    ground: string;
    ambient: number;
    directional: number;
    fog: boolean;
    spawnX: number;
    spawnZ: number;
}

export interface EntityDef {
    id: string;
    x: number;
    z: number;
    type: "enemy" | "chest" | "transition" | "candle" | "secret_door";
    enemyType?: EnemyType;
    chestGold?: number;
    chestItems?: string;
    chestLocked?: string;
    transitionTarget?: AreaId;
    transitionSpawnX?: number;
    transitionSpawnZ?: number;
    transitionDirection?: "north" | "south" | "east" | "west";
    transitionW?: number;
    transitionH?: number;
    candleDx?: number;
    candleDz?: number;
    secretBlockX?: number;
    secretBlockZ?: number;
    secretBlockW?: number;
    secretBlockH?: number;
}

export interface TreeDef {
    x: number;
    z: number;
    size: number;
    type?: TreeType;
}

export interface DecorationDef {
    x: number;
    z: number;
    type: "column" | "broken_column" | "broken_wall" | "rock" | "small_rock" | "mushroom" | "small_mushroom" | "seaweed" | "small_seaweed" | "fern" | "small_fern";
    rotation?: number;
    size?: number;
}

export interface EditorSnapshot {
    geometryLayer: string[][];
    terrainLayer: string[][];
    floorLayer: string[][];
    propsLayer: string[][];
    entitiesLayer: string[][];
    entities: EntityDef[];
    trees: TreeDef[];
    decorations: DecorationDef[];
}
