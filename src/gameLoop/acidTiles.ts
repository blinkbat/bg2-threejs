// =============================================================================
// ACID TILES - Ground hazards created by acid slugs
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, AcidTile } from "../core/types";
import { COLORS, ACID_TILE_DURATION, ACID_TICK_INTERVAL, ACID_DAMAGE_PER_TICK, ACID_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { spawnDamageNumber, handleUnitDefeat } from "../combat/combat";

// =============================================================================
// ACID TILE CREATION
// =============================================================================

/**
 * Create an acid tile mesh at the given grid position.
 */
export function createAcidTileMesh(x: number, z: number): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(0.45, 16);
    const material = new THREE.MeshBasicMaterial({
        color: COLORS.acid,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, 0.02, z + 0.5);  // Center of grid cell, slightly above ground
    mesh.name = "acidTile";
    return mesh;
}

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
    const key = `${gridX},${gridZ}`;

    // Don't exceed max tiles
    if (acidTiles.size >= ACID_MAX_TILES && !acidTiles.has(key)) {
        return null;
    }

    // If tile already exists, refresh its duration
    const existing = acidTiles.get(key);
    if (existing) {
        existing.createdAt = now;
        existing.duration = ACID_TILE_DURATION;
        // Reset opacity
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
        return existing;
    }

    // Create new tile
    const mesh = createAcidTileMesh(gridX, gridZ);
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
        const elapsed = now - tile.createdAt;

        // Check if tile has expired
        if (elapsed >= tile.duration) {
            tilesToRemove.push(key);
            return;
        }

        // Update visual opacity based on remaining time
        const remaining = tile.duration - elapsed;
        const fadeStart = tile.duration * 0.5;  // Start fading at 50% duration
        if (remaining < fadeStart) {
            const fadeProgress = remaining / fadeStart;
            (tile.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * fadeProgress;
        }

        // Check for damage tick
        if (now - tile.lastDamageTick >= ACID_TICK_INTERVAL) {
            tile.lastDamageTick = now;

            // Find units standing on this tile (acid slugs are immune)
            unitsState.forEach(unit => {
                if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) return;
                if (unit.enemyType === "acid_slug") return;  // Acid slugs immune to acid

                const unitG = unitsRef[unit.id];
                if (!unitG) return;

                // Check if unit is on this grid cell
                const unitGridX = Math.floor(unitG.position.x);
                const unitGridZ = Math.floor(unitG.position.z);

                if (unitGridX === tile.x && unitGridZ === tile.z) {
                    // Deal acid damage
                    const dmg = ACID_DAMAGE_PER_TICK;
                    const data = getUnitStats(unit);
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;
                        return { ...u, hp: newHp };
                    }));

                    hitFlashRef[unit.id] = now;
                    spawnDamageNumber(scene, unitG.position.x, unitG.position.z, dmg, COLORS.acidText, damageTexts);
                    addLog(`${data.name} takes ${dmg} acid damage.`, COLORS.acidText);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            });
        }
    });

    // Remove expired tiles
    tilesToRemove.forEach(key => {
        const tile = acidTiles.get(key);
        if (tile) {
            scene.remove(tile.mesh);
            tile.mesh.geometry.dispose();
            (tile.mesh.material as THREE.MeshBasicMaterial).dispose();
            acidTiles.delete(key);
        }
    });
}

/**
 * Clear all acid tiles from the scene.
 * Called on game restart.
 */
export function clearAcidTiles(acidTiles: Map<string, AcidTile>, scene: THREE.Scene): void {
    acidTiles.forEach(tile => {
        scene.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        (tile.mesh.material as THREE.MeshBasicMaterial).dispose();
    });
    acidTiles.clear();
}
