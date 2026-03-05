// =============================================================================
// DUNGEON - Re-exports from area system for backwards compatibility
// =============================================================================

import {
    getComputedAreaData
} from "./areas";

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
