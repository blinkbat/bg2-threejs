// =============================================================================
// ACID SLUG BEHAVIOR - Patrol around players spreading acid
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, AcidTile } from "../../core/types";
import { getEffectiveSpeedMultiplier } from "../../combat/combatMath";
import { distance } from "../../game/geometry";
import { findPath } from "../../ai/pathfinding";
import { runPathFollowingPhase, runMovementPhase, type PathContext, type MovementContext } from "../../ai/unitAI";
import { createAcidTile, tryCreateAcidAura } from "../acidTiles";

// =============================================================================
// TYPES
// =============================================================================

export interface AcidSlugContext {
    unit: Unit;
    g: UnitGroup;
    slugData: EnemyStats;
    unitsState: Unit[];
    unitsRef: Record<number, UnitGroup>;
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    scene: THREE.Scene;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    acidTilesRef: Map<string, AcidTile>;
    now: number;
}

// =============================================================================
// ACID TRAIL & AURA PROCESSING
// =============================================================================

/**
 * Process acid trail (when moving) and acid aura (when stationary) for an acid slug.
 * Called after movement to check if the slug moved to a new cell.
 */
export function processAcidTrailAndAura(
    slugData: EnemyStats,
    scene: THREE.Scene,
    acidTiles: Map<string, AcidTile>,
    skillCooldowns: Record<string, { end: number; duration: number }>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    unitId: number,
    oldGridX: number,
    oldGridZ: number,
    newGridX: number,
    newGridZ: number,
    now: number
): void {
    const movedCell = newGridX !== oldGridX || newGridZ !== oldGridZ;

    // Acid trail - leave acid on cells we move through
    if (slugData.acidTrail && movedCell) {
        createAcidTile(scene, acidTiles, oldGridX, oldGridZ, unitId, now);
    }

    // Acid aura - periodically create acid around self when NOT moving
    if (!movedCell) {
        tryCreateAcidAura(slugData, {
            scene, acidTiles, skillCooldowns, setSkillCooldowns,
            unitId, centerX: newGridX, centerZ: newGridZ, now
        });
    }
}

// =============================================================================
// ACID SLUG PATROL
// =============================================================================

/**
 * Try to patrol around players instead of attacking.
 * Acid slugs circle around the closest player, spreading acid.
 * @returns true if the slug is patrolling (skip normal attack behavior)
 */
export function tryAcidSlugPatrol(ctx: AcidSlugContext): boolean {
    const { unit, g, slugData, unitsState, unitsRef, pathsRef, moveStartRef, scene, skillCooldowns, setSkillCooldowns, acidTilesRef, now } = ctx;

    // Find closest player
    let closestPlayer: { unit: Unit; group: UnitGroup; dist: number } | null = null;
    for (const u of unitsState) {
        if (u.team !== "player" || u.hp <= 0) continue;
        const playerG = unitsRef[u.id];
        if (!playerG) continue;
        const dist = distance(playerG.position.x, playerG.position.z, g.position.x, g.position.z);
        if (dist <= slugData.aggroRange && (!closestPlayer || dist < closestPlayer.dist)) {
            closestPlayer = { unit: u, group: playerG, dist };
        }
    }

    if (!closestPlayer) return false;

    // Clear attack target - slugs don't attack
    g.userData.attackTarget = null;

    // Check if we need a new patrol destination (no path or reached destination)
    const currentPath = pathsRef[unit.id];
    const needsNewDestination = !currentPath || currentPath.length === 0;

    if (needsNewDestination) {
        // Pick a random point around the player to patrol to
        const patrolRadius = 3 + Math.random() * 3;  // 3-6 units away from player
        const patrolAngle = Math.random() * Math.PI * 2;
        const patrolX = closestPlayer.group.position.x + Math.cos(patrolAngle) * patrolRadius;
        const patrolZ = closestPlayer.group.position.z + Math.sin(patrolAngle) * patrolRadius;

        const path = findPath(
            Math.floor(g.position.x), Math.floor(g.position.z),
            Math.floor(patrolX), Math.floor(patrolZ)
        );
        if (path && path.length > 0) {
            pathsRef[unit.id] = path;
            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        }
    }

    // Track old position for acid trail
    const oldGridX = Math.floor(g.position.x);
    const oldGridZ = Math.floor(g.position.z);

    // Path following
    const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer: false };
    const pathResult = runPathFollowingPhase(pathCtx);

    // Movement
    const movementCtx: MovementContext = { unit, g, unitsRef, unitsState, targetX: pathResult.targetX, targetZ: pathResult.targetZ, speedMultiplier: getEffectiveSpeedMultiplier(unit, slugData) };
    runMovementPhase(movementCtx);

    // Acid trail/aura
    const newGridX = Math.floor(g.position.x);
    const newGridZ = Math.floor(g.position.z);
    processAcidTrailAndAura(slugData, scene, acidTilesRef, skillCooldowns, setSkillCooldowns, unit.id, oldGridX, oldGridZ, newGridX, newGridZ, now);

    return true;  // Skip normal attack behavior
}
