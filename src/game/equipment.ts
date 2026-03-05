// =============================================================================
// EQUIPMENT SYSTEM - Equipment state and stat calculations
// =============================================================================

import type {
    CharacterEquipment,
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

/** Get total armor from equipment (armor slot + shield) */
function getEquipmentArmor(equipment: CharacterEquipment): number {
    let total = 0;

    // Armor slot
    const armorItem = equipment.armor ? getItem(equipment.armor) : null;
    if (armorItem && isArmor(armorItem)) {
        total += armorItem.armor;
    }

    // Shield in off-hand (only if not disabled by 2h)
    if (!isOffHandDisabled(equipment)) {
        const rightHandItem = equipment.rightHand ? getItem(equipment.rightHand) : null;
        if (rightHandItem && isShield(rightHandItem)) {
            total += rightHandItem.armor;
        }
    }

    // Accessory armor bonuses
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];
    for (const slot of slots) {
        const itemId = equipment[slot];
        if (!itemId) continue;
        const item = getItem(itemId);
        if (item && isAccessory(item) && item.bonusArmor) {
            total += item.bonusArmor;
        }
    }

    return total;
}

/** Get bonus max HP from accessories */
function getEquipmentBonusMaxHp(equipment: CharacterEquipment): number {
    let total = 0;
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];

    for (const slot of slots) {
        const itemId = equipment[slot];
        if (itemId) {
            const item = getItem(itemId);
            if (item && isAccessory(item) && item.bonusMaxHp) {
                total += item.bonusMaxHp;
            }
        }
    }

    return total;
}

/** Get HP regen info from accessories (returns first regen item found) */
function getEquipmentHpRegen(equipment: CharacterEquipment): { amount: number; interval: number } | null {
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];

    for (const slot of slots) {
        const itemId = equipment[slot];
        if (itemId) {
            const item = getItem(itemId);
            if (item && isAccessory(item) && item.hpRegen && item.hpRegenInterval) {
                return { amount: item.hpRegen, interval: item.hpRegenInterval };
            }
        }
    }

    return null;
}

/** Get aggro reduction multiplier from accessories (stacks multiplicatively) */
function getEquipmentAggroReduction(equipment: CharacterEquipment): number {
    let multiplier = 1;
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];

    for (const slot of slots) {
        const itemId = equipment[slot];
        if (itemId) {
            const item = getItem(itemId);
            if (item && isAccessory(item) && item.aggroReduction) {
                multiplier *= (1 - item.aggroReduction);
            }
        }
    }

    return multiplier;
}

/** Get move speed multiplier from accessories (stacks multiplicatively) */
function getEquipmentMoveSpeedMultiplier(equipment: CharacterEquipment): number {
    let multiplier = 1;
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];

    for (const slot of slots) {
        const itemId = equipment[slot];
        if (itemId) {
            const item = getItem(itemId);
            if (item && isAccessory(item) && item.bonusMoveSpeed) {
                multiplier *= (1 + item.bonusMoveSpeed);
            }
        }
    }

    return multiplier;
}

/** Get bonus magic damage from accessories */
function getEquipmentBonusMagicDamage(equipment: CharacterEquipment): number {
    let total = 0;
    const slots: (keyof CharacterEquipment)[] = ["accessory1", "accessory2"];

    for (const slot of slots) {
        const itemId = equipment[slot];
        if (itemId) {
            const item = getItem(itemId);
            if (item && isAccessory(item) && item.bonusMagicDamage) {
                total += item.bonusMagicDamage;
            }
        }
    }

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
    bonusMagicDamage: number;
    hpRegen: { amount: number; interval: number } | null;
    aggroMultiplier: number;
    moveSpeedMultiplier: number;
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
        bonusMagicDamage: getEquipmentBonusMagicDamage(equipment),
        hpRegen: getEquipmentHpRegen(equipment),
        aggroMultiplier: getEquipmentAggroReduction(equipment),
        moveSpeedMultiplier: getEquipmentMoveSpeedMultiplier(equipment),
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
