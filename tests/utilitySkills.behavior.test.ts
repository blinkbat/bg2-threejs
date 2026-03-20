import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Skill } from "../src/core/types";
import { createSkillContext, ensureDocumentMock, makeUnit, makeUnitGroup } from "./gameplayTestUtils";

const { isInRangeMock, scheduleEffectAnimationMock } = vi.hoisted(() => ({
    isInRangeMock: vi.fn(() => true),
    scheduleEffectAnimationMock: vi.fn(),
}));

vi.mock("three", async () => {
    const module = await import("./threeMock");
    return module.createThreeTestModule();
});

vi.mock("../src/audio", () => ({
    soundFns: {
        playAttack: vi.fn(),
        playBlock: vi.fn(),
        playHeal: vi.fn(),
        playHit: vi.fn(),
        playHolyStrike: vi.fn(),
        playMiss: vi.fn(),
        playWarcry: vi.fn(),
    },
}));

vi.mock("../src/ai/movement", () => ({
    cleanupUnitState: vi.fn(),
}));

vi.mock("../src/game/enemyState", () => ({
    cleanupEnemyKiteCooldown: vi.fn(),
}));

vi.mock("../src/core/gameClock", () => ({
    getGameTime: () => 1_000,
}));

vi.mock("../src/core/effectScheduler", () => ({
    scheduleEffectAnimation: scheduleEffectAnimationMock,
}));

vi.mock("../src/game/areas", () => ({
    getCurrentArea: () => ({ gridWidth: 50, gridHeight: 50, invulnerable: false }),
    getComputedAreaData: () => ({ blocked: [] }),
    isTreeBlocked: () => false,
    isTerrainBlocked: () => false,
    isWaterTerrain: () => false,
}));

vi.mock("../src/gameLoop/enemyBehaviors/submerge", () => ({
    trySubmergeKraken: vi.fn(),
}));

vi.mock("../src/gameLoop/enemyBehaviors/untargetable", () => ({
    isEnemyUntargetable: vi.fn(() => false),
}));

vi.mock("../src/combat/barks", () => ({
    tryKillBark: vi.fn(),
    trySpellBark: vi.fn(),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: isInRangeMock,
}));

vi.mock("../src/gameLoop/swingAnimations", () => ({
    spawnSwingIndicator: vi.fn(),
}));

import {
    executeDimMakSkill,
    executeFivePointPalmSkill,
    executeSanctuarySkill,
    executeSmokeBombSkill,
} from "../src/combat/skills/utility";
import type { AcidTile, SmokeTile, SanctuaryTile } from "../src/core/types";

function makeSkill(overrides: Partial<Skill>): Skill {
    return {
        name: "Utility Skill",
        manaCost: 0,
        cooldown: 1_000,
        type: "buff",
        targetType: "self",
        range: 6,
        damageType: "physical",
        ...overrides,
    };
}

beforeEach(() => {
    ensureDocumentMock();
    vi.clearAllMocks();
    isInRangeMock.mockReturnValue(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("utility skill behavior", () => {
    it("creates sanctuary tiles and dispels overlapping acid", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const sanctuaryTiles = new Map<string, SanctuaryTile>();
        const acidTiles = new Map<string, AcidTile>();
        acidTiles.set("6,5", {
            mesh: new THREE.Mesh(),
            x: 6,
            z: 5,
            elapsedTime: 0,
            lastUpdateTime: 0,
            duration: 5_000,
            timeSinceTick: 0,
            sourceId: 999,
        });
        const { ctx } = createSkillContext({
            units: [caster],
            unitsRef: { 1: casterGroup },
            sanctuaryTiles,
            acidTiles,
        });
        const skill = makeSkill({
            name: "Sanctuary",
            type: "sanctuary",
            targetType: "aoe",
            damageType: "holy",
            aoeRadius: 0.1,
            healPerTick: 4,
        });

        const result = executeSanctuarySkill(ctx, 1, skill, 6, 5);

        expect(result).toBe(true);
        expect(acidTiles.has("6,5")).toBe(false);
        expect(sanctuaryTiles.size).toBe(1);
        expect(sanctuaryTiles.get("6,5")).toMatchObject({ x: 6, z: 5, healPerTick: 4 });
    });

    it("creates smoke tiles at the target point", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const smokeTiles = new Map<string, SmokeTile>();
        const { ctx } = createSkillContext({
            units: [caster],
            unitsRef: { 1: casterGroup },
            smokeTiles,
        });
        const skill = makeSkill({
            name: "Smoke Bomb",
            type: "smoke",
            targetType: "aoe",
            aoeRadius: 0.1,
            blindChance: 100,
            blindDuration: 3_000,
        });

        const result = executeSmokeBombSkill(ctx, 1, skill, 7, 6);

        expect(result).toBe(true);
        expect(smokeTiles.size).toBe(1);
        expect(smokeTiles.get("7,6")).toMatchObject({ x: 7, z: 6, sourceId: 1 });
    });

    it("applies weakened when Five-Point Palm lands", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const enemy = makeUnit({ id: 100, x: 6, z: 5, hp: 20, team: "enemy", enemyType: "kobold" });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const enemyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, enemy],
            unitsRef: { 1: casterGroup, 100: enemyGroup },
            addLog: vi.fn(),
        });
        ctx.unitMeshRef.current[100] = new THREE.Mesh();
        const skill = makeSkill({
            name: "Five-Point Palm",
            type: "debuff",
            targetType: "enemy",
            damageRange: [3, 3],
            range: 2,
            duration: 5_000,
        });

        const result = executeFivePointPalmSkill(ctx, 1, skill, 6, 5, 100);

        expect(result).toBe(true);
        const updatedEnemy = unitsStateRef.current.find(unit => unit.id === 100);
        expect(updatedEnemy?.hp).toBeLessThan(20);
        expect(updatedEnemy?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "weakened", duration: 5_000 }),
            ])
        );
    });

    it("refuses to apply Dim Mak to boss-tier enemies", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const boss = makeUnit({ id: 100, x: 6, z: 5, hp: 100, team: "enemy", enemyType: "ancient_construct" });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const bossGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const addLog = vi.fn();
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, boss],
            unitsRef: { 1: casterGroup, 100: bossGroup },
            addLog,
        });
        const skill = makeSkill({
            name: "Dim Mak",
            type: "debuff",
            targetType: "enemy",
            damageRange: [1, 1],
            range: 2,
            duration: 10_000,
            isCantrip: true,
            maxUses: 1,
        });

        const result = executeDimMakSkill(ctx, 1, skill, 6, 5, 100);

        expect(result).toBe(false);
        expect(addLog).toHaveBeenCalledWith(
            "Barbarian: Ancient Construct is immune to Doom!",
            expect.any(String)
        );
        expect(unitsStateRef.current.find(unit => unit.id === 100)?.statusEffects).toBeUndefined();
    });
});
