// =============================================================================
// ITEM DEFINITIONS - All game items
// =============================================================================

import type {
    Item,
    ItemCategory,
    EquipmentPassives,
    WeaponItem,
    ShieldItem,
    ArmorItem,
    AccessoryItem,
    ConsumableItem,
    KeyItem,
    DamageType,
    WeaponGrip,
    ConsumableSound
} from "../core/types";

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
        description: "A resonant chime, tarnished by age. Channels holy bolts.",
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
    boneSceptre: {
        id: "boneSceptre",
        name: "Bone Sceptre",
        description: "Carved from something that was once alive, and may still be.",
        category: "weapon",
        grip: "oneHand",
        damage: [4, 8],
        damageType: "chaos",
    },
    corpsemaker: {
        id: "corpsemaker",
        name: "Corpsemaker",
        description: "Forged in a siege camp from melted-down horseshoes. It has since found better use.",
        category: "weapon",
        grip: "twoHand",
        damage: [6, 14],
        damageType: "physical",
    },
    ashenLongbow: {
        id: "ashenLongbow",
        name: "Ashen Longbow",
        description: "The bowstring smolders faintly. Arrows char the air as they fly.",
        category: "weapon",
        grip: "twoHand",
        damage: [3, 6],
        damageType: "fire",
        range: 10,
        projectileColor: "#cc5522",
    },
    pilgrimsMace: {
        id: "pilgrimsMace",
        name: "Pilgrim's Mace",
        description: "Blessed by three temples and cursed by one. The blessings won.",
        category: "weapon",
        grip: "oneHand",
        damage: [3, 7],
        damageType: "holy",
    },
    staffOfThePaleCircuit: {
        id: "staffOfThePaleCircuit",
        name: "Staff of the Pale Circuit",
        description: "It hums in the rain. Wizards who carry it learn to love storms.",
        category: "weapon",
        grip: "twoHand",
        damage: [2, 5],
        damageType: "lightning",
        range: 7,
        projectileColor: "#aaccff",
    },
    widowsNeedle: {
        id: "widowsNeedle",
        name: "Widow's Needle",
        description: "Thin as a hatpin. The Thief's Guild calls it a 'letter opener' — and every letter says the same thing.",
        category: "weapon",
        grip: "oneHand",
        damage: [3, 5],
        damageType: "physical",
        attackCooldown: 1200,
    },
    vampiricBlade: {
        id: "vampiricBlade",
        name: "Vampiric Blade",
        description: "The edge weeps red even when clean. Wounds it inflicts mend wounds it has made.",
        category: "weapon",
        grip: "oneHand",
        damage: [4, 7],
        damageType: "physical",
        lifesteal: 0.15,
    },
    windcutterBow: {
        id: "windcutterBow",
        name: "Windcutter Bow",
        description: "Strung with sinew from something that flew. Arrows find their mark with unsettling enthusiasm.",
        category: "weapon",
        grip: "twoHand",
        damage: [3, 6],
        damageType: "physical",
        range: 10,
        projectileColor: "#88bbaa",
        bonusCritChance: 8,
        bonusMoveSpeed: 0.05,
    },
    emberStaff: {
        id: "emberStaff",
        name: "Ember Staff",
        description: "It smolders at the tip and warms the hand. The previous owner let go only reluctantly — and posthumously.",
        category: "weapon",
        grip: "twoHand",
        damage: [2, 5],
        damageType: "fire",
        range: 7,
        projectileColor: "#ff6622",
        bonusMagicDamage: 2,
        hpRegen: 1,
        hpRegenInterval: 8000,
    },
};

// =============================================================================
// SHIELDS
// =============================================================================

