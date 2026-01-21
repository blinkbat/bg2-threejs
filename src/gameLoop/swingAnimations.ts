// =============================================================================
// MELEE SWING ANIMATIONS
// =============================================================================

import * as THREE from "three";
import type { UnitGroup, SwingAnimation } from "../core/types";
import { SWING_DURATION } from "../core/constants";
import { disposeBasicMesh } from "../rendering/disposal";

// =============================================================================
// MELEE SWING ANIMATION
// =============================================================================

export function spawnSwingIndicator(
    scene: THREE.Scene,
    attackerG: UnitGroup,
    targetG: UnitGroup,
    isPlayer: boolean,
    swingAnimations: SwingAnimation[],
    now: number
): void {
    const swingDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: isPlayer ? "#ffffff" : "#ff6666" })
    );
    const startAngle = Math.atan2(
        targetG.position.z - attackerG.position.z,
        targetG.position.x - attackerG.position.x
    ) - Math.PI / 3;
    swingDot.position.set(
        attackerG.position.x + Math.cos(startAngle) * 0.5,
        0.7,
        attackerG.position.z + Math.sin(startAngle) * 0.5
    );
    scene.add(swingDot);

    swingAnimations.push({
        mesh: swingDot,
        attackerX: attackerG.position.x,
        attackerZ: attackerG.position.z,
        startAngle,
        startTime: now,
        duration: SWING_DURATION
    });
}

export function updateSwingAnimations(
    swingAnimations: SwingAnimation[],
    scene: THREE.Scene,
    now: number
): SwingAnimation[] {
    return swingAnimations.filter(swing => {
        const elapsed = now - swing.startTime;
        const t = Math.min(1, elapsed / swing.duration);
        const angle = swing.startAngle + (Math.PI * 2 / 3) * t;
        swing.mesh.position.x = swing.attackerX + Math.cos(angle) * 0.5;
        swing.mesh.position.z = swing.attackerZ + Math.sin(angle) * 0.5;

        if (t >= 1) {
            disposeBasicMesh(scene, swing.mesh);
            return false;
        }
        return true;
    });
}
