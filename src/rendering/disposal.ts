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
 * Dispose only geometry (when replacing geometry on existing mesh)
 * Use for: indicator geometry updates
 */
export function disposeGeometry(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
}
