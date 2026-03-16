import type { AreaId } from "./areas";

export type FogVisibilityByArea = Record<string, number[][]>;

const fogVisibilityByArea = new Map<string, number[][]>();

function createEmptyVisibility(width: number, height: number): number[][] {
    return Array(width).fill(null).map(() => Array(height).fill(0));
}

function cloneVisibility(visibility: number[][]): number[][] {
    return visibility.map(column => [...column]);
}

function cloneFogVisibilityByArea(source: FogVisibilityByArea): FogVisibilityByArea {
    const clone: FogVisibilityByArea = {};
    for (const [areaId, visibility] of Object.entries(source)) {
        clone[areaId] = cloneVisibility(visibility);
    }
    return clone;
}

export function loadFogVisibility(areaId: AreaId, width: number, height: number): number[][] {
    const key = String(areaId);
    const stored = fogVisibilityByArea.get(key);
    if (!stored) {
        return createEmptyVisibility(width, height);
    }

    const widthMatches = stored.length === width;
    const heightMatches = widthMatches && stored.every(column => column.length === height);
    if (!widthMatches || !heightMatches) {
        return createEmptyVisibility(width, height);
    }

    return cloneVisibility(stored);
}

export function saveFogVisibility(areaId: AreaId, visibility: number[][]): void {
    fogVisibilityByArea.set(String(areaId), cloneVisibility(visibility));
}

export function captureFogVisibilityMemory(areaId?: AreaId, visibility?: number[][]): FogVisibilityByArea {
    const snapshot: FogVisibilityByArea = {};

    for (const [storedAreaId, storedVisibility] of fogVisibilityByArea.entries()) {
        snapshot[storedAreaId] = cloneVisibility(storedVisibility);
    }

    if (areaId !== undefined && visibility !== undefined) {
        snapshot[String(areaId)] = cloneVisibility(visibility);
    }

    return snapshot;
}

export function restoreFogVisibilityMemory(snapshot: FogVisibilityByArea | null | undefined): void {
    fogVisibilityByArea.clear();
    if (!snapshot) return;

    const clonedSnapshot = cloneFogVisibilityByArea(snapshot);
    for (const [areaId, visibility] of Object.entries(clonedSnapshot)) {
        fogVisibilityByArea.set(areaId, visibility);
    }
}

export function clearFogVisibilityMemory(): void {
    fogVisibilityByArea.clear();
}
