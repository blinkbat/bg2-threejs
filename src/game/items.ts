// =============================================================================
// ITEM DEFINITIONS - All game items
// =============================================================================

import type { Item, WeaponItem, ShieldItem, ArmorItem, AccessoryItem, ConsumableItem, KeyItem } from "../core/types";

// =============================================================================
// WEAPONS
// =============================================================================

export const WEAPONS: Record<string, WeaponItem> = {
    fist: {
        id: "fist",
        name: "Fist",
        description: "An unarmed strike.",
        category: "weapon",
        grip: "oneHand",
        damage: [1, 4],
        damageType: "physical",
    },
    largeBranch: {
        id: "largeBranch",
        name: "Large Branch",
        description: "A thick, gnarled branch. Heavy but effective.",
        category: "weapon",
        grip: "twoHand",
        damage: [4, 8],
        damageType: "physical",
    },
    tarnishedChime: {
        id: "tarnishedChime",
        name: "Tarnished Chime",
        description: "A holy chime, tarnished by age but still resonant. Channels holy bolts.",
        category: "weapon",
        grip: "oneHand",
        damage: [2, 4],
        damageType: "holy",
        range: 7,
        projectileColor: "#ffffaa",
    },
    woodenWand: {
        id: "woodenWand",
        name: "Wooden Wand",
        description: "A simple wand carved from an old oak.",
        category: "weapon",
        grip: "oneHand",
        damage: [1, 5],
        damageType: "chaos",
        range: 6,
        projectileColor: "#ff6600",
    },
    bowAndQuiver: {
        id: "bowAndQuiver",
        name: "Bow and Quiver",
        description: "A serviceable shortbow with a quiver of arrows.",
        category: "weapon",
        grip: "twoHand",
        damage: [2, 4],
        damageType: "physical",
        range: 9,
        projectileColor: "#a0522d",
    },
    bentSceptre: {
        id: "bentSceptre",
        name: "Bent Sceptre",
        description: "A ceremonial sceptre, slightly bent from use.",
        category: "weapon",
        grip: "oneHand",
        damage: [3, 6],
        damageType: "physical",
    },
    battleaxe: {
        id: "battleaxe",
        name: "Battleaxe",
        description: "A heavy axe forged for war. Cleaves through armor.",
        category: "weapon",
        grip: "twoHand",
        damage: [5, 12],
        damageType: "physical",
    },
};

// =============================================================================
// SHIELDS
// =============================================================================

export const SHIELDS: Record<string, ShieldItem> = {
    buckler: {
        id: "buckler",
        name: "Buckler",
        description: "A small, round shield. Light but protective.",
        category: "shield",
        armor: 1,
    },
    crestShield: {
        id: "crestShield",
        name: "Crest Shield",
        description: "A sturdy shield bearing a faded family crest.",
        category: "shield",
        armor: 2,
    },
};

// =============================================================================
// ARMOR
// =============================================================================

export const ARMORS: Record<string, ArmorItem> = {
    desertGi: {
        id: "desertGi",
        name: "Desert Gi",
        description: "Light cloth armor worn by desert monks. Allows freedom of movement.",
        category: "armor",
        armor: 2,
    },
};

// =============================================================================
// ACCESSORIES
// =============================================================================

export const ACCESSORIES: Record<string, AccessoryItem> = {
    ringOfTheDrakeling: {
        id: "ringOfTheDrakeling",
        name: "Ring of the Drakeling",
        description: "A ring imbued with faint draconic power. Increases magic damage slightly.",
        category: "accessory",
        bonusMagicDamage: 1,
    },
    nightpawsRing: {
        id: "nightpawsRing",
        name: "Nightpaw's Ring",
        description: "A shadowy ring that makes the wearer less noticeable to enemies.",
        category: "accessory",
        aggroReduction: 0.3,
    },
    mudwormsRing: {
        id: "mudwormsRing",
        name: "Mudworm's Ring",
        description: "A slimy ring that grants the wearer increased vitality.",
        category: "accessory",
        bonusMaxHp: 5,
    },
    ringOfTheSapling: {
        id: "ringOfTheSapling",
        name: "Ring of the Sapling",
        description: "A wooden ring that slowly mends the wearer's wounds.",
        category: "accessory",
        hpRegen: 1,
        hpRegenInterval: 10000,  // 1 HP every 10 seconds
    },
    quickfoxRing: {
        id: "quickfoxRing",
        name: "Quickfox Ring",
        description: "A silver ring etched with fox motifs. The wearer moves with uncanny swiftness.",
        category: "accessory",
        bonusMoveSpeed: 0.1,  // +10% move speed
    },
};

