import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import * as THREE from "three";
import { createMutableRef, ensureDocumentMock, makeScene, makeUnit, makeUnitGroup } from "./gameplayTestUtils";
import type { AcidTile, DamageText, HolyTile, SanctuaryTile, SmokeTile, Unit, UnitGroup } from "../src/core/types";

const { spawnDamageNumberMock, applyDamageToUnitMock } = vi.hoisted(() => ({
    spawnDamageNumberMock: vi.fn(),
    applyDamageToUnitMock: vi.fn(),
}));

vi.mock("three", async () => {
    const module = await import("./threeMock");
    return module.createThreeTestModule();
});

vi.mock("../src/rendering/disposal", () => ({
    disposeBasicMesh: vi.fn(),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: vi.fn(() => true),
}));

vi.mock("../src/combat/damageEffects", () => ({
    spawnDamageNumber: spawnDamageNumberMock,
    buildDamageContext: (
        scene: THREE.Scene,
        damageTexts: DamageText[],
        hitFlashRef: Record<number, number>,
        unitsRef: Record<number, UnitGroup>,
        unitsState: Unit[],
        setUnits: Dispatch<SetStateAction<Unit[]>>,
        addLog: (text: string, color?: string) => void,
        now: number,
        defeatedThisFrame: Set<number>
    ) => ({
        scene,
        damageTexts,
        hitFlashRef,
        unitsRef,
        unitsStateRef: { current: unitsState },
        setUnits,
        addLog,
        now,
        defeatedThisFrame,
    }),
    applyDamageToUnit: (
        ctx: {
            setUnits: Dispatch<SetStateAction<Unit[]>>;
        },
        targetId: number,
        _targetG: UnitGroup,
        damage: number
    ) => {
        applyDamageToUnitMock(targetId, damage);
        ctx.setUnits(previous => previous.map(unit => (
            unit.id === targetId ? { ...unit, hp: Math.max(0, unit.hp - damage) } : unit
        )));
    },
}));

import { createHolyCross, processHolyTiles } from "../src/gameLoop/holyTiles";
import { createSanctuaryTile, processSanctuaryTiles } from "../src/gameLoop/sanctuaryTiles";
import { createSmokeTile, processSmokeTiles } from "../src/gameLoop/smokeTiles";

function createLiveUnitsState(units: Unit[]): {
    unitsStateRef: ReturnType<typeof createMutableRef<Unit[]>>;
    setUnits: Dispatch<SetStateAction<Unit[]>>;
} {
    const unitsStateRef = createMutableRef(units);
    const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn((update: SetStateAction<Unit[]>) => {
        unitsStateRef.current = typeof update === "function"
            ? update(unitsStateRef.current)
            : update;
        return unitsStateRef.current;
    });

    return {
        unitsStateRef,
        setUnits,
    };
}

beforeEach(() => {
    ensureDocumentMock();
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("persistent tile processors", () => {
    it("heals players standing on sanctuary tiles", () => {
        const player = makeUnit({ id: 1, hp: 10 });
        const playerGroup = makeUnitGroup({ position: { x: 5.5, y: 0, z: 5.5 } });
        const scene = makeScene();
        const sanctuaryTiles = new Map<string, SanctuaryTile>();
        const acidTiles = new Map<string, AcidTile>();
        const { unitsStateRef, setUnits } = createLiveUnitsState([player]);
        const addLog = vi.fn();

        createSanctuaryTile(scene, sanctuaryTiles, acidTiles, 5, 5, 1, 3, 0);
        for (let now = 100; now <= 2_000; now += 100) {
            processSanctuaryTiles(
                sanctuaryTiles,
                unitsStateRef.current,
                { 1: playerGroup },
                scene,
                [],
                setUnits,
                addLog,
                now
            );
        }

        expect(unitsStateRef.current[0].hp).toBe(13);
        expect(spawnDamageNumberMock).toHaveBeenCalled();
        expect(addLog).toHaveBeenCalledWith("Barbarian is healed for 3 by Sanctuary.", expect.any(String));
    });

    it("applies blind to enemies standing in smoke", () => {
        const enemy = makeUnit({ id: 100, team: "enemy", hp: 20, enemyType: "kobold" });
        const enemyGroup = makeUnitGroup({ position: { x: 6.5, y: 0, z: 4.5 } });
        const scene = makeScene();
        const smokeTiles = new Map<string, SmokeTile>();
        const { unitsStateRef, setUnits } = createLiveUnitsState([enemy]);

        createSmokeTile(scene, smokeTiles, 6, 4, 1, 100, 3_000, 0);
        for (let now = 100; now <= 1_500; now += 100) {
            processSmokeTiles(
                smokeTiles,
                unitsStateRef.current,
                { 100: enemyGroup },
                scene,
                setUnits,
                now
            );
        }

        expect(unitsStateRef.current[0].statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "blind", duration: 3_000 }),
            ])
        );
    });

    it("damages enemies once per tick on overlapping holy ground", () => {
        const enemy = makeUnit({ id: 100, team: "enemy", hp: 20, enemyType: "kobold" });
        const enemyGroup = makeUnitGroup({ position: { x: 5.5, y: 0, z: 5.5 } });
        const scene = makeScene();
        const holyTiles = new Map<string, HolyTile>();
        const { unitsStateRef, setUnits } = createLiveUnitsState([enemy]);

        createHolyCross(scene, holyTiles, 5.5, 5.5, 1, 4, 0, 1, 1, 5_000);
        for (let now = 100; now <= 1_000; now += 100) {
            processHolyTiles(
                holyTiles,
                unitsStateRef.current,
                { 100: enemyGroup },
                scene,
                [],
                {},
                setUnits,
                vi.fn(),
                now,
                new Set<number>()
            );
        }

        expect(applyDamageToUnitMock).toHaveBeenCalledOnce();
        expect(unitsStateRef.current[0].hp).toBe(16);
    });
});
