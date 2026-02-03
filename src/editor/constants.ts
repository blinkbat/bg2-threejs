// =============================================================================
// EDITOR CONSTANTS
// =============================================================================

import type { AreaId } from "../game/areas/types";
import type { EnemyType } from "../core/types";
import type { CSSProperties } from "react";

// Available areas for loading
export const AREA_IDS: AreaId[] = ["dungeon", "forest", "coast", "ruins", "sanctum", "cliffs", "magma_cave"];

// Available enemy types
export const ENEMY_TYPES: EnemyType[] = [
    "kobold", "kobold_archer", "kobold_witch_doctor", "ogre", "brood_mother", "broodling",
    "giant_amoeba", "acid_slug", "bat", "undead_knight", "ancient_construct",
    "feral_hound", "corrupt_druid", "skeleton_warrior", "baby_kraken", "kraken_tentacle", "magma_imp"
];

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
