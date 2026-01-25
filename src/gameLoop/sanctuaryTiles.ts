// =============================================================================
// SANCTUARY TILES - Holy ground created by Paladin that heals allies
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, SanctuaryTile, AcidTile } from "../core/types";
import { COLORS, SANCTUARY_TILE_DURATION, SANCTUARY_TICK_INTERVAL, SANCTUARY_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { spawnDamageNumber } from "../combat/combat";
import { disposeBasicMesh } from "../rendering/disposal";
import { createTileMesh, updateTileFade, removeExpiredTiles, clearAllTiles, getTileKey, isUnitOnTile, type TileProcessConfig } from "./tileUtils";

// =============================================================================
// CONSTANTS
// =============================================================================

const SANCTUARY_MESH_CONFIG = {
    color: COLORS.sanctuary,
    opacity: 0.4,
    yPosition: 0.03,
    name: "sanctuaryTile"
} as const;

const SANCTUARY_PROCESS_CONFIG: TileProcessConfig = {
    fadeStartPercent: 0.3,
    baseOpacity: 0.4
};

// =============================================================================
// SANCTUARY TILE CREATION
// =============================================================================

/**
 * Create a new sanctuary tile at the given grid position.
 * Also removes any acid tile at the same position.
 * Returns the tile, or null if max tiles reached.
 */
export function createSanctuaryTile(
    scene: THREE.Scene,
    sanctuaryTiles: Map<string, SanctuaryTile>,
    acidTiles: Map<string, AcidTile>,
    gridX: number,
    gridZ: number,
    sourceId: number,
    healPerTick: number,
    now: number
): SanctuaryTile | null {
    const key = getTileKey(gridX, gridZ);

    // Remove any acid tile at this position
    const existingAcid = acidTiles.get(key);
    if (existingAcid) {
        disposeBasicMesh(scene, existingAcid.mesh);
        acidTiles.delete(key);
    }

    // Don't exceed max tiles
    if (sanctuaryTiles.size >= SANCTUARY_MAX_TILES && !sanctuaryTiles.has(key)) {
        return null;
    }

    // If tile already exists, refresh its duration
    const existing = sanctuaryTiles.get(key);
    if (existing) {
        existing.createdAt = now;
        existing.duration = SANCTUARY_TILE_DURATION;
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = SANCTUARY_MESH_CONFIG.opacity;
        return existing;
    }

    // Create new tile
    const mesh = createTileMesh(gridX, gridZ, SANCTUARY_MESH_CONFIG);
    scene.add(mesh);

    const tile: SanctuaryTile = {
        mesh,
        x: gridX,
        z: gridZ,
        createdAt: now,
        duration: SANCTUARY_TILE_DURATION,
        lastHealTick: now,
        sourceId,
        healPerTick
    };

    sanctuaryTiles.set(key, tile);
    return tile;
}

// =============================================================================
// SANCTUARY TILE PROCESSING
// =============================================================================

/**
 * Process sanctuary tile healing and decay.
 * Called every frame from the game loop.
 */
export function processSanctuaryTiles(
    sanctuaryTiles: Map<string, SanctuaryTile>,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number
): void {
    const tilesToRemove: string[] = [];

    sanctuaryTiles.forEach((tile, key) => {
        // Handle expiration and fade
        if (updateTileFade(tile, now, SANCTUARY_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        // Check for heal tick
        if (now - tile.lastHealTick >= SANCTUARY_TICK_INTERVAL) {
            tile.lastHealTick = now;

            // Find player units standing on this tile
            unitsState.forEach(unit => {
                if (unit.hp <= 0 || unit.team !== "player") return;

                const unitG = unitsRef[unit.id];
                if (!unitG) return;

                if (isUnitOnTile(unitG.position.x, unitG.position.z, tile.x, tile.z)) {
                    const data = getUnitStats(unit);
                    const maxHp = data.maxHp;

                    // Only heal if not at max HP
                    if (unit.hp < maxHp) {
                        const healAmount = Math.min(tile.healPerTick, maxHp - unit.hp);

                        setUnits(prev => prev.map(u => {
                            if (u.id !== unit.id) return u;
                            return { ...u, hp: Math.min(maxHp, u.hp + healAmount) };
                        }));

                        spawnDamageNumber(scene, unitG.position.x, unitG.position.z, healAmount, COLORS.sanctuaryText, damageTexts, true);
                        addLog(`${data.name} is healed for ${healAmount} by Sanctuary.`, COLORS.sanctuaryText);
                    }
                }
            });
        }
    });

    removeExpiredTiles(sanctuaryTiles, tilesToRemove, scene);
}

/**
 * Clear all sanctuary tiles from the scene.
 * Called on game restart.
 */
export function clearSanctuaryTiles(sanctuaryTiles: Map<string, SanctuaryTile>, scene: THREE.Scene): void {
    clearAllTiles(sanctuaryTiles, scene);
}
