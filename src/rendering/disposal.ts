// =============================================================================
// MESH DISPOSAL UTILITIES
// Centralized disposal to prevent memory leaks and make cleanup impossible to forget
// =============================================================================

import * as THREE from "three";

/**
 * Dispose a basic mesh (geometry + material, no texture)
 * Use for: projectiles, swing animations, explosion effects
 */
export function disposeBasicMesh(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
}

/**
 * Dispose a textured mesh (geometry + material + texture)
 * Use for: damage numbers, any mesh with a CanvasTexture map
 */
export function disposeTexturedMesh(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial;
    if (material.map) material.map.dispose();
    material.dispose();
}

/**
 * Dispose only geometry (when replacing geometry on existing mesh)
 * Use for: indicator geometry updates
 */
export function disposeGeometry(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
}

/**
 * Schedule mesh removal after delay with proper disposal
 * Returns cleanup function to cancel if needed
 */
export function scheduleDisposal(
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    delayMs: number,
    hasTexture: boolean = false
): () => void {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
        if (cancelled) return;
        if (hasTexture) {
            disposeTexturedMesh(scene, mesh);
        } else {
            disposeBasicMesh(scene, mesh);
        }
    }, delayMs);

    return () => {
        cancelled = true;
        clearTimeout(timeoutId);
    };
}

/**
 * Create a tracked mesh that remembers its disposal method
 * Prevents forgetting which disposal function to use
 */
export interface TrackedMesh {
    mesh: THREE.Mesh;
    dispose: (scene: THREE.Scene) => void;
}

export function createBasicMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material
): TrackedMesh {
    const mesh = new THREE.Mesh(geometry, material);
    return {
        mesh,
        dispose: (scene) => disposeBasicMesh(scene, mesh)
    };
}

export function createTexturedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshBasicMaterial
): TrackedMesh {
    const mesh = new THREE.Mesh(geometry, material);
    return {
        mesh,
        dispose: (scene) => disposeTexturedMesh(scene, mesh)
    };
}
