import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Unit } from "../src/core/types";
import { createMutableRef, ensureDocumentMock, makeScene, makeUnit, makeUnitGroup } from "./gameplayTestUtils";

const {
    createProjectileMock,
    applyDamageToUnitMock,
    applyLifestealMock,
    startAttackBumpMock,
    spawnSwingIndicatorMock,
    setEnemyKiteCooldownMock,
    setEnemyKitingUntilMock,
    findPathMock,
    findNearestUnitMock,
} = vi.hoisted(() => ({
    createProjectileMock: vi.fn(() => ({
        position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
        rotation: { x: 0, y: 0, z: 0 },
        userData: {},
        add: vi.fn(),
    })),
    applyDamageToUnitMock: vi.fn(),
    applyLifestealMock: vi.fn(),
    startAttackBumpMock: vi.fn(),
    spawnSwingIndicatorMock: vi.fn(),
    setEnemyKiteCooldownMock: vi.fn(),
    setEnemyKitingUntilMock: vi.fn(),
    findPathMock: vi.fn(),
    findNearestUnitMock: vi.fn(),
}));

vi.mock("three", async () => {
    const module = await import("./threeMock");
    return module.createThreeTestModule();
});

vi.mock("../src/game/units", () => ({
    getUnitStats: (unit: Unit) => {
        if (unit.team === "enemy") {
            return {
                name: unit.enemyType === "kobold" ? "Kobold" : "Enemy",
                armor: 0,
            };
        }

        return {
            name: unit.id === 1 ? "Barbarian" : "Paladin",
            armor: 0,
            damage: [1, 4] as [number, number],
        };
    },
}));

vi.mock("../src/combat/combatMath", () => ({
    calculateDamageWithCrit: vi.fn(() => ({ damage: 7, isCrit: false })),
    getDirectionAndDistance: (fromX: number, fromZ: number, toX: number, toZ: number) => {
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.001) {
            return { dx: 0, dz: 0, dist: 0 };
        }
        return { dx: dx / dist, dz: dz / dist, dist };
    },
    rollHit: vi.fn(() => true),
    rollChance: vi.fn(() => true),
    rollDamage: vi.fn((min: number) => min),
    getEffectiveArmor: vi.fn(() => 0),
    getEffectiveDamage: vi.fn((_unit: Unit, damage: [number, number], multiplier: number) => [
        Math.floor(damage[0] * multiplier),
        Math.floor(damage[1] * multiplier),
    ]),
    shouldApplyPoison: vi.fn(() => true),
    shouldApplySlow: vi.fn(() => true),
    logHit: vi.fn(() => "hit"),
    logLifestealHit: vi.fn(() => "lifesteal"),
    logMiss: vi.fn(() => "miss"),
    logPoisoned: vi.fn(() => "poisoned"),
    logSlowed: vi.fn(() => "slowed"),
    applyStatusEffect: (effects: unknown[] | undefined, effect: unknown) => [...(effects ?? []), effect],
    logStunned: vi.fn(() => "stunned"),
    hasStatusEffect: vi.fn(() => false),
    applyArmor: vi.fn((damage: number) => damage),
}));

vi.mock("../src/combat/damageEffects", () => ({
    createProjectile: createProjectileMock,
    getProjectileSpeed: vi.fn(() => 0.25),
    applyDamageToUnit: (...args: unknown[]) => applyDamageToUnitMock(...args),
    applyLifesteal: (...args: unknown[]) => applyLifestealMock(...args),
}));

vi.mock("../src/game/statBonuses", () => ({
    CRIT_MULTIPLIER: 2,
}));

vi.mock("../src/audio", () => ({
    soundFns: {
        playAttack: vi.fn(),
        playHit: vi.fn(),
        playMiss: vi.fn(),
    },
}));

vi.mock("../src/gameLoop/swingAnimations", () => ({
    startAttackBump: startAttackBumpMock,
    spawnSwingIndicator: spawnSwingIndicatorMock,
}));

vi.mock("../src/ai/pathfinding", () => ({
    findPath: (...args: unknown[]) => findPathMock(...args),
    isPassable: vi.fn(() => true),
}));

vi.mock("../src/game/enemyState", () => ({
    getEnemyKiteCooldown: vi.fn(() => 0),
    setEnemyKiteCooldown: setEnemyKiteCooldownMock,
    setEnemyKitingUntil: setEnemyKitingUntilMock,
}));

vi.mock("../src/game/areas", () => ({
    getCurrentArea: () => ({ gridWidth: 20, gridHeight: 20 }),
}));

vi.mock("../src/game/unitQuery", () => ({
    findNearestUnit: (...args: unknown[]) => findNearestUnitMock(...args),
}));

