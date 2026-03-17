import { describe, expect, it } from "vitest";
import { formatRolledEnemyLootSummary } from "../src/game/enemyLoot";

describe("enemyLoot", () => {
    it("formats a loot summary with gold and resolved item names", () => {
        const summary = formatRolledEnemyLootSummary(
            { gold: 12, items: ["smallManaPotion"] },
            itemId => itemId === "smallManaPotion" ? "Small Mana Potion" : undefined
        );

        expect(summary).toBe("Loot dropped: 12 gold, Small Mana Potion");
    });

    it("returns null when the rolled loot is empty", () => {
        const summary = formatRolledEnemyLootSummary(
            { gold: 0, items: [] },
            () => undefined
        );

        expect(summary).toBeNull();
    });
});
