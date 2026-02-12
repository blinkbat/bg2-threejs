// =============================================================================
// MELEE SWING ANIMATIONS
// =============================================================================

import * as THREE from "three";
import type { UnitGroup, SwingAnimation } from "../core/types";
import { SWING_DURATION, SWING_ARC_ANGLE, SWING_START_OFFSET, SWING_DOT_ORBIT_RADIUS } from "../core/constants";
// Shared geometry for all swing dots
const swingDotGeo = new THREE.SphereGeometry(0.08, 8, 8);

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
        swingDotGeo,
        new THREE.MeshBasicMaterial({ color: isPlayer ? "#ffffff" : "#ff6666" })
    );
    const startAngle = Math.atan2(
        targetG.position.z - attackerG.position.z,
        targetG.position.x - attackerG.position.x
    ) - SWING_START_OFFSET;
    swingDot.position.set(
        attackerG.position.x + Math.cos(startAngle) * SWING_DOT_ORBIT_RADIUS,
        1.0,
        attackerG.position.z + Math.sin(startAngle) * SWING_DOT_ORBIT_RADIUS
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
        const angle = swing.startAngle + SWING_ARC_ANGLE * t;
        swing.mesh.position.x = swing.attackerX + Math.cos(angle) * SWING_DOT_ORBIT_RADIUS;
        swing.mesh.position.z = swing.attackerZ + Math.sin(angle) * SWING_DOT_ORBIT_RADIUS;

        if (t >= 1) {
            scene.remove(swing.mesh);
            (swing.mesh.material as THREE.Material).dispose();
            return false;
        }
        return true;
    });
}
