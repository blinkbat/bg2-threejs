// =============================================================================
// AREA SYSTEM - Exports and state management
// =============================================================================

// Types
export * from "./types";

// All areas loaded from .txt files
import { TEXT_AREAS, getAllAreaIds, registerAreaFromText } from "./textLoader";

import type { AreaId, AreaData, ComputedAreaData } from "./types";
import { computeAreaData } from "./helpers";

// Registry of all areas
export const AREAS: Record<string, AreaData> = TEXT_AREAS;

// Re-export dynamic area functions for editor use
export { getAllAreaIds, registerAreaFromText };

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
    const nextArea = AREAS[areaId];
    if (!nextArea) {
        if (import.meta.env.DEV) {
            console.warn(`[areas] Invalid area id "${areaId}". Keeping current area "${currentAreaId}".`);
        }
        return getComputedAreaData();
    }

    currentAreaId = areaId;
    currentAreaComputed = computeAreaData(nextArea);
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

export function isWaterTerrain(x: number, z: number): boolean {
    const area = getCurrentArea();
    const terrainChar = area.terrain[z]?.[x];
    if (terrainChar === "w" || terrainChar === "W") return true;

    const floorChar = area.floor[z]?.[x];
    return floorChar === "w" || floorChar === "W";
}
