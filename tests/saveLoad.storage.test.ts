import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MAX_SLOTS,
    STORAGE_KEY,
    getSaveSlots,
    loadGame,
    resolveLoadedSaveState,
    saveGame,
    type SaveSlotData,
} from "../src/game/saveLoad";

class LocalStorageMock {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.has(key) ? (this.values.get(key) ?? null) : null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    clear(): void {
        this.values.clear();
    }
}

const localStorageMock = new LocalStorageMock();

function createValidSaveData(overrides: Partial<SaveSlotData> = {}): SaveSlotData {
    const saveData: SaveSlotData = {
        version: 1,
        timestamp: 123456789,
        slotName: "Test Slot",
        players: [{ id: 1, hp: 20, level: 2, exp: 100 }],
        currentAreaId: "coast",
        openedChests: ["coast-1"],
        openedSecretDoors: ["coast-secret-1"],
        activatedWaystones: ["coast-waystone-0"],
        killedEnemies: ["coast-3"],
        gold: 45,
        equipment: {
            1: {
                armor: null,
                leftHand: "largeBranch",
                rightHand: null,
                accessory1: null,
                accessory2: null,
            },
        },
        inventory: {
            items: [{ itemId: "loafOfBread", quantity: 2 }],
        },
        hotbarAssignments: {
            1: ["Attack", null, null, null, null],
        },
        formationOrder: [1, 2, 3, 4, 5, 6],
        dialogTriggerProgress: {
            coast: ["intro_1"],
        },
        fogVisibilityByArea: {
            coast: [[0, 1], [2, 2]],
        },
        ...overrides,
    };

    saveData.activatedWaystones = overrides.activatedWaystones ?? ["coast-waystone-0"];
    return saveData;
}

beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
        value: localStorageMock,
        configurable: true,
        writable: true,
    });
});

beforeEach(() => {
    localStorageMock.clear();
});

describe("saveLoad storage", () => {
    it("returns normalized slots and drops invalid entries", () => {
        const valid = createValidSaveData();
        const invalid = { foo: "bar" };
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: [valid, invalid, null] }));

        const slots = getSaveSlots();

        expect(slots).toHaveLength(MAX_SLOTS);
        expect(slots[0]).not.toBeNull();
        expect(slots[1]).toBeNull();
        expect(slots[2]).toBeNull();
        expect(slots[0]?.fogVisibilityByArea).toEqual({
            coast: [[0, 1], [2, 2]],
        });
    });

    it("rejects newer save versions", () => {
        const newerVersion = createValidSaveData({ version: 999 });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: [newerVersion] }));

        const loaded = loadGame(0);

        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.code).toBe("version_unsupported");
        }
    });

    it("migrates and sanitizes malformed payload fields", () => {
        const rawSlot = {
            timestamp: 1,
            slotName: " Legacy Save ",
            players: [
                { id: 1, hp: 8, summonType: "ancestor_warrior", statusEffects: [{ type: "poison", duration: 5000 }] },
                { id: "bad", hp: "bad" },
            ],
            currentAreaId: "coast",
            openedChests: ["coast-0", 12, "coast-0"],
            openedSecretDoors: ["secret-1"],
            killedEnemies: ["coast-2"],
            gold: -10,
            equipment: {
                1: { leftHand: "largeBranch", rightHand: "", armor: null, accessory1: null, accessory2: null },
                x: { leftHand: "bad" },
            },
            inventory: {
                items: [
                    { itemId: "loafOfBread", quantity: 2 },
                    { itemId: "loafOfBread", quantity: 1 },
                    { itemId: "smallManaPotion", quantity: -1 },
                    { nope: true },
                ],
            },
            hotbarAssignments: {
                1: ["Attack", "", 12],
                x: ["bad"],
            },
            formationOrder: [3, 2, "x", 2],
            dialogTriggerProgress: {
                coast: ["intro_1", "intro_1"],
            },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: [rawSlot] }));

        const loaded = loadGame(0);

        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.data.version).toBe(1);
            expect(loaded.data.players).toHaveLength(1);
            expect(loaded.data.gold).toBe(0);
            expect(loaded.data.openedChests).toEqual(["coast-0"]);
            expect(loaded.data.inventory.items).toEqual([{ itemId: "loafOfBread", quantity: 3 }]);
            expect(loaded.data.formationOrder).toEqual([3, 2]);
            expect(loaded.data.hotbarAssignments?.[1]).toEqual(["Attack", null, null, null, null]);
            expect(loaded.data.dialogTriggerProgress?.coast).toEqual(["intro_1"]);
        }
    });

    it("returns invalid slot error for out of bounds saves", () => {
        const result = saveGame(8, createValidSaveData());

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("invalid_slot");
        }
    });

    it("rejects loading unknown areas at runtime resolution", () => {
        const result = resolveLoadedSaveState(createValidSaveData({ currentAreaId: "missing_area" }), {});

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("unknown_area");
        }
    });
});
