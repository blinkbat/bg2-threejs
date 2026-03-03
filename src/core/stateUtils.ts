// =============================================================================
// STATE UTILITIES - Common React state update patterns
// =============================================================================

import type { Unit } from "./types";

type SetUnits = React.Dispatch<React.SetStateAction<Unit[]>>;
const LIVE_DISPATCH_PATCH_MAX_UNITS = 64;

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
        // For larger unit arrays, skip pre-diff scanning and fall back to updater replay.
        // The pre-diff path is best for small arrays where index patching wins clearly.
        const changedIndices = snapshotNext !== snapshotPrev
            && snapshotNext.length === snapshotPrev.length
            && snapshotPrev.length <= LIVE_DISPATCH_PATCH_MAX_UNITS
            ? (() => {
                const indices: number[] = [];
                for (let i = 0; i < snapshotPrev.length; i++) {
                    if (snapshotPrev[i] !== snapshotNext[i]) {
                        indices.push(i);
                    }
                }
                return indices;
            })()
            : null;

        setUnits(prev => {
            if (prev === snapshotPrev) {
                unitsStateRef.current = snapshotNext;
                return snapshotNext;
            }

            if (changedIndices !== null && prev.length === snapshotPrev.length) {
                let canPatch = true;
                for (let i = 0; i < prev.length; i++) {
                    if (prev[i].id !== snapshotPrev[i].id || snapshotNext[i].id !== snapshotPrev[i].id) {
                        canPatch = false;
                        break;
                    }
                }
                if (canPatch) {
                    for (const index of changedIndices) {
                        if (prev[index] !== snapshotPrev[index]) {
                            canPatch = false;
                            break;
                        }
                    }
                }

                if (canPatch) {
                    let patched = prev;
                    for (const index of changedIndices) {
                        const replacement = snapshotNext[index];
                        if (patched[index] === replacement) continue;
                        if (patched === prev) {
                            patched = [...prev];
                        }
                        patched[index] = replacement;
                    }
                    unitsStateRef.current = patched;
                    return patched;
                }
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
 * Update a single unit within applySyncedUnitsUpdate without mapping the whole array.
 * Returns the updated unit snapshot when the unit exists.
 */
export function applySyncedUnitUpdate(
    unitsStateRef: React.RefObject<Unit[]>,
    setUnits: SetUnits,
    unitId: number,
    updater: (unit: Unit) => Unit
): Unit | undefined {
    let updatedUnit: Unit | undefined;

    applySyncedUnitsUpdate(unitsStateRef, setUnits, prev => {
        const index = prev.findIndex(unit => unit.id === unitId);
        if (index < 0) return prev;

        const currentUnit = prev[index];
        const nextUnit = updater(currentUnit);
        updatedUnit = nextUnit;

        if (nextUnit === currentUnit) {
            return prev;
        }

        const nextUnits = [...prev];
        nextUnits[index] = nextUnit;
        return nextUnits;
    });

    return updatedUnit;
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
    setUnits(prev => {
        const index = prev.findIndex(u => u.id === unitId);
        if (index < 0) return prev;
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
    });
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
    setUnits(prev => {
        const index = prev.findIndex(u => u.id === unitId);
        if (index < 0) return prev;
        const current = prev[index];
        const updates = transform(current);
        const next = [...prev];
        next[index] = { ...current, ...updates };
        return next;
    });
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
