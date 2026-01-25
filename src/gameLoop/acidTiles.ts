// =============================================================================
// ACID TILES - Ground hazards created by acid slugs
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, AcidTile } from "../core/types";
import { COLORS, ACID_TILE_DURATION, ACID_TICK_INTERVAL, ACID_DAMAGE_PER_TICK, ACID_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { handleUnitDefeat, showDamageVisual } from "../combat/combat";
import { createTileMesh, updateTileFade, removeExpiredTiles, clearAllTiles, getTileKey, isUnitOnTile, type TileProcessConfig } from "./tileUtils";
import { isUnitAlive } from "../combat/combatMath";

// =============================================================================
// CONSTANTS
// =============================================================================

const ACID_MESH_CONFIG = {
    color: COLORS.acid,
    opacity: 0.5,
    yPosition: 0.02,
    name: "acidTile"
} as const;

const ACID_PROCESS_CONFIG: TileProcessConfig = {
    fadeStartPercent: 0.5,
    baseOpacity: 0.5
};

// =============================================================================
// ACID TILE CREATION
// =============================================================================

/**
 * Create a new acid tile at the given grid position.
 * Returns the tile, or null if max tiles reached or tile already exists.
 */
export function createAcidTile(
    scene: THREE.Scene,
    acidTiles: Map<string, AcidTile>,
    gridX: number,
    gridZ: number,
    sourceId: number,
    now: number
): AcidTile | null {
    const key = getTileKey(gridX, gridZ);

    // Don't exceed max tiles
    if (acidTiles.size >= ACID_MAX_TILES && !acidTiles.has(key)) {
        return null;
    }

    // If tile already exists, refresh its duration
    const existing = acidTiles.get(key);
    if (existing) {
        existing.createdAt = now;
        existing.duration = ACID_TILE_DURATION;
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = ACID_MESH_CONFIG.opacity;
        return existing;
    }

    // Create new tile
    const mesh = createTileMesh(gridX, gridZ, ACID_MESH_CONFIG);
    scene.add(mesh);

    const tile: AcidTile = {
        mesh,
        x: gridX,
        z: gridZ,
        createdAt: now,
        duration: ACID_TILE_DURATION,
        lastDamageTick: now,
        sourceId
    };

    acidTiles.set(key, tile);
    return tile;
}

// =============================================================================
// ACID TILE PROCESSING
// =============================================================================

/**
 * Process acid tile damage and decay.
 * Called every frame from the game loop.
 */
export function processAcidTiles(
    acidTiles: Map<string, AcidTile>,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    const tilesToRemove: string[] = [];

    acidTiles.forEach((tile, key) => {
        // Handle expiration and fade
        if (updateTileFade(tile, now, ACID_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        // Check for damage tick
        if (now - tile.lastDamageTick >= ACID_TICK_INTERVAL) {
            tile.lastDamageTick = now;

            // Find units standing on this tile (acid slugs are immune)
            unitsState.forEach(unit => {
                if (!isUnitAlive(unit, defeatedThisFrame)) return;
                if (unit.enemyType === "acid_slug") return;

                const unitG = unitsRef[unit.id];
                if (!unitG) return;

                if (isUnitOnTile(unitG.position.x, unitG.position.z, tile.x, tile.z)) {
                    const dmg = ACID_DAMAGE_PER_TICK;
                    const data = getUnitStats(unit);
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;
                        return { ...u, hp: newHp };
                    }));

                    showDamageVisual(scene, unit.id, unitG.position.x, unitG.position.z, dmg, COLORS.acidText, hitFlashRef, damageTexts, addLog, `${data.name} takes ${dmg} acid damage.`, now);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            });
        }
    });

    removeExpiredTiles(acidTiles, tilesToRemove, scene);
}

/**
 * Clear all acid tiles from the scene.
 * Called on game restart.
 */
export function clearAcidTiles(acidTiles: Map<string, AcidTile>, scene: THREE.Scene): void {
    clearAllTiles(acidTiles, scene);
}
