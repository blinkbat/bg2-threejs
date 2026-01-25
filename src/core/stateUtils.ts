// =============================================================================
// STATE UTILITIES - Common React state update patterns
// =============================================================================

import type { Unit } from "./types";

type SetUnits = React.Dispatch<React.SetStateAction<Unit[]>>;

/**
 * Update a single unit by ID with partial updates.
 * Replaces the common pattern: setUnits(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u))
 */
export function updateUnit(
    setUnits: SetUnits,
    unitId: number,
    updates: Partial<Unit>
): void {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, ...updates } : u));
}

/**
 * Update a single unit by ID using a transform function.
 * Useful when the update depends on the current unit state.
 */
export function updateUnitWith(
    setUnits: SetUnits,
    unitId: number,
    transform: (unit: Unit) => Partial<Unit>
): void {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, ...transform(u) } : u));
}

/**
 * Update multiple units that match a predicate.
 */
export function updateUnitsWhere(
    setUnits: SetUnits,
    predicate: (unit: Unit) => boolean,
    updates: Partial<Unit>
): void {
    setUnits(prev => prev.map(u => predicate(u) ? { ...u, ...updates } : u));
}
