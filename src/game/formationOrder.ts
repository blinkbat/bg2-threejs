import type { Unit } from "../core/types";

const UNKNOWN_FORMATION_BASE = 1000;

/**
 * Build a complete formation order by keeping saved order first, then appending
 * any missing units in their current ID order.
 */
export function buildEffectiveFormationOrder(unitIds: number[], formationOrder: number[]): number[] {
    const ordered = formationOrder.filter(id => unitIds.includes(id));
    for (const id of unitIds) {
        if (!ordered.includes(id)) {
            ordered.push(id);
        }
    }
    return ordered;
}

/**
 * Return a sortable formation rank for the given unit.
 * Unknown units are sorted after known units and then by ID.
 */
export function getFormationRank(unitId: number, formationOrder: number[]): number {
    const idx = formationOrder.indexOf(unitId);
    return idx === -1 ? UNKNOWN_FORMATION_BASE + unitId : idx;
}

/**
 * Sort units by formation order, falling back to ID order for unknowns.
 */
export function sortUnitsByFormationOrder(units: Unit[], formationOrder: number[]): Unit[] {
    return [...units].sort((a, b) => getFormationRank(a.id, formationOrder) - getFormationRank(b.id, formationOrder));
}
