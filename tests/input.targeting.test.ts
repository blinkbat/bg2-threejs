import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Dispatch, SetStateAction } from "react";
import type { Skill, Unit } from "../src/core/types";
import { createMutableRef, createRef, createSkillContext, ensureDocumentMock, makeUnit, makeUnitGroup } from "./gameplayTestUtils";

const {
    executeSkillMock,
    clearTargetingModeMock,
    pauseGameClockMock,
    resumeGameClockMock,
    isInRangeMock,
    disposeGeometryMock,
} = vi.hoisted(() => ({
    executeSkillMock: vi.fn(),
    clearTargetingModeMock: vi.fn(),
    pauseGameClockMock: vi.fn(),
    resumeGameClockMock: vi.fn(),
    isInRangeMock: vi.fn(() => true),
    disposeGeometryMock: vi.fn(),
}));

vi.mock("three", async () => {
    const module = await import("./threeMock");
    return module.createThreeTestModule();
});

vi.mock("../src/ai/pathfinding", () => ({
    findPath: vi.fn(() => null),
}));

vi.mock("../src/game/playerUnits", () => ({
    UNIT_DATA: {
        1: { name: "Barbarian" },
        2: { name: "Paladin" },
        4: { name: "Wizard" },
    },
}));

vi.mock("../src/core/gameClock", () => ({
    pauseGameClock: pauseGameClockMock,
    resumeGameClock: resumeGameClockMock,
}));

vi.mock("../src/combat/skills", () => ({
    executeSkill: executeSkillMock,
    clearTargetingMode: clearTargetingModeMock,
}));

vi.mock("../src/combat/combatMath", () => ({
    getIncapacitatingStatus: () => null,
}));

vi.mock("../src/game/formation", () => ({
    getFormationPositions: vi.fn(() => []),
}));

vi.mock("../src/game/formationOrder", () => ({
    sortUnitsByFormationOrder: vi.fn((units: Unit[]) => units),
}));

vi.mock("../src/core/constants", () => ({
    MOVE_SPEED: 1,
    getSkillTextColor: () => "#ffffff",
}));

vi.mock("../src/rendering/disposal", () => ({
    disposeGeometry: disposeGeometryMock,
}));

vi.mock("../src/game/geometry", () => ({
    distanceToPoint: vi.fn(() => 2),
}));

vi.mock("../src/core/stateUtils", () => ({
    updateUnitsWhere: vi.fn(),
}));

vi.mock("../src/gameLoop/enemyBehaviors", () => ({
    isEnemyUntargetable: vi.fn(() => false),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: isInRangeMock,
}));

import {
    computeDragLineTiles,
    handleTargetingClick,
    handleTargetingOnUnit,
    queueOrExecuteSkill,
    setupTargetingMode,
} from "../src/input";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        name: "Warcry",
        manaCost: 5,
        cooldown: 1000,
        type: "buff",
        targetType: "self",
        range: 5,
        damageType: "physical",
        ...overrides,
    };
}

function applyQueuedActionsUpdate(
    update: SetStateAction<Array<{ unitId: number; skillName: string }>>,
    current: Array<{ unitId: number; skillName: string }>
): Array<{ unitId: number; skillName: string }> {
    return typeof update === "function"
        ? update(current)
        : update;
}

beforeEach(() => {
    ensureDocumentMock();
    vi.clearAllMocks();
    isInRangeMock.mockReturnValue(true);
});

