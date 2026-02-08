// =============================================================================
// AREA SYSTEM - Exports and state management
// =============================================================================

import { clearPathCache, invalidateDynamicObstacles } from "../../ai/pathfinding";

// Types
export * from "./types";

// Helpers
export { computeAreaData } from "./helpers";

// All areas loaded from .txt files
import { TEXT_AREAS, getAllAreaIds, hasArea, registerArea, registerAreaFromText, getTextArea } from "./textLoader";

import type { AreaId, AreaData, ComputedAreaData } from "./types";
import { computeAreaData } from "./helpers";

// Registry of all areas
export const AREAS: Record<string, AreaData> = TEXT_AREAS;

// Re-export dynamic area functions for editor use
export { getAllAreaIds, hasArea, registerArea, registerAreaFromText, getTextArea };

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

export function isTerrainBlocked(x: number, z: number): boolean {
    return getComputedAreaData().terrainBlocked.has(`${x},${z}`);
}
