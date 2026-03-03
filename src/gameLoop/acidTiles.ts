// =============================================================================
// ACID TILES - Ground hazards created by acid slugs
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, AcidTile } from "../core/types";
import { COLORS, ACID_TILE_DURATION, ACID_TICK_INTERVAL, ACID_DAMAGE_PER_TICK, ACID_MAX_TILES, ACID_AURA_COOLDOWN, ACID_AURA_RADIUS } from "../core/constants";
import type { EnemyStats } from "../core/types";
import { getUnitStats } from "../game/units";
import { applyDamageToUnit, buildDamageContext } from "../combat/damageEffects";
import { createTileMesh, updateTileFade, removeExpiredTiles, clearAllTiles, getTileKey, isUnitOnTile, forEachTileInRadius, type TileProcessConfig } from "./tileUtils";
import { isUnitAlive, setSkillCooldown } from "../combat/combatMath";

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
    now: number,
    duration: number = ACID_TILE_DURATION
): AcidTile | null {
    const key = getTileKey(gridX, gridZ);

    // Don't exceed max tiles
    if (acidTiles.size >= ACID_MAX_TILES && !acidTiles.has(key)) {
        return null;
    }

    // If tile already exists, refresh its duration
    const existing = acidTiles.get(key);
    if (existing) {
        existing.elapsedTime = 0;
        existing.lastUpdateTime = now;
        existing.duration = duration;
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
        elapsedTime: 0,
        lastUpdateTime: now,
        duration,
        timeSinceTick: 0,
        sourceId
    };

    acidTiles.set(key, tile);
    return tile;
}

/**
 * Create or refresh an acid pool centered on a position.
 * Returns the number of tiles touched (created or refreshed).
 */
export function createAcidPool(
    scene: THREE.Scene,
    acidTiles: Map<string, AcidTile>,
    centerX: number,
    centerZ: number,
    sourceId: number,
    now: number,
    radius: number,
    duration: number = ACID_TILE_DURATION
): number {
    const originX = Math.floor(centerX);
    const originZ = Math.floor(centerZ);
    let tilesTouched = 0;

    forEachTileInRadius(originX, originZ, radius, (x, z) => {
        if (createAcidTile(scene, acidTiles, x, z, sourceId, now, duration)) {
            tilesTouched++;
        }
    });

    return tilesTouched;
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
    const unitsByTileKey = new Map<string, Array<{ unit: Unit; group: UnitGroup }>>();
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
        if (!isUnitAlive(unit, defeatedThisFrame)) continue;
        if (unit.enemyType === "acid_slug") continue;
        const unitG = unitsRef[unit.id];
        if (!unitG) continue;
        const key = getTileKey(Math.floor(unitG.position.x), Math.floor(unitG.position.z));
        const existing = unitsByTileKey.get(key);
        if (existing) {
            existing.push({ unit, group: unitG });
        } else {
            unitsByTileKey.set(key, [{ unit, group: unitG }]);
        }
    }

    acidTiles.forEach((tile, key) => {
        // Accumulate time since last tick (pause-safe delta)
        // Cap delta to prevent pause/unpause from causing instant multi-ticks
        const rawDelta = now - tile.lastUpdateTime;
        const delta = Math.min(rawDelta, 100); // Max 100ms per frame
        tile.timeSinceTick += delta;

        // Handle expiration and fade (also updates lastUpdateTime)
        if (updateTileFade(tile, now, ACID_PROCESS_CONFIG)) {
            tilesToRemove.push(key);
            return;
        }

        // Check for damage tick
        if (tile.timeSinceTick >= ACID_TICK_INTERVAL) {
            tile.timeSinceTick = 0;
            const tileOccupants = unitsByTileKey.get(key);
            if (!tileOccupants || tileOccupants.length === 0) return;

            // Damage only units currently overlapping this tile footprint.
            for (const { unit, group } of tileOccupants) {
                if (!isUnitOnTile(group.position.x, group.position.z, tile.x, tile.z)) continue;
                const dmg = ACID_DAMAGE_PER_TICK;
                const data = getUnitStats(unit);
                applyDamageToUnit(damageCtx, unit.id, group, dmg, data.name, {
                    color: COLORS.acidText,
                    hitMessage: { text: `${data.name} takes ${dmg} acid damage.`, color: COLORS.acidText },
                    targetUnit: unit,
                    damageType: "physical"
                });
            }
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

// =============================================================================
// ACID AURA - Periodic acid creation around stationary acid-aura enemies
// =============================================================================

export interface AcidAuraContext {
    scene: THREE.Scene;
    acidTiles: Map<string, AcidTile>;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    unitId: number;
    centerX: number;
    centerZ: number;
    now: number;
}

/**
 * Try to create acid aura tiles around a stationary acid-aura enemy.
 * Handles cooldown checking and tile creation in a radius.
 * @param stats - Enemy stats (must have acidAura: true)
 * @param ctx - Context with scene, tiles, cooldowns, position, and timing
 * @returns true if aura was created, false if on cooldown
 */
export function tryCreateAcidAura(stats: EnemyStats, ctx: AcidAuraContext): boolean {
    if (!stats.acidAura) return false;

    const auraCooldownKey = `${ctx.unitId}-acidAura`;
    const auraCooldownEnd = ctx.skillCooldowns[auraCooldownKey]?.end ?? 0;

    if (ctx.now < auraCooldownEnd) return false;

    const auraCooldown = stats.acidAuraCooldown ?? ACID_AURA_COOLDOWN;
    const auraRadius = stats.acidAuraRadius ?? ACID_AURA_RADIUS;
    createAcidPool(ctx.scene, ctx.acidTiles, ctx.centerX, ctx.centerZ, ctx.unitId, ctx.now, auraRadius);

    setSkillCooldown(ctx.setSkillCooldowns, auraCooldownKey, auraCooldown, ctx.now);

    return true;
}
