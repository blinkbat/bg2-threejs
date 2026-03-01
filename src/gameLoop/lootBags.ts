// =============================================================================
// LOOT BAGS - Dropped by enemies, clicked to open like chests
// =============================================================================

import * as THREE from "three";
import type { LootBag } from "../core/types";
import { getGameTime } from "../core/gameClock";
import { scheduleEffectAnimation } from "../core/effectScheduler";
import { LOOT_BAG_DROP_HEIGHT, LOOT_BAG_BOUNCE_DURATION, LOOT_BAG_DROP_PHASE, LOOT_BAG_BOUNCE_HEIGHT } from "../core/constants";

// =============================================================================
// LOOT BAG ID TRACKING
// =============================================================================

let nextLootBagId = 1;

export function getNextLootBagId(): number {
    return nextLootBagId++;
}

export function resetLootBagIds(): void {
    nextLootBagId = 1;
}

// =============================================================================
// LOOT BAG CREATION
// =============================================================================

/**
 * Create a loot bag mesh - a small pouch/sack visual
 * Each child mesh has name="lootBag" and userData for raycasting
 */
function createLootBagMesh(id: number, x: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(0.75);

    const userData = { lootBagId: id, lootBagX: x, lootBagZ: z };

    // Bag body - rounded pouch shape
    const bagGeometry = new THREE.SphereGeometry(0.4, 12, 8);
    // Scale to make it more pouch-like - taller
    bagGeometry.scale(1, 1.1, 1);
    const bagMaterial = new THREE.MeshPhongMaterial({
        color: 0x8b6914,  // Brownish gold leather color
        shininess: 20
    });
    const bag = new THREE.Mesh(bagGeometry, bagMaterial);
    bag.position.y = 0.35;
    bag.name = "lootBag";
    bag.userData = userData;
    group.add(bag);

    // Bag tie/knot at top
    const knotGeometry = new THREE.SphereGeometry(0.12, 8, 6);
    const knotMaterial = new THREE.MeshPhongMaterial({
        color: 0x5a4510,  // Darker brown
        shininess: 10
    });
    const knot = new THREE.Mesh(knotGeometry, knotMaterial);
    knot.position.y = 0.72;
    knot.name = "lootBag";
    knot.userData = userData;
    group.add(knot);

    // Gold coin peeking out (optional visual flair)
    const coinGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10);
    const coinMaterial = new THREE.MeshPhongMaterial({
        color: 0xffd700,  // Gold
        shininess: 80
    });
    const coin = new THREE.Mesh(coinGeometry, coinMaterial);
    coin.position.set(0.2, 0.45, 0.15);
    coin.rotation.x = Math.PI / 4;
    coin.rotation.z = Math.PI / 6;
    coin.name = "lootBag";
    coin.userData = userData;
    group.add(coin);

    return group;
}

/**
 * Spawn a loot bag at a position with drop animation
 */
export function spawnLootBag(
    scene: THREE.Scene,
    x: number,
    z: number,
    gold: number,
    items?: string[]
): LootBag {
    const id = getNextLootBagId();
    const mesh = createLootBagMesh(id, x, z);
    scene.add(mesh);

    // Add a small bounce animation on spawn
    const startY = LOOT_BAG_DROP_HEIGHT;
    const endY = 0;
    const startTime = getGameTime();
    const duration = LOOT_BAG_BOUNCE_DURATION;

    scheduleEffectAnimation((gameNow) => {
        const elapsed = gameNow - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Bounce easing - cubic out with bounce
        let y: number;
        if (progress < LOOT_BAG_DROP_PHASE) {
            // Initial drop with ease-in
            const t = progress / LOOT_BAG_DROP_PHASE;
            y = startY + (endY - startY) * (t * t);
        } else {
            // Small bounce
            const bounceT = (progress - LOOT_BAG_DROP_PHASE) / (1 - LOOT_BAG_DROP_PHASE);
            const bounceHeight = LOOT_BAG_BOUNCE_HEIGHT;
            y = endY + Math.sin(bounceT * Math.PI) * bounceHeight * (1 - bounceT);
        }
        mesh.position.y = y;

        if (progress < 1) {
            return false;
        }

        mesh.position.y = endY;
        return true;
    });

    return {
        id,
        mesh,
        x,
        z,
        gold,
        items
    };
}

/**
 * Remove a loot bag from the scene and dispose its resources
 */
export function removeLootBag(scene: THREE.Scene, bag: LootBag): void {
    scene.remove(bag.mesh);
    bag.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
                child.material.dispose();
            }
        }
    });
}

/**
 * Clear all loot bags (for area transitions or game restart)
 */
export function clearAllLootBags(scene: THREE.Scene, lootBags: LootBag[]): void {
    for (const bag of lootBags) {
        removeLootBag(scene, bag);
    }
    resetLootBagIds();
}
