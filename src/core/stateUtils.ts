// =============================================================================
// STATE UTILITIES - Common React state update patterns
// =============================================================================

import type { Unit } from "./types";

type SetUnits = React.Dispatch<React.SetStateAction<Unit[]>>;

export interface LiveUnitsDispatch extends SetUnits {
    __liveUnitsRef: React.MutableRefObject<Unit[]>;
}

function setUnitsSnapshotRef(unitsStateRef: React.RefObject<Unit[]>, units: Unit[]): void {
    (unitsStateRef as { current: Unit[] | null }).current = units;
}

function isLiveUnitsDispatch(setUnits: SetUnits): setUnits is LiveUnitsDispatch {
    return "__liveUnitsRef" in setUnits;
}

/**
 * Wrap setUnits so the mutable units ref stays in sync immediately within the frame.
 * Uses a fast path to avoid re-running the updater when React's prev matches snapshot prev.
 */
export function createLiveUnitsDispatch(
    setUnits: SetUnits,
    unitsStateRef: React.MutableRefObject<Unit[]>
): LiveUnitsDispatch {
    const liveSetUnits: LiveUnitsDispatch = (update) => {
        if (typeof update !== "function") {
            unitsStateRef.current = update;
            setUnits(update);
            return;
        }

        const updater = update as (prev: Unit[]) => Unit[];
        const snapshotPrev = unitsStateRef.current;
        const snapshotNext = updater(snapshotPrev);
        unitsStateRef.current = snapshotNext;

        setUnits(prev => {
            if (prev === snapshotPrev) {
                unitsStateRef.current = snapshotNext;
                return snapshotNext;
            }

            const next = updater(prev);
            unitsStateRef.current = next;
            return next;
        });
    };

    liveSetUnits.__liveUnitsRef = unitsStateRef;
    return liveSetUnits;
}

/**
 * Apply a units updater while keeping an arbitrary units snapshot ref synchronized.
 * Uses a live dispatch ref when available to avoid duplicate eager updater execution.
 */
export function applySyncedUnitsUpdate(
    unitsStateRef: React.RefObject<Unit[]>,
    setUnits: SetUnits,
    updater: (prev: Unit[]) => Unit[]
): Unit[] {
    if (isLiveUnitsDispatch(setUnits)) {
        setUnits(updater);
        const next = setUnits.__liveUnitsRef.current;
        setUnitsSnapshotRef(unitsStateRef, next);
        return next;
    }

    const snapshotPrev = unitsStateRef.current ?? [];
    const snapshotNext = updater(snapshotPrev);
    setUnitsSnapshotRef(unitsStateRef, snapshotNext);
    setUnits(prev => {
        if (prev === snapshotPrev) {
            setUnitsSnapshotRef(unitsStateRef, snapshotNext);
            return snapshotNext;
        }

        const next = updater(prev);
        setUnitsSnapshotRef(unitsStateRef, next);
        return next;
    });
    return snapshotNext;
}

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
