// =============================================================================
// HOLY TILES - Smiting ground created by Cleric skills
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, HolyTile } from "../core/types";
import { COLORS, HOLY_TILE_DURATION, HOLY_TICK_INTERVAL, HOLY_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { getUnitRadius, isInRange } from "../rendering/range";
import { buildDamageContext, applyDamageToUnit } from "../combat/damageEffects";
import { isUnitAlive } from "../combat/combatMath";
import { createTileMesh, updateTileFade, removeExpiredTiles, clearAllTiles, getTileKey, type TileProcessConfig } from "./tileUtils";

// =============================================================================
// CONSTANTS
// =============================================================================

const HOLY_MESH_CONFIG = {
    color: COLORS.holyGround,
    opacity: 0.45,
    yPosition: 0.025,
    name: "holyTile"
} as const;

const HOLY_PROCESS_CONFIG: TileProcessConfig = {
    fadeStartPercent: 0.35,
    baseOpacity: 0.45
};
const HOLY_TILE_HIT_RADIUS = 0.45;

// =============================================================================
// HOLY TILE CREATION
// =============================================================================

/**
 * Create or refresh a holy tile.
 * Returns the tile, or null if tile limit would be exceeded.
 */
export function createHolyTile(
    scene: THREE.Scene,
    holyTiles: Map<string, HolyTile>,
    gridX: number,
    gridZ: number,
    sourceId: number,
    damagePerTick: number,
    now: number,
    duration: number = HOLY_TILE_DURATION
): HolyTile | null {
    const key = getTileKey(gridX, gridZ);

    if (holyTiles.size >= HOLY_MAX_TILES && !holyTiles.has(key)) {
        return null;
    }

    const existing = holyTiles.get(key);
    if (existing) {
        existing.elapsedTime = 0;
        existing.lastUpdateTime = now;
        existing.duration = duration;
        existing.damagePerTick = damagePerTick;
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = HOLY_MESH_CONFIG.opacity;
        return existing;
    }

    const mesh = createTileMesh(gridX, gridZ, HOLY_MESH_CONFIG);
    scene.add(mesh);

    const tile: HolyTile = {
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

    holyTiles.set(key, tile);
    return tile;
}

/**
 * Create or refresh holy tiles in a cross pattern centered on a world position.
 * Returns number of unique tiles touched.
 */
export function createHolyCross(
    scene: THREE.Scene,
    holyTiles: Map<string, HolyTile>,
    centerX: number,
    centerZ: number,
    sourceId: number,
    damagePerTick: number,
    now: number,
    armLengthCells: number,
    armWidthCells: number = 1,
    duration: number = HOLY_TILE_DURATION
): number {
    const extension = Math.max(1, Math.round(armLengthCells));
    const widthCells = Math.max(1, Math.round(armWidthCells));
    const originX = Math.floor(centerX - (widthCells - 1) * 0.5);
    const originZ = Math.floor(centerZ - (widthCells - 1) * 0.5);
    const touched = new Set<string>();

    const touchTile = (x: number, z: number): void => {
        if (createHolyTile(scene, holyTiles, x, z, sourceId, damagePerTick, now, duration)) {
            touched.add(getTileKey(x, z));
        }
    };

    const horizontalStartX = originX - extension;
    const horizontalEndX = originX + widthCells - 1 + extension;
    const horizontalStartZ = originZ;
    const horizontalEndZ = originZ + widthCells - 1;

    for (let x = horizontalStartX; x <= horizontalEndX; x++) {
        for (let z = horizontalStartZ; z <= horizontalEndZ; z++) {
            touchTile(x, z);
        }
    }

    const verticalStartX = originX;
    const verticalEndX = originX + widthCells - 1;
    const verticalStartZ = originZ - extension;
    const verticalEndZ = originZ + widthCells - 1 + extension;

    for (let x = verticalStartX; x <= verticalEndX; x++) {
        for (let z = verticalStartZ; z <= verticalEndZ; z++) {
            touchTile(x, z);
        }
    }

    return touched.size;
}

// =============================================================================
// HOLY TILE PROCESSING
// =============================================================================

/**
 * Process holy tile damage and decay.
 */
export function processHolyTiles(
    holyTiles: Map<string, HolyTile>,
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

    holyTiles.forEach((tile, key) => {
        const rawDelta = now - tile.lastUpdateTime;
        const delta = Math.min(rawDelta, 100);
        tile.timeSinceTick += delta;

        if (updateTileFade(tile, now, HOLY_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        if (tile.timeSinceTick < HOLY_TICK_INTERVAL) {
            return;
        }
        tile.timeSinceTick = 0;

        for (const unit of unitsState) {
            if (!isUnitAlive(unit, defeatedThisFrame) || unit.team !== "enemy") continue;
            if (damagedThisTick.has(unit.id)) continue;

            const unitG = unitsRef[unit.id];
            if (!unitG) continue;

            const unitRadius = getUnitRadius(unit);
            const tileCenterX = tile.x + 0.5;
            const tileCenterZ = tile.z + 0.5;
            const overlapsTile = isInRange(
                tileCenterX,
                tileCenterZ,
                unitG.position.x,
                unitG.position.z,
                unitRadius,
                HOLY_TILE_HIT_RADIUS
            );
            if (!overlapsTile) continue;

            const data = getUnitStats(unit);
            applyDamageToUnit(damageCtx, unit.id, unitG, tile.damagePerTick, data.name, {
                color: COLORS.holyGroundText,
                targetUnit: unit,
                damageType: "holy"
            });
            damagedThisTick.add(unit.id);
        }
    });

    removeExpiredTiles(holyTiles, tilesToRemove, scene);
}

/**
 * Clear all holy tiles from the scene.
 */
export function clearHolyTiles(holyTiles: Map<string, HolyTile>, scene: THREE.Scene): void {
    clearAllTiles(holyTiles, scene);
}
