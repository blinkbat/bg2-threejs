// =============================================================================
// SANCTUARY TILES - Holy ground created by Paladin that heals allies
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, SanctuaryTile, AcidTile } from "../core/types";
import { COLORS, SANCTUARY_TILE_DURATION, SANCTUARY_TICK_INTERVAL, SANCTUARY_MAX_TILES } from "../core/constants";
import { getUnitStats } from "../game/units";
import { spawnDamageNumber } from "../combat/combat";

// =============================================================================
// SANCTUARY TILE CREATION
// =============================================================================

/**
 * Create a sanctuary tile mesh at the given grid position.
 */
export function createSanctuaryTileMesh(x: number, z: number): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(0.45, 16);
    const material = new THREE.MeshBasicMaterial({
        color: COLORS.sanctuary,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, 0.03, z + 0.5);  // Slightly above acid tiles
    mesh.name = "sanctuaryTile";
    return mesh;
}

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
    const key = `${gridX},${gridZ}`;

    // Remove any acid tile at this position
    const existingAcid = acidTiles.get(key);
    if (existingAcid) {
        scene.remove(existingAcid.mesh);
        existingAcid.mesh.geometry.dispose();
        (existingAcid.mesh.material as THREE.MeshBasicMaterial).dispose();
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
        // Reset opacity
        (existing.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4;
        return existing;
    }

    // Create new tile
    const mesh = createSanctuaryTileMesh(gridX, gridZ);
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
        const elapsed = now - tile.createdAt;

        // Check if tile has expired
        if (elapsed >= tile.duration) {
            tilesToRemove.push(key);
            return;
        }

        // Update visual opacity based on remaining time
        const remaining = tile.duration - elapsed;
        const fadeStart = tile.duration * 0.3;  // Start fading at 30% duration remaining
        if (remaining < fadeStart) {
            const fadeProgress = remaining / fadeStart;
            (tile.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * fadeProgress;
        }

        // Check for heal tick
        if (now - tile.lastHealTick >= SANCTUARY_TICK_INTERVAL) {
            tile.lastHealTick = now;

            // Find player units standing on this tile
            unitsState.forEach(unit => {
                if (unit.hp <= 0 || unit.team !== "player") return;

                const unitG = unitsRef[unit.id];
                if (!unitG) return;

                // Check if unit is on this grid cell
                const unitGridX = Math.floor(unitG.position.x);
                const unitGridZ = Math.floor(unitG.position.z);

                if (unitGridX === tile.x && unitGridZ === tile.z) {
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

    // Remove expired tiles
    tilesToRemove.forEach(key => {
        const tile = sanctuaryTiles.get(key);
        if (tile) {
            scene.remove(tile.mesh);
            tile.mesh.geometry.dispose();
            (tile.mesh.material as THREE.MeshBasicMaterial).dispose();
            sanctuaryTiles.delete(key);
        }
    });
}

/**
 * Clear all sanctuary tiles from the scene.
 * Called on game restart.
 */
export function clearSanctuaryTiles(sanctuaryTiles: Map<string, SanctuaryTile>, scene: THREE.Scene): void {
    sanctuaryTiles.forEach(tile => {
        scene.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        (tile.mesh.material as THREE.MeshBasicMaterial).dispose();
    });
    sanctuaryTiles.clear();
}
