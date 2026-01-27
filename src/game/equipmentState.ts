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

import type { CharacterEquipment, PartyInventory } from "../core/types";
import { STARTING_EQUIPMENT, STARTING_INVENTORY, getEquipmentArmor, getEquipmentBonusMaxHp, getEquipmentHpRegen, getMainHandWeapon } from "./equipment";
import type { DamageType } from "../core/types";

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
// INITIALIZATION
// =============================================================================

/** Initialize equipment state with starting equipment. Call on game start. */
export function initializeEquipmentState(): void {
    equipmentState = {};
    for (const [id, equipment] of Object.entries(STARTING_EQUIPMENT)) {
        equipmentState[Number(id)] = { ...equipment };
    }
    inventoryState = {
        items: STARTING_INVENTORY.items.map(e => ({ ...e }))
    };
    isInitialized = true;
}

/** Reset equipment state (for game restart) */
export function resetEquipmentState(): void {
    isInitialized = false;
    equipmentState = {};
    inventoryState = { items: [] };
}

// =============================================================================
// GETTERS
// =============================================================================

/** Get equipment for a character. Returns empty equipment if not found. */
export function getCharacterEquipment(unitId: number): CharacterEquipment {
    if (!isInitialized) {
        initializeEquipmentState();
    }
    return equipmentState[unitId] ?? {
        armor: null,
        leftHand: null,
        rightHand: null,
        accessory1: null,
        accessory2: null,
    };
}

/** Get all character equipment (for persistence) */
export function getAllEquipment(): Record<number, CharacterEquipment> {
    if (!isInitialized) {
        initializeEquipmentState();
    }
    return { ...equipmentState };
}

/** Get party inventory */
export function getPartyInventory(): PartyInventory {
    if (!isInitialized) {
        initializeEquipmentState();
    }
    return inventoryState;
}

// =============================================================================
// SETTERS
// =============================================================================

/** Set equipment for a character */
export function setCharacterEquipment(unitId: number, equipment: CharacterEquipment): void {
    equipmentState[unitId] = equipment;
}

/** Set all character equipment (for loading saved state) */
export function setAllEquipment(equipment: Record<number, CharacterEquipment>): void {
    equipmentState = { ...equipment };
    isInitialized = true;
}

/** Set party inventory */
export function setPartyInventory(inventory: PartyInventory): void {
    inventoryState = inventory;
}

// =============================================================================
// COMPUTED STATS HELPERS
// =============================================================================

/** Monk unit ID for fist damage bonus */
const MONK_ID = 5;
const MONK_FIST_BONUS: [number, number] = [2, 4];

/** Get effective damage for a character based on equipment */
export function getEffectivePlayerDamage(unitId: number): [number, number] {
    const equipment = getCharacterEquipment(unitId);
    const weapon = getMainHandWeapon(equipment);
    const baseDamage = weapon.damage;

    // Monk gets innate bonus when using fists
    if (unitId === MONK_ID && weapon.id === "fist") {
        return [baseDamage[0] + MONK_FIST_BONUS[0], baseDamage[1] + MONK_FIST_BONUS[1]];
    }

    return baseDamage;
}

/** Get effective damage type for a character based on equipment */
export function getEffectivePlayerDamageType(unitId: number): DamageType {
    const equipment = getCharacterEquipment(unitId);
    const weapon = getMainHandWeapon(equipment);
    return weapon.damageType;
}

/** Get effective armor for a character based on equipment */
export function getEffectivePlayerArmor(unitId: number): number {
    const equipment = getCharacterEquipment(unitId);
    return getEquipmentArmor(equipment);
}

/** Get effective range for a character based on equipment (undefined = melee) */
export function getEffectivePlayerRange(unitId: number): number | undefined {
    const equipment = getCharacterEquipment(unitId);
    const weapon = getMainHandWeapon(equipment);
    return weapon.range;
}

/** Get projectile color for a character based on equipped weapon */
export function getEffectivePlayerProjectileColor(unitId: number): string | undefined {
    const equipment = getCharacterEquipment(unitId);
    const weapon = getMainHandWeapon(equipment);
    return weapon.projectileColor;
}

/** Get bonus max HP from equipment */
export function getEffectivePlayerBonusMaxHp(unitId: number): number {
    const equipment = getCharacterEquipment(unitId);
    return getEquipmentBonusMaxHp(equipment);
}

/** Get HP regen from equipment */
export function getEffectivePlayerHpRegen(unitId: number): { amount: number; interval: number } | null {
    const equipment = getCharacterEquipment(unitId);
    return getEquipmentHpRegen(equipment);
}