import { tryKite } from "../src/ai/targeting";
import { executeEnemyBasicAttack } from "../src/gameLoop/enemyAttack";

function createLiveSetUnits(ref: ReturnType<typeof createMutableRef<Unit[]>>): Dispatch<SetStateAction<Unit[]>> {
    return vi.fn((update: SetStateAction<Unit[]>) => {
        ref.current = typeof update === "function"
            ? update(ref.current)
            : update;
        return ref.current;
    });
}

beforeEach(() => {
    ensureDocumentMock();
    vi.clearAllMocks();
    applyDamageToUnitMock.mockReturnValue({
        hpDamage: 7,
        totalHpDamage: 7,
        shieldAbsorbed: 0,
        shieldDepleted: false,
        wasDefeated: false,
    });
    findPathMock.mockReturnValue([
        { x: 5, z: 5 },
        { x: 8, z: 5 },
    ]);
});

describe("enemy combat behavior", () => {
    it("spawns a basic projectile for ranged enemy attacks", () => {
        const attacker = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 5, z: 5 });
        const target = makeUnit({ id: 1, x: 8, z: 5 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const targetGroup = makeUnitGroup({ position: { x: 8, y: 0, z: 5 } });
        const unitsStateRef = createMutableRef([attacker, target]);

        executeEnemyBasicAttack({
            scene: makeScene(),
            attacker,
            attackerG: attackerGroup,
            target,
            targetG: targetGroup,
            attackerStats: {
                name: "Kobold Archer",
                projectileColor: "#ff0000",
                damage: [2, 4],
                accuracy: 70,
                armor: 0,
                aggroRange: 8,
                attackCooldown: 1_500,
                moveSpeed: 1,
                size: 1,
                monsterType: "beast",
                tier: "enemy",
                hp: 20,
                maxHp: 20,
                expReward: 10,
            },
            damageTexts: [],
            hitFlashRef: {},
            unitsRef: { 100: attackerGroup, 1: targetGroup },
            unitsStateRef,
            setUnits: createLiveSetUnits(unitsStateRef),
            addLog: vi.fn(),
            now: 1_000,
            defeatedThisFrame: new Set<number>(),
            swingAnimations: [],
            projectilesRef: [],
        });

        expect(createProjectileMock).toHaveBeenCalledWith(expect.anything(), "enemy", 5, 5, "#ff0000");
    });

    it("spawns a fireball projectile for fireball attacks", () => {
        const attacker = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 5, z: 5 });
        const target = makeUnit({ id: 1, x: 8, z: 5 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const targetGroup = makeUnitGroup({ position: { x: 8, y: 0, z: 5 } });
        const unitsStateRef = createMutableRef([attacker, target]);
        const projectiles: Array<{ type: string; directionX?: number; directionZ?: number }> = [];

        executeEnemyBasicAttack({
            scene: makeScene(),
            attacker,
            attackerG: attackerGroup,
            target,
            targetG: targetGroup,
            attackerStats: {
                name: "Kobold Pyro",
                fireballAttack: true,
                damage: [3, 5],
                accuracy: 70,
                armor: 0,
                aggroRange: 8,
                attackCooldown: 1_500,
                moveSpeed: 1,
                size: 1,
                monsterType: "beast",
                tier: "enemy",
                hp: 20,
                maxHp: 20,
                expReward: 10,
            },
            damageTexts: [],
            hitFlashRef: {},
            unitsRef: { 100: attackerGroup, 1: targetGroup },
            unitsStateRef,
            setUnits: createLiveSetUnits(unitsStateRef),
            addLog: vi.fn(),
            now: 1_000,
            defeatedThisFrame: new Set<number>(),
            swingAnimations: [],
            projectilesRef: projectiles as never[],
        });

        expect(projectiles).toHaveLength(1);
        expect(projectiles[0]).toMatchObject({
            type: "fireball",
            directionX: 1,
            directionZ: 0,
        });
    });

    it("applies melee side effects and lifesteal on a hit", () => {
        const attacker = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 5, z: 5 });
        const target = makeUnit({ id: 1, x: 6, z: 5, hp: 30 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const targetGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const unitsStateRef = createMutableRef([attacker, target]);
        const setUnits = createLiveSetUnits(unitsStateRef);

        executeEnemyBasicAttack({
            scene: makeScene(),
            attacker,
            attackerG: attackerGroup,
            target,
            targetG: targetGroup,
            attackerStats: {
                name: "Venom Fang",
                damage: [4, 4],
                accuracy: 100,
                armor: 0,
                aggroRange: 8,
                attackCooldown: 1_500,
                moveSpeed: 1,
                size: 1,
                monsterType: "beast",
                tier: "enemy",
                hp: 20,
                maxHp: 20,
                expReward: 10,
                poisonDamage: 2,
                slowChance: 100,
                stunChance: 100,
                lifesteal: 0.5,
            },
            damageTexts: [],
            hitFlashRef: {},
            unitsRef: { 100: attackerGroup, 1: targetGroup },
            unitsStateRef,
            setUnits,
            addLog: vi.fn(),
            now: 1_000,
            defeatedThisFrame: new Set<number>(),
            swingAnimations: [],
            projectilesRef: [],
        });

        expect(applyDamageToUnitMock).toHaveBeenCalledWith(
            expect.any(Object),
            1,
            targetGroup,
            7,
            "Barbarian",
            expect.objectContaining({
                poison: { sourceId: 100, damagePerTick: 2 },
                slow: { sourceId: 100 },
            })
        );
        expect(applyLifestealMock).toHaveBeenCalledWith(expect.anything(), [], setUnits, 100, 5, 5, 3);
        expect(unitsStateRef.current.find(unit => unit.id === 1)?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "stunned", sourceId: 100 }),
            ])
        );
    });

    it("bases melee lifesteal on actual HP damage after mitigation", () => {
        applyDamageToUnitMock.mockReturnValueOnce({
            hpDamage: 0,
            totalHpDamage: 2,
            shieldAbsorbed: 5,
            shieldDepleted: false,
            wasDefeated: false,
        });

        const attacker = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 5, z: 5 });
        const target = makeUnit({ id: 1, x: 6, z: 5, hp: 30 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const targetGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const unitsStateRef = createMutableRef([attacker, target]);
        const setUnits = createLiveSetUnits(unitsStateRef);

        executeEnemyBasicAttack({
            scene: makeScene(),
            attacker,
            attackerG: attackerGroup,
            target,
            targetG: targetGroup,
            attackerStats: {
                name: "Venom Fang",
                damage: [4, 4],
                accuracy: 100,
                armor: 0,
                aggroRange: 8,
                attackCooldown: 1_500,
                moveSpeed: 1,
                size: 1,
                monsterType: "beast",
                tier: "enemy",
                hp: 20,
                maxHp: 20,
                expReward: 10,
                poisonDamage: 2,
                slowChance: 100,
                stunChance: 100,
                lifesteal: 0.5,
            },
            damageTexts: [],
            hitFlashRef: {},
            unitsRef: { 100: attackerGroup, 1: targetGroup },
            unitsStateRef,
            setUnits,
            addLog: vi.fn(),
            now: 1_000,
            defeatedThisFrame: new Set<number>(),
            swingAnimations: [],
            projectilesRef: [],
        });

        expect(applyLifestealMock).toHaveBeenCalledWith(expect.anything(), [], setUnits, 100, 5, 5, 1);
    });

    it("creates a retreat path and clears targeting when kiting starts", () => {
        const enemy = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 5, z: 5 });
        const enemyGroup = makeUnitGroup({
            position: { x: 5, y: 0, z: 5 },
            userData: { attackTarget: 1, lastHitTime: 0 },
        });
        const playerGroup = makeUnitGroup({ position: { x: 4, y: 0, z: 5 } });
        const pathsRef: Record<number, { x: number; z: number }[]> = {};
        const moveStartRef: Record<number, { time: number; x: number; z: number }> = {};

        findNearestUnitMock.mockReturnValue({
            unit: makeUnit({ id: 1, x: 4, z: 5 }),
            group: playerGroup,
            dist: 1,
        });

        const result = tryKite(
            {
                unit: enemy,
                g: enemyGroup,
                unitsRef: { 100: enemyGroup, 1: playerGroup },
                unitsState: [enemy, makeUnit({ id: 1, x: 4, z: 5 })],
                pathsRef,
                moveStartRef,
                now: 1_000,
            },
            {
                name: "Kobold Sling",
                damage: [2, 4],
                accuracy: 70,
                armor: 0,
                aggroRange: 8,
                attackCooldown: 1_500,
                moveSpeed: 1,
                size: 1,
                monsterType: "beast",
                tier: "enemy",
                hp: 20,
                maxHp: 20,
                expReward: 10,
                kiteTrigger: 3,
                kiteDistance: 4,
                kiteCooldown: 2_000,
            }
        );

        expect(result.isKiting).toBe(true);
        expect(pathsRef[100]).toEqual([{ x: 8, z: 5 }]);
        expect(moveStartRef[100]).toEqual({ time: 1_000, x: 5, z: 5 });
        expect(enemyGroup.userData.attackTarget).toBeNull();
        expect(setEnemyKiteCooldownMock).toHaveBeenCalledWith(100, 3_000);
        expect(setEnemyKitingUntilMock).toHaveBeenCalledWith(100, 2_000);
    });
});
