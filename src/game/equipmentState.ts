// =============================================================================
// EQUIPMENT STATE - Global state for equipment and inventory
// =============================================================================
//
// This module provides a global store for equipment and inventory state that
// can be accessed from combat code, UI, and anywhere else without threading
// state through all function calls.
//
// The state is initialized from STARTING_EQUIPMENT/STARTING_INVENTORY and
// can be updated via setters. React components should sync their local state
// with this module.

import type { CharacterEquipment, EquipmentSlot, PartyInventory } from "../core/types";
import {
    STARTING_EQUIPMENT,
    STARTING_INVENTORY,
    equipItem,
    getComputedStats,
    getMainHandWeapon,
    unequipItem
} from "./equipment";
import type { EffectivePlayerEquipmentStats } from "./equipment";

// =============================================================================
// STATE STORAGE
// =============================================================================

// Per-character equipment (keyed by unit ID)
let equipmentState: Record<number, CharacterEquipment> = {};

// Shared party inventory
let inventoryState: PartyInventory = { items: [] };

// Initialization flag
let isInitialized = false;
let equipmentStateRevision = 0;

// =============================================================================
// TYPES
// =============================================================================

interface EquipmentTransactionResult {
    unitId: number;
    previousEquipment: CharacterEquipment;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Monk unit ID for fist damage bonus */
const MONK_ID = 5;
const MONK_FIST_BONUS: [number, number] = [2, 4];

function createEmptyEquipment(): CharacterEquipment {
    return {
        armor: null,
        leftHand: null,
        rightHand: null,
        accessory1: null,
        accessory2: null,
    };
}

function cloneEquipment(equipment: CharacterEquipment): CharacterEquipment {
    return { ...equipment };
}

function cloneAllEquipment(equipment: Record<number, CharacterEquipment>): Record<number, CharacterEquipment> {
    const clone: Record<number, CharacterEquipment> = {};
    for (const [unitId, unitEquipment] of Object.entries(equipment)) {
        clone[Number(unitId)] = cloneEquipment(unitEquipment);
    }
    return clone;
}

function cloneInventory(inventory: PartyInventory): PartyInventory {
    return {
        items: inventory.items.map(entry => ({ ...entry }))
    };
}

function ensureInitialized(): void {
    if (!isInitialized) {
        initializeEquipmentState();
    }
}

function bumpEquipmentStateRevision(): void {
    equipmentStateRevision += 1;
}

function getEffectivePlayerEquipmentStatsFor(unitId: number, equipment: CharacterEquipment): EffectivePlayerEquipmentStats {
    const computed = getComputedStats(equipment);
    const weapon = getMainHandWeapon(equipment);
    const baseDamage = computed.damage;

    const damage: [number, number] = (unitId === MONK_ID && weapon.id === "fist")
        ? [baseDamage[0] + MONK_FIST_BONUS[0], baseDamage[1] + MONK_FIST_BONUS[1]]
        : [baseDamage[0], baseDamage[1]];

    return {
        ...computed,
        damage,
        hpRegen: computed.hpRegen ? { ...computed.hpRegen } : null,
    };
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/** Initialize equipment state with starting equipment. Call on game start. */
export function initializeEquipmentState(): void {
    equipmentState = cloneAllEquipment(STARTING_EQUIPMENT);
    inventoryState = cloneInventory(STARTING_INVENTORY);
    isInitialized = true;
    bumpEquipmentStateRevision();
}

// =============================================================================
// GETTERS
// =============================================================================

/** Get equipment for a character. Returns empty equipment if not found. */
export function getCharacterEquipment(unitId: number): CharacterEquipment {
    ensureInitialized();
    const equipment = equipmentState[unitId];
    return equipment ? cloneEquipment(equipment) : createEmptyEquipment();
}

/** Get all character equipment (for persistence) */
export function getAllEquipment(): Record<number, CharacterEquipment> {
    ensureInitialized();
    return cloneAllEquipment(equipmentState);
}

/** Get party inventory */
export function getPartyInventory(): PartyInventory {
    ensureInitialized();
    return cloneInventory(inventoryState);
}

/** Revision token for caches that depend on equipped gear. */
export function getEquipmentStateRevision(): number {
    ensureInitialized();
    return equipmentStateRevision;
}

// =============================================================================
// SETTERS
// =============================================================================

/** Set all character equipment (for loading saved state) */
export function setAllEquipment(equipment: Record<number, CharacterEquipment>): void {
    equipmentState = cloneAllEquipment(equipment);
    isInitialized = true;
    bumpEquipmentStateRevision();
}

/** Set party inventory */
export function setPartyInventory(inventory: PartyInventory): void {
    ensureInitialized();
    inventoryState = cloneInventory(inventory);
}

// =============================================================================
// COMPUTED STATS HELPERS
// =============================================================================

/** Get all effective equipment-derived stats for a player unit. */
export function getEffectivePlayerEquipmentStats(unitId: number): EffectivePlayerEquipmentStats {
    const equipment = getCharacterEquipment(unitId);
    return getEffectivePlayerEquipmentStatsFor(unitId, equipment);
}

/** Get bonus magic damage from equipment */
export function getEffectivePlayerBonusMagicDamage(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).bonusMagicDamage;
}

/** Get HP regen from equipment */
export function getEffectivePlayerHpRegen(unitId: number): { amount: number; interval: number } | null {
    return getEffectivePlayerEquipmentStats(unitId).hpRegen;
}

/** Get aggro multiplier from equipment (lower is less likely to be targeted) */
export function getEffectivePlayerAggroMultiplier(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).aggroMultiplier;
}

