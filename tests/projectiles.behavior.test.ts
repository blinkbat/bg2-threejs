import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Dispatch, SetStateAction } from "react";
import type { Unit, UnitGroup } from "../src/core/types";
import { createMutableRef, ensureDocumentMock, makeScene, makeUnit, makeUnitGroup } from "./gameplayTestUtils";

const {
    applyDamageToUnitMock,
    applyLifestealMock,
    isInRangeMock,
} = vi.hoisted(() => ({
    applyDamageToUnitMock: vi.fn(),
    applyLifestealMock: vi.fn(),
    isInRangeMock: vi.fn((...args: number[]) => {
        void args;
        return true;
    }),
}));

const unitsById = new Map<number, Unit>();

vi.mock("three", async () => {
    const module = await import("./threeMock");
    return module.createThreeTestModule();
});

vi.mock("../src/game/units", () => ({
    getUnitStats: (unit: Unit) => {
        if (unit.team === "enemy") {
            return {
                name: unit.enemyType === "kobold" ? "Kobold" : "Enemy",
                damage: [2, 4] as [number, number],
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
                lifesteal: 0.5,
            };
        }

        return {
            name: unit.id === 1 ? "Barbarian" : "Wizard",
            armor: 0,
            damage: [2, 4] as [number, number],
            accuracy: 100,
            class: unit.id === 1 ? "Barbarian" : "Wizard",
        };
    },
    isEnemyData: (value: unknown) => typeof value === "object" && value !== null && "aggroRange" in (value as Record<string, unknown>),
}));

vi.mock("../src/combat/combatMath", () => ({
    calculateDamageWithCrit: vi.fn(() => ({ damage: 5, isCrit: false })),
    calculateDamageWithOptionalCritChance: vi.fn(() => ({ damage: 5, isCrit: false })),
    getDirectionAndDistance: (fromX: number, fromZ: number, toX: number, toZ: number) => {
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.001) {
            return { dx: 0, dz: 0, dist: 0 };
        }
        return { dx: dx / dist, dz: dz / dist, dist };
    },
    rollSkillHit: vi.fn(() => true),
    rollDamage: vi.fn((min: number) => min),
    shouldApplyPoison: vi.fn(() => false),
    getEffectiveArmor: vi.fn(() => 0),
    logHit: vi.fn(() => "hit"),
    logLifestealHit: vi.fn(() => "lifesteal"),
    logMiss: vi.fn(() => "miss"),
    logPoisoned: vi.fn(() => "poisoned"),
    logBurning: vi.fn(() => "burning"),
    logAoeHit: vi.fn(() => "aoe-hit"),
    logAoeMiss: vi.fn(() => "aoe-miss"),
    getDamageColor: vi.fn(() => "#fff"),
    logTrapTriggered: vi.fn(() => "trap-triggered"),
    calculateStatBonus: vi.fn(() => 0),
    applyStatusEffect: (effects: unknown[] | undefined, effect: unknown) => [...(effects ?? []), effect],
    checkEnemyDefenses: vi.fn(() => "none"),
    hasStatusEffect: (unit: Unit, type: string) => unit.statusEffects?.some(effect => effect.type === type) ?? false,
    rollChance: vi.fn(() => true),
    applyChilled: (unit: Unit, sourceId: number, now: number) => ({
        ...unit,
        statusEffects: [
            ...(unit.statusEffects ?? []),
            {
                type: "chilled",
                duration: 2_000,
                tickInterval: 1_000,
                timeSinceTick: 0,
                lastUpdateTime: now,
                damagePerTick: 0,
                sourceId,
            },
        ],
    }),
    logStunned: vi.fn(() => "stunned"),
    logConstricted: vi.fn(() => "constricted"),
    logHamstrung: vi.fn(() => "hamstrung"),
}));

vi.mock("../src/core/gameClock", () => ({
    accumulateDelta: (projectile: { elapsedTime: number; lastUpdateTime: number }, now: number) => {
        projectile.elapsedTime += now - projectile.lastUpdateTime;
        projectile.lastUpdateTime = now;
    },
}));

