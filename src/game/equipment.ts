// =============================================================================
// EQUIPMENT SYSTEM - Equipment state and stat calculations
// =============================================================================

import type {
    CharacterEquipment,
    EquipmentPassives,
    PartyInventory,
    Item,
    WeaponItem,
    EquipmentSlot,
    DamageType,
} from "../core/types";
import { WEAPONS, getItem } from "./items";
import { isWeapon, isShield, isArmor, isAccessory } from "../core/types";

// =============================================================================
// STARTING EQUIPMENT BY CHARACTER ID
// =============================================================================

export const STARTING_EQUIPMENT: Record<number, CharacterEquipment> = {
    // Barbarian: Large Branch (2h)
    1: {
        armor: null,
        leftHand: "largeBranch",
        rightHand: null,  // Disabled by 2h weapon
        accessory1: null,
        accessory2: null,
    },
    // Paladin: Bent Sceptre (melee) + Crest Shield + Mudworm's Ring
    2: {
        armor: null,
        leftHand: "bentSceptre",
        rightHand: "crestShield",
        accessory1: "mudwormsRing",
        accessory2: null,
    },
    // Thief: Bow and Quiver (2h) + Nightpaw's Ring
    3: {
        armor: null,
        leftHand: "bowAndQuiver",
        rightHand: null,  // Disabled by 2h weapon
        accessory1: "nightpawsRing",
        accessory2: null,
    },
    // Wizard: Wooden Wand + Ring of the Drakeling
    4: {
        armor: null,
        leftHand: "woodenWand",
        rightHand: null,
        accessory1: "ringOfTheDrakeling",
        accessory2: null,
    },
    // Monk: Desert Gi + Ring of the Sapling
    5: {
        armor: "desertGi",
        leftHand: null,
        rightHand: null,
        accessory1: "ringOfTheSapling",
        accessory2: null,
    },
    // Cleric: Tarnished Chime (ranged holy bolt) + Buckler
    6: {
        armor: null,
        leftHand: "tarnishedChime",
        rightHand: "buckler",
        accessory1: null,
        accessory2: null,
    },
};

// =============================================================================
// STARTING INVENTORY
// =============================================================================

export const STARTING_INVENTORY: PartyInventory = {
    items: [
        { itemId: "smallManaPotion", quantity: 1 },
        { itemId: "loafOfBread", quantity: 2 },
        { itemId: "stripOfBatJerky", quantity: 1 },
        { itemId: "scrollOfLearning", quantity: 1 },
        { itemId: "woodenAnkh", quantity: 1 },
    ],
};

// =============================================================================
// EQUIPMENT HELPERS
// =============================================================================

/** Get the weapon equipped in the main hand (leftHand), or fist if unarmed */
export function getMainHandWeapon(equipment: CharacterEquipment): WeaponItem {
    const leftHandItem = equipment.leftHand ? getItem(equipment.leftHand) : null;
    if (leftHandItem && isWeapon(leftHandItem)) {
        return leftHandItem;
    }
    return WEAPONS.fist;
}

/** Check if off-hand slot is disabled (2h weapon equipped) */
export function isOffHandDisabled(equipment: CharacterEquipment): boolean {
    const mainHand = getMainHandWeapon(equipment);
    return mainHand.grip === "twoHand";
}

// =============================================================================
// PASSIVE AGGREGATION - Scan all equipment slots for passive bonus fields
// =============================================================================

const ALL_EQUIPMENT_SLOTS: (keyof CharacterEquipment)[] = [
    "armor", "leftHand", "rightHand", "accessory1", "accessory2",
];

/** Get the EquipmentPassives from an item regardless of category. */
function getPassives(item: Item): EquipmentPassives | null {
    if (isWeapon(item) || isShield(item) || isArmor(item) || isAccessory(item)) {
        return item;
    }
    return null;
}

/** Iterate passive fields across all equipped items. */
function forEachEquippedPassive(
    equipment: CharacterEquipment,
    fn: (passives: EquipmentPassives) => void
): void {
    for (const slot of ALL_EQUIPMENT_SLOTS) {
        // Skip off-hand if disabled by 2h weapon
        if (slot === "rightHand" && isOffHandDisabled(equipment)) continue;
        const itemId = equipment[slot];
        if (!itemId) continue;
        const item = getItem(itemId);
        if (!item) continue;
        const passives = getPassives(item);
        if (passives) fn(passives);
    }
}