/** Get movement speed multiplier from equipment */
export function getEffectivePlayerMoveSpeedMultiplier(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).moveSpeedMultiplier;
}

/** Get bonus crit chance from equipment */
export function getEffectivePlayerBonusCritChance(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).bonusCritChance;
}

/** Get lifesteal from equipment (0-1) */
export function getEffectivePlayerLifesteal(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).lifesteal;
}

/** Get thorns reflect damage from equipment */
export function getEffectivePlayerThornsDamage(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).thornsDamage;
}

// =============================================================================
// TRANSACTIONAL EQUIP/UNEQUIP API
// =============================================================================

/** Equip an item onto a character and atomically update both equipment and inventory state. */
export function equipItemForCharacter(unitId: number, itemId: string, slot: EquipmentSlot): EquipmentTransactionResult | null {
    ensureInitialized();

    const previousEquipment = getCharacterEquipment(unitId);
    const previousInventory = getPartyInventory();

    if (previousEquipment[slot] === itemId) {
        return null;
    }

    const equipped = equipItem(previousEquipment, previousInventory, itemId, slot);
    if (!equipped) {
        return null;
    }

    equipmentState[unitId] = cloneEquipment(equipped.equipment);
    inventoryState = cloneInventory(equipped.inventory);
    bumpEquipmentStateRevision();

    return { unitId, previousEquipment };
}

/** Unequip an item from a character and atomically update both equipment and inventory state. */
export function unequipItemForCharacter(unitId: number, slot: EquipmentSlot): EquipmentTransactionResult | null {
    ensureInitialized();

    const previousEquipment = getCharacterEquipment(unitId);
    const previousItemId = previousEquipment[slot];
    if (!previousItemId) {
        return null;
    }

    const previousInventory = getPartyInventory();
    const unequipped = unequipItem(previousEquipment, previousInventory, slot);
    if (unequipped.equipment[slot] === previousItemId) {
        return null;
    }

    equipmentState[unitId] = cloneEquipment(unequipped.equipment);
    inventoryState = cloneInventory(unequipped.inventory);
    bumpEquipmentStateRevision();

    return { unitId, previousEquipment };
}

/** Move an already-equipped item to another slot and atomically update equipment + inventory. */
export function moveEquippedItemForCharacter(unitId: number, fromSlot: EquipmentSlot, toSlot: EquipmentSlot): EquipmentTransactionResult | null {
    ensureInitialized();

    if (fromSlot === toSlot) {
        return null;
    }

    const previousEquipment = getCharacterEquipment(unitId);
    const movingItemId = previousEquipment[fromSlot];
    if (!movingItemId) {
        return null;
    }

    const previousInventory = getPartyInventory();

    // Build next state on local copies first, then commit once to avoid partial updates.
    const afterUnequip = unequipItem(previousEquipment, previousInventory, fromSlot);
    const afterMove = equipItem(afterUnequip.equipment, afterUnequip.inventory, movingItemId, toSlot);
    if (!afterMove) {
        return null;
    }

    equipmentState[unitId] = cloneEquipment(afterMove.equipment);
    inventoryState = cloneInventory(afterMove.inventory);
    bumpEquipmentStateRevision();

    return { unitId, previousEquipment };
}
