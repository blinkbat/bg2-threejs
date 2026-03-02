// =============================================================================
// ITEM DEFINITIONS - All game items
// =============================================================================

import type {
    Item,
    ItemCategory,
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
export const KNOWN_CONSUMABLE_EFFECTS: readonly ConsumableEffect[] = ["heal", "mana", "exp", "revive", "cleanse"];
export const KNOWN_CONSUMABLE_SOUNDS: readonly ConsumableSound[] = ["gulp", "crunch"];
export const KNOWN_CONSUMABLE_TARGET_TYPES: readonly ConsumableTargetType[] = ["dead_ally"];

const VALID_DAMAGE_TYPES = new Set(KNOWN_DAMAGE_TYPES);
const VALID_WEAPON_GRIPS = new Set(KNOWN_WEAPON_GRIPS);
const VALID_CONSUMABLE_EFFECTS = new Set(KNOWN_CONSUMABLE_EFFECTS);
const VALID_CONSUMABLE_SOUNDS = new Set(KNOWN_CONSUMABLE_SOUNDS);
const VALID_CONSUMABLE_TARGET_TYPES = new Set(KNOWN_CONSUMABLE_TARGET_TYPES);
const ITEM_REGISTRY_STORAGE_VERSION = 1;
export const ITEM_REGISTRY_STORAGE_KEY = "bg2_item_registry_v1";

export interface ItemCategoryGroup {
    category: ItemCategory;
    label: string;
    itemIds: string[];
}

interface ItemRegistryStoragePayload {
    version: number;
    items: Item[];
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
            items: items as Item[],
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
    } else if (item.category === "shield" || item.category === "armor") {
        if (!isNonNegativeNumber(item.armor)) {
            errors.push(`${item.category === "shield" ? "Shield" : "Armor"} value must be a non-negative number.`);
        }
    } else if (item.category === "accessory") {
        if (item.bonusMaxHp !== undefined && !isNonNegativeNumber(item.bonusMaxHp)) {
            errors.push("Accessory bonus max HP must be a non-negative number.");
        }
        if (item.bonusMagicDamage !== undefined && !isNonNegativeNumber(item.bonusMagicDamage)) {
            errors.push("Accessory bonus magic damage must be a non-negative number.");
        }
        if (item.bonusArmor !== undefined && !isNonNegativeNumber(item.bonusArmor)) {
            errors.push("Accessory bonus armor must be a non-negative number.");
        }
        if (item.hpRegen !== undefined && !isPositiveNumber(item.hpRegen)) {
            errors.push("Accessory HP regen must be a positive number when provided.");
        }
        if (item.hpRegenInterval !== undefined && !isPositiveNumber(item.hpRegenInterval)) {
            errors.push("Accessory HP regen interval must be a positive number when provided.");
        }
        if ((item.hpRegen !== undefined) !== (item.hpRegenInterval !== undefined)) {
            errors.push("Accessory HP regen amount and interval must both be set together.");
        }
        if (item.aggroReduction !== undefined && (!isNonNegativeNumber(item.aggroReduction) || item.aggroReduction > 1)) {
            errors.push("Accessory aggro reduction must be between 0 and 1.");
        }
        if (item.bonusMoveSpeed !== undefined && (!isNonNegativeNumber(item.bonusMoveSpeed) || item.bonusMoveSpeed > 1)) {
            errors.push("Accessory move speed bonus must be between 0 and 1.");
        }
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
    const errors = replaceItemRegistryInternal(payload.items, false);
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

/** Get an item by ID. Throws if not found. */
export function getItemOrThrow(itemId: string): Item {
    const item = ITEMS[itemId];
    if (!item) {
        throw new Error(`Item not found: ${itemId}`);
    }
    return item;
}
