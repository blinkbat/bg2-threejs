// =============================================================================
// SANCTUARY TILES - Holy ground created by Paladin that heals allies
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, SanctuaryTile, AcidTile } from "../core/types";
import { COLORS, SANCTUARY_TILE_DURATION, SANCTUARY_TICK_INTERVAL, SANCTUARY_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { getEffectiveMaxHp } from "../game/playerUnits";
import { spawnDamageNumber } from "../combat/damageEffects";
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
        existing.elapsedTime = 0;
        existing.lastUpdateTime = now;
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
        elapsedTime: 0,
        lastUpdateTime: now,
        duration: SANCTUARY_TILE_DURATION,
        timeSinceTick: 0,
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
    const requestedHealById = new Map<number, number>();
    const unitNameById = new Map<number, string>();

    sanctuaryTiles.forEach((tile, key) => {
        // Accumulate time since last tick (pause-safe delta)
        // Cap delta to prevent pause/unpause from causing instant multi-ticks
        const rawDelta = now - tile.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        tile.timeSinceTick += delta;

        // Handle expiration and fade (also updates lastUpdateTime)
        if (updateTileFade(tile, now, SANCTUARY_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        // Check for heal tick
        if (tile.timeSinceTick >= SANCTUARY_TICK_INTERVAL) {
            tile.timeSinceTick = 0;

            // Find player units standing on this tile
            for (const unit of unitsState) {
                if (unit.hp <= 0 || unit.team !== "player") continue;

                const unitG = unitsRef[unit.id];
                if (!unitG) continue;

                if (isUnitOnTile(unitG.position.x, unitG.position.z, tile.x, tile.z)) {
                    const existing = requestedHealById.get(unit.id) ?? 0;
                    requestedHealById.set(unit.id, existing + tile.healPerTick);
                    if (!unitNameById.has(unit.id)) {
                        unitNameById.set(unit.id, getUnitStats(unit).name);
                    }
                }
            }
        }
    });

    if (requestedHealById.size > 0) {
        let actualHealById = new Map<number, number>();
        setUnits(prev => {
            const frameHeals = new Map<number, number>();
            const nextUnits = prev.map(u => {
                const requestedHeal = requestedHealById.get(u.id);
                if (!requestedHeal || u.hp <= 0) return u;

                const maxHp = getEffectiveMaxHp(u.id, u);
                if (u.hp >= maxHp) return u;

                const actualHeal = Math.min(requestedHeal, maxHp - u.hp);
                if (actualHeal <= 0) return u;

                frameHeals.set(u.id, actualHeal);
                return { ...u, hp: u.hp + actualHeal };
            });
            actualHealById = frameHeals;
            return nextUnits;
        });

        for (const [unitId, healAmount] of actualHealById.entries()) {
            const unitG = unitsRef[unitId];
            if (!unitG) continue;
            const unitName = unitNameById.get(unitId) ?? "Ally";
            spawnDamageNumber(scene, unitG.position.x, unitG.position.z, healAmount, COLORS.sanctuaryText, damageTexts, true);
            addLog(`${unitName} is healed for ${healAmount} by Sanctuary.`, COLORS.sanctuaryText);
        }
    }

    removeExpiredTiles(sanctuaryTiles, tilesToRemove, scene);
}

/**
 * Clear all sanctuary tiles from the scene.
 * Called on game restart.
 */
export function clearSanctuaryTiles(sanctuaryTiles: Map<string, SanctuaryTile>, scene: THREE.Scene): void {
    clearAllTiles(sanctuaryTiles, scene);
}
