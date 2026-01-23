// =============================================================================
// UNIT ID COUNTER - Prevents ID collision when spawning units
// Extracted to avoid circular dependencies between combat and gameLoop
// =============================================================================

import type { Unit } from "./types";

let nextUnitId = 1000;  // Start high to avoid collision with initial party IDs

/** Get the next unique unit ID for spawning */
export function getNextUnitId(): number {
    return nextUnitId++;
}

/** Initialize the unit ID counter based on existing units (call on game start/restart) */
export function initializeUnitIdCounter(units: Unit[]): void {
    const maxId = Math.max(...units.map(u => u.id), 0);
    nextUnitId = maxId + 1;
}
