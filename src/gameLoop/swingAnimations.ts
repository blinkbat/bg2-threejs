// =============================================================================
// MELEE SWING ANIMATIONS + ATTACK BUMP
// =============================================================================

import * as THREE from "three";
import type { UnitGroup, SwingAnimation } from "../core/types";
import { SWING_DURATION, SWING_ARC_ANGLE, SWING_START_OFFSET, SWING_DOT_ORBIT_RADIUS } from "../core/constants";
import { distance } from "../game/geometry";

const BUMP_DURATION = 200;  // ms total (forward + back)
const BUMP_DISTANCE = 0.25; // world units forward
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

// =============================================================================
// ATTACK BUMP — nudge unit toward target then back
// =============================================================================

export function startAttackBump(attackerG: UnitGroup, targetX: number, targetZ: number, now: number): void {
    const dx = targetX - attackerG.position.x;
    const dz = targetZ - attackerG.position.z;
    const len = distance(attackerG.position.x, attackerG.position.z, targetX, targetZ);
    if (len < 0.01) return;
    attackerG.userData.attackBump = {
        startTime: now,
        dx: (dx / len) * BUMP_DISTANCE,
        dz: (dz / len) * BUMP_DISTANCE,
        appliedX: 0,
        appliedZ: 0
    };
}

/** Remove any currently applied bump offset so AI/pathfinding sees true position. */
export function removeBumpOffsets(unitsRef: Record<number, UnitGroup>): void {
    for (const key in unitsRef) {
        const g = unitsRef[key];
        const bump = g.userData.attackBump;
        if (!bump || (bump.appliedX === 0 && bump.appliedZ === 0)) continue;
        g.position.x -= bump.appliedX;
        g.position.z -= bump.appliedZ;
        bump.appliedX = 0;
        bump.appliedZ = 0;
    }
}

/** Apply bump offsets after AI has run. */
export function applyBumpOffsets(unitsRef: Record<number, UnitGroup>, now: number): void {
    for (const key in unitsRef) {
        const g = unitsRef[key];
        const bump = g.userData.attackBump;
        if (!bump) continue;

        const elapsed = now - bump.startTime;
        if (elapsed >= BUMP_DURATION) {
            g.userData.attackBump = undefined;
            continue;
        }

        // Triangle wave: forward first half, back second half
        const t = elapsed / BUMP_DURATION;
        const scale = t < 0.5 ? t * 2 : (1 - t) * 2;
        bump.appliedX = bump.dx * scale;
        bump.appliedZ = bump.dz * scale;
        g.position.x += bump.appliedX;
        g.position.z += bump.appliedZ;
    }
}
