// =============================================================================
// DUNGEON - Re-exports from area system for backwards compatibility
// =============================================================================

import {
    getCurrentArea,
    getComputedAreaData
} from "./areas";

// Re-export area data accessors as module-level getters
// These are computed lazily when accessed

/**
 * Get blocked grid for current area.
 * Note: This returns a reference to the current area's blocked grid.
 * When areas change, this reference updates.
 */
export function getBlocked(): boolean[][] {
    return getComputedAreaData().blocked;
}

/**
 * For backwards compatibility with existing code that uses `blocked` directly.
 * Returns a proxy that always reads from current area.
 */
export const blocked: boolean[][] = new Proxy([] as boolean[][], {
    get(_target, prop) {
        const currentBlocked = getComputedAreaData().blocked;
        if (typeof prop === "string" && !isNaN(Number(prop))) {
            return currentBlocked[Number(prop)];
        }
        if (prop === "length") {
            return currentBlocked.length;
        }
        return Reflect.get(currentBlocked, prop);
    }
});

export function getCandlePositions() {
    return getComputedAreaData().candlePositions;
}

export function getMergedObstacles() {
    return getComputedAreaData().mergedObstacles;
}

export function getFloor() {
    return getCurrentArea().floor;
}

// For scene.ts which imports these directly
export const candlePositions = new Proxy([] as ReturnType<typeof getCandlePositions>, {
    get(_target, prop) {
        const positions = getCandlePositions();
        if (typeof prop === "string" && !isNaN(Number(prop))) {
            return positions[Number(prop)];
        }
        if (prop === "length") return positions.length;
        if (prop === "forEach") return positions.forEach.bind(positions);
        if (prop === "map") return positions.map.bind(positions);
        if (prop === Symbol.iterator) return positions[Symbol.iterator].bind(positions);
        return Reflect.get(positions, prop);
    }
});

export const mergedObstacles = new Proxy([] as ReturnType<typeof getMergedObstacles>, {
    get(_target, prop) {
        const obstacles = getMergedObstacles();
        if (typeof prop === "string" && !isNaN(Number(prop))) {
            return obstacles[Number(prop)];
        }
        if (prop === "length") return obstacles.length;
        if (prop === "forEach") return obstacles.forEach.bind(obstacles);
        if (prop === "map") return obstacles.map.bind(obstacles);
        if (prop === Symbol.iterator) return obstacles[Symbol.iterator].bind(obstacles);
        return Reflect.get(obstacles, prop);
    }
});

export const floor = new Proxy([] as ReturnType<typeof getFloor>, {
    get(_target, prop) {
        const floorData = getFloor();
        if (typeof prop === "string" && !isNaN(Number(prop))) {
            return floorData[Number(prop)];
        }
        if (prop === "length") return floorData.length;
        if (prop === "forEach") return floorData.forEach.bind(floorData);
        if (prop === "map") return floorData.map.bind(floorData);
        if (prop === Symbol.iterator) return floorData[Symbol.iterator].bind(floorData);
        return Reflect.get(floorData, prop);
    }
});
