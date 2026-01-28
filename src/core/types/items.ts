// =============================================================================
// ITEM TYPES - Equipment, consumables, and inventory
// =============================================================================

import type { DamageType } from "./combat";

// Equipment slot identifiers
export type EquipmentSlot = "armor" | "leftHand" | "rightHand" | "accessory1" | "accessory2";

// Item categories
export type ItemCategory = "weapon" | "shield" | "armor" | "accessory" | "consumable" | "key";

// Weapon grip type
export type WeaponGrip = "oneHand" | "twoHand";

// Base item interface
export interface ItemBase {
    id: string;
    name: string;
    description: string;
    category: ItemCategory;
}

// Weapon item
export interface WeaponItem extends ItemBase {
    category: "weapon";
    grip: WeaponGrip;
    damage: [number, number];
    damageType: DamageType;
    range?: number;              // If set, weapon is ranged
    projectileColor?: string;    // Color for ranged projectiles
    attackCooldown?: number;     // Override base attack cooldown
}

// Shield item
export interface ShieldItem extends ItemBase {
    category: "shield";
    armor: number;
}

// Armor item
export interface ArmorItem extends ItemBase {
    category: "armor";
    armor: number;
}

// Accessory item - can have various stat bonuses
export interface AccessoryItem extends ItemBase {
    category: "accessory";
    bonusMaxHp?: number;
    bonusMagicDamage?: number;      // Flat bonus to non-physical damage
    bonusArmor?: number;
    hpRegen?: number;               // HP regenerated per tick (in combat)
    hpRegenInterval?: number;       // Interval in ms for regen tick
    aggroReduction?: number;        // 0-1, reduces enemy targeting priority
    bonusMoveSpeed?: number;        // 0-1, percentage bonus to move speed (0.1 = +10%)
}

// Key item - used to unlock chests or doors
export interface KeyItem extends ItemBase {
    category: "key";
    keyId: string;                  // Unique identifier for lock matching
}

// Consumable sound types
export type ConsumableSound = "gulp" | "crunch";

// Consumable item
export interface ConsumableItem extends ItemBase {
    category: "consumable";
    effect: "heal" | "mana";
    value: number;
    cooldown: number;               // Cooldown in ms (default 5000)
    sound?: ConsumableSound;        // Sound to play on use
}

// Union type for all items
export type Item = WeaponItem | ShieldItem | ArmorItem | AccessoryItem | ConsumableItem | KeyItem;

// Character equipment state
export interface CharacterEquipment {
    armor: string | null;           // Item ID or null
    leftHand: string | null;
    rightHand: string | null;
    accessory1: string | null;
    accessory2: string | null;
}

// Shared party inventory
export interface PartyInventory {
    items: InventoryEntry[];
}

// Inventory entry with stack count
export interface InventoryEntry {
    itemId: string;
    quantity: number;
}

// Type guards
export function isWeapon(item: Item): item is WeaponItem {
    return item.category === "weapon";
}

export function isShield(item: Item): item is ShieldItem {
    return item.category === "shield";
}

export function isArmor(item: Item): item is ArmorItem {
    return item.category === "armor";
}

export function isAccessory(item: Item): item is AccessoryItem {
    return item.category === "accessory";
}

export function isConsumable(item: Item): item is ConsumableItem {
    return item.category === "consumable";
}

export function isKey(item: Item): item is KeyItem {
    return item.category === "key";
}
