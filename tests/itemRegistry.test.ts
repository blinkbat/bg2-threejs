import { beforeEach, describe, expect, it } from "vitest";
import type { Item } from "../src/core/types";
import {
    getAllItemDefinitions,
    getDefaultItemDefinitions,
    getItem,
    removeItemDefinition,
    replaceItemRegistry,
    resetItemRegistryToDefaults,
    upsertItemDefinition,
    validateItemRegistry,
} from "../src/game/items";

function cloneItem(item: Item): Item {
    if (item.category === "weapon") {
        return { ...item, damage: [item.damage[0], item.damage[1]] };
    }
    return { ...item };
}

describe("item registry", () => {
    beforeEach(() => {
        resetItemRegistryToDefaults();
    });

    it("validates duplicate ids and missing fallback weapon", () => {
        const defaultsWithoutFist = getAllItemDefinitions().filter(item => item.id !== "fist");
        const duplicate = cloneItem(defaultsWithoutFist[0]);
        const errors = validateItemRegistry([...defaultsWithoutFist, duplicate]);

        expect(errors.some(error => error.includes("Duplicate item id"))).toBe(true);
        expect(errors.some(error => error.includes("fallback weapon"))).toBe(true);
    });

    it("applies valid upserts and allows category changes for an item id", () => {
        const weaponErrors = upsertItemDefinition({
            id: "editorTestItem",
            name: "Editor Test Blade",
            description: "Temporary item for unit tests.",
            category: "weapon",
            grip: "oneHand",
            damage: [2, 5],
            damageType: "physical",
        });
        expect(weaponErrors).toEqual([]);

        const weapon = getItem("editorTestItem");
        expect(weapon?.category).toBe("weapon");

        const keyErrors = upsertItemDefinition({
            id: "editorTestItem",
            name: "Editor Test Key",
            description: "Same id, different category.",
            category: "key",
            keyId: "editor_test_key",
        });
        expect(keyErrors).toEqual([]);

        const key = getItem("editorTestItem");
        expect(key?.category).toBe("key");
    });

    it("does not mutate live registry when replacement payload is invalid", () => {
        const validReplacement = getAllItemDefinitions();
        validReplacement.push({
            id: "editorPotion",
            name: "Editor Potion",
            description: "Consumable added by test.",
            category: "consumable",
            effect: "heal",
            value: 12,
            cooldown: 3000,
        });

        const validErrors = replaceItemRegistry(validReplacement);
        expect(validErrors).toEqual([]);
        expect(getItem("editorPotion")?.category).toBe("consumable");

        const invalidReplacement = validReplacement.filter(item => item.id !== "fist");
        const invalidErrors = replaceItemRegistry(invalidReplacement);
        expect(invalidErrors.some(error => error.includes("fallback weapon"))).toBe(true);

        // Previous valid state should still be active.
        expect(getItem("editorPotion")?.category).toBe("consumable");
        expect(getItem("fist")?.category).toBe("weapon");
    });

    it("removes non-fallback items and blocks removal of fallback weapon", () => {
        const addErrors = upsertItemDefinition({
            id: "editorRemoveMe",
            name: "Editor Remove Me",
            description: "Disposable test item.",
            category: "accessory",
            bonusMaxHp: 1,
        });
        expect(addErrors).toEqual([]);
        expect(getItem("editorRemoveMe")).toBeDefined();

        const removeErrors = removeItemDefinition("editorRemoveMe");
        expect(removeErrors).toEqual([]);
        expect(getItem("editorRemoveMe")).toBeUndefined();

        const fallbackRemoveErrors = removeItemDefinition("fist");
        expect(fallbackRemoveErrors.some(error => error.includes("Cannot remove fallback item"))).toBe(true);
    });

    it("returns default item snapshots as independent clones", () => {
        const defaultsA = getDefaultItemDefinitions();
        const defaultsB = getDefaultItemDefinitions();

        expect(defaultsA.length).toBeGreaterThan(0);
        defaultsA[0].name = "Mutated Name";

        expect(defaultsB[0].name).not.toBe("Mutated Name");
    });
});
