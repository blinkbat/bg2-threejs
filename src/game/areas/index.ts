// =============================================================================
// AREA SYSTEM - Exports and state management
// =============================================================================

import { clearPathCache, invalidateDynamicObstacles } from "../../ai/pathfinding";

// Types
export * from "./types";

// Helpers
export { computeAreaData } from "./helpers";

// Area definitions (TypeScript)
import { DUNGEON_AREA } from "./dungeon";
import { FIELD_AREA } from "./forest";
import { RUINS_AREA } from "./ruins";
import { SANCTUM_AREA } from "./sanctum";
import { CLIFFS_AREA } from "./cliffs";
import { MAGMA_CAVE_AREA } from "./magmaCave";

// Text-based areas - load all areas from .txt files for editor support
import { TEXT_AREAS } from "./textLoader";
const COAST_AREA = TEXT_AREAS.coast;

import type { AreaId, AreaData, ComputedAreaData } from "./types";
import { computeAreaData } from "./helpers";

// Re-export individual areas for direct access if needed
export { DUNGEON_AREA, FIELD_AREA, COAST_AREA, RUINS_AREA, SANCTUM_AREA, CLIFFS_AREA, MAGMA_CAVE_AREA };

// Registry of all areas - uses text files for editor support
export const AREAS: Record<AreaId, AreaData> = {
    dungeon: TEXT_AREAS.dungeon,
    forest: TEXT_AREAS.forest,
    coast: TEXT_AREAS.coast,
    ruins: TEXT_AREAS.ruins,
    sanctum: TEXT_AREAS.sanctum,
    cliffs: TEXT_AREAS.cliffs,
    magma_cave: TEXT_AREAS.magma_cave
};

// =============================================================================
// AREA STATE MANAGEMENT
// =============================================================================

import { DEFAULT_STARTING_AREA } from "./types";

let currentAreaId: AreaId = DEFAULT_STARTING_AREA;
let currentAreaComputed: ComputedAreaData | null = null;

export function getCurrentAreaId(): AreaId {
    return currentAreaId;
}

export function getCurrentArea(): AreaData {
    return AREAS[currentAreaId];
}

export function getComputedAreaData(): ComputedAreaData {
    if (!currentAreaComputed) {
        currentAreaComputed = computeAreaData(getCurrentArea());
    }
    return currentAreaComputed;
}

export function setCurrentArea(areaId: AreaId): ComputedAreaData {
    currentAreaId = areaId;
    currentAreaComputed = computeAreaData(AREAS[areaId]);
    // Invalidate pathfinding caches when changing areas
    clearPathCache();
    invalidateDynamicObstacles();
    return currentAreaComputed;
}

export function getBlocked(): boolean[][] {
    return getComputedAreaData().blocked;
}

export function isTreeBlocked(x: number, z: number): boolean {
    return getComputedAreaData().treeBlocked.has(`${x},${z}`);
}

export function isLavaBlocked(x: number, z: number): boolean {
    return getComputedAreaData().lavaBlocked.has(`${x},${z}`);
}
