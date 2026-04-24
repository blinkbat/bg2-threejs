import { describe, expect, it } from "vitest";
import type { Unit } from "../src/core/types";
import { buildDialogTriggerUnitsSnapshot } from "../src/app/gameShared";

function makeUnit(overrides: Partial<Unit>): Unit {
    return {
        id: 1,
        x: 0,
        z: 0,
        hp: 10,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

describe("game shared helpers", () => {
    it("uses live UnitGroup positions when building dialog trigger snapshots", () => {
        const unit = makeUnit({ id: 1, x: 1.95, z: 1.95 });

        const snapshot = buildDialogTriggerUnitsSnapshot([unit], {
            1: { position: { x: 2.05, z: 2.05 } },
        });

        expect(snapshot[0]).toMatchObject({ id: 1, x: 2.05, z: 2.05 });
        expect(unit).toMatchObject({ id: 1, x: 1.95, z: 1.95 });
    });
});