/** Get total armor from equipment (base armor from armor/shield slots + bonusArmor from all slots) */
export function getEquipmentArmor(equipment: CharacterEquipment): number {
    let total = 0;

    // Base armor from armor slot
    const armorItem = equipment.armor ? getItem(equipment.armor) : null;
    if (armorItem && isArmor(armorItem)) {
        total += armorItem.armor;
    }

    // Base armor from shield in off-hand (only if not disabled by 2h)
    if (!isOffHandDisabled(equipment)) {
        const rightHandItem = equipment.rightHand ? getItem(equipment.rightHand) : null;
        if (rightHandItem && isShield(rightHandItem)) {
            total += rightHandItem.armor;
        }
    }

    // Bonus armor from passives on all slots
    forEachEquippedPassive(equipment, p => {
        if (p.bonusArmor) total += p.bonusArmor;
    });

    return total;
}

/** Get bonus max HP from all equipment */
function getEquipmentBonusMaxHp(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.bonusMaxHp) total += p.bonusMaxHp;
    });
    return total;
}

/** Get bonus max mana from all equipment */
function getEquipmentBonusMaxMana(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.bonusMaxMana) total += p.bonusMaxMana;
    });
    return total;
}

/** Get HP regen info from equipment (returns first regen item found) */
function getEquipmentHpRegen(equipment: CharacterEquipment): { amount: number; interval: number } | null {
    let result: { amount: number; interval: number } | null = null;
    forEachEquippedPassive(equipment, p => {
        if (!result && p.hpRegen && p.hpRegenInterval) {
            result = { amount: p.hpRegen, interval: p.hpRegenInterval };
        }
    });
    return result;
}

/** Get aggro reduction multiplier from all equipment (stacks multiplicatively) */
function getEquipmentAggroReduction(equipment: CharacterEquipment): number {
    let multiplier = 1;
    forEachEquippedPassive(equipment, p => {
        if (p.aggroReduction) multiplier *= (1 - p.aggroReduction);
    });
    return multiplier;
}

/** Get move speed multiplier from all equipment (stacks multiplicatively) */
function getEquipmentMoveSpeedMultiplier(equipment: CharacterEquipment): number {
    let multiplier = 1;
    forEachEquippedPassive(equipment, p => {
        if (p.bonusMoveSpeed) multiplier *= (1 + p.bonusMoveSpeed);
    });
    return multiplier;
}

/** Get bonus magic damage from all equipment */
function getEquipmentBonusMagicDamage(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.bonusMagicDamage) total += p.bonusMagicDamage;
    });
    return total;
}

/** Get bonus crit chance from all equipment */
function getEquipmentBonusCritChance(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.bonusCritChance) total += p.bonusCritChance;
    });
    return total;
}

/** Get lifesteal from all equipment (additive stacking) */
function getEquipmentLifesteal(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.lifesteal) total += p.lifesteal;
    });
    return total;
}

function getEquipmentThornsDamage(equipment: CharacterEquipment): number {
    let total = 0;
    forEachEquippedPassive(equipment, p => {
        if (p.thornsDamage) total += p.thornsDamage;
    });
    return total;
}

// =============================================================================
// COMPUTED STATS FROM EQUIPMENT
// =============================================================================

export interface EffectivePlayerEquipmentStats {
    damage: [number, number];
    damageType: DamageType;
    armor: number;
    range: number | undefined;
    projectileColor: string | undefined;
    attackCooldown: number | undefined;  // Only if weapon overrides it
    bonusMaxHp: number;
    bonusMaxMana: number;
    bonusMagicDamage: number;
    bonusCritChance: number;
    lifesteal: number;
    hpRegen: { amount: number; interval: number } | null;
    aggroMultiplier: number;
    moveSpeedMultiplier: number;
    thornsDamage: number;
}

/** Get computed combat stats from equipment */
export function getComputedStats(equipment: CharacterEquipment): EffectivePlayerEquipmentStats {
    const weapon = getMainHandWeapon(equipment);

    return {
        damage: weapon.damage,
        damageType: weapon.damageType,
        armor: getEquipmentArmor(equipment),
        range: weapon.range,
        projectileColor: weapon.projectileColor,
        attackCooldown: weapon.attackCooldown,
        bonusMaxHp: getEquipmentBonusMaxHp(equipment),
        bonusMaxMana: getEquipmentBonusMaxMana(equipment),
        bonusMagicDamage: getEquipmentBonusMagicDamage(equipment),
        bonusCritChance: getEquipmentBonusCritChance(equipment),
        lifesteal: getEquipmentLifesteal(equipment),
        hpRegen: getEquipmentHpRegen(equipment),
        aggroMultiplier: getEquipmentAggroReduction(equipment),
        moveSpeedMultiplier: getEquipmentMoveSpeedMultiplier(equipment),
        thornsDamage: getEquipmentThornsDamage(equipment),
    };
}

