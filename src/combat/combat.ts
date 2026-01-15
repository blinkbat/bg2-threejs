// =============================================================================
// COMBAT HELPERS - Damage numbers, defeat handling, projectiles
// =============================================================================

import * as THREE from "three";
import type { DamageText, UnitGroup, Unit } from "../core/types";
import { PROJECTILE_CONFIG, COLORS, RING_EXPAND_DURATION } from "../core/constants";
import { getUnitRadius, isInRange } from "../rendering/range";
import { soundFns } from "../audio/sound";
import { cleanupUnitState } from "../ai/pathManager";
import { cleanupEnemySkillCooldown } from "../game/enemyState";
import { logDefeated, applyPoison } from "./combatMath";

// =============================================================================
// PROJECTILE CREATION
// =============================================================================

export type ProjectileType = "aoe" | "ranged" | "enemy";

/**
 * Create a projectile mesh with standardized configuration
 */
export function createProjectile(
    scene: THREE.Scene,
    type: ProjectileType,
    x: number,
    z: number,
    color?: string
): THREE.Mesh {
    const config = PROJECTILE_CONFIG[type];
    const projectileColor = color || ('defaultColor' in config ? config.defaultColor : "#ffffff");

    const projectile = new THREE.Mesh(
        new THREE.SphereGeometry(config.radius, config.segments, config.segments),
        new THREE.MeshBasicMaterial({ color: projectileColor })
    );
    projectile.position.set(x, config.height, z);
    scene.add(projectile);

    return projectile;
}

/**
 * Get projectile speed for a given type
 */
export function getProjectileSpeed(type: ProjectileType): number {
    return PROJECTILE_CONFIG[type].speed;
}

// =============================================================================
// EXPANDING MESH ANIMATION (rings, arcs)
// =============================================================================

export interface ExpandingMeshConfig {
    duration?: number;
    initialOpacity?: number;
    maxScale?: number;
    baseRadius?: number;
}

/**
 * Animate a mesh expanding and fading out, then dispose it.
 * Used for taunt rings, swipe arcs, etc.
 */
export function animateExpandingMesh(
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    config: ExpandingMeshConfig = {}
): void {
    const {
        duration = RING_EXPAND_DURATION,
        initialOpacity = 0.8,
        maxScale = 1,
        baseRadius = 0.6
    } = config;

    const startTime = Date.now();
    const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const currentScale = baseRadius + (maxScale - baseRadius) * t;
        mesh.scale.set(currentScale / baseRadius, currentScale / baseRadius, 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = initialOpacity * (1 - t);

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.MeshBasicMaterial).dispose();
        }
    };
    requestAnimationFrame(animate);
}

// =============================================================================
// TARGET FILTERING
// =============================================================================

/**
 * Get all alive units of a specific team within range of a position.
 * Uses hitbox-aware range checking.
 */
export function getAliveUnitsInRange(
    units: Unit[],
    unitsRef: Record<number, UnitGroup>,
    team: "player" | "enemy",
    x: number,
    z: number,
    range: number,
    defeatedThisFrame?: Set<number>
): { unit: Unit; group: UnitGroup; dist: number }[] {
    const results: { unit: Unit; group: UnitGroup; dist: number }[] = [];

    for (const unit of units) {
        if (unit.team !== team || unit.hp <= 0) continue;
        if (defeatedThisFrame?.has(unit.id)) continue;

        const g = unitsRef[unit.id];
        if (!g) continue;

        const unitRadius = getUnitRadius(unit);
        if (isInRange(x, z, g.position.x, g.position.z, unitRadius, range)) {
            const dist = Math.hypot(g.position.x - x, g.position.z - z);
            results.push({ unit, group: g, dist });
        }
    }

    return results;
}

// =============================================================================
// UNIFIED DAMAGE APPLICATION
// =============================================================================

export interface DamageContext {
    scene: THREE.Scene;
    damageTexts: DamageText[];
    hitFlashRef: Record<number, number>;
    unitsRef: Record<number, UnitGroup>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    addLog: (text: string, color?: string) => void;
    now: number;
    defeatedThisFrame?: Set<number>;
}

export interface DamageOptions {
    poison?: { sourceId: number };
    color?: string;
    skipDefeatTracking?: boolean;
}

/**
 * Apply damage to a unit with all side effects (state update, flash, damage number, defeat check)
 * Returns the new HP value
 */
export function applyDamageToUnit(
    ctx: DamageContext,
    targetId: number,
    targetGroup: UnitGroup,
    currentHp: number,
    damage: number,
    targetName: string,
    options: DamageOptions = {}
): number {
    const { scene, damageTexts, hitFlashRef, unitsRef, setUnits, addLog, now, defeatedThisFrame } = ctx;
    const { poison, color = COLORS.damageEnemy, skipDefeatTracking = false } = options;

    const newHp = Math.max(0, currentHp - damage);

    // Single setUnits call for both damage and optional poison
    setUnits(prev => prev.map(u => {
        if (u.id !== targetId) return u;
        let updated = { ...u, hp: newHp };
        if (poison) {
            updated = applyPoison(updated, poison.sourceId, now);
        }
        return updated;
    }));

    // Visual effects
    hitFlashRef[targetId] = now;
    spawnDamageNumber(scene, targetGroup.position.x, targetGroup.position.z, damage, color, damageTexts);

    // Defeat handling
    if (newHp <= 0) {
        if (defeatedThisFrame && !skipDefeatTracking) {
            defeatedThisFrame.add(targetId);
        }
        handleUnitDefeat(targetId, targetGroup, unitsRef, addLog, targetName);
    }

    return newHp;
}

/**
 * Spawn a floating damage number at the given position
 */
export function spawnDamageNumber(
    scene: THREE.Scene,
    x: number,
    z: number,
    damage: number,
    color: string,
    damageTexts: DamageText[]
): void {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 24px monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(`-${damage}`, 32, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.4),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    );
    mesh.position.set(x, 1.5, z);
    scene.add(mesh);
    damageTexts.push({ mesh, life: 1000 });
}

/**
 * Handle unit defeat - hide unit, clear targeting from all units
 */
export function handleUnitDefeat(
    targetId: number,
    targetGroup: UnitGroup,
    unitsRef: Record<number, UnitGroup>,
    addLog: (text: string, color?: string) => void,
    targetName: string
): void {
    addLog(logDefeated(targetName), "#f59e0b");
    soundFns.playDeath();
    targetGroup.visible = false;

    // Clear attack targets pointing to defeated unit
    Object.values(unitsRef).forEach((ug: UnitGroup) => {
        if (ug.userData.attackTarget === targetId) {
            ug.userData.attackTarget = null;
        }
    });

    // Clean up state for defeated unit
    cleanupUnitState(targetId);
    cleanupEnemySkillCooldown(targetId);
}
