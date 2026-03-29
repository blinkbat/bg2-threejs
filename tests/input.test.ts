import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import * as THREE from "three";
import type { Skill, StatusEffect, Unit, UnitGroup } from "../src/core/types";
import type { SkillExecutionContext } from "../src/combat/skills/types";

const { executeSkillMock, pauseGameClockMock, resumeGameClockMock } = vi.hoisted(() => ({
    executeSkillMock: vi.fn(),
    pauseGameClockMock: vi.fn(),
    resumeGameClockMock: vi.fn(),
}));

vi.mock("three", () => {
    class SceneStub {
        add(): void {}
        remove(): void {}
    }

    class MeshStub {
        position = { set() {}, x: 0, y: 0, z: 0 };
        rotation = { x: 0, y: 0, z: 0 };
        scale = { set() {} };
        userData: Record<string, unknown> = {};
        material = { opacity: 1, dispose() {} };
        geometry = { dispose() {} };
    }

    class ColorStub {}

    return {
        Scene: SceneStub,
        Mesh: MeshStub,
        Color: ColorStub,
    };
});

vi.mock("../src/ai/pathfinding", () => ({
    findPath: vi.fn(() => null),
}));

vi.mock("../src/game/playerUnits", () => ({
    UNIT_DATA: {
        1: { name: "Barbarian" },
        2: { name: "Paladin" },
    },
}));

vi.mock("../src/core/gameClock", () => ({
    pauseGameClock: pauseGameClockMock,
    resumeGameClock: resumeGameClockMock,
}));

vi.mock("../src/combat/skills", () => ({
    executeSkill: executeSkillMock,
    clearTargetingMode: vi.fn(),
}));

vi.mock("../src/combat/combatMath", () => ({
    getIncapacitatingStatus: (unit: Unit): "stunned" | "sleep" | null => {
        if (unit.statusEffects?.some(effect => effect.type === "stunned")) return "stunned";
        if (unit.statusEffects?.some(effect => effect.type === "sleep")) return "sleep";
        return null;
    },
}));

vi.mock("../src/game/formation", () => ({
    getFormationPositions: vi.fn(() => []),
}));

vi.mock("../src/game/formationOrder", () => ({
    sortUnitsByFormationOrder: vi.fn((units: Unit[]) => units),
}));

vi.mock("../src/core/constants", () => ({
    MOVE_SPEED: 1,
    getSkillTextColor: vi.fn(() => "#ffffff"),
}));

vi.mock("../src/rendering/disposal", () => ({
    disposeGeometry: vi.fn(),
}));

vi.mock("../src/game/geometry", () => ({
    distanceToPoint: vi.fn(() => 0),
}));

vi.mock("../src/core/stateUtils", () => ({
    updateUnitsWhere: vi.fn(),
}));

vi.mock("../src/gameLoop/enemyBehaviors", () => ({
    isEnemyUntargetable: vi.fn(() => false),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: vi.fn(() => true),
}));

import { getSkillLockoutEnd, processActionQueue, queueOrExecuteSkill, togglePause, type ActionQueue } from "../src/input";

function createRef<T>(current: T): RefObject<T> {
    return { current };
}

function createMutableRef<T>(current: T): MutableRefObject<T> {
    return { current };
}

function makeStatusEffect(type: StatusEffect["type"]): StatusEffect {
    return {
        type,
        duration: 5000,
        tickInterval: 1000,
        timeSinceTick: 0,
        lastUpdateTime: 0,
        damagePerTick: 0,
        sourceId: 1,
    };
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 1,
        x: 5,
        z: 5,
        hp: 30,
        mana: 15,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
    return {
        name: "Warcry",
        kind: "ability",
        manaCost: 5,
        cooldown: 1000,
        type: "buff",
        targetType: "self",
        range: 0,
        damageType: "physical",
        ...overrides,
    };
}

