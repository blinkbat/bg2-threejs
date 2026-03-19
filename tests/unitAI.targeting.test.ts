import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import type { Unit, UnitGroup } from "../src/core/types";

const findPathMock = vi.fn();
const unitsById = new Map<number, Unit>();

vi.mock("../src/ai/pathfinding", () => ({
    findPath: (...args: unknown[]) => findPathMock(...args),
    isBlocked: () => false,
    isPassable: () => true,
}));

vi.mock("../src/game/equipmentState", () => ({
    getEffectivePlayerAggroMultiplier: () => 1,
}));

vi.mock("../src/combat/combatMath", () => ({
    hasStatusEffect: (unit: Unit, type: string) => unit.statusEffects?.some(effect => effect.type === type) ?? false,
    isUnitAlive: (unit: Unit | undefined, defeatedThisFrame: Set<number>) => (
        unit !== undefined && unit.hp > 0 && !defeatedThisFrame.has(unit.id)
    ),
}));

vi.mock("../src/gameLoop/enemyBehaviors/untargetable", () => ({
    isEnemyUntargetable: () => false,
}));

vi.mock("../src/game/unitQuery", () => ({
    getUnitById: (id: number) => unitsById.get(id),
}));

import { handleGiveUp, resetAllMovementState } from "../src/ai/movement";
import { runTargetingPhase, updateTargetingCache } from "../src/ai/unitAI";
import type { TargetingContext } from "../src/ai/unitAI";

function createUnit(overrides: Partial<Unit>): Unit {
    return {
        id: 1,
        x: 0.5,
        z: 0.5,
        hp: 10,
        team: "enemy",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

function createUnitGroup(unitId: number, x: number, z: number): UnitGroup {
    const group: UnitGroup = Object.assign(new THREE.Group(), {
        userData: {
            unitId,
            targetX: x,
            targetZ: z,
            attackTarget: null,
            flyHeight: 0,
        },
    });

    group.position.set(x, 0, z);
    return group;
}

function setUnitLookup(units: Unit[]): void {
    unitsById.clear();
    for (const unit of units) {
        unitsById.set(unit.id, unit);
    }
}

function createContext(
    unit: Unit,
    g: UnitGroup,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    now: number
): TargetingContext {
    updateTargetingCache(unitsState, unitsRef, new Set<number>());

    return {
        unit,
        g,
        unitsRef,
        unitsState,
        visibility: [],
        pathsRef: {},
        moveStartRef: {},
        now,
        defeatedThisFrame: new Set<number>(),
        aggroRange: 12,
    };
}

describe("runTargetingPhase", () => {
    beforeEach(() => {
        findPathMock.mockReset();
        unitsById.clear();
        resetAllMovementState();
    });

    it("falls through to another reachable player when the nearest target has no path", () => {
        const enemy = createUnit({ id: 10, enemyType: "kobold" });
        const blockedTarget = createUnit({ id: 20, team: "player", x: 3.5, z: 0.5 });
        const reachableTarget = createUnit({ id: 30, team: "player", x: 5.5, z: 0.5 });

        const enemyGroup = createUnitGroup(enemy.id, enemy.x, enemy.z);
        const blockedGroup = createUnitGroup(blockedTarget.id, blockedTarget.x, blockedTarget.z);
        const reachableGroup = createUnitGroup(reachableTarget.id, reachableTarget.x, reachableTarget.z);

        const unitsState = [enemy, blockedTarget, reachableTarget];
        const unitsRef = {
            [enemy.id]: enemyGroup,
            [blockedTarget.id]: blockedGroup,
            [reachableTarget.id]: reachableGroup,
        };

        setUnitLookup(unitsState);

        findPathMock.mockImplementation((_startX: number, _startZ: number, targetX: number) => {
            if (targetX === blockedGroup.position.x) {
                return null;
            }

            return [
                { x: enemyGroup.position.x, z: enemyGroup.position.z },
                { x: reachableGroup.position.x, z: reachableGroup.position.z },
            ];
        });

        const ctx = createContext(enemy, enemyGroup, unitsState, unitsRef, 10_000);
        runTargetingPhase(ctx);

        expect(enemyGroup.userData.attackTarget).toBe(reachableTarget.id);
        expect(ctx.pathsRef[enemy.id]).toEqual([
            { x: reachableGroup.position.x, z: reachableGroup.position.z },
        ]);
        expect(findPathMock).toHaveBeenCalledTimes(2);
    });

    it("retargets during give-up cooldown when another player is still reachable", () => {
        const enemy = createUnit({ id: 11, enemyType: "kobold" });
        const unreachableTarget = createUnit({ id: 21, team: "player", x: 3.5, z: 0.5 });
        const fallbackTarget = createUnit({ id: 31, team: "player", x: 6.5, z: 0.5 });

        const enemyGroup = createUnitGroup(enemy.id, enemy.x, enemy.z);
        const unreachableGroup = createUnitGroup(unreachableTarget.id, unreachableTarget.x, unreachableTarget.z);
        const fallbackGroup = createUnitGroup(fallbackTarget.id, fallbackTarget.x, fallbackTarget.z);

        const unitsState = [enemy, unreachableTarget, fallbackTarget];
        const unitsRef = {
            [enemy.id]: enemyGroup,
            [unreachableTarget.id]: unreachableGroup,
            [fallbackTarget.id]: fallbackGroup,
        };

        setUnitLookup(unitsState);
        handleGiveUp(enemy.id, false, unreachableTarget.id, 10_000);

        findPathMock.mockReturnValue([
            { x: enemyGroup.position.x, z: enemyGroup.position.z },
            { x: fallbackGroup.position.x, z: fallbackGroup.position.z },
        ]);

        const ctx = createContext(enemy, enemyGroup, unitsState, unitsRef, 10_050);
        runTargetingPhase(ctx);

        expect(enemyGroup.userData.attackTarget).toBe(fallbackTarget.id);
        expect(ctx.pathsRef[enemy.id]).toEqual([
            { x: fallbackGroup.position.x, z: fallbackGroup.position.z },
        ]);
        expect(findPathMock).toHaveBeenCalledTimes(1);
        expect(findPathMock).toHaveBeenCalledWith(
            enemyGroup.position.x,
            enemyGroup.position.z,
            fallbackGroup.position.x,
            fallbackGroup.position.z,
            0,
            false,
            false
        );
    });
});
