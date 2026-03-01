import { beforeEach, describe, expect, it } from "vitest";
import type { CharacterEquipment, PartyInventory } from "../src/core/types";
import {
    equipItemForCharacter,
    getCharacterEquipment,
    getPartyInventory,
    initializeEquipmentState,
    moveEquippedItemForCharacter,
    setCharacterEquipment,
    setPartyInventory,
    unequipItemForCharacter
} from "../src/game/equipmentState";

const EMPTY_EQUIPMENT: CharacterEquipment = {
    armor: null,
    leftHand: null,
    rightHand: null,
    accessory1: null,
    accessory2: null
};

function inventoryWith(itemId: string, quantity: number): PartyInventory {
    return { items: [{ itemId, quantity }] };
}

function getQuantity(itemId: string): number {
    const entry = getPartyInventory().items.find(i => i.itemId === itemId);
    return entry?.quantity ?? 0;
}

describe("equipment transactions", () => {
    beforeEach(() => {
        initializeEquipmentState();
        setCharacterEquipment(1, { ...EMPTY_EQUIPMENT });
        setPartyInventory({ items: [] });
    });

    it("equips from inventory and consumes exactly one item", () => {
        setPartyInventory(inventoryWith("mudwormsRing", 1));

        const transaction = equipItemForCharacter(1, "mudwormsRing", "accessory1");

        expect(transaction).not.toBeNull();
        expect(getCharacterEquipment(1).accessory1).toBe("mudwormsRing");
        expect(getQuantity("mudwormsRing")).toBe(0);
    });

    it("unequips to inventory and clears the slot", () => {
        setCharacterEquipment(1, { ...EMPTY_EQUIPMENT, accessory1: "mudwormsRing" });

        const transaction = unequipItemForCharacter(1, "accessory1");

        expect(transaction).not.toBeNull();
        expect(getCharacterEquipment(1).accessory1).toBeNull();
        expect(getQuantity("mudwormsRing")).toBe(1);
    });

    it("moves equipped item between valid slots without touching inventory", () => {
        setCharacterEquipment(1, { ...EMPTY_EQUIPMENT, accessory1: "mudwormsRing" });
        setPartyInventory(inventoryWith("loafOfBread", 2));
        const inventoryBefore = getPartyInventory();

        const transaction = moveEquippedItemForCharacter(1, "accessory1", "accessory2");

        expect(transaction).not.toBeNull();
        const equipment = getCharacterEquipment(1);
        expect(equipment.accessory1).toBeNull();
        expect(equipment.accessory2).toBe("mudwormsRing");
        expect(getPartyInventory()).toEqual(inventoryBefore);
    });

    it("does not mutate equipment/inventory when move destination is invalid", () => {
        const initialEquipment: CharacterEquipment = { ...EMPTY_EQUIPMENT, accessory1: "mudwormsRing" };
        const initialInventory: PartyInventory = inventoryWith("loafOfBread", 2);
        setCharacterEquipment(1, initialEquipment);
        setPartyInventory(initialInventory);

        const transaction = moveEquippedItemForCharacter(1, "accessory1", "leftHand");

        expect(transaction).toBeNull();
        expect(getCharacterEquipment(1)).toEqual(initialEquipment);
        expect(getPartyInventory()).toEqual(initialInventory);
    });
});

