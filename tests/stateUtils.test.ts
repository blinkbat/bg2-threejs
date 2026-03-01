import { describe, expect, it, vi } from "vitest";
import type { Unit } from "../src/core/types";
import {
    applySyncedUnitUpdate,
    applySyncedUnitsUpdate,
    createLiveUnitsDispatch,
    updateUnit,
    updateUnitWith,
    updateUnitsWhere,
} from "../src/core/stateUtils";

type SetUnits = (update: Unit[] | ((prev: Unit[]) => Unit[])) => void;

function makeUnit(id: number, overrides: Partial<Unit> = {}): Unit {
    return {
        id,
        x: 0,
        z: 0,
        hp: 10,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

function createStateStore(initialState: Unit[]): {
    getState: () => Unit[];
    setUnits: SetUnits;
} {
    let state = initialState;
    return {
        getState: () => state,
        setUnits: update => {
            state = typeof update === "function" ? update(state) : update;
        },
    };
}

describe("stateUtils", () => {
    it("createLiveUnitsDispatch syncs direct assignments to state and ref", () => {
        const initial = [makeUnit(1, { hp: 7 })];
        const unitsStateRef = { current: initial };
        const store = createStateStore(initial);
        const setUnits = createLiveUnitsDispatch(store.setUnits, unitsStateRef);

        const next = [makeUnit(1, { hp: 12 })];
        setUnits(next);

        expect(store.getState()).toEqual(next);
        expect(unitsStateRef.current).toEqual(next);
    });

    it("createLiveUnitsDispatch runs updater once on fast path", () => {
        const initial = [makeUnit(1, { hp: 7 })];
        const unitsStateRef = { current: initial };
        const store = createStateStore(initial);
        const setUnits = createLiveUnitsDispatch(store.setUnits, unitsStateRef);
        const updater = vi.fn((prev: Unit[]) => prev.map(unit => ({ ...unit, hp: unit.hp + 1 })));

        setUnits(updater);

        expect(updater).toHaveBeenCalledTimes(1);
        expect(store.getState()[0].hp).toBe(8);
        expect(unitsStateRef.current[0].hp).toBe(8);
    });

    it("createLiveUnitsDispatch re-runs updater when React prev diverges", () => {
        const snapshotPrev = [makeUnit(1, { hp: 10 })];
        const divergentPrev = [makeUnit(1, { hp: 3 })];
        const unitsStateRef = { current: snapshotPrev };
        let committed = divergentPrev;
        const setUnits: SetUnits = update => {
            committed = typeof update === "function" ? update(divergentPrev) : update;
        };
        const liveSetUnits = createLiveUnitsDispatch(setUnits, unitsStateRef);
        const updater = vi.fn((prev: Unit[]) => prev.map(unit => ({ ...unit, hp: unit.hp + 2 })));

        liveSetUnits(updater);

        expect(updater).toHaveBeenCalledTimes(2);
        expect(committed[0].hp).toBe(5);
        expect(unitsStateRef.current[0].hp).toBe(5);
    });

    it("applySyncedUnitsUpdate returns live-dispatch result and syncs snapshot ref", () => {
        const initial = [makeUnit(1, { hp: 9 })];
        const liveRef = { current: initial };
        const snapshotRef: { current: Unit[] | null } = { current: initial };
        const store = createStateStore(initial);
        const liveSetUnits = createLiveUnitsDispatch(store.setUnits, liveRef);

        const next = applySyncedUnitsUpdate(snapshotRef, liveSetUnits, prev =>
            prev.map(unit => ({ ...unit, hp: unit.hp + 1 }))
        );

        expect(next[0].hp).toBe(10);
        expect(snapshotRef.current).toEqual(store.getState());
        expect(liveRef.current).toEqual(store.getState());
    });

    it("applySyncedUnitsUpdate falls back to snapshot and replays on divergence", () => {
        const snapshotPrev = [makeUnit(1, { hp: 10 })];
        const runtimePrev = [makeUnit(1, { hp: 4 })];
        const snapshotRef: { current: Unit[] | null } = { current: snapshotPrev };
        let committed = runtimePrev;
        const setUnits: SetUnits = update => {
            committed = typeof update === "function" ? update(committed) : update;
        };
        const updater = vi.fn((prev: Unit[]) => prev.map(unit => ({ ...unit, hp: unit.hp + 3 })));

        const returned = applySyncedUnitsUpdate(snapshotRef, setUnits, updater);

        expect(updater).toHaveBeenCalledTimes(2);
        expect(returned[0].hp).toBe(13);
        expect(committed[0].hp).toBe(7);
        expect(snapshotRef.current?.[0].hp).toBe(7);
    });

    it("applySyncedUnitUpdate updates one unit and returns the updated snapshot", () => {
        const initial = [makeUnit(1, { hp: 10 }), makeUnit(2, { hp: 6 })];
        const snapshotRef: { current: Unit[] | null } = { current: initial };
        const store = createStateStore(initial);

        const updated = applySyncedUnitUpdate(snapshotRef, store.setUnits, 2, unit => ({ ...unit, hp: 1 }));

        expect(updated?.id).toBe(2);
        expect(updated?.hp).toBe(1);
        expect(store.getState().find(unit => unit.id === 2)?.hp).toBe(1);
    });

    it("updateUnit, updateUnitWith, and updateUnitsWhere mutate only intended units", () => {
        const initial = [
            makeUnit(1, { hp: 10, team: "player", aiEnabled: true }),
            makeUnit(2, { hp: 5, team: "enemy", aiEnabled: true }),
        ];
        const store = createStateStore(initial);

        updateUnit(store.setUnits, 1, { hp: 8 });
        updateUnitWith(store.setUnits, 1, unit => ({ x: unit.x + 2 }));
        updateUnitsWhere(store.setUnits, unit => unit.team === "enemy", { aiEnabled: false });

        const player = store.getState().find(unit => unit.id === 1);
        const enemy = store.getState().find(unit => unit.id === 2);
        expect(player?.hp).toBe(8);
        expect(player?.x).toBe(2);
        expect(enemy?.aiEnabled).toBe(false);
        expect(player?.aiEnabled).toBe(true);
    });
});
