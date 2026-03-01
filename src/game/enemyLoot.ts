import type { EnemyType } from "../core/types";

export interface RolledEnemyLoot {
    gold: number;
    items: string[];
}

type GoldTier = "small" | "medium" | "large";

interface GoldLootSlot {
    kind: "gold";
    tier: GoldTier;
    chance: number;
}

interface ItemLootSlot {
    kind: "item";
    itemId: string;
    chance: number;
}

interface ItemPoolLootSlot {
    kind: "itemPool";
    itemIds: readonly string[];
    chance: number;
}

type LootSlot = GoldLootSlot | ItemLootSlot | ItemPoolLootSlot;

const GOLD_RANGES: Record<GoldTier, { min: number; max: number }> = {
    small: { min: 3, max: 7 },
    medium: { min: 8, max: 15 },
    large: { min: 16, max: 28 }
};

const HEALING_ITEM_POOL = ["loafOfBread", "stripOfBatJerky", "broodmotherLiver"] as const;

const ENEMY_LOOT_SLOTS: Partial<Record<EnemyType, readonly LootSlot[]>> = {
    acid_slug: [
        { kind: "gold", tier: "small", chance: 0.28 }
    ],
    armored_crab: [
        { kind: "item", itemId: "tomeOfKnowledge", chance: 0.34 }
    ],
    bat: [
        { kind: "item", itemId: "stripOfBatJerky", chance: 0.20 }
    ],
    baby_kraken: [
        { kind: "gold", tier: "large", chance: 0.46 },
        { kind: "item", itemId: "tomeOfKnowledge", chance: 0.34 },
        { kind: "item", itemId: "krakenFilet", chance: 0.28 }
    ],
    corrupt_druid: [
        { kind: "itemPool", itemIds: HEALING_ITEM_POOL, chance: 0.36 },
        { kind: "gold", tier: "medium", chance: 0.34 }
    ],
    feral_hound: [
        { kind: "item", itemId: "loafOfBread", chance: 0.20 },
        { kind: "item", itemId: "blightberry", chance: 0.14 }
    ],
    giant_amoeba: [
        { kind: "item", itemId: "blightberry", chance: 0.14 }
    ],
    kobold: [
        { kind: "gold", tier: "small", chance: 0.22 },
        { kind: "item", itemId: "stripOfBatJerky", chance: 0.16 }
    ],
    kobold_archer: [
        { kind: "item", itemId: "blightberry", chance: 0.20 }
    ],
    kobold_witch_doctor: [
        { kind: "item", itemId: "smallManaPotion", chance: 0.24 },
        { kind: "gold", tier: "medium", chance: 0.28 }
    ],
    undead_knight: [
        { kind: "item", itemId: "tomeOfKnowledge", chance: 0.42 }
    ]
};

function rollInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: readonly T[]): T {
    return items[rollInt(0, items.length - 1)];
}

function resolveSlotLoot(slot: LootSlot): RolledEnemyLoot {
    if (slot.kind === "gold") {
        const { min, max } = GOLD_RANGES[slot.tier];
        return { gold: rollInt(min, max), items: [] };
    }
    if (slot.kind === "item") {
        return { gold: 0, items: [slot.itemId] };
    }
    return { gold: 0, items: [pickRandom(slot.itemIds)] };
}

/**
 * Roll loot from an enemy drop table.
 * Each slot is rolled independently, but at most one successful slot is selected.
 */
export function rollEnemyLoot(enemyType: EnemyType | undefined): RolledEnemyLoot | null {
    if (!enemyType) return null;
    const slots = ENEMY_LOOT_SLOTS[enemyType];
    if (!slots || slots.length === 0) return null;

    const successfulSlots: LootSlot[] = [];
    for (const slot of slots) {
        if (Math.random() < slot.chance) {
            successfulSlots.push(slot);
        }
    }

    if (successfulSlots.length === 0) return null;

    const selectedSlot = pickRandom(successfulSlots);
    const rolledLoot = resolveSlotLoot(selectedSlot);
    if (rolledLoot.gold <= 0 && rolledLoot.items.length === 0) return null;
    return rolledLoot;
}
