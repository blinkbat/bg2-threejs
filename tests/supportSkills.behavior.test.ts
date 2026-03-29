import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Skill, StatusEffect } from "../src/core/types";
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
        playHeal: vi.fn(),
        playEnergyShield: vi.fn(),
        playHolyStrike: vi.fn(),
    },
}));

vi.mock("../src/core/gameClock", () => ({
    getGameTime: () => 1_000,
}));

vi.mock("../src/core/effectScheduler", () => ({
    scheduleEffectAnimation: scheduleEffectAnimationMock,
}));

vi.mock("../src/combat/barks", () => ({
    tryHealBark: vi.fn(),
    trySpellBark: vi.fn(),
}));

vi.mock("../src/rendering/range", () => ({
    getUnitRadius: vi.fn(() => 0.5),
    isInRange: isInRangeMock,
}));

import {
    executeDivineLatticeSkill,
    executeManaTransferSkill,
    executeRestorationSkill,
    executeReviveSkill,
} from "../src/combat/skills/support";

function makeStatusEffect(type: StatusEffect["type"], overrides: Partial<StatusEffect> = {}): StatusEffect {
    return {
        type,
        duration: 5_000,
        tickInterval: 1_000,
        timeSinceTick: 0,
        lastUpdateTime: 0,
        damagePerTick: 0,
        sourceId: 99,
        ...overrides,
    };
}

function makeSkill(overrides: Partial<Skill>): Skill {
    return {
        name: "Support Skill",
        kind: "ability",
        manaCost: 0,
        cooldown: 1_000,
        type: "buff",
        targetType: "self",
        range: 6,
        damageType: "holy",
        ...overrides,
    };
}

beforeEach(() => {
    ensureDocumentMock();
    vi.clearAllMocks();
    isInRangeMock.mockReturnValue(true);
});

describe("support skill behavior", () => {
    it("applies mana transfer to the ally and qi drain to the caster", () => {
        const caster = makeUnit({ id: 1, hp: 50, mana: 12 });
        const ally = makeUnit({ id: 2, hp: 20, mana: 4 });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const allyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const addLog = vi.fn();
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, ally],
            unitsRef: { 1: casterGroup, 2: allyGroup },
            addLog,
        });
        const skill = makeSkill({
            name: "Qi Focus",
            type: "mana_transfer",
            targetType: "ally",
            manaRange: [12, 12],
            selfDamage: [20, 20],
            damageType: "physical",
        });

        const result = executeManaTransferSkill(ctx, 1, skill, 6, 5, 2);

        expect(result).toBe(true);
        const updatedCaster = unitsStateRef.current.find(unit => unit.id === 1);
        const updatedAlly = unitsStateRef.current.find(unit => unit.id === 2);
        expect(updatedAlly?.mana).toBe(16);
        expect(updatedCaster?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "qi_drain", damagePerTick: 2 }),
            ])
        );
        expect(addLog).toHaveBeenCalledWith(expect.stringContaining("restores 12 mana"), expect.any(String));
    });

    it("applies Divine Lattice and clears combat targeting", () => {
        const caster = makeUnit({ id: 1 });
        const enemy = makeUnit({ id: 100, team: "enemy", enemyType: "kobold", target: 2 });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const enemyGroup = makeUnitGroup({
            position: { x: 7, y: 0, z: 5 },
            userData: { attackTarget: 2 },
        });
        const addLog = vi.fn();
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, enemy],
            unitsRef: { 1: casterGroup, 100: enemyGroup },
            addLog,
        });
        ctx.unitMeshRef.current[100] = new THREE.Mesh();
        const skill = makeSkill({
            name: "Divine Lattice",
            duration: 8_000,
            targetType: "unit",
        });

        const result = executeDivineLatticeSkill(ctx, 1, skill, 7, 5, 100);

        expect(result).toBe(true);
        const updatedEnemy = unitsStateRef.current.find(unit => unit.id === 100);
        expect(updatedEnemy?.target).toBeNull();
        expect(updatedEnemy?.statusEffects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "divine_lattice", duration: 8_000 }),
            ])
        );
        expect(enemyGroup.userData.attackTarget).toBeNull();
        expect(addLog).toHaveBeenCalledWith("Barbarian seals the kobold in Divine Lattice.", expect.any(String));
    });

    it("restoration removes harmful effects and applies regen", () => {
        const caster = makeUnit({ id: 1 });
        const ally = makeUnit({
            id: 2,
            hp: 10,
            statusEffects: [
                makeStatusEffect("doom"),
                makeStatusEffect("poison"),
                makeStatusEffect("burn"),
                makeStatusEffect("slowed"),
                makeStatusEffect("hamstrung"),
                makeStatusEffect("constricted"),
                makeStatusEffect("sleep"),
            ],
        });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const allyGroup = makeUnitGroup({ position: { x: 6, y: 0, z: 5 } });
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, ally],
            unitsRef: { 1: casterGroup, 2: allyGroup },
            addLog: vi.fn(),
        });
        const skill = makeSkill({
            name: "Restoration",
            type: "restoration",
            targetType: "ally",
            duration: 10_000,
            healPerTick: 3,
        });

        const result = executeRestorationSkill(ctx, 1, skill, 6, 5, 2);

        expect(result).toBe(true);
        const updatedAlly = unitsStateRef.current.find(unit => unit.id === 2);
        expect(updatedAlly?.statusEffects).toEqual([
            expect.objectContaining({
                type: "regen",
                duration: 10_000,
                shieldAmount: 3,
            }),
        ]);
    });

    it("revives a fallen ally beside the caster and restores their UnitGroup", () => {
        const caster = makeUnit({ id: 1, x: 5, z: 5 });
        const fallenAlly = makeUnit({
            id: 2,
            hp: 0,
            x: 3,
            z: 4,
            statusEffects: [makeStatusEffect("poison")],
        });
        const casterGroup = makeUnitGroup({ position: { x: 5, y: 0, z: 5 } });
        const fallenGroup = makeUnitGroup({
            position: { x: 3, y: 0.2, z: 4 },
            visible: false,
            userData: { flyHeight: 0.2, targetX: 3, targetZ: 4 },
        });
        const { ctx, unitsStateRef } = createSkillContext({
            units: [caster, fallenAlly],
            unitsRef: { 1: casterGroup, 2: fallenGroup },
            addLog: vi.fn(),
        });
        ctx.unitMeshRef.current[2] = new THREE.Mesh();
        const skill = makeSkill({
            name: "Ankh",
            type: "revive",
            targetType: "ally",
            range: 999,
            damageType: "holy",
        });

        vi.spyOn(Math, "random").mockReturnValue(0);

        const result = executeReviveSkill(ctx, 1, skill, 3, 4, 2);

        expect(result).toBe(true);
        const revivedAlly = unitsStateRef.current.find(unit => unit.id === 2);
        expect(revivedAlly).toMatchObject({
            hp: 1,
            x: 6.5,
            z: 5,
            target: null,
            statusEffects: undefined,
        });
        expect(fallenGroup.visible).toBe(true);
        expect(fallenGroup.position).toMatchObject({ x: 6.5, y: 0.2, z: 5 });
        expect(fallenGroup.userData.targetX).toBe(6.5);
        expect(fallenGroup.userData.targetZ).toBe(5);
    });
});
