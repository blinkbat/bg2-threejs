import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Unit, UnitGroup } from "../src/core/types";
import { updateShieldFacing } from "../src/gameLoop";

function createShieldedEnemy(id: number): Unit {
    return {
        id,
        x: 0,
        z: 0,
        hp: 20,
        team: "enemy",
        enemyType: "undead_knight",
        target: null,
        aiEnabled: true,
        facing: 0,
    };
}

function createUnitGroup(
    x: number,
    z: number,
    targetX: number,
    targetZ: number,
    shieldFacingSamplePosition?: { x: number; z: number }
): UnitGroup {
    return {
        position: { x, z },
        userData: {
            unitId: 0,
            targetX,
            targetZ,
            attackTarget: null,
            flyHeight: 0,
            shieldFacingSamplePosition,
        },
    } as unknown as UnitGroup;
}

function createShieldMesh(): THREE.Mesh {
    return {
        rotation: { z: 0 },
    } as unknown as THREE.Mesh;
}

describe("shield facing", () => {
    it("uses the faster stationary turn speed when the unit did not move this frame", () => {
        const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

        const stationaryEnemy = createShieldedEnemy(201);
        const movingEnemy = createShieldedEnemy(202);
        const stationaryGroup = createUnitGroup(0, 0, 10, 0, { x: 0, z: 0 });
        const movingGroup = createUnitGroup(0, 0, 10, 0, { x: -1, z: 0 });
        const stationaryShield = createShieldMesh();
        const movingShield = createShieldMesh();

        updateShieldFacing(
            [stationaryEnemy, movingEnemy],
            {
                201: stationaryGroup,
                202: movingGroup,
            },
            {
                201: stationaryShield,
                202: movingShield,
            },
            vi.fn()
        );

        expect(stationaryGroup.userData.visualFacing).toBeCloseTo(0.0525, 4);
        expect(movingGroup.userData.visualFacing).toBeCloseTo(0.015, 4);
        expect((stationaryGroup.userData.visualFacing ?? 0)).toBeGreaterThan(movingGroup.userData.visualFacing ?? 0);

        dateNowSpy.mockRestore();
    });
});
