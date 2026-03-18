// =============================================================================
// EDITOR TYPES
// =============================================================================

import type { AreaDialogDefinition, AreaDialogTrigger, AreaId, AreaLocation, TreeType } from "../game/areas/types";
import type { EnemyType } from "../core/types";

export type Tool = "paint" | "erase" | "select";
export type Layer = "geometry" | "terrain" | "floor" | "props" | "entities" | "locations";

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
    type: "enemy" | "chest" | "transition" | "waystone" | "candle" | "torch" | "light" | "secret_door";
    enemyType?: EnemyType;
    enemySpawnIndex?: number;
    chestGold?: number;
    chestItems?: string;
    chestLocked?: string;
    chestDecorOnly?: boolean;
    transitionTarget?: AreaId;
    transitionSpawnX?: number;
    transitionSpawnZ?: number;
    transitionDirection?: "north" | "south" | "east" | "west";
    transitionW?: number;
    transitionH?: number;
    waystoneDirection?: "north" | "south" | "east" | "west";
    candleDx?: number;
    candleDz?: number;
    lightColor?: string;
    lightRadius?: number;
    lightAngle?: number;
    lightBrightness?: number;
    lightHeight?: number;
    lightDiffusion?: number;
    lightDecay?: number;
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
    type: "column" | "broken_column" | "broken_wall" | "rock" | "small_rock" | "mushroom" | "small_mushroom" | "weeds" | "small_weeds" | "fern" | "small_fern" | "bookshelf" | "bar" | "chair" | "bed";
    rotation?: number;
    size?: number;
}

export interface EditorSnapshot {
    metadata: MapMetadata;
    geometryLayer: string[][];
    terrainLayers: string[][][];
    floorLayers: string[][][];
    terrainTintLayers: number[][][];
    floorTintLayers: number[][][];
    propsLayer: string[][];
    entitiesLayer: string[][];
    entities: EntityDef[];
    trees: TreeDef[];
    decorations: DecorationDef[];
    dialogs: AreaDialogDefinition[];
    locations: AreaLocation[];
    dialogTriggers: AreaDialogTrigger[];
}
