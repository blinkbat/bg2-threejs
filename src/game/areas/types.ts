// =============================================================================
// AREA TYPES - Interfaces and type definitions
// =============================================================================

import type { CandlePosition, MergedObstacle, EnemyType } from "../../core/types";
import type { DialogSpeakerId } from "../../dialog/types";

// Built-in areas (for autocomplete)
export type BuiltInAreaId = "dungeon" | "forest" | "coast" | "ruins" | "sanctum" | "cliffs" | "magma_cave";

// AreaId allows any string (for custom areas) while preserving autocomplete for built-in ones
export type AreaId = BuiltInAreaId | (string & {});

// Default game start configuration - single source of truth
export const DEFAULT_STARTING_AREA: AreaId = "coast";

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

export interface AreaDialogChoice {
    id: string;
    label: string;
    nextNodeId?: string;
    conditions?: AreaDialogChoiceCondition[];
    onDialogEndAction?: AreaDialogUiAction;
}

export type AreaDialogMenuId = "controls" | "save_game" | "load_game";
export type AreaDialogEventId = "spend_the_night";

export interface AreaDialogOpenMenuAction {
    type: "open_menu";
    menuId: AreaDialogMenuId;
}

export interface AreaDialogEventAction {
    type: "event";
    eventId: AreaDialogEventId;
}

export type AreaDialogUiAction = AreaDialogOpenMenuAction | AreaDialogEventAction;

export interface AreaDialogChoicePartyGatheredCondition {
    type: "party_is_gathered";
    maxDistance?: number;
    disabledMessage?: string;
}

export interface AreaDialogChoicePartyHasGoldCondition {
    type: "party_has_gold";
    amount: number;
    disabledMessage?: string;
}

export type AreaDialogChoiceCondition =
    | AreaDialogChoicePartyGatheredCondition
    | AreaDialogChoicePartyHasGoldCondition;

export interface AreaDialogNode {
    id: string;
    speakerId: DialogSpeakerId;
    text: string;
    choices?: AreaDialogChoice[];
    nextNodeId?: string;
    continueLabel?: string;
    onDialogEndAction?: AreaDialogUiAction;
}

export interface AreaDialogDefinition {
    id: string;
    startNodeId: string;
    nodes: Record<string, AreaDialogNode>;
}

export interface AreaLocation {
    id: string;
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface DialogTriggerOnAreaLoadCondition {
    type: "on_area_load";
}

export interface DialogTriggerEnemyKilledCondition {
    type: "enemy_killed";
    spawnIndex: number;  // Index in area.enemySpawns
}

export interface DialogTriggerPartyEntersRegionCondition {
    type: "party_enters_region";
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface DialogTriggerPartyEntersLocationCondition {
    type: "party_enters_location";
    locationId: string;
}

export interface DialogTriggerUnitSeenCondition {
    type: "unit_seen";
    spawnIndex: number;  // Index in area.enemySpawns
    range?: number;      // Optional override range from party (world units)
}

export interface DialogTriggerNpcEngagedCondition {
    type: "npc_engaged";
    spawnIndex: number;  // Index in area.enemySpawns for the NPC
}

export interface DialogTriggerOutOfCombatRangeCondition {
    type: "party_out_of_combat_range";
    range: number;  // No living enemy within this range of any living party member
}

export interface DialogTriggerDelayCondition {
    type: "after_delay";
    ms: number;  // Delay after area load
}

export type AreaDialogTriggerCondition =
    | DialogTriggerOnAreaLoadCondition
    | DialogTriggerEnemyKilledCondition
    | DialogTriggerPartyEntersLocationCondition
    | DialogTriggerPartyEntersRegionCondition
    | DialogTriggerUnitSeenCondition
    | DialogTriggerNpcEngagedCondition
    | DialogTriggerOutOfCombatRangeCondition
    | DialogTriggerDelayCondition;

export interface AreaDialogTriggerStartDialogAction {
    type: "start_dialog";
    dialogId: string;
}

export type AreaDialogTriggerAction =
    | AreaDialogTriggerStartDialogAction;

export interface AreaDialogTrigger {
    id: string;
    dialogId?: string; // Legacy fallback for maps saved before action-based triggers
    actions?: AreaDialogTriggerAction[];
    wip?: boolean; // Allows incomplete trigger drafts to be saved intentionally
    once?: boolean;   // Defaults to true
    priority?: number; // Higher runs first when multiple triggers are satisfied
    conditions: AreaDialogTriggerCondition[];
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
    decorOnly?: boolean;     // Non-interactive chest prop (cannot be hovered/opened)
}

export type TreeType = "pine" | "palm" | "oak";

export const MIN_TREE_SIZE = 0.4;
export const MAX_TREE_SIZE = 2.0;
export const MAX_PINE_TREE_SIZE = 1.35;

export interface TreeLocation {
    x: number;
    z: number;
    size: number;  // Scale multiplier (0.5 = small, 1 = medium, 1.5 = large)
    type?: TreeType;  // Defaults to "pine"
}

export interface Decoration {
    x: number;
    z: number;
    type: "column" | "broken_column" | "broken_wall" | "rock" | "small_rock" | "mushroom" | "small_mushroom" | "weeds" | "small_weeds" | "fern" | "small_fern" | "bookshelf" | "bar" | "chair" | "bed";
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

export const DEFAULT_AREA_LIGHT_RADIUS = 18;
export const DEFAULT_AREA_LIGHT_ANGLE = 65;
export const DEFAULT_AREA_LIGHT_TINT = "#ffd28a";
export const DEFAULT_AREA_LIGHT_BRIGHTNESS = 30;
export const DEFAULT_AREA_LIGHT_HEIGHT = 10;
export const DEFAULT_AREA_LIGHT_DIFFUSION = 0.55;
export const DEFAULT_AREA_LIGHT_DECAY = 1.0;

export interface AreaLight {
    x: number;
    z: number;
    radius: number;
    angle: number;
    tint: string;
    brightness: number;
    height: number;
    diffusion: number;
    decay?: number;
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
    terrainLayers?: string[][][];      // Optional layered terrain stacks (bottom -> top)
    floorLayers?: string[][][];        // Optional layered floor stacks (bottom -> top)
    terrainTintLayers?: number[][][];  // Optional per-tile tint % per terrain layer (same dimensions as terrainLayers)
    floorTintLayers?: number[][][];    // Optional per-tile tint % per floor layer (same dimensions as floorLayers)
    enemySpawns: EnemySpawn[];
    transitions: AreaTransition[];
    chests: ChestLocation[];
    trees: TreeLocation[];
    decorations?: Decoration[];  // Columns, broken walls, etc.
    secretDoors?: SecretDoor[];  // Hidden doors that require inspection to use
    lights?: AreaLight[];        // Manual overhead spot lights
    candles?: CandlePosition[];  // Manual candle placements
    ambientLight: number;        // Ambient light intensity
    directionalLight: number;    // Directional light intensity
    hasFogOfWar: boolean;
    invulnerable?: boolean;              // All units immune to damage, enemies don't aggro
    defaultSpawn: { x: number; z: number };  // Default spawn point for debug warps
    dialogs?: AreaDialogDefinition[];
    locations?: AreaLocation[];
    dialogTriggers?: AreaDialogTrigger[];
}

export interface ComputedAreaData {
    blocked: boolean[][];
    mergedObstacles: MergedObstacle[];
    candlePositions: CandlePosition[];
    treeBlocked: Set<string>;  // Set of "x,z" keys for tree-blocked cells (for LOS)
    terrainBlocked: Set<string>;  // Set of "x,z" keys for terrain-blocked cells (lava, water - movement only, not LOS)
}
