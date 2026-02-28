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

import type { CharacterEquipment, DamageType, EquipmentSlot, PartyInventory } from "../core/types";
import {
    STARTING_EQUIPMENT,
    STARTING_INVENTORY,
    equipItem,
    getComputedStats,
    getMainHandWeapon,
    unequipItem
} from "./equipment";

// =============================================================================
// STATE STORAGE
// =============================================================================

// Per-character equipment (keyed by unit ID)
let equipmentState: Record<number, CharacterEquipment> = {};

// Shared party inventory
let inventoryState: PartyInventory = { items: [] };

// Initialization flag
let isInitialized = false;

// =============================================================================
// TYPES
// =============================================================================

export interface EffectivePlayerEquipmentStats {
    damage: [number, number];
    damageType: DamageType;
    armor: number;
    range: number | undefined;
    projectileColor: string | undefined;
    attackCooldown: number | undefined;
    bonusMaxHp: number;
    bonusMagicDamage: number;
    hpRegen: { amount: number; interval: number } | null;
    aggroMultiplier: number;
    moveSpeedMultiplier: number;
}

export interface EquipmentTransactionResult {
    unitId: number;
    previousEquipment: CharacterEquipment;
    nextEquipment: CharacterEquipment;
    previousInventory: PartyInventory;
    nextInventory: PartyInventory;
    previousStats: EffectivePlayerEquipmentStats;
    nextStats: EffectivePlayerEquipmentStats;
    // Callers should clamp live unit HP after applying this delta.
    bonusMaxHpDelta: number;
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

function cloneStats(stats: EffectivePlayerEquipmentStats): EffectivePlayerEquipmentStats {
    return {
        ...stats,
        damage: [stats.damage[0], stats.damage[1]],
        hpRegen: stats.hpRegen ? { ...stats.hpRegen } : null,
    };
}

function ensureInitialized(): void {
    if (!isInitialized) {
        initializeEquipmentState();
    }
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

// =============================================================================
// SETTERS
// =============================================================================

/** Set equipment for a character */
export function setCharacterEquipment(unitId: number, equipment: CharacterEquipment): void {
    ensureInitialized();
    equipmentState[unitId] = cloneEquipment(equipment);
}

/** Set all character equipment (for loading saved state) */
export function setAllEquipment(equipment: Record<number, CharacterEquipment>): void {
    equipmentState = cloneAllEquipment(equipment);
    isInitialized = true;
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

/** Get effective damage for a character based on equipment */
export function getEffectivePlayerDamage(unitId: number): [number, number] {
    return getEffectivePlayerEquipmentStats(unitId).damage;
}

/** Get effective damage type for a character based on equipment */
export function getEffectivePlayerDamageType(unitId: number): DamageType {
    return getEffectivePlayerEquipmentStats(unitId).damageType;
}

/** Get effective armor for a character based on equipment */
export function getEffectivePlayerArmor(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).armor;
}

/** Get effective range for a character based on equipment (undefined = melee) */
export function getEffectivePlayerRange(unitId: number): number | undefined {
    return getEffectivePlayerEquipmentStats(unitId).range;
}

/** Get projectile color for a character based on equipped weapon */
export function getEffectivePlayerProjectileColor(unitId: number): string | undefined {
    return getEffectivePlayerEquipmentStats(unitId).projectileColor;
}

/** Get weapon attack cooldown override from equipment */
export function getEffectivePlayerAttackCooldown(unitId: number): number | undefined {
    return getEffectivePlayerEquipmentStats(unitId).attackCooldown;
}

/** Get bonus max HP from equipment */
export function getEffectivePlayerBonusMaxHp(unitId: number): number {
    return getEffectivePlayerEquipmentStats(unitId).bonusMaxHp;
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

    const previousStats = getEffectivePlayerEquipmentStatsFor(unitId, previousEquipment);
    const nextStats = getEffectivePlayerEquipmentStatsFor(unitId, equipped.equipment);

    equipmentState[unitId] = cloneEquipment(equipped.equipment);
    inventoryState = cloneInventory(equipped.inventory);

    return {
        unitId,
        previousEquipment,
        nextEquipment: cloneEquipment(equipped.equipment),
        previousInventory,
        nextInventory: cloneInventory(equipped.inventory),
        previousStats: cloneStats(previousStats),
        nextStats: cloneStats(nextStats),
        bonusMaxHpDelta: nextStats.bonusMaxHp - previousStats.bonusMaxHp,
    };
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

    const previousStats = getEffectivePlayerEquipmentStatsFor(unitId, previousEquipment);
    const nextStats = getEffectivePlayerEquipmentStatsFor(unitId, unequipped.equipment);

    equipmentState[unitId] = cloneEquipment(unequipped.equipment);
    inventoryState = cloneInventory(unequipped.inventory);

    return {
        unitId,
        previousEquipment,
        nextEquipment: cloneEquipment(unequipped.equipment),
        previousInventory,
        nextInventory: cloneInventory(unequipped.inventory),
        previousStats: cloneStats(previousStats),
        nextStats: cloneStats(nextStats),
        bonusMaxHpDelta: nextStats.bonusMaxHp - previousStats.bonusMaxHp,
    };
}