const SHIELDS: Record<string, ShieldItem> = {
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
    thornwallBuckler: {
        id: "thornwallBuckler",
        name: "Thornwall Buckler",
        description: "The brambles woven into its face are not decorative.",
        category: "shield",
        armor: 1,
    },
    towerShield: {
        id: "towerShield",
        name: "Tower Shield",
        description: "You can hide behind it. Most do.",
        category: "shield",
        armor: 4,
    },
    spikedPavise: {
        id: "spikedPavise",
        name: "Spiked Pavise",
        description: "Originally a siege barricade. Someone added a handle and a prayer.",
        category: "shield",
        armor: 3,
        bonusMaxHp: 5,
    },
    arcaneCrest: {
        id: "arcaneCrest",
        name: "Arcane Crest",
        description: "The sigils etched into its face pulse in time with the wielder's spellcraft.",
        category: "shield",
        armor: 1,
        bonusMaxMana: 3,
        bonusMagicDamage: 1,
    },
};

// =============================================================================
// ARMOR
// =============================================================================

const ARMORS: Record<string, ArmorItem> = {
    chainmailHauberk: {
        id: "chainmailHauberk",
        name: "Chainmail Hauberk",
        description: "Heavy and loud. You'll never sneak in it, but you'll live long enough not to care.",
        category: "armor",
        armor: 4,
    },
    desertGi: {
        id: "desertGi",
        name: "Desert Gi",
        description: "Light cloth armor worn by desert monks. Allows freedom of movement.",
        category: "armor",
        armor: 2,
    },
    leatherBrigandine: {
        id: "leatherBrigandine",
        name: "Leather Brigandine",
        description: "Layered leather plates riveted to canvas. A soldier's compromise between weight and protection.",
        category: "armor",
        armor: 3,
    },
    threadbareRobes: {
        id: "threadbareRobes",
        name: "Threadbare Robes",
        description: "The enchantment faded long ago, but the silk still turns a blade — barely.",
        category: "armor",
        armor: 1,
    },
    ironbarkPlate: {
        id: "ironbarkPlate",
        name: "Ironbark Plate",
        description: "Grown, not forged. The heartwood of an ancient ironbark tree, shaped by druids who never came back for it.",
        category: "armor",
        armor: 5,
        bonusMaxHp: 8,
    },
    emberwovenRobe: {
        id: "emberwovenRobe",
        name: "Emberwoven Robe",
        description: "Threaded with cinders that never cool. It smells faintly of campfire and ambition.",
        category: "armor",
        armor: 1,
        bonusMaxMana: 5,
        bonusMagicDamage: 1,
    },
    stalkersLeathers: {
        id: "stalkersLeathers",
        name: "Stalker's Leathers",
        description: "Oiled and silent. The previous owner was never seen — which was rather the point.",
        category: "armor",
        armor: 3,
        bonusCritChance: 5,
        bonusMoveSpeed: 0.08,
    },
};

// =============================================================================
// ACCESSORIES
// =============================================================================

const ACCESSORIES: Record<string, AccessoryItem> = {
    bloodstonePendant: {
        id: "bloodstonePendant",
        name: "Bloodstone Pendant",
        description: "The stone pulses faintly, in time with the wearer's heartbeat.",
        category: "accessory",
        bonusMaxHp: 10,
    },
    ironhideBangle: {
        id: "ironhideBangle",
        name: "Ironhide Bangle",
        description: "Dwarven metalwork. The runes say 'stand firm' — or possibly 'lunch is at noon.' The dialect is unclear.",
        category: "accessory",
        bonusArmor: 2,
    },
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
    blooddrinkersLoop: {
        id: "blooddrinkersLoop",
        name: "Blooddrinker's Loop",
        description: "It tightens when you bleed and loosens when your enemy does. The ring has preferences.",
        category: "accessory",
        lifesteal: 0.1,
    },
    sharpshootersBand: {
        id: "sharpshootersBand",
        name: "Sharpshooter's Band",
        description: "A thin copper band that makes the world seem slower and targets seem larger.",
        category: "accessory",
        bonusCritChance: 6,
    },
};

// =============================================================================
// KEYS
// =============================================================================