// =============================================================================
// INVENTORY HELPERS
// =============================================================================

/** Add item to inventory (stacks if already present) */
export function addToInventory(inventory: PartyInventory, itemId: string, quantity: number = 1): PartyInventory {
    const existing = inventory.items.find(e => e.itemId === itemId);
    if (existing) {
        return {
            items: inventory.items.map(e =>
                e.itemId === itemId ? { ...e, quantity: e.quantity + quantity } : e
            ),
        };
    }
    return {
        items: [...inventory.items, { itemId, quantity }],
    };
}

/** Remove item from inventory (reduces quantity, removes entry if 0) */
export function removeFromInventory(inventory: PartyInventory, itemId: string, quantity: number = 1): PartyInventory {
    const existing = inventory.items.find(e => e.itemId === itemId);
    if (!existing || existing.quantity < quantity) {
        return inventory;  // Not enough to remove
    }

    const newQuantity = existing.quantity - quantity;
    if (newQuantity <= 0) {
        return {
            items: inventory.items.filter(e => e.itemId !== itemId),
        };
    }

    return {
        items: inventory.items.map(e =>
            e.itemId === itemId ? { ...e, quantity: newQuantity } : e
        ),
    };
}

/** Check if inventory has at least the specified quantity of an item */
export function hasInInventory(inventory: PartyInventory, itemId: string, quantity: number = 1): boolean {
    const entry = inventory.items.find(e => e.itemId === itemId);
    return entry !== undefined && entry.quantity >= quantity;
}

// =============================================================================
// EQUIPMENT VALIDATION
// =============================================================================

/** Check if an item can be equipped in a slot */
export function canEquipInSlot(item: Item, slot: EquipmentSlot): boolean {
    switch (slot) {
        case "armor":
            return isArmor(item);
        case "leftHand":
            return isWeapon(item);
        case "rightHand":
            return isShield(item) || (isWeapon(item) && item.grip === "oneHand");
        case "accessory1":
        case "accessory2":
            return isAccessory(item);
        default:
            return false;
    }
}

/** Equip an item from inventory to a character */
export function equipItem(
    equipment: CharacterEquipment,
    inventory: PartyInventory,
    itemId: string,
    slot: EquipmentSlot
): { equipment: CharacterEquipment; inventory: PartyInventory } | null {
    const item = getItem(itemId);
    if (!item || !canEquipInSlot(item, slot)) {
        return null;
    }

    // Off-hand cannot be used while main hand has a two-handed weapon.
    if (slot === "rightHand" && isOffHandDisabled(equipment)) {
        return null;
    }

    // Check if we have the item
    if (!hasInInventory(inventory, itemId)) {
        return null;
    }

    // Unequip current item in slot (returns to inventory)
    let newInventory = inventory;
    const newEquipment = { ...equipment };

    const currentItemId = equipment[slot];
    if (currentItemId) {
        newInventory = addToInventory(newInventory, currentItemId);
    }

    // If equipping a 2h weapon, also unequip right hand
    if (slot === "leftHand" && isWeapon(item) && item.grip === "twoHand") {
        const rightHandItemId = equipment.rightHand;
        if (rightHandItemId) {
            newInventory = addToInventory(newInventory, rightHandItemId);
        }
        newEquipment.rightHand = null;
    }

    // Remove item from inventory and equip it
    newInventory = removeFromInventory(newInventory, itemId);
    newEquipment[slot] = itemId;

    return { equipment: newEquipment, inventory: newInventory };
}

/** Unequip an item from a slot (returns to inventory) */
export function unequipItem(
    equipment: CharacterEquipment,
    inventory: PartyInventory,
    slot: EquipmentSlot
): { equipment: CharacterEquipment; inventory: PartyInventory } {
    const currentItemId = equipment[slot];
    if (!currentItemId) {
        return { equipment, inventory };
    }

    // Fist is the default, don't add it to inventory
    if (currentItemId === "fist") {
        return { equipment, inventory };
    }

    return {
        equipment: { ...equipment, [slot]: null },
        inventory: addToInventory(inventory, currentItemId),
    };
}
