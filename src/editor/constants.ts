// =============================================================================
// EDITOR CONSTANTS
// =============================================================================

import { getAllAreaIds } from "../game/areas";
import type { EnemyType } from "../core/types";
import { ENEMY_STATS } from "../game/enemyStats";
import type { Layer, DecorationDef } from "./types";
import type { CSSProperties } from "react";

// Available areas for loading (dynamically determined from txt files)
export function getAvailableAreaIds(): string[] {
    return getAllAreaIds();
}

// Available enemy types (derived from ENEMY_STATS keys)
export const ENEMY_TYPES: EnemyType[] = (Object.keys(ENEMY_STATS) as EnemyType[]).sort();

// =============================================================================
// LAYER BRUSH REGISTRIES - Single source of truth for editor tiles
// Adding a new tile type only requires adding it to the relevant array below.
// =============================================================================

export interface BrushDef {
    char: string;
    label: string;
    color: string;
}

export interface PropBrushDef extends BrushDef {
    decorationType?: DecorationDef["type"];
    isTree?: boolean;
}

export const GEOMETRY_BRUSHES: BrushDef[] = [
    { char: "#", label: "Wall", color: "#444" },
    { char: ".", label: "Floor", color: "" },
];

export const TERRAIN_BRUSHES: BrushDef[] = [
    { char: ".", label: "Empty", color: "" },
    { char: "~", label: "Lava", color: "#f40" },
    { char: "w", label: "Water", color: "#48f" },
    { char: "a", label: "Acid", color: "#8f0" },
];

export const FLOOR_BRUSHES: BrushDef[] = [
    { char: ".", label: "Default", color: "" },
    { char: "s", label: "Sand", color: "#c2b280" },
    { char: "S", label: "Lt Sand", color: "#d4c490" },
    { char: "d", label: "Dirt", color: "#8b7355" },
    { char: "D", label: "Dk Dirt", color: "#6b5344" },
    { char: "g", label: "Grass", color: "#5a8a4a" },
    { char: "G", label: "Dk Grass", color: "#4a7a3a" },
    { char: "w", label: "Water", color: "#4a90a0" },
    { char: "W", label: "Dp Water", color: "#3a7080" },
    { char: "t", label: "Stone", color: "#707070" },
    { char: "T", label: "Dk Stone", color: "#606060" },
];

export const PROP_BRUSHES: PropBrushDef[] = [
    { char: ".", label: "Empty", color: "" },
    { char: "T", label: "Tree", color: "#2a5", isTree: true },
    { char: "C", label: "Column", color: "#888", decorationType: "column" },
    { char: "c", label: "Broken Col", color: "#888", decorationType: "broken_column" },
    { char: "W", label: "Broken Wall", color: "#665", decorationType: "broken_wall" },
    { char: "R", label: "Rock", color: "#6a5a4a", decorationType: "rock" },
    { char: "r", label: "Small Rock", color: "#7a6a5a", decorationType: "small_rock" },
    { char: "M", label: "Mushroom", color: "#a44", decorationType: "mushroom" },
    { char: "m", label: "Small Mush", color: "#c66", decorationType: "small_mushroom" },
    { char: "F", label: "Fern", color: "#4a5", decorationType: "fern" },
    { char: "f", label: "Small Fern", color: "#5b6", decorationType: "small_fern" },
    { char: "S", label: "Seaweed", color: "#3a7", decorationType: "seaweed" },
    { char: "s", label: "Sm Seaweed", color: "#4a8", decorationType: "small_seaweed" },
];

export const ENTITY_BRUSHES: BrushDef[] = [
    { char: ".", label: "Empty", color: "" },
    { char: "@", label: "Spawn", color: "#4af" },
    { char: "E", label: "Enemy", color: "#f44" },
    { char: "X", label: "Chest", color: "#ff0" },
    { char: "D", label: "Door", color: "#84f" },
    { char: "L", label: "Candle", color: "#fa4" },
    { char: "S", label: "Secret Door", color: "#4aa" },
];

// =============================================================================
// DERIVED LOOKUP MAPS (built from registries above)
// =============================================================================

function buildColorMap(brushes: BrushDef[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const b of brushes) {
        if (b.color) map.set(b.char, b.color);
    }
    return map;
}

/** Per-layer char → color lookup for canvas rendering */
export const LAYER_COLORS: Record<Layer, Map<string, string>> = {
    geometry: buildColorMap(GEOMETRY_BRUSHES),
    terrain: buildColorMap(TERRAIN_BRUSHES),
    floor: buildColorMap(FLOOR_BRUSHES),
    props: buildColorMap(PROP_BRUSHES),
    entities: buildColorMap(ENTITY_BRUSHES),
};

/** Per-layer brush palettes for the toolbar */
export const LAYER_BRUSHES: Record<Layer, BrushDef[]> = {
    geometry: GEOMETRY_BRUSHES,
    terrain: TERRAIN_BRUSHES,
    floor: FLOOR_BRUSHES,
    props: PROP_BRUSHES,
    entities: ENTITY_BRUSHES,
};

/** Prop layer: decoration type → grid char (for loading area data into editor) */
export const PROP_TYPE_TO_CHAR: Map<string, string> = new Map();
/** Prop layer: grid char → decoration type (for saving editor data to area) */
export const PROP_CHAR_TO_TYPE: Map<string, DecorationDef["type"]> = new Map();
/** Prop layer: chars that represent trees (not decorations) */
export const PROP_TREE_CHARS: Set<string> = new Set();

for (const brush of PROP_BRUSHES) {
    if (brush.decorationType) {
        PROP_TYPE_TO_CHAR.set(brush.decorationType, brush.char);
        PROP_CHAR_TO_TYPE.set(brush.char, brush.decorationType);
    }
    if (brush.isTree) {
        PROP_TREE_CHARS.add(brush.char);
    }
}

// =============================================================================
// EDITOR LAYOUT
// =============================================================================

// Popup dimensions
export const POPUP_WIDTH = 280;
export const POPUP_MARGIN = 16;

// Base cell size for editor grid
export const BASE_CELL_SIZE = 28;

// Maximum undo/redo history
export const MAX_HISTORY = 50;

// =============================================================================
// POPUP STYLES
// =============================================================================

export const popupStyle: CSSProperties = {
    position: "fixed",
    background: "#2a2a3e",
    border: "1px solid #555",
    borderRadius: 8,
    padding: 16,
    zIndex: 1000,
    minWidth: POPUP_WIDTH,
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
};

export const inputStyle: CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    background: "#333",
    border: "1px solid #555",
    borderRadius: 4,
    color: "#fff",
    width: "100%",
};

export const selectStyle: CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
};

export const buttonStyle: CSSProperties = {
    padding: "8px 16px",
    fontSize: 13,
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
};
