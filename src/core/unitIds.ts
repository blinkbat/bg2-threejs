// =============================================================================
// UNIT ID COUNTER - Prevents ID collision when spawning units
// Extracted to avoid circular dependencies between combat and gameLoop
// =============================================================================

import type { Unit } from "./types";

const MIN_DYNAMIC_UNIT_ID = 1000;
let nextUnitId = MIN_DYNAMIC_UNIT_ID;  // Keep spawned IDs in a safe non-static range

/** Get the next unique unit ID for spawning */
export function getNextUnitId(): number {
    return nextUnitId++;
}

/** Initialize the unit ID counter based on existing units (call on game start/restart) */
export function initializeUnitIdCounter(units: Unit[]): void {
    const maxId = Math.max(...units.map(u => u.id), 0);
    nextUnitId = Math.max(maxId + 1, MIN_DYNAMIC_UNIT_ID);
}
