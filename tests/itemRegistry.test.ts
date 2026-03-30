import { beforeEach, describe, expect, it } from "vitest";
import type { Item } from "../src/core/types";
import {
    getAllItemDefinitions,
    getDefaultItemDefinitions,
    getItem,
    replaceItemRegistry,
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
        replaceItemRegistry(getDefaultItemDefinitions());
    });

    it("validates duplicate ids and missing fallback weapon", () => {
        const defaultsWithoutFist = getAllItemDefinitions().filter(item => item.id !== "fist");
        const duplicate = cloneItem(defaultsWithoutFist[0]);
        const errors = validateItemRegistry([...defaultsWithoutFist, duplicate]);

        expect(errors.some(error => error.includes("Duplicate item id"))).toBe(true);
        expect(errors.some(error => error.includes("fallback weapon"))).toBe(true);
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

    it("returns default item snapshots as independent clones", () => {
        const defaultsA = getDefaultItemDefinitions();
        const defaultsB = getDefaultItemDefinitions();

        expect(defaultsA.length).toBeGreaterThan(0);
        defaultsA[0].name = "Mutated Name";

        expect(defaultsB[0].name).not.toBe("Mutated Name");
    });
});
