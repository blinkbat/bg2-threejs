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
interface ItemBase {
    id: string;
    name: string;
    description: string;
    category: ItemCategory;
}

// Passive bonus fields shared across all equipment types
export interface EquipmentPassives {
    bonusMaxHp?: number;            // Flat bonus to max HP
    bonusMaxMana?: number;          // Flat bonus to max mana
    bonusMagicDamage?: number;      // Flat bonus to non-physical damage
    bonusArmor?: number;            // Flat bonus to armor
    bonusCritChance?: number;       // Flat % added to crit chance
    bonusMoveSpeed?: number;        // 0-1, percentage bonus to move speed (0.1 = +10%)
    lifesteal?: number;             // 0-1, fraction of damage dealt healed back
    hpRegen?: number;               // HP regenerated per tick (in combat)
    hpRegenInterval?: number;       // Interval in ms for regen tick
    aggroReduction?: number;        // 0-1, reduces enemy targeting priority
    thornsDamage?: number;          // Flat damage reflected back to melee attackers
}

// Weapon item
export interface WeaponItem extends ItemBase, EquipmentPassives {
    category: "weapon";
    grip: WeaponGrip;
    damage: [number, number];
    damageType: DamageType;
    range?: number;              // If set, weapon is ranged
    projectileColor?: string;    // Color for ranged projectiles
    attackCooldown?: number;     // Override base attack cooldown
}

// Shield item
export interface ShieldItem extends ItemBase, EquipmentPassives {
    category: "shield";
    armor: number;
}

// Armor item
export interface ArmorItem extends ItemBase, EquipmentPassives {
    category: "armor";
    armor: number;
}

// Accessory item
export interface AccessoryItem extends ItemBase, EquipmentPassives {
    category: "accessory";
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
    effect: "heal" | "mana" | "exp" | "revive" | "cleanse" | "camp" | "waystone_recall";
    value: number;
    cooldown: number;               // Cooldown in ms (default 5000)
    sound?: ConsumableSound;        // Sound to play on use
    targetType?: "dead_ally";       // If set, requires targeting a unit before use
    poisonChanceOnUse?: number;     // Optional self-poison chance (%) when consumed
    poisonDamageOnUse?: number;     // Optional poison damage-per-tick if self-poison procs
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