vi.mock("../src/ai/pathfinding", () => ({
    isBlocked: vi.fn(() => false),
}));

vi.mock("../src/game/areas", () => ({
    isTreeBlocked: vi.fn(() => false),
}));

vi.mock("../src/game/enemyStats", () => ({
    ENEMY_STATS: {
        kobold: { name: "Kobold" },
    },
}));

vi.mock("../src/combat/damageEffects", () => ({
    applyDamageToUnit: (...args: unknown[]) => applyDamageToUnitMock(...args),
    animateExpandingMesh: vi.fn(),
    buildDamageContext: (
        scene: THREE.Scene,
        damageTexts: unknown[],
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
    applyLifesteal: (...args: unknown[]) => applyLifestealMock(...args),
    createAnimatedRing: vi.fn(),
}));

vi.mock("../src/audio", () => ({
    soundFns: {
        playBlock: vi.fn(),
        playExplosion: vi.fn(),
        playHit: vi.fn(),
        playMiss: vi.fn(),
    },
}));

vi.mock("../src/game/unitQuery", () => ({
    getUnitById: (id: number) => unitsById.get(id),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: (
        attackerX: number,
        attackerZ: number,
        targetX: number,
        targetZ: number,
        targetRadius: number,
        range: number
    ) => isInRangeMock(attackerX, attackerZ, targetX, targetZ, targetRadius, range),
}));

import { updateProjectiles } from "../src/gameLoop/projectiles";

function createLiveUnitsState(units: Unit[]): {
    unitsStateRef: ReturnType<typeof createMutableRef<Unit[]>>;
    setUnits: Dispatch<SetStateAction<Unit[]>>;
} {
    const unitsStateRef = createMutableRef(units);
    for (const unit of units) {
        unitsById.set(unit.id, unit);
    }

    const setUnits: Dispatch<SetStateAction<Unit[]>> = vi.fn((update: SetStateAction<Unit[]>) => {
        unitsStateRef.current = typeof update === "function"
            ? update(unitsStateRef.current)
            : update;
        unitsById.clear();
        for (const unit of unitsStateRef.current) {
            unitsById.set(unit.id, unit);
        }
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
    unitsById.clear();
    isInRangeMock.mockReturnValue(true);
    applyDamageToUnitMock.mockReturnValue({
        hpDamage: 5,
        totalHpDamage: 5,
        shieldAbsorbed: 0,
        shieldDepleted: false,
        wasDefeated: false,
    });
});

describe("projectile resolution", () => {
    it("triggers landed traps, deals trap damage, and applies pinned", () => {
        const attacker = makeUnit({ id: 1, x: 5, z: 5 });
        const enemy = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 6, z: 5, hp: 20 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const enemyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const { unitsStateRef, setUnits } = createLiveUnitsState([attacker, enemy]);
        const trapMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshPhongMaterial());
        const projectiles = [
            {
                type: "trap" as const,
                mesh: trapMesh,
                attackerId: 1,
                speed: 0,
                targetPos: { x: 6, z: 5 },
                aoeRadius: 1,
                pinnedDuration: 3_000,
                trapDamage: [4, 4] as [number, number],
                startX: 5,
                startZ: 5,
                elapsedTime: 0,
                lastUpdateTime: 500,
                flightDuration: 600,
                arcHeight: 1,
                isLanded: true,
                armedAt: 500,
            },
        ];

        const result = updateProjectiles(
            projectiles,
            { 1: attackerGroup, 100: enemyGroup },
            unitsStateRef.current,
            makeScene(),
            [],
            {},
            setUnits,
            vi.fn(),
            1_000,
            new Set<number>()
        );

        expect(result).toHaveLength(0);
        expect(applyDamageToUnitMock).toHaveBeenCalledWith(
            expect.any(Object),
            100,
            enemyGroup,
            4,
            "Kobold",
            expect.objectContaining({ damageType: "physical", attackerId: 1 })
        );
        expect(unitsStateRef.current.find(unit => unit.id === 100)?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "pinned", sourceId: 1 }),
            ])
        );
    });

    it("applies chilled when a piercing projectile connects", () => {
        const attacker = makeUnit({ id: 1, x: 5, z: 5 });
        const enemy = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", x: 6, z: 5, hp: 20 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const enemyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const { unitsStateRef, setUnits } = createLiveUnitsState([attacker, enemy]);
        const shard = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial());
        shard.position.set(5.8, 0.5, 5);
        const projectiles = [
            {
                type: "piercing" as const,
                mesh: shard,
                attackerId: 1,
                speed: 0.1,
                damage: [3, 3] as [number, number],
                damageType: "cold" as const,
                startX: 5.8,
                startZ: 5,
                directionX: 1,
                directionZ: 0,
                maxDistance: 5,
                hitUnits: new Set<number>(),
                chillChance: 100,
                attackerTeam: "player" as const,
                baseScaleX: 1,
                baseScaleZ: 1,
            },
        ];

        const result = updateProjectiles(
            projectiles,
            { 1: attackerGroup, 100: enemyGroup },
            unitsStateRef.current,
            makeScene(),
            [],
            {},
            setUnits,
            vi.fn(),
            1_000,
            new Set<number>()
        );

        expect(result).toHaveLength(1);
        expect(applyDamageToUnitMock).toHaveBeenCalledWith(
            expect.any(Object),
            100,
            enemyGroup,
            5,
            "Kobold",
            expect.objectContaining({ damageType: "cold" })
        );
        expect(unitsStateRef.current.find(unit => unit.id === 100)?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "chilled", sourceId: 1 }),
            ])
        );
    });

    it("applies on-hit projectile effects and alerts the enemy", () => {
        const attacker = makeUnit({ id: 1, x: 5, z: 5 });
        const enemy = makeUnit({ id: 100, team: "enemy", x: 6, z: 5, hp: 20 });
        const attackerGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const enemyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 }, userData: {} });
        const { unitsStateRef, setUnits } = createLiveUnitsState([attacker, enemy]);
        const projectileMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial());
        projectileMesh.position.set(5.8, 0.4, 5);
        const projectiles = [
            {
                type: "basic" as const,
                mesh: projectileMesh,
                targetId: 100,
                attackerId: 1,
                speed: 0.1,
                skillName: "Pressure Bolt",
                skillDamage: [2, 2] as [number, number],
                skillDamageType: "physical" as const,
                skillHitChanceOverride: 100,
                skillOnHitEffect: {
                    type: "stun" as const,
                    chance: 100,
                    duration: 1_500,
                },
                statBonus: 0,
            },
        ];

        const result = updateProjectiles(
            projectiles,
            { 1: attackerGroup, 100: enemyGroup },
            unitsStateRef.current,
            makeScene(),
            [],
            {},
            setUnits,
            vi.fn(),
            1_000,
            new Set<number>()
        );

        expect(result).toHaveLength(0);
        expect(applyDamageToUnitMock).toHaveBeenCalledWith(
            expect.any(Object),
            100,
            enemyGroup,
            5,
            "Enemy",
            expect.objectContaining({ damageType: "physical" })
        );
        expect(enemyGroup.userData.alerted).toBe(true);
        expect(unitsStateRef.current.find(unit => unit.id === 100)?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "stunned", sourceId: 1 }),
            ])
        );
    });

    it("bases enemy projectile lifesteal on actual HP damage after mitigation", () => {
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
        const { unitsStateRef, setUnits } = createLiveUnitsState([attacker, target]);
        const projectileMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial());
        projectileMesh.position.set(5.8, 0.4, 5);
        const projectiles = [
            {
                type: "basic" as const,
                mesh: projectileMesh,
                targetId: 1,
                attackerId: 100,
                speed: 0.1,
            },
        ];

        const result = updateProjectiles(
            projectiles,
            { 100: attackerGroup, 1: targetGroup },
            unitsStateRef.current,
            makeScene(),
            [],
            {},
            setUnits,
            vi.fn(),
            1_000,
            new Set<number>()
        );

        expect(result).toHaveLength(0);
        expect(applyLifestealMock).toHaveBeenCalledWith(expect.anything(), [], setUnits, 100, 5, 5, 1);
    });
});