function makeSkillContext(units: Unit[]): SkillExecutionContext {
    const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn();
    const setSkillCooldowns: Dispatch<SetStateAction<Record<string, { end: number; duration: number }>>> = vi.fn();

    return {
        scene: new THREE.Scene(),
        unitsStateRef: createRef(units),
        unitsRef: createRef<Record<number, UnitGroup>>({}),
        actionCooldownRef: createMutableRef<Record<number, number>>({}),
        cantripCooldownRef: createMutableRef<Record<string, number>>({}),
        projectilesRef: createMutableRef<SkillExecutionContext["projectilesRef"]["current"]>([]),
        hitFlashRef: createMutableRef<Record<number, number>>({}),
        damageTexts: createMutableRef<SkillExecutionContext["damageTexts"]["current"]>([]),
        unitMeshRef: createRef<Record<number, THREE.Mesh>>({}),
        unitOriginalColorRef: createRef<Record<number, THREE.Color>>({}),
        swingAnimationsRef: createMutableRef<SkillExecutionContext["swingAnimationsRef"]["current"]>([]),
        setUnits,
        setSkillCooldowns,
        addLog: vi.fn(),
        defeatedThisFrame: new Set<number>(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("input action handling", () => {
    it("uses a separate cantrip lockout from the unit action cooldown", () => {
        vi.spyOn(Date, "now").mockReturnValue(1_000);

        const skillCtx = makeSkillContext([makeUnit()]);
        const refs = {
            actionCooldownRef: createMutableRef<Record<number, number>>({ 1: 1_500 }),
            cantripCooldownRef: createMutableRef<Record<string, number>>({}),
            actionQueueRef: createMutableRef<ActionQueue>({}),
            rangeIndicatorRef: createRef<THREE.Mesh | null>(null),
            aoeIndicatorRef: createRef<THREE.Mesh | null>(null),
        };
        const pausedRef = createMutableRef(false);
        const setTargetingMode: Dispatch<SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>> = vi.fn();
        const setQueuedActions: Dispatch<SetStateAction<{ unitId: number; skillName: string }[]>> = vi.fn();
        const addLog = vi.fn();
        const cantrip = makeSkill({ name: "Highland Defense", isCantrip: true, maxUses: 1 });

        const executed = queueOrExecuteSkill(
            1,
            cantrip,
            5,
            5,
            refs,
            { pausedRef },
            { setTargetingMode, setQueuedActions },
            skillCtx,
            addLog
        );

        expect(executed).toBe(true);
        expect(executeSkillMock).toHaveBeenCalledWith(skillCtx, 1, cantrip, 5, 5, undefined, undefined);
        expect(refs.actionQueueRef.current[1]).toBeUndefined();

        refs.cantripCooldownRef.current["1-Highland Defense"] = 1_400;
        executeSkillMock.mockClear();

        const queued = queueOrExecuteSkill(
            1,
            cantrip,
            5,
            5,
            refs,
            { pausedRef },
            { setTargetingMode, setQueuedActions },
            skillCtx,
            addLog
        );

        expect(queued).toBe(true);
        expect(executeSkillMock).not.toHaveBeenCalled();
        expect(refs.actionQueueRef.current[1]).toEqual({
            type: "skill",
            skill: cantrip,
            targetX: 5,
            targetZ: 5,
            targetId: undefined,
            dragLinePositions: undefined,
        });
        expect(getSkillLockoutEnd(cantrip, 1, refs)).toBe(1_400);
    });

    it("keeps queued actions while a unit is asleep", () => {
        const sleeper = makeUnit({
            statusEffects: [makeStatusEffect("sleep")],
        });
        const actionQueueRef = createMutableRef<ActionQueue>({
            1: { type: "skill", skill: makeSkill(), targetX: 5, targetZ: 5 },
        });
        const actionCooldownRef = createMutableRef<Record<number, number>>({});
        const pausedRef = createMutableRef(false);
        const skillCtx = makeSkillContext([sleeper]);
        const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn();
        const setQueuedActions: Dispatch<SetStateAction<{ unitId: number; skillName: string }[]>> = vi.fn();

        processActionQueue(
            actionQueueRef,
            actionCooldownRef,
            {},
            {},
            {},
            pausedRef,
            skillCtx,
            setUnits,
            setQueuedActions
        );

        expect(executeSkillMock).not.toHaveBeenCalled();
        expect(actionQueueRef.current[1]).toBeDefined();
        expect(setQueuedActions).not.toHaveBeenCalled();
    });

    it("shifts movement timers and queued move delays when unpausing", () => {
        const actionQueueRef = createMutableRef<ActionQueue>({
            1: { type: "move", targetX: 8, targetZ: 9, notBefore: 200 },
            2: { type: "skill", skill: makeSkill(), targetX: 5, targetZ: 5 },
        });
        const actionCooldownRef = createMutableRef<Record<number, number>>({ 1: 100 });
        const moveStartRef = createMutableRef<Record<number, { time: number; x: number; z: number }>>({
            1: { time: 300, x: 1, z: 2 },
        });
        const pauseStartTimeRef = createMutableRef<number | null>(1000);
        const pausedRef = createMutableRef(true);
        const cantripCooldownRef = createMutableRef<Record<string, number>>({ "1-Warcry": 900 });
        let skillCooldownState: Record<string, { end: number; duration: number }> = {
            "1-Warcry": { end: 500, duration: 250 },
        };
        const setPaused: Dispatch<SetStateAction<boolean>> = vi.fn();
        const setSkillCooldowns: Dispatch<SetStateAction<Record<string, { end: number; duration: number }>>> = vi.fn(nextState => {
            skillCooldownState = typeof nextState === "function" ? nextState(skillCooldownState) : nextState;
            return skillCooldownState;
        });
        const processActionQueueMock = vi.fn();

        vi.spyOn(Date, "now").mockReturnValue(1600);

        togglePause(
            { pauseStartTimeRef, actionCooldownRef, cantripCooldownRef, actionQueueRef, moveStartRef },
            { pausedRef },
            { setPaused, setSkillCooldowns },
            processActionQueueMock
        );

        expect(resumeGameClockMock).toHaveBeenCalledTimes(1);
        expect(actionCooldownRef.current[1]).toBe(700);
        expect(cantripCooldownRef.current["1-Warcry"]).toBe(1500);
        expect(moveStartRef.current[1].time).toBe(900);
        expect(actionQueueRef.current[1]).toEqual({ type: "move", targetX: 8, targetZ: 9, notBefore: 800 });
        expect(actionQueueRef.current[2]).toEqual({ type: "skill", skill: makeSkill(), targetX: 5, targetZ: 5 });
        expect(skillCooldownState["1-Warcry"]).toEqual({ end: 1100, duration: 250 });
        expect(pauseStartTimeRef.current).toBeNull();
        expect(processActionQueueMock).toHaveBeenCalledWith(new Set<number>());
    });
});