describe("input targeting helpers", () => {
    it("queues a skill when the caster is on cooldown", () => {
        const caster = makeUnit({ id: 1 });
        const casterGroup = makeUnitGroup();
        const { ctx } = createSkillContext({
            units: [caster],
            unitsRef: { 1: casterGroup },
        });
        const queuedActionsRef = createMutableRef<Record<number, { type: "skill"; skill: Skill; targetX: number; targetZ: number; targetId?: number }>>({});
        const rangeIndicatorRef = createRef<THREE.Mesh | null>(new THREE.Mesh());
        const aoeIndicatorRef = createRef<THREE.Mesh | null>(new THREE.Mesh());
        const pausedRef = createMutableRef(false);
        const setTargetingMode: Dispatch<SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>> = vi.fn();
        let queuedActions: Array<{ unitId: number; skillName: string }> = [];
        const setQueuedActions: Dispatch<SetStateAction<Array<{ unitId: number; skillName: string }>>> = vi.fn(update => {
            queuedActions = applyQueuedActionsUpdate(update, queuedActions);
            return queuedActions;
        });
        const addLog = vi.fn();
        const skill = makeSkill({ name: "Holy Strike", targetType: "aoe", type: "damage", damageType: "holy" });

        vi.spyOn(Date, "now").mockReturnValue(1_000);
        ctx.actionCooldownRef.current[1] = 2_000;

        const result = queueOrExecuteSkill(
            1,
            skill,
            8,
            9,
            {
                actionCooldownRef: ctx.actionCooldownRef,
                cantripCooldownRef: ctx.cantripCooldownRef,
                actionQueueRef: queuedActionsRef,
                rangeIndicatorRef,
                aoeIndicatorRef,
            },
            { pausedRef },
            { setTargetingMode, setQueuedActions },
            ctx,
            addLog,
            99
        );

        expect(result).toBe(true);
        expect(queuedActionsRef.current[1]).toMatchObject({
            type: "skill",
            skill,
            targetX: 8,
            targetZ: 9,
            targetId: 99,
        });
        expect(queuedActions).toEqual([{ unitId: 1, skillName: "Holy Strike" }]);
        expect(addLog).toHaveBeenCalledWith(expect.stringContaining("on cooldown"), "#ffffff");
        expect(executeSkillMock).not.toHaveBeenCalled();
        expect(clearTargetingModeMock).toHaveBeenCalledWith(setTargetingMode, rangeIndicatorRef, aoeIndicatorRef);
    });

    it("allows revive targeting by unit id even when the dead ally has no UnitGroup", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const deadAlly = makeUnit({ id: 2, x: 8, z: 9, hp: 0 });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const { ctx } = createSkillContext({
            units: [caster, deadAlly],
            unitsRef: { 1: casterGroup },
        });
        const pausedRef = createMutableRef(false);
        const actionQueueRef = createMutableRef<Record<number, never>>({});
        const rangeIndicatorRef = createRef<THREE.Mesh | null>(new THREE.Mesh());
        const aoeIndicatorRef = createRef<THREE.Mesh | null>(new THREE.Mesh());
        const skill = makeSkill({ name: "Ankh", type: "revive", targetType: "ally", range: 10, damageType: "holy" });
        const addLog = vi.fn();
        const setTargetingMode: Dispatch<SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>> = vi.fn();
        const setQueuedActions: Dispatch<SetStateAction<Array<{ unitId: number; skillName: string }>>> = vi.fn();

        const handled = handleTargetingOnUnit(
            2,
            { casterId: 1, skill },
            {
                actionCooldownRef: ctx.actionCooldownRef,
                cantripCooldownRef: ctx.cantripCooldownRef,
                actionQueueRef,
                pendingIntentsRef: createMutableRef<Record<number, never>>({}),
                pathsRef: createMutableRef<Record<number, { x: number; z: number }[]>>({}),
                moveStartRef: createMutableRef<Record<number, { time: number; x: number; z: number }>>({}),
                rangeIndicatorRef,
                aoeIndicatorRef,
            },
            {
                unitsStateRef: ctx.unitsStateRef,
                pausedRef,
            },
            {
                setTargetingMode,
                setQueuedActions,
            },
            ctx.unitsRef.current,
            ctx,
            addLog
        );

        expect(handled).toBe(true);
        expect(executeSkillMock).toHaveBeenCalledWith(ctx, 1, skill, 8, 9, 2, undefined);
    });

    it("enters displacement phase two after clicking a valid unit target", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const target = makeUnit({ id: 2, team: "enemy", x: 8, z: 8, enemyType: "kobold" });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const targetGroup = makeUnitGroup({ position: { x: 8, y: 0, z: 8 } });
        const { ctx } = createSkillContext({
            units: [caster, target],
            unitsRef: { 1: casterGroup, 2: targetGroup },
        });
        const rangeIndicator = new THREE.Mesh();
        rangeIndicator.visible = true;
        const rangeIndicatorRef = createRef<THREE.Mesh | null>(rangeIndicator);
        const aoeIndicatorRef = createRef<THREE.Mesh | null>(new THREE.Mesh());
        const pausedRef = createMutableRef(false);
        const actionQueueRef = createMutableRef<Record<number, never>>({});
        const skill = makeSkill({ name: "Body Swap", type: "displacement", targetType: "unit", range: 10 });
        const addLog = vi.fn();
        const setTargetingMode: Dispatch<SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>> = vi.fn();
        const setQueuedActions: Dispatch<SetStateAction<Array<{ unitId: number; skillName: string }>>> = vi.fn();
        const hit = {
            object: {
                name: "unit",
                userData: { unitId: 2 },
                parent: null,
            },
            point: { x: 8, y: 0, z: 8 },
        } as unknown as THREE.Intersection;

        const handled = handleTargetingClick(
            hit,
            { casterId: 1, skill },
            {
                actionCooldownRef: ctx.actionCooldownRef,
                cantripCooldownRef: ctx.cantripCooldownRef,
                actionQueueRef,
                pendingIntentsRef: createMutableRef<Record<number, never>>({}),
                pathsRef: createMutableRef<Record<number, { x: number; z: number }[]>>({}),
                moveStartRef: createMutableRef<Record<number, { time: number; x: number; z: number }>>({}),
                rangeIndicatorRef,
                aoeIndicatorRef,
            },
            {
                unitsStateRef: ctx.unitsStateRef,
                pausedRef,
            },
            {
                setTargetingMode,
                setQueuedActions,
            },
            ctx.unitsRef.current,
            ctx,
            addLog
        );

        expect(handled).toBe(true);
        expect(setTargetingMode).toHaveBeenCalledWith({ casterId: 1, skill, displacementTargetId: 2 });
        expect(addLog).toHaveBeenCalledWith("Barbarian: Now choose a destination.", "#ffffff");
        expect(rangeIndicator.visible).toBe(false);
        expect(executeSkillMock).not.toHaveBeenCalled();
    });

    it("reconfigures AOE geometry when switching between line and circular skills", () => {
        const casterGroup = makeUnitGroup({ position: { x: 4, y: 0, z: 6 } });
        const rangeIndicator = new THREE.Mesh();
        rangeIndicator.userData = {};
        const aoeIndicator = new THREE.Mesh();
        aoeIndicator.userData = {};
        aoeIndicator.material = new THREE.MeshBasicMaterial();
        const setTargetingMode: Dispatch<SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>> = vi.fn();

        setupTargetingMode(
            1,
            makeSkill({ name: "Holy Strike", type: "damage", targetType: "aoe", range: 7, lineWidth: 2 }),
            casterGroup,
            createRef(rangeIndicator),
            createRef(aoeIndicator),
            setTargetingMode
        );

        expect(setTargetingMode).toHaveBeenCalledWith({
            casterId: 1,
            skill: expect.objectContaining({ name: "Holy Strike" }),
        });
        expect(aoeIndicator.userData.isLine).toBe(true);
        expect(Reflect.get(aoeIndicator.geometry, "parameters")).toMatchObject({ width: 7, height: 2 });
        expect(aoeIndicator.visible).toBe(true);

        setupTargetingMode(
            1,
            makeSkill({ name: "Fireball", type: "damage", targetType: "aoe", range: 8, aoeRadius: 3, damageType: "fire" }),
            casterGroup,
            createRef(rangeIndicator),
            createRef(aoeIndicator),
            setTargetingMode
        );

        expect(disposeGeometryMock).toHaveBeenCalled();
        expect(aoeIndicator.userData.isLine).toBe(false);
        expect(Reflect.get(aoeIndicator.geometry, "parameters")).toMatchObject({ innerRadius: 0.1, outerRadius: 3 });
        expect(aoeIndicator.rotation.z).toBe(0);
    });

    it("computes a capped set of unique drag-line tiles", () => {
        const tiles = computeDragLineTiles(1.1, 1.1, 8.6, 3.4, 5);

        expect(tiles[0]).toEqual({ x: 1, z: 1 });
        expect(tiles.length).toBe(5);
        expect(new Set(tiles.map(tile => `${tile.x},${tile.z}`)).size).toBe(tiles.length);
    });
});
