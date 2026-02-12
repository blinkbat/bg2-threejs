import type { AreaId } from "./areas";

const fogVisibilityByArea = new Map<string, number[][]>();

function createEmptyVisibility(width: number, height: number): number[][] {
    return Array(width).fill(null).map(() => Array(height).fill(0));
}

function cloneVisibility(visibility: number[][]): number[][] {
    return visibility.map(column => [...column]);
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

export function clearFogVisibilityMemory(): void {
    fogVisibilityByArea.clear();
}
