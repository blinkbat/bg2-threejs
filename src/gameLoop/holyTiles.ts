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
import { createTileMesh, updateTileFade, removeExpiredTiles, getTileKey, type TileProcessConfig } from "./tileUtils";

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
function createHolyTile(
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
                        HOLY_TILE_HIT_RADIUS
                    );
                    if (!overlapsTile) continue;

                    const data = getUnitStats(candidate.unit);
                    applyDamageToUnit(damageCtx, candidate.unit.id, candidate.group, tile.damagePerTick, data.name, {
                        color: COLORS.holyGroundText,
                        targetUnit: candidate.unit,
                        damageType: "holy"
                    });
                    damagedThisTick.add(candidate.unit.id);
                }
            }
        }
    });

    removeExpiredTiles(holyTiles, tilesToRemove, scene);
}
