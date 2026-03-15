// =============================================================================
// FIRE TILES - Burning ground created by Wizard skills
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, FireTile } from "../core/types";
import { COLORS, FIRE_TILE_DURATION, FIRE_TICK_INTERVAL, FIRE_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { getUnitRadius, isInRange } from "../rendering/range";
import { buildDamageContext, applyDamageToUnit } from "../combat/damageEffects";
import { isUnitAlive } from "../combat/combatMath";
import { createTileMesh, updateTileFade, removeExpiredTiles, getTileKey, type TileProcessConfig } from "./tileUtils";

// =============================================================================
// CONSTANTS
// =============================================================================

const FIRE_MESH_CONFIG = {
    color: COLORS.fireGround,
    opacity: 0.5,
    yPosition: 0.025,
    name: "fireTile"
} as const;

const FIRE_PROCESS_CONFIG: TileProcessConfig = {
    fadeStartPercent: 0.3,
    baseOpacity: 0.5
};
const FIRE_TILE_HIT_RADIUS = 0.45;

// =============================================================================
// FIRE TILE CREATION
// =============================================================================

/**
 * Create or refresh a fire tile.
 * Returns the tile, or null if tile limit would be exceeded.
 */
export function createFireTile(
    scene: THREE.Scene,
    fireTiles: Map<string, FireTile>,
    gridX: number,
    gridZ: number,
    sourceId: number,
    damagePerTick: number,
    now: number,
    duration: number = FIRE_TILE_DURATION
): FireTile | null {
    const key = getTileKey(gridX, gridZ);

    if (fireTiles.size >= FIRE_MAX_TILES && !fireTiles.has(key)) {
        return null;
    }

    const existing = fireTiles.get(key);
    if (existing) {
        existing.elapsedTime = 0;
        existing.lastUpdateTime = now;
        existing.duration = duration;
        existing.damagePerTick = damagePerTick;
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = FIRE_MESH_CONFIG.opacity;
        return existing;
    }

    const mesh = createTileMesh(gridX, gridZ, FIRE_MESH_CONFIG);
    scene.add(mesh);

    const tile: FireTile = {
        mesh,
        x: gridX,
        z: gridZ,
        elapsedTime: 0,
        lastUpdateTime: now,
        duration,
        timeSinceTick: 0,
        sourceId,
        damagePerTick
    };

    fireTiles.set(key, tile);
    return tile;
}

// =============================================================================
// FIRE TILE PROCESSING
// =============================================================================

/**
 * Process fire tile damage and decay.
 */
export function processFireTiles(
    fireTiles: Map<string, FireTile>,
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
    const damagedThisTick = new Set<number>();
    const enemyUnitsByCell = new Map<string, Array<{ unit: Unit; group: UnitGroup; radius: number }>>();
    const damageCtx = buildDamageContext(
        scene,
        damageTexts,
        hitFlashRef,
        unitsRef,
        unitsState,
        setUnits,
        addLog,
        now,
        defeatedThisFrame
    );
    for (const unit of unitsState) {
        if (!isUnitAlive(unit, defeatedThisFrame) || unit.team !== "enemy") continue;
        const unitG = unitsRef[unit.id];
        if (!unitG) continue;
        const key = getTileKey(Math.floor(unitG.position.x), Math.floor(unitG.position.z));
        const bucket = enemyUnitsByCell.get(key);
        const entry = { unit, group: unitG, radius: getUnitRadius(unit) };
        if (bucket) {
            bucket.push(entry);
        } else {
            enemyUnitsByCell.set(key, [entry]);
        }
    }

    fireTiles.forEach((tile, key) => {
        const rawDelta = now - tile.lastUpdateTime;
        const delta = Math.min(rawDelta, 100);
        tile.timeSinceTick += delta;

        if (updateTileFade(tile, now, FIRE_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        if (tile.timeSinceTick < FIRE_TICK_INTERVAL) {
            return;
        }
        tile.timeSinceTick = 0;

        const tileCenterX = tile.x + 0.5;
        const tileCenterZ = tile.z + 0.5;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const candidates = enemyUnitsByCell.get(getTileKey(tile.x + dx, tile.z + dz));
                if (!candidates) continue;
                for (const candidate of candidates) {
                    if (damagedThisTick.has(candidate.unit.id)) continue;
                    const overlapsTile = isInRange(
                        tileCenterX,
                        tileCenterZ,
                        candidate.group.position.x,
                        candidate.group.position.z,
                        candidate.radius,
                        FIRE_TILE_HIT_RADIUS
                    );
                    if (!overlapsTile) continue;

                    const data = getUnitStats(candidate.unit);
                    applyDamageToUnit(damageCtx, candidate.unit.id, candidate.group, tile.damagePerTick, data.name, {
                        color: COLORS.fireGroundText,
                        targetUnit: candidate.unit,
                        damageType: "fire"
                    });
                    damagedThisTick.add(candidate.unit.id);
                }
            }
        }
    });

    removeExpiredTiles(fireTiles, tilesToRemove, scene);
}
