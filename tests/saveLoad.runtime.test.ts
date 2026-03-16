import { describe, expect, it } from "vitest";
import type { CharacterEquipment, PartyInventory } from "../src/core/types";
import type { SaveSlotData } from "../src/game/saveLoad";
import {
    buildSaveSlotData,
    normalizeDialogTriggerProgress,
    resolveLoadedSaveState,
    type SaveSnapshotState,
} from "../src/game/saveLoad";

function createEquipmentMap(): Record<number, CharacterEquipment> {
    return {
        1: {
            armor: null,
            leftHand: "largeBranch",
            rightHand: null,
            accessory1: null,
            accessory2: null,
        },
    };
}

function createInventory(): PartyInventory {
    return {
        items: [{ itemId: "loafOfBread", quantity: 2 }],
    };
}

function createState(): SaveSnapshotState {
    return {
        players: [{ id: 1, hp: 12, level: 2, exp: 40 }],
        currentAreaId: "coast",
        openedChests: new Set(["coast-1"]),
        openedSecretDoors: new Set(["coast-s1"]),
        killedEnemies: new Set(["coast-2"]),
        gold: 25,
        hotbarAssignments: { 1: ["Attack", null, null, null, null] },
        formationOrder: [1, 2, 3],
        dialogTriggerProgress: { coast: ["intro_1", "intro_1"] },
        enemyPositions: {},
        fogVisibilityByArea: {
            coast: [[0, 1], [2, 2]],
            forest: [[1, 0], [0, 1]],
        },
    };
}

describe("saveLoad runtime", () => {
    it("normalizes dialog trigger progress by trimming and de-duplicating", () => {
        const normalized = normalizeDialogTriggerProgress({
            " coast ": [" intro ", "intro", "", " next "],
            "   ": ["ignored"],
            forest: [],
        });

        expect(normalized).toEqual({
            coast: ["intro", "next"],
        });
    });

    it("builds deep-cloned save slot data and normalizes trigger progress", () => {
        const state = createState();
        const equipment = createEquipmentMap();
        const inventory = createInventory();

        const slot = buildSaveSlotData({
            timestamp: 111,
            slotName: "slot-a",
            state,
            equipment,
            inventory,
        });

        state.players[0].hp = 1;
        state.openedChests.add("coast-99");
        state.hotbarAssignments[1][0] = "Changed";
        state.fogVisibilityByArea.coast[0][1] = 2;
        equipment[1].leftHand = "battleaxe";
        inventory.items[0].quantity = 99;

        expect(slot.players[0].hp).toBe(12);
        expect(slot.openedChests).toEqual(["coast-1"]);
        expect(slot.hotbarAssignments?.[1][0]).toBe("Attack");
        expect(slot.fogVisibilityByArea).toEqual({
            coast: [[0, 1], [2, 2]],
            forest: [[1, 0], [0, 1]],
        });
        expect(slot.equipment[1].leftHand).toBe("largeBranch");
        expect(slot.inventory.items[0].quantity).toBe(2);
        expect(slot.dialogTriggerProgress).toEqual({ coast: ["intro_1"] });
    });

    it("returns unknown_area when loading a save for an unregistered area", () => {
        const data: SaveSlotData = {
            version: 1,
            timestamp: 1,
            slotName: "slot",
            players: [{ id: 1, hp: 10 }],
            currentAreaId: "missing_area",
            openedChests: [],
            openedSecretDoors: [],
            killedEnemies: [],
            gold: 0,
            equipment: createEquipmentMap(),
            inventory: createInventory(),
        };

        const result = resolveLoadedSaveState(data, {});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("unknown_area");
        }
    });

    it("resolves loaded save state with cloned containers", () => {
        const input: SaveSlotData = {
            version: 1,
            timestamp: 1,
            slotName: "slot",
            players: [{ id: 1, hp: 10 }],
            currentAreaId: "coast",
            openedChests: ["coast-1"],
            openedSecretDoors: ["coast-s1"],
            killedEnemies: ["coast-2"],
            gold: 9,
            equipment: createEquipmentMap(),
            inventory: createInventory(),
            hotbarAssignments: { 1: ["Attack", null, null, null, null] },
            formationOrder: [1, 2],
            dialogTriggerProgress: { coast: ["intro_1", "intro_1"] },
            fogVisibilityByArea: {
                coast: [[0, 1], [2, 2]],
            },
        };

        const result = resolveLoadedSaveState(input, {
            coast: { defaultSpawn: { x: 4, z: 5 } },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.data.spawnPoint).toEqual({ x: 4, z: 5 });
        expect(result.data.openedChests).toEqual(new Set(["coast-1"]));
        expect(result.data.dialogTriggerProgress).toEqual({ coast: ["intro_1"] });

        input.players[0].hp = 1;
        input.equipment[1].leftHand = "battleaxe";
        input.inventory.items[0].quantity = 99;
        input.hotbarAssignments?.[1].splice(0, 1, "Changed");
        input.formationOrder?.push(99);
        input.dialogTriggerProgress?.coast?.push("new");
        input.fogVisibilityByArea?.coast?.[0].splice(0, 1, 2);

        expect(result.data.players[0].hp).toBe(10);
        expect(result.data.equipment[1].leftHand).toBe("largeBranch");
        expect(result.data.inventory.items[0].quantity).toBe(2);
        expect(result.data.hotbarAssignments?.[1][0]).toBe("Attack");
        expect(result.data.formationOrder).toEqual([1, 2]);
        expect(result.data.dialogTriggerProgress).toEqual({ coast: ["intro_1"] });
        expect(result.data.fogVisibilityByArea).toEqual({
            coast: [[0, 1], [2, 2]],
        });
    });
});
