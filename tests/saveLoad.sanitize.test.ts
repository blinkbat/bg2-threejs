import { describe, expect, it } from "vitest";
import { MAX_SLOTS } from "../src/game/saveLoad/constants";
import { normalizeSlots, parseSaveSlotData } from "../src/game/saveLoad/sanitize";

function createMinimalValidRawSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: 1,
        timestamp: 1,
        slotName: "slot",
        players: [{ id: 1, hp: 10 }],
        currentAreaId: "coast",
        openedChests: [],
        openedSecretDoors: [],
        killedEnemies: [],
        gold: 0,
        equipment: {},
        inventory: { items: [] },
        ...overrides,
    };
}

describe("saveLoad sanitize", () => {
    it("sanitizes players and nested save payload fields", () => {
        const raw = createMinimalValidRawSave({
            players: [
                {
                    id: 1,
                    hp: 9,
                    mana: -3,
                    level: 2,
                    exp: 15,
                    statusEffects: [
                        {
                            type: "poison",
                            duration: 250,
                            tickInterval: 0,
                            timeSinceTick: 12,
                            lastUpdateTime: 99,
                            damagePerTick: 2,
                            sourceId: 7,
                            auraDamageType: "fire",
                        },
                        {
                            type: "bad_type",
                            duration: 10,
                        },
                    ],
                    cantripUses: {
                        spark: 3,
                        drained: -2,
                        "": 4,
                        invalid: "x",
                    },
                    summonType: "ancestor_warrior",
                    summonedBy: 2,
                    summonRemainingDurationMs: 3750.9,
                },
                {
                    id: "bad",
                    hp: "bad",
                },
            ],
            gold: -20,
            equipment: {
                1: {
                    leftHand: " largeBranch ",
                    rightHand: "",
                    armor: null,
                    accessory1: null,
                    accessory2: null,
                },
                "-1": {
                    leftHand: "battleaxe",
                },
                x: {
                    leftHand: "largeBranch",
                },
            },
            inventory: {
                items: [
                    { itemId: "loafOfBread", quantity: 1 },
                    { itemId: "loafOfBread", quantity: 2 },
                    { itemId: "smallManaPotion", quantity: -1 },
                    { bad: true },
                ],
            },
            hotbarAssignments: {
                1: ["Attack", "", null, "Skill", 3],
                x: ["bad"],
            },
            formationOrder: [1, 2, 2, -1, "x"],
            dialogTriggerProgress: {
                " coast ": ["intro_1", "intro_1", ""],
                "": ["bad"],
            },
            fogVisibilityByArea: {
                coast: [[0, 1], [2, 2]],
                forest: [[0, 1], [2]],
                bad_values: [[0, 3]],
            },
            lastWaystone: {
                areaId: " forest ",
                waystoneIndex: 2.9,
            },
        });

        const parsed = parseSaveSlotData(raw);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const data = parsed.data;

        expect(data.players).toHaveLength(1);
        expect(data.players[0].mana).toBe(0);
        // tickInterval: 0 is invalid (would cause infinite ticks), sanitized to 1000ms default
        expect(data.players[0].statusEffects).toEqual([
            {
                type: "poison",
                duration: 250,
                tickInterval: 1000,
                timeSinceTick: 12,
                lastUpdateTime: 99,
                damagePerTick: 2,
                sourceId: 7,
                auraDamageType: "fire",
            },
        ]);
        expect(data.players[0].cantripUses).toEqual({
            spark: 3,
            drained: 0,
        });
        expect(data.players[0].summonType).toBe("ancestor_warrior");
        expect(data.players[0].summonedBy).toBe(2);
        // Float durations are truncated via Math.floor to ensure integer ms
        expect(data.players[0].summonRemainingDurationMs).toBe(3750);

        expect(data.gold).toBe(0);
        expect(data.equipment).toEqual({
            1: {
                armor: null,
                leftHand: "largeBranch",
                rightHand: null,
                accessory1: null,
                accessory2: null,
            },
        });
        expect(data.inventory.items).toEqual([{ itemId: "loafOfBread", quantity: 3 }]);
        expect(data.hotbarAssignments?.[1]).toEqual(["Attack", null, null, "Skill", null]);
        expect(data.formationOrder).toEqual([1, 2]);
        expect(data.dialogTriggerProgress).toEqual({ coast: ["intro_1"] });
        expect(data.fogVisibilityByArea).toEqual({
            coast: [[0, 1], [2, 2]],
        });
        expect(data.lastWaystone).toEqual({
            areaId: "forest",
            waystoneIndex: 2,
        });
    });

    it("rejects saves created by newer versions", () => {
        const parsed = parseSaveSlotData(createMinimalValidRawSave({ version: 999 }));

        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.code).toBe("version_unsupported");
        }
    });

    it("normalizes slots to fixed length and nulls invalid entries", () => {
        const slots = normalizeSlots([
            createMinimalValidRawSave(),
            { bad: true },
            null,
        ]);

        expect(slots).toHaveLength(MAX_SLOTS);
        expect(slots[0]).not.toBeNull();
        expect(slots[1]).toBeNull();
        expect(slots[2]).toBeNull();
    });

    it("deduplicates repeated player ids to avoid duplicate units on load", () => {
        const parsed = parseSaveSlotData(createMinimalValidRawSave({
            players: [
                { id: 1, hp: 10, level: 2 },
                { id: 1, hp: 1, level: 99 },
                { id: 8, hp: 12, summonType: "vishas_eye_orb", summonedBy: 6 },
                { id: 8, hp: 4, summonType: "vishas_eye_orb", summonedBy: 2 },
            ],
        }));

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.data.players).toEqual([
            { id: 1, hp: 10, level: 2 },
            { id: 8, hp: 12, summonType: "vishas_eye_orb", summonedBy: 6 },
        ]);
    });
});
