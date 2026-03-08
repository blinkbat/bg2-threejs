// =============================================================================
// TILE UTILITIES - Shared logic for ground tile systems (acid, sanctuary, etc.)
// =============================================================================

import * as THREE from "three";
import { disposeBasicMesh } from "../rendering/disposal";

// =============================================================================
// TYPES
// =============================================================================

/** Base interface for all tile types (pause-safe with delta time accumulation) */
interface BaseTile {
    mesh: THREE.Mesh;
    x: number;
    z: number;
    elapsedTime: number;     // Accumulated elapsed time
    lastUpdateTime: number;  // For delta calculation
    duration: number;
}

/** Configuration for creating tile meshes */
interface TileMeshConfig {
    color: string;
    opacity: number;
    yPosition: number;
    name: string;
    radius?: number;
    segments?: number;
}

/** Configuration for tile processing */
export interface TileProcessConfig {
    fadeStartPercent: number;  // When to start fading (0.5 = 50% remaining)
    baseOpacity: number;       // Original opacity to fade from
}

// =============================================================================
// MESH CREATION
// =============================================================================

/**
 * Create a ground tile mesh at the given grid position.
 * All tile types use the same base geometry (flat circle on ground).
 */
export function createTileMesh(x: number, z: number, config: TileMeshConfig): THREE.Mesh {
    const radius = config.radius ?? 0.45;
    const segments = config.segments ?? 16;

    const geometry = new THREE.CircleGeometry(radius, segments);
    const material = new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: config.opacity,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, config.yPosition, z + 0.5);
    mesh.name = config.name;
    return mesh;
}

// =============================================================================
// TILE LIFECYCLE
// =============================================================================

/**
 * Update tile elapsed time using delta accumulation (pause-safe).
 * Also updates opacity based on remaining time (fade effect).
 * Returns true if tile has expired and should be removed.
 */
export function updateTileFade<T extends BaseTile>(
    tile: T,
    now: number,
    config: TileProcessConfig
): boolean {
    // Accumulate elapsed time using delta (pause-safe)
    // Cap delta to prevent pause/unpause from causing instant expiration
    const rawDelta = now - tile.lastUpdateTime;
    const delta = Math.min(rawDelta, 100); // Max 100ms per frame
    tile.elapsedTime += delta;
    tile.lastUpdateTime = now;

    // Check if expired
    if (tile.elapsedTime >= tile.duration) {
        return true;
    }

    // Update opacity based on remaining time
    const remaining = tile.duration - tile.elapsedTime;
    const fadeStart = tile.duration * config.fadeStartPercent;
    if (remaining < fadeStart) {
        const fadeProgress = remaining / fadeStart;
        (tile.mesh.material as THREE.MeshBasicMaterial).opacity = config.baseOpacity * fadeProgress;
    }

    return false;
}

/**
 * Remove and dispose a list of tiles by their keys.
 */
export function removeExpiredTiles<T extends BaseTile>(
    tiles: Map<string, T>,
    keysToRemove: string[],
    scene: THREE.Scene
): void {
    keysToRemove.forEach(key => {
        const tile = tiles.get(key);
        if (tile) {
            disposeBasicMesh(scene, tile.mesh);
            tiles.delete(key);
        }
    });
}

/**
 * Get tile key from grid coordinates.
 */
export function getTileKey(gridX: number, gridZ: number): string {
    return `${gridX},${gridZ}`;
}

/**
 * Check if a unit is standing on a specific grid cell.
 */
export function isUnitOnTile(
    unitX: number,
    unitZ: number,
    tileX: number,
    tileZ: number
): boolean {
    const unitGridX = Math.floor(unitX);
    const unitGridZ = Math.floor(unitZ);
    return unitGridX === tileX && unitGridZ === tileZ;
}

/**
 * Iterate all integer grid cells within a circular radius, calling `fn` for each.
 * Computes `Math.ceil(radius)` offsets in each axis and filters by Euclidean distance.
 */
export function forEachTileInRadius(
    centerX: number,
    centerZ: number,
    radius: number,
    fn: (x: number, z: number) => void
): void {
    const radiusCeil = Math.ceil(radius);
    for (let dx = -radiusCeil; dx <= radiusCeil; dx++) {
        for (let dz = -radiusCeil; dz <= radiusCeil; dz++) {
            if (Math.hypot(dx, dz) > radius) continue;
            fn(centerX + dx, centerZ + dz);
        }
    }
}

/**
 * Create a ground warning tile (PlaneGeometry 0.9x0.9) used by telegraphed AoE attacks.
 * Consolidates the identical createChargeTile / createCurseTile helpers.
 */
export function createGroundWarningTile(
    scene: THREE.Scene,
    x: number,
    z: number,
    color: string,
    name: string
): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, 0.05, z + 0.5);
    mesh.name = name;
    scene.add(mesh);
    return mesh;
}