const KEYS: Record<string, KeyItem> = {
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

const CONSUMABLES: Record<string, ConsumableItem> = {
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
    dustyElixir: {
        id: "dustyElixir",
        name: "Dusty Elixir",
        description: "The label peeled off years ago. It tastes like regret and ozone.",
        category: "consumable",
        effect: "mana",
        value: 30,
        cooldown: 5000,
        sound: "gulp",
    },
    honeydFig: {
        id: "honeydFig",
        name: "Honeyed Fig",
        description: "Sweet and filling. A rare comfort in the wild.",
        category: "consumable",
        effect: "heal",
        value: 12,
        cooldown: 5000,
        sound: "crunch",
    },
    ironbarkTonic: {
        id: "ironbarkTonic",
        name: "Ironbark Tonic",
        description: "Brewed from boiled bark and swamp water. Effective, but the aftertaste lingers — in your stomach, violently.",
        category: "consumable",
        effect: "heal",
        value: 25,
        cooldown: 5000,
        sound: "gulp",
        poisonChanceOnUse: 30,
        poisonDamageOnUse: 3,
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
    campingKit: {
        id: "campingKit",
        name: "Camping Kit",
        description: "A bedroll, flint, and rations for a night under the stars. The party must be gathered and out of danger.",
        category: "consumable",
        effect: "camp",
        value: 0,
        cooldown: 2000,
    },
    waystoneFragment: {
        id: "waystoneFragment",
        name: "Waystone Fragment",
        description: "A shard of crystallized travel magic. Shatters to return the party to the last visited waystone.",
        category: "consumable",
        effect: "waystone_recall",
        value: 0,
        cooldown: 2000,
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

type ConsumableEffect = ConsumableItem["effect"];
type ConsumableTargetType = NonNullable<ConsumableItem["targetType"]>;

export const ITEM_CATEGORY_ORDER: readonly ItemCategory[] = ["consumable", "weapon", "shield", "armor", "accessory", "key"];
export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
    consumable: "Consumables",
    weapon: "Weapons",
    shield: "Shields",
    armor: "Armor",
    accessory: "Accessories",
    key: "Keys",
};

export const KNOWN_DAMAGE_TYPES: readonly DamageType[] = ["physical", "fire", "cold", "lightning", "chaos", "holy"];
export const KNOWN_WEAPON_GRIPS: readonly WeaponGrip[] = ["oneHand", "twoHand"];
export const KNOWN_CONSUMABLE_EFFECTS: readonly ConsumableEffect[] = ["heal", "mana", "exp", "revive", "cleanse", "camp", "waystone_recall"];
export const KNOWN_CONSUMABLE_SOUNDS: readonly ConsumableSound[] = ["gulp", "crunch"];
export const KNOWN_CONSUMABLE_TARGET_TYPES: readonly ConsumableTargetType[] = ["dead_ally"];

const VALID_DAMAGE_TYPES = new Set<string>(KNOWN_DAMAGE_TYPES);
const VALID_ITEM_CATEGORIES = new Set<string>(ITEM_CATEGORY_ORDER);
const VALID_WEAPON_GRIPS = new Set<string>(KNOWN_WEAPON_GRIPS);
const VALID_CONSUMABLE_EFFECTS = new Set<string>(KNOWN_CONSUMABLE_EFFECTS);
const VALID_CONSUMABLE_SOUNDS = new Set<string>(KNOWN_CONSUMABLE_SOUNDS);
const VALID_CONSUMABLE_TARGET_TYPES = new Set<string>(KNOWN_CONSUMABLE_TARGET_TYPES);
const ITEM_REGISTRY_STORAGE_VERSION = 1;
export const ITEM_REGISTRY_STORAGE_KEY = "bg2_item_registry_v1";

interface ItemCategoryGroup {
    category: ItemCategory;
    label: string;
    itemIds: string[];
}

interface ItemRegistryStoragePayload {
    version: number;
    items: unknown[];
}

const DEFAULT_ITEMS: Item[] = Object.values(ITEMS).map(cloneItemDefinition);

function cloneItemDefinition(item: Item): Item {
    if (item.category === "weapon") {
        return { ...item, damage: [item.damage[0], item.damage[1]] };
    }
    return { ...item };
}

function cloneItemList(items: Item[]): Item[] {
    return items.map(cloneItemDefinition);
}

function getBrowserStorage(): Storage | null {
    const maybeStorage = Reflect.get(globalThis, "localStorage");
    if (!maybeStorage || typeof maybeStorage !== "object") {
        return null;
    }
    if (typeof Reflect.get(maybeStorage, "getItem") !== "function") return null;
    if (typeof Reflect.get(maybeStorage, "setItem") !== "function") return null;
    if (typeof Reflect.get(maybeStorage, "removeItem") !== "function") return null;
    return maybeStorage as Storage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isItemCategory(value: unknown): value is ItemCategory {
    return typeof value === "string" && VALID_ITEM_CATEGORIES.has(value);
}

function isWeaponGripValue(value: unknown): value is WeaponGrip {
    return typeof value === "string" && VALID_WEAPON_GRIPS.has(value);
}

function isDamageTypeValue(value: unknown): value is DamageType {
    return typeof value === "string" && VALID_DAMAGE_TYPES.has(value);
}

function isConsumableEffectValue(value: unknown): value is ConsumableItem["effect"] {
    return typeof value === "string" && VALID_CONSUMABLE_EFFECTS.has(value);
}

function isConsumableSoundValue(value: unknown): value is ConsumableSound {
    return typeof value === "string" && VALID_CONSUMABLE_SOUNDS.has(value);
}

function isConsumableTargetTypeValue(value: unknown): value is ConsumableTargetType {
    return typeof value === "string" && VALID_CONSUMABLE_TARGET_TYPES.has(value);
}

function getItemCandidateLabel(value: unknown, index: number): string {
    if (!isRecord(value)) return `Item ${index + 1}`;
    return typeof value.id === "string" && value.id.trim().length > 0
        ? value.id
        : `Item ${index + 1}`;
}

const PASSIVE_FIELD_NAMES: (keyof EquipmentPassives)[] = [
    "bonusMaxHp", "bonusMaxMana", "bonusMagicDamage", "bonusArmor",
    "bonusCritChance", "bonusMoveSpeed", "lifesteal",
    "hpRegen", "hpRegenInterval", "aggroReduction",
];

/** Extract passive fields from a raw record, returning null if any field has a bad type. */
function parsePassiveFields(raw: Record<string, unknown>): Partial<EquipmentPassives> | null {
    const result: Partial<EquipmentPassives> = {};
    for (const key of PASSIVE_FIELD_NAMES) {
        const val = raw[key];
        if (val === undefined) continue;
        if (typeof val !== "number") return null;
        (result as Record<string, number>)[key] = val;
    }
    return result;
}

/** Validate passive fields on an equipment item. */
function validatePassiveFields(item: EquipmentPassives, label: string): string[] {
    const errors: string[] = [];
    if (item.bonusMaxHp !== undefined && !isNonNegativeNumber(item.bonusMaxHp)) {
        errors.push(`${label} bonus max HP must be a non-negative number.`);
    }
    if (item.bonusMaxMana !== undefined && !isNonNegativeNumber(item.bonusMaxMana)) {
        errors.push(`${label} bonus max mana must be a non-negative number.`);
    }
    if (item.bonusMagicDamage !== undefined && !isNonNegativeNumber(item.bonusMagicDamage)) {
        errors.push(`${label} bonus magic damage must be a non-negative number.`);
    }
    if (item.bonusArmor !== undefined && !isNonNegativeNumber(item.bonusArmor)) {
        errors.push(`${label} bonus armor must be a non-negative number.`);
    }
    if (item.bonusCritChance !== undefined && !isNonNegativeNumber(item.bonusCritChance)) {
        errors.push(`${label} bonus crit chance must be a non-negative number.`);
    }
    if (item.bonusMoveSpeed !== undefined && (!isNonNegativeNumber(item.bonusMoveSpeed) || item.bonusMoveSpeed > 1)) {
        errors.push(`${label} move speed bonus must be between 0 and 1.`);
    }
    if (item.lifesteal !== undefined && (!isNonNegativeNumber(item.lifesteal) || item.lifesteal > 1)) {
        errors.push(`${label} lifesteal must be between 0 and 1.`);
    }
    if (item.hpRegen !== undefined && !isPositiveNumber(item.hpRegen)) {
        errors.push(`${label} HP regen must be a positive number when provided.`);
    }
    if (item.hpRegenInterval !== undefined && !isPositiveNumber(item.hpRegenInterval)) {
        errors.push(`${label} HP regen interval must be a positive number when provided.`);
    }
    if ((item.hpRegen !== undefined) !== (item.hpRegenInterval !== undefined)) {
        errors.push(`${label} HP regen amount and interval must both be set together.`);
    }
    if (item.aggroReduction !== undefined && (!isNonNegativeNumber(item.aggroReduction) || item.aggroReduction > 1)) {
        errors.push(`${label} aggro reduction must be between 0 and 1.`);
    }
    return errors;
}

function parseItemCandidate(value: unknown): Item | null {
    if (!isRecord(value)) return null;

    const { id, name, description, category } = value;
    if (typeof id !== "string" || typeof name !== "string" || typeof description !== "string" || !isItemCategory(category)) {
        return null;
    }

    if (category === "weapon") {
        const { grip, damage, damageType, range, projectileColor, attackCooldown } = value;
        if (!isWeaponGripValue(grip) || !Array.isArray(damage) || damage.length !== 2) return null;
        const [minDamage, maxDamage] = damage;
        if (typeof minDamage !== "number" || typeof maxDamage !== "number" || !isDamageTypeValue(damageType)) return null;
        if (range !== undefined && typeof range !== "number") return null;
        if (projectileColor !== undefined && typeof projectileColor !== "string") return null;
        if (attackCooldown !== undefined && typeof attackCooldown !== "number") return null;
        const passives = parsePassiveFields(value);
        if (!passives) return null;
        const item: WeaponItem = {
            id,
            name,
            description,
            category,
            grip,
            damage: [minDamage, maxDamage],
            damageType,
            ...(range !== undefined ? { range } : {}),
            ...(projectileColor !== undefined ? { projectileColor } : {}),
            ...(attackCooldown !== undefined ? { attackCooldown } : {}),
            ...passives,
        };
        return item;
    }

    if (category === "shield" || category === "armor") {
        const { armor } = value;
        if (typeof armor !== "number") return null;
        const passives = parsePassiveFields(value);
        if (!passives) return null;
        if (category === "shield") {
            const item: ShieldItem = { id, name, description, category, armor, ...passives };
            return item;
        }
        const item: ArmorItem = { id, name, description, category, armor, ...passives };
        return item;
    }

    if (category === "accessory") {
        const passives = parsePassiveFields(value);
        if (!passives) return null;
        const item: AccessoryItem = {
            id,
            name,
            description,
            category,
            ...passives,
        };
        return item;
    }

    if (category === "key") {
        const { keyId } = value;
        if (typeof keyId !== "string") return null;
        const item: KeyItem = { id, name, description, category, keyId };
        return item;
    }

    const {
        effect,
        value: consumableValue,
        cooldown,
        sound,
        targetType,
        poisonChanceOnUse,
        poisonDamageOnUse,
    } = value;
    if (!isConsumableEffectValue(effect) || typeof consumableValue !== "number" || typeof cooldown !== "number") return null;
    if (sound !== undefined && !isConsumableSoundValue(sound)) return null;
    if (targetType !== undefined && !isConsumableTargetTypeValue(targetType)) return null;
    if (poisonChanceOnUse !== undefined && typeof poisonChanceOnUse !== "number") return null;
    if (poisonDamageOnUse !== undefined && typeof poisonDamageOnUse !== "number") return null;
    const item: ConsumableItem = {
        id,
        name,
        description,
        category,
        effect,
        value: consumableValue,
        cooldown,
        ...(sound !== undefined ? { sound } : {}),
        ...(targetType !== undefined ? { targetType } : {}),
        ...(poisonChanceOnUse !== undefined ? { poisonChanceOnUse } : {}),
        ...(poisonDamageOnUse !== undefined ? { poisonDamageOnUse } : {}),
    };
    return item;
}

export function parseItemRegistryCandidates(items: readonly unknown[]): { items: Item[]; errors: string[] } {
    const parsedItems: Item[] = [];
    const errors: string[] = [];

    items.forEach((candidate, index) => {
        const parsed = parseItemCandidate(candidate);
        if (!parsed) {
            errors.push(`${getItemCandidateLabel(candidate, index)}: Item is malformed or has an invalid category-specific payload.`);
            return;
        }
        parsedItems.push(parsed);
    });

    return { items: parsedItems, errors };
}

function readStoredRegistryPayload(): ItemRegistryStoragePayload | null {
    const storage = getBrowserStorage();
    if (!storage) return null;
    const raw = storage.getItem(ITEM_REGISTRY_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        const version = Reflect.get(parsed, "version");
        const items = Reflect.get(parsed, "items");
        if (typeof version !== "number") return null;
        if (!Array.isArray(items)) return null;
        return {
            version,
            items,
        };
    } catch {
        return null;
    }
}

function writeStoredRegistry(items: Item[]): void {
    const storage = getBrowserStorage();
    if (!storage) return;
    const payload: ItemRegistryStoragePayload = {
        version: ITEM_REGISTRY_STORAGE_VERSION,
        items: cloneItemList(items),
    };
    storage.setItem(ITEM_REGISTRY_STORAGE_KEY, JSON.stringify(payload));
}

export function clearStoredItemRegistry(): void {
    const storage = getBrowserStorage();
    if (!storage) return;
    storage.removeItem(ITEM_REGISTRY_STORAGE_KEY);
}

function clearRegistry(registry: Record<string, unknown>): void {
    for (const key of Object.keys(registry)) {
        delete registry[key];
    }
}

function getCategoryRegistry(category: ItemCategory): Record<string, Item> {
    if (category === "weapon") return WEAPONS as Record<string, Item>;
    if (category === "shield") return SHIELDS as Record<string, Item>;
    if (category === "armor") return ARMORS as Record<string, Item>;
    if (category === "accessory") return ACCESSORIES as Record<string, Item>;
    if (category === "consumable") return CONSUMABLES as Record<string, Item>;
    return KEYS as Record<string, Item>;
}

function rebuildItemIndex(): void {
    clearRegistry(ITEMS);
    Object.assign(ITEMS, WEAPONS, SHIELDS, ARMORS, ACCESSORIES, KEYS, CONSUMABLES);
}

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function validateBase(item: Item): string[] {
    const errors: string[] = [];
    if (typeof item.id !== "string" || item.id.trim().length === 0) {
        errors.push("Item id is required.");
    } else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(item.id)) {
        errors.push("Item id must start with a letter and contain only letters, numbers, or underscores.");
    }
    if (typeof item.name !== "string" || item.name.trim().length === 0) {
        errors.push("Item name is required.");
    }
    if (typeof item.description !== "string" || item.description.trim().length === 0) {
        errors.push("Item description is required.");
    }
    return errors;
}

export function validateItemDefinition(item: Item): string[] {
    const errors = validateBase(item);

    if (item.category === "weapon") {
        if (!VALID_WEAPON_GRIPS.has(item.grip)) {
            errors.push("Weapon grip must be oneHand or twoHand.");
        }
        if (!Array.isArray(item.damage) || item.damage.length !== 2) {
            errors.push("Weapon damage must be [min, max].");
        } else {
            const [min, max] = item.damage;
            if (!isNonNegativeNumber(min) || !isNonNegativeNumber(max)) {
                errors.push("Weapon damage values must be non-negative numbers.");
            } else if (max < min) {
                errors.push("Weapon max damage must be greater than or equal to min damage.");
            }
        }
        if (!VALID_DAMAGE_TYPES.has(item.damageType)) {
            errors.push("Weapon damage type is invalid.");
        }
        if (item.range !== undefined && !isPositiveNumber(item.range)) {
            errors.push("Weapon range must be a positive number when provided.");
        }
        if (item.projectileColor !== undefined && !isHexColor(item.projectileColor)) {
            errors.push("Weapon projectile color must be a hex color like #ff6600.");
        }
        if (item.attackCooldown !== undefined && !isNonNegativeNumber(item.attackCooldown)) {
            errors.push("Weapon attack cooldown must be a non-negative number when provided.");
        }
        errors.push(...validatePassiveFields(item, "Weapon"));
    } else if (item.category === "shield" || item.category === "armor") {
        if (!isNonNegativeNumber(item.armor)) {
            errors.push(`${item.category === "shield" ? "Shield" : "Armor"} value must be a non-negative number.`);
        }
        const label = item.category === "shield" ? "Shield" : "Armor";
        errors.push(...validatePassiveFields(item, label));
    } else if (item.category === "accessory") {
        errors.push(...validatePassiveFields(item, "Accessory"));
    } else if (item.category === "key") {
        if (typeof item.keyId !== "string" || item.keyId.trim().length === 0) {
            errors.push("Key item must have a non-empty keyId.");
        }
    } else if (item.category === "consumable") {
        if (!VALID_CONSUMABLE_EFFECTS.has(item.effect)) {
            errors.push("Consumable effect is invalid.");
        }
        if (!isNonNegativeNumber(item.value)) {
            errors.push("Consumable value must be a non-negative number.");
        }
        if (!isNonNegativeNumber(item.cooldown)) {
            errors.push("Consumable cooldown must be a non-negative number.");
        }
        if (item.sound !== undefined && !VALID_CONSUMABLE_SOUNDS.has(item.sound)) {
            errors.push("Consumable sound must be gulp or crunch.");
        }
        if (item.targetType !== undefined && !VALID_CONSUMABLE_TARGET_TYPES.has(item.targetType)) {
            errors.push("Consumable target type is invalid.");
        }
        if (item.poisonChanceOnUse !== undefined && (!isNonNegativeNumber(item.poisonChanceOnUse) || item.poisonChanceOnUse > 100)) {
            errors.push("Consumable poison chance on use must be between 0 and 100.");
        }
        if (item.poisonDamageOnUse !== undefined && !isNonNegativeNumber(item.poisonDamageOnUse)) {
            errors.push("Consumable poison damage on use must be a non-negative number.");
        }
        if ((item.poisonChanceOnUse !== undefined) !== (item.poisonDamageOnUse !== undefined)) {
            errors.push("Consumable poisonChanceOnUse and poisonDamageOnUse must both be set together.");
        }
    } else {
        errors.push("Item category is invalid.");
    }

    return errors;
}

function ensureFistWeapon(items: Item[]): string[] {
    const fist = items.find(item => item.id === "fist");
    if (!fist) {
        return ["Registry must include the fallback weapon 'fist'."];
    }
    if (fist.category !== "weapon") {
        return ["Fallback item 'fist' must remain a weapon."];
    }
    return [];
}

export function getAllItemDefinitions(): Item[] {
    return Object.values(ITEMS)
        .map(cloneItemDefinition)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function getDefaultItemDefinitions(): Item[] {
    return DEFAULT_ITEMS
        .map(cloneItemDefinition)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function getItemCategoryGroups(): ItemCategoryGroup[] {
    return ITEM_CATEGORY_ORDER.map(category => {
        const registry = getCategoryRegistry(category);
        const itemIds = Object.keys(registry).sort((a, b) => {
            const nameA = registry[a]?.name ?? a;
            const nameB = registry[b]?.name ?? b;
            return nameA.localeCompare(nameB);
        });
        return {
            category,
            label: ITEM_CATEGORY_LABELS[category],
            itemIds,
        };
    });
}

export function upsertItemDefinition(item: Item): string[] {
    const errors = validateItemDefinition(item);
    if (errors.length > 0) return errors;

    const cloned = cloneItemDefinition(item);

    // Remove old entry from every category to support category changes safely.
    clearItemDefinition(item.id, false);

    const targetRegistry = getCategoryRegistry(cloned.category);
    targetRegistry[cloned.id] = cloned;
    rebuildItemIndex();
    writeStoredRegistry(Object.values(ITEMS));
    return [];
}

function clearItemDefinition(itemId: string, rebuild: boolean): void {
    delete WEAPONS[itemId];
    delete SHIELDS[itemId];
    delete ARMORS[itemId];
    delete ACCESSORIES[itemId];
    delete KEYS[itemId];
    delete CONSUMABLES[itemId];
    if (rebuild) {
        rebuildItemIndex();
    }
}

export function removeItemDefinition(itemId: string): string[] {
    if (itemId === "fist") {
        return ["Cannot remove fallback item 'fist'."];
    }
    if (!ITEMS[itemId]) {
        return [`Item '${itemId}' does not exist.`];
    }
    clearItemDefinition(itemId, true);
    writeStoredRegistry(Object.values(ITEMS));
    return [];
}

export function validateItemRegistry(items: Item[]): string[] {
    const errors: string[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
        if (seenIds.has(item.id)) {
            errors.push(`Duplicate item id '${item.id}'.`);
            continue;
        }
        seenIds.add(item.id);
        const validationErrors = validateItemDefinition(item);
        for (const err of validationErrors) {
            errors.push(`${item.id}: ${err}`);
        }
    }

    for (const err of ensureFistWeapon(items)) {
        errors.push(err);
    }

    return errors;
}

function replaceItemRegistryInternal(items: Item[], persist: boolean): string[] {
    const errors = validateItemRegistry(items);
    if (errors.length > 0) {
        return errors;
    }

    clearRegistry(WEAPONS);
    clearRegistry(SHIELDS);
    clearRegistry(ARMORS);
    clearRegistry(ACCESSORIES);
    clearRegistry(KEYS);
    clearRegistry(CONSUMABLES);

    for (const item of items) {
        const cloned = cloneItemDefinition(item);
        const targetRegistry = getCategoryRegistry(cloned.category);
        targetRegistry[cloned.id] = cloned;
    }

    rebuildItemIndex();
    if (persist) {
        writeStoredRegistry(Object.values(ITEMS));
    }
    return [];
}

export function replaceItemRegistry(items: Item[]): string[] {
    return replaceItemRegistryInternal(items, true);
}

export function loadItemRegistryFromStorage(): string[] {
    const payload = readStoredRegistryPayload();
    if (!payload) {
        return [];
    }
    if (payload.version > ITEM_REGISTRY_STORAGE_VERSION) {
        return ["Saved item registry version is newer than supported."];
    }
    const parsedRegistry = parseItemRegistryCandidates(payload.items);
    if (parsedRegistry.errors.length > 0) {
        clearStoredItemRegistry();
        return parsedRegistry.errors;
    }
    const errors = replaceItemRegistryInternal(parsedRegistry.items, false);
    if (errors.length > 0) {
        clearStoredItemRegistry();
        return errors;
    }
    return [];
}

export function resetItemRegistryToDefaults(): void {
    const errors = replaceItemRegistryInternal(DEFAULT_ITEMS, false);
    if (errors.length > 0) {
        return;
    }
    clearStoredItemRegistry();
}

const storedRegistryErrors = loadItemRegistryFromStorage();
if (storedRegistryErrors.length > 0 && typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[items] Failed to load saved item registry:", storedRegistryErrors);
}

/** Get an item by ID. Returns undefined if not found. */
export function getItem(itemId: string): Item | undefined {
    return ITEMS[itemId];
}
