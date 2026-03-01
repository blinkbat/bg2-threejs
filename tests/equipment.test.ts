import { describe, expect, it } from "vitest";
import type { CharacterEquipment, PartyInventory } from "../src/core/types";
import {
    addToInventory,
    canEquipInSlot,
    equipItem,
    getComputedStats,
    getEquipmentArmor,
    getInventoryQuantity,
    hasInInventory,
    removeFromInventory,
} from "../src/game/equipment";
import { getItem } from "../src/game/items";

function createEquipment(overrides: Partial<CharacterEquipment> = {}): CharacterEquipment {
    return {
        armor: null,
        leftHand: null,
        rightHand: null,
        accessory1: null,
        accessory2: null,
        ...overrides,
    };
}

function createInventory(items: PartyInventory["items"] = []): PartyInventory {
    return { items };
}

describe("equipment", () => {
    it("rejects off-hand equip while a two-hand weapon is equipped", () => {
        const equipment = createEquipment({ leftHand: "largeBranch" });
        const inventory = createInventory([{ itemId: "crestShield", quantity: 1 }]);

        const result = equipItem(equipment, inventory, "crestShield", "rightHand");

        expect(result).toBeNull();
        expect(equipment.rightHand).toBeNull();
        expect(getInventoryQuantity(inventory, "crestShield")).toBe(1);
    });

    it("equipping a two-hand weapon unequips right-hand item back to inventory", () => {
        const equipment = createEquipment({
            leftHand: "bentSceptre",
            rightHand: "crestShield",
        });
        const inventory = createInventory([{ itemId: "largeBranch", quantity: 1 }]);

        const result = equipItem(equipment, inventory, "largeBranch", "leftHand");

        expect(result).not.toBeNull();
        if (!result) return;
        expect(result.equipment.leftHand).toBe("largeBranch");
        expect(result.equipment.rightHand).toBeNull();
        expect(getInventoryQuantity(result.inventory, "largeBranch")).toBe(0);
        expect(getInventoryQuantity(result.inventory, "crestShield")).toBe(1);
    });

    it("validates item categories against equipment slots", () => {
        const loaf = getItem("loafOfBread");
        const branch = getItem("largeBranch");
        const shield = getItem("crestShield");

        expect(loaf).toBeDefined();
        expect(branch).toBeDefined();
        expect(shield).toBeDefined();
        if (!loaf || !branch || !shield) return;

        expect(canEquipInSlot(loaf, "leftHand")).toBe(false);
        expect(canEquipInSlot(branch, "leftHand")).toBe(true);
        expect(canEquipInSlot(branch, "rightHand")).toBe(false);
        expect(canEquipInSlot(shield, "rightHand")).toBe(true);
        expect(canEquipInSlot(shield, "leftHand")).toBe(false);
    });

    it("ignores shield armor when off-hand is disabled by two-hand weapon", () => {
        const twoHanded = createEquipment({
            armor: "desertGi",
            leftHand: "largeBranch",
            rightHand: "crestShield",
        });
        const oneHanded = createEquipment({
            armor: "desertGi",
            leftHand: "bentSceptre",
            rightHand: "crestShield",
        });

        expect(getEquipmentArmor(twoHanded)).toBe(2);
        expect(getEquipmentArmor(oneHanded)).toBe(4);
    });

    it("computes weapon/accessory derived stats", () => {
        const equipment = createEquipment({
            leftHand: "woodenWand",
            accessory1: "ringOfTheDrakeling",
            accessory2: "nightpawsRing",
        });

        const stats = getComputedStats(equipment);

        expect(stats.damageType).toBe("chaos");
        expect(stats.range).toBe(6);
        expect(stats.projectileColor).toBe("#ff6600");
        expect(stats.bonusMagicDamage).toBe(1);
        expect(stats.aggroMultiplier).toBeCloseTo(0.7, 6);
        expect(stats.moveSpeedMultiplier).toBe(1);
    });

    it("stacks and removes inventory entries correctly", () => {
        const start = createInventory([{ itemId: "loafOfBread", quantity: 1 }]);
        const added = addToInventory(start, "loafOfBread", 2);
        const afterSingleRemoval = removeFromInventory(added, "loafOfBread", 1);
        const afterFinalRemoval = removeFromInventory(afterSingleRemoval, "loafOfBread", 2);

        expect(hasInInventory(added, "loafOfBread", 3)).toBe(true);
        expect(getInventoryQuantity(afterSingleRemoval, "loafOfBread")).toBe(2);
        expect(getInventoryQuantity(afterFinalRemoval, "loafOfBread")).toBe(0);
    });
});
