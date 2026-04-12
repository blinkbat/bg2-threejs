// =============================================================================
// SMOKE TILES - Blind zone created by Thief's Smoke Bomb
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, StatusEffect, SmokeTile } from "../core/types";
import { COLORS, SMOKE_TILE_DURATION, SMOKE_TICK_INTERVAL, SMOKE_MAX_TILES, BUFF_TICK_INTERVAL, BLIND_DURATION } from "../core/constants";
import { rollChance, applyStatusEffect } from "../combat/combatMath";
import { createTileMesh, updateTileFade, removeExpiredTiles, getTileKey, isUnitOnTile, type TileProcessConfig } from "./tileUtils";

// =============================================================================
// CONSTANTS
// =============================================================================

const SMOKE_MESH_CONFIG = {
    color: COLORS.smoke,
    opacity: 0.35,
    yPosition: 0.03,
    name: "smokeTile"
} as const;

const SMOKE_PROCESS_CONFIG: TileProcessConfig = {
    fadeStartPercent: 0.3,
    baseOpacity: 0.35
};

// =============================================================================
// SMOKE TILE CREATION
// =============================================================================

/**
 * Create a new smoke tile at the given grid position.
 * Returns the tile, or null if max tiles reached.
 */
export function createSmokeTile(
    scene: THREE.Scene,
    smokeTiles: Map<string, SmokeTile>,
    gridX: number,
    gridZ: number,
    sourceId: number,
    blindChance: number,
    blindDuration: number,
    now: number
): SmokeTile | null {
    const key = getTileKey(gridX, gridZ);

    // Don't exceed max tiles
    if (smokeTiles.size >= SMOKE_MAX_TILES && !smokeTiles.has(key)) {
        return null;
    }

    // If tile already exists, refresh its duration
    const existing = smokeTiles.get(key);
    if (existing) {
        existing.elapsedTime = 0;
        existing.lastUpdateTime = now;
        existing.duration = SMOKE_TILE_DURATION;
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = SMOKE_MESH_CONFIG.opacity;
        return existing;
    }

    // Create new tile
    const mesh = createTileMesh(gridX, gridZ, SMOKE_MESH_CONFIG);
    scene.add(mesh);

    const tile: SmokeTile = {
        mesh,
        x: gridX,
        z: gridZ,
        elapsedTime: 0,
        lastUpdateTime: now,
        duration: SMOKE_TILE_DURATION,
        timeSinceTick: 0,
        sourceId
    };

    // Store blind params on tile userData for processing
    mesh.userData.blindChance = blindChance;
    mesh.userData.blindDuration = blindDuration;

    smokeTiles.set(key, tile);
    return tile;
}

// =============================================================================
// SMOKE TILE PROCESSING
// =============================================================================

/**
 * Process smoke tile blind application and decay.
 * Called every frame from the game loop.
 * Enemies standing in smoke have a chance to be blinded each tick.
 */
export function processSmokeTiles(
    smokeTiles: Map<string, SmokeTile>,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    now: number
): void {
    const tilesToRemove: string[] = [];
    const blindTargets = new Map<number, { chance: number; duration: number }>();

    // Pre-compute enemy positions by tile key
    const enemyUnitsByTile = new Map<string, Array<{ unit: Unit; group: UnitGroup }>>();
    for (const unit of unitsState) {
        if (unit.hp <= 0 || unit.team !== "enemy") continue;
        const unitG = unitsRef[unit.id];
        if (!unitG) continue;
        const key = getTileKey(Math.floor(unitG.position.x), Math.floor(unitG.position.z));
        const existing = enemyUnitsByTile.get(key);
        if (existing) {
            existing.push({ unit, group: unitG });
        } else {
            enemyUnitsByTile.set(key, [{ unit, group: unitG }]);
        }
    }

    smokeTiles.forEach((tile, key) => {
        // Accumulate time (pause-safe delta, capped)
        const rawDelta = now - tile.lastUpdateTime;
        const delta = Math.min(rawDelta, 100);
        tile.timeSinceTick += delta;

        // Handle expiration and fade
        if (updateTileFade(tile, now, SMOKE_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        // Check for blind tick
        if (tile.timeSinceTick >= SMOKE_TICK_INTERVAL) {
            tile.timeSinceTick = 0;
            const tileOccupants = enemyUnitsByTile.get(key);
            if (!tileOccupants || tileOccupants.length === 0) return;

            const blindChance = (tile.mesh.userData.blindChance as number) ?? 70;
            const blindDuration = (tile.mesh.userData.blindDuration as number) ?? BLIND_DURATION;

            for (const { unit, group } of tileOccupants) {
                if (!isUnitOnTile(group.position.x, group.position.z, tile.x, tile.z)) continue;
                // Only set if not already queued with a longer duration
                const existing = blindTargets.get(unit.id);
                if (!existing || blindDuration > existing.duration) {
                    blindTargets.set(unit.id, { chance: blindChance, duration: blindDuration });
                }
            }
        }
    });

    // Apply blind to enemies that passed the check
    if (blindTargets.size > 0) {
        const blindedIds = new Set<number>();
        for (const [unitId, { chance }] of blindTargets) {
            if (rollChance(chance)) {
                blindedIds.add(unitId);
            }
        }

        if (blindedIds.size > 0) {
            setUnits(prev => prev.map(u => {
                if (!blindedIds.has(u.id) || u.hp <= 0) return u;
                const params = blindTargets.get(u.id)!;
                const blindEffect: StatusEffect = {
                    type: "blind",
                    duration: params.duration,
                    tickInterval: BUFF_TICK_INTERVAL,
                    timeSinceTick: 0,
                    lastUpdateTime: now,
                    damagePerTick: 0,
                    sourceId: 0
                };
                return { ...u, statusEffects: applyStatusEffect(u.statusEffects, blindEffect) };
            }));
        }
    }

    removeExpiredTiles(smokeTiles, tilesToRemove, scene);
}