// =============================================================================
// KEYS
// =============================================================================

export const KEYS: Record<string, KeyItem> = {
    sulliedBronzeKey: {
        id: "sulliedBronzeKey",
        name: "Sullied Bronze Key",
        description: "An old bronze key, tarnished and pitted with age. It might still open something.",
        category: "key",
        keyId: "bronzeKey",
    },
};

// =============================================================================
// CONSUMABLES
// =============================================================================

export const CONSUMABLES: Record<string, ConsumableItem> = {
    smallManaPotion: {
        id: "smallManaPotion",
        name: "Glowfly Tear Vial",
        description: "A small vial of blue liquid. Restores mana.",
        category: "consumable",
        effect: "mana",
        value: 15,
        cooldown: 5000,
        sound: "gulp",
    },
    blightberry: {
        id: "blightberry",
        name: "Blightberry",
        description: "A bitter berry that purges poison and hardens the body against it.",
        category: "consumable",
        effect: "cleanse",
        value: 0,
        cooldown: 5000,
        sound: "crunch",
    },
    broodmotherLiver: {
        id: "broodmotherLiver",
        name: "Broodmother Liver",
        description: "Dense and nutrient-rich. Restores health, but it can turn your stomach.",
        category: "consumable",
        effect: "heal",
        value: 20,
        cooldown: 5000,
        sound: "crunch",
        poisonChanceOnUse: 15,
        poisonDamageOnUse: 2,
    },
    loafOfBread: {
        id: "loafOfBread",
        name: "Crust of Bread",
        description: "A simple piece of bread. Restores a small amount of health.",
        category: "consumable",
        effect: "heal",
        value: 8,
        cooldown: 5000,
        sound: "crunch",
    },
    stripOfBatJerky: {
        id: "stripOfBatJerky",
        name: "Strip of Bat Jerky",
        description: "Dried bat meat. Chewy but nutritious.",
        category: "consumable",
        effect: "heal",
        value: 15,
        cooldown: 5000,
        sound: "crunch",
    },
    krakenFilet: {
        id: "krakenFilet",
        name: "Kraken Filet",
        description: "A thick cut of sea-beast meat. Restores a large amount of health.",
        category: "consumable",
        effect: "heal",
        value: 30,
        cooldown: 5000,
        sound: "crunch",
    },
    scrollOfLearning: {
        id: "scrollOfLearning",
        name: "Scroll of Learning",
        description: "Ancient knowledge inscribed on vellum. Grants 50 experience to one party member.",
        category: "consumable",
        effect: "exp",
        value: 50,
        cooldown: 0,
    },
    tomeOfKnowledge: {
        id: "tomeOfKnowledge",
        name: "Tome of Knowledge",
        description: "A heavy folio of battle lore. Grants 100 experience to one party member.",
        category: "consumable",
        effect: "exp",
        value: 100,
        cooldown: 0,
    },
    woodenAnkh: {
        id: "woodenAnkh",
        name: "Wooden Ankh",
        description: "A crude ankh carved from sacred wood. Revives a fallen ally to 1 HP.",
        category: "consumable",
        effect: "revive",
        value: 1,
        cooldown: 5000,
        targetType: "dead_ally",
    },
};

// =============================================================================
// ITEM REGISTRY - All items by ID
// =============================================================================

export const ITEMS: Record<string, Item> = {
    ...WEAPONS,
    ...SHIELDS,
    ...ARMORS,
    ...ACCESSORIES,
    ...KEYS,
    ...CONSUMABLES,
};

/** Get an item by ID. Returns undefined if not found. */
export function getItem(itemId: string): Item | undefined {
    return ITEMS[itemId];
}

/** Get an item by ID. Throws if not found. */
export function getItemOrThrow(itemId: string): Item {
    const item = ITEMS[itemId];
    if (!item) {
        throw new Error(`Item not found: ${itemId}`);
    }
    return item;
}
