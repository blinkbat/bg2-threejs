// =============================================================================
// ACID SLUG BEHAVIOR - Patrol around players spreading acid
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, EnemyStats, AcidTile } from "../../core/types";
import { getEffectiveSpeedMultiplier } from "../../combat/combatMath";
import { distance } from "../../game/geometry";
import { isPassable } from "../../ai/pathfinding";
import { runPathFollowingPhase, runMovementPhase, type PathContext, type MovementContext } from "../../ai/unitAI";
import { clearJitterTracking, createPathToTarget, recentlyGaveUp } from "../../ai/movement";
import { createAcidTile, tryCreateAcidAura } from "../acidTiles";
import { getUnitRadius, isInRange } from "../../rendering/range";

// =============================================================================
// TYPES
// =============================================================================

interface AcidSlugContext {
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

interface ClosestPlayerTarget {
    unit: Unit;
    group: UnitGroup;
    dist: number;
}

const ACID_SLUG_PATROL_MIN_RADIUS = 2.75;
const ACID_SLUG_PATROL_MAX_RADIUS = 4.5;
const ACID_SLUG_ORBIT_LOOKAHEAD = Math.PI / 7;
const ACID_SLUG_PATROL_ANGLE_STEP = Math.PI / 3;
const ACID_SLUG_PATROL_ANGLE_RETRY_STEP = Math.PI / 6;
const ACID_SLUG_PATROL_MAX_RETRIES = 3;
const ACID_SLUG_PATROL_DWELL_MS = 260;
const ACID_SLUG_PATROL_LANE_OFFSET = 0.35;
const ACID_SLUG_DIRECT_SEGMENT_SAMPLE_STEP = 0.35;
const ACID_SLUG_PATROL_AVOIDANCE_SCALE = 0.6;

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

function clearAcidSlugPatrolState(g: UnitGroup): void {
    delete g.userData.acidSlugPatrolAngle;
    delete g.userData.acidSlugPatrolDirection;
    delete g.userData.acidSlugPatrolRadius;
    delete g.userData.acidSlugPatrolRetargetAt;
}

function getAcidSlugPatrolDirection(g: UnitGroup, unitId: number): 1 | -1 {
    const currentDirection = g.userData.acidSlugPatrolDirection;
    if (currentDirection === 1 || currentDirection === -1) {
        return currentDirection;
    }

    const nextDirection: 1 | -1 = unitId % 2 === 0 ? 1 : -1;
    g.userData.acidSlugPatrolDirection = nextDirection;
    return nextDirection;
}

function getAcidSlugPatrolRadius(g: UnitGroup, unitId: number, targetDistance: number): number {
    const laneOffset = ((unitId % 3) - 1) * ACID_SLUG_PATROL_LANE_OFFSET;
    const clampedDistance = Math.max(
        ACID_SLUG_PATROL_MIN_RADIUS,
        Math.min(ACID_SLUG_PATROL_MAX_RADIUS, targetDistance + laneOffset)
    );
    const previousRadius = g.userData.acidSlugPatrolRadius;
    if (previousRadius === undefined) {
        return clampedDistance;
    }

    const blendedRadius = previousRadius * 0.7 + clampedDistance * 0.3;
    return Math.max(
        ACID_SLUG_PATROL_MIN_RADIUS,
        Math.min(ACID_SLUG_PATROL_MAX_RADIUS, blendedRadius)
    );
}

function getAcidSlugBaseAngle(g: UnitGroup, playerGroup: UnitGroup): number {
    const storedAngle = g.userData.acidSlugPatrolAngle;
    if (storedAngle !== undefined) {
        return storedAngle;
    }

    return Math.atan2(
        g.position.z - playerGroup.position.z,
        g.position.x - playerGroup.position.x
    );
}

function hasClearAcidSlugOrbitSegment(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number
): boolean {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / ACID_SLUG_DIRECT_SEGMENT_SAMPLE_STEP));

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sampleX = startX + dx * t;
        const sampleZ = startZ + dz * t;
        if (!isPassable(Math.floor(sampleX), Math.floor(sampleZ))) {
            return false;
        }
    }

    return true;
}

function getAcidSlugOrbitTarget(
    unit: Unit,
    g: UnitGroup,
    playerTarget: ClosestPlayerTarget
): { x: number; z: number; angle: number; radius: number } {
    const direction = getAcidSlugPatrolDirection(g, unit.id);
    const radius = getAcidSlugPatrolRadius(g, unit.id, playerTarget.dist);
    const relativeX = g.position.x - playerTarget.group.position.x;
    const relativeZ = g.position.z - playerTarget.group.position.z;
    const hasRelativeOffset = Math.abs(relativeX) > 0.001 || Math.abs(relativeZ) > 0.001;
    const baseAngle = hasRelativeOffset
        ? Math.atan2(relativeZ, relativeX)
        : getAcidSlugBaseAngle(g, playerTarget.group);
    const angle = baseAngle + direction * ACID_SLUG_ORBIT_LOOKAHEAD;

    return {
        x: playerTarget.group.position.x + Math.cos(angle) * radius,
        z: playerTarget.group.position.z + Math.sin(angle) * radius,
        angle,
        radius
    };
}

function tryAssignAcidSlugPatrolDestination(
    unit: Unit,
    g: UnitGroup,
    playerTarget: ClosestPlayerTarget,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    now: number
): boolean {
    const direction = getAcidSlugPatrolDirection(g, unit.id);
    const radius = getAcidSlugPatrolRadius(g, unit.id, playerTarget.dist);
    const baseAngle = getAcidSlugBaseAngle(g, playerTarget.group);
    const desiredAngle = baseAngle + direction * ACID_SLUG_PATROL_ANGLE_STEP;
    const retryOffsets: number[] = [0];

    for (let retry = 1; retry <= ACID_SLUG_PATROL_MAX_RETRIES; retry++) {
        const offset = ACID_SLUG_PATROL_ANGLE_RETRY_STEP * retry;
        retryOffsets.push(offset, -offset);
    }

    for (const offset of retryOffsets) {
        const patrolAngle = desiredAngle + offset;
        const patrolX = playerTarget.group.position.x + Math.cos(patrolAngle) * radius;
        const patrolZ = playerTarget.group.position.z + Math.sin(patrolAngle) * radius;
        const pathResult = createPathToTarget(g.position.x, g.position.z, patrolX, patrolZ);
        if (!pathResult.success || pathResult.path.length === 0) {
            continue;
        }

        pathsRef[unit.id] = pathResult.path;
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        g.userData.moveTarget = { x: patrolX, z: patrolZ };
        g.userData.acidSlugPatrolAngle = patrolAngle;
        g.userData.acidSlugPatrolRadius = radius;
        g.userData.acidSlugPatrolRetargetAt = now + ACID_SLUG_PATROL_DWELL_MS;
        clearJitterTracking(unit.id);
        return true;
    }

    g.userData.acidSlugPatrolDirection = direction === 1 ? -1 : 1;
    g.userData.acidSlugPatrolRetargetAt = now + ACID_SLUG_PATROL_DWELL_MS;
    return false;
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
    let closestPlayer: ClosestPlayerTarget | null = null;
    for (const u of unitsState) {
        if (u.team !== "player" || u.hp <= 0) continue;
        const playerG = unitsRef[u.id];
        if (!playerG) continue;
        const dist = distance(playerG.position.x, playerG.position.z, g.position.x, g.position.z);
        if (!isInRange(g.position.x, g.position.z, playerG.position.x, playerG.position.z, getUnitRadius(u), slugData.aggroRange)) {
            continue;
        }
        if (!closestPlayer || dist < closestPlayer.dist) {
            closestPlayer = { unit: u, group: playerG, dist };
        }
    }

    if (!closestPlayer) {
        clearAcidSlugPatrolState(g);
        pathsRef[unit.id] = [];
        delete moveStartRef[unit.id];
        delete g.userData.moveTarget;
        return false;
    }

    // Clear attack target - slugs don't attack
    g.userData.attackTarget = null;

    const orbitTarget = getAcidSlugOrbitTarget(unit, g, closestPlayer);
    g.userData.acidSlugPatrolAngle = orbitTarget.angle;
    g.userData.acidSlugPatrolRadius = orbitTarget.radius;

    const oldGridX = Math.floor(g.position.x);
    const oldGridZ = Math.floor(g.position.z);

    if (hasClearAcidSlugOrbitSegment(g.position.x, g.position.z, orbitTarget.x, orbitTarget.z)) {
        if (pathsRef[unit.id]?.length) {
            pathsRef[unit.id] = [];
            clearJitterTracking(unit.id);
        }

        delete moveStartRef[unit.id];
        g.userData.moveTarget = { x: orbitTarget.x, z: orbitTarget.z };

        const movementCtx: MovementContext = {
            unit,
            g,
            unitsRef,
            unitsState,
            targetX: orbitTarget.x,
            targetZ: orbitTarget.z,
            speedMultiplier: getEffectiveSpeedMultiplier(unit, slugData),
            avoidanceScale: ACID_SLUG_PATROL_AVOIDANCE_SCALE
        };
        runMovementPhase(movementCtx);

        const newGridX = Math.floor(g.position.x);
        const newGridZ = Math.floor(g.position.z);
        processAcidTrailAndAura(slugData, scene, acidTilesRef, skillCooldowns, setSkillCooldowns, unit.id, oldGridX, oldGridZ, newGridX, newGridZ, now);
        return true;
    }

    // Check if we need a new patrol destination (no path or reached destination)
    const currentPath = pathsRef[unit.id];
    const needsNewDestination = !currentPath || currentPath.length === 0;

    if (needsNewDestination) {
        const retargetAt = g.userData.acidSlugPatrolRetargetAt ?? 0;
        if (!recentlyGaveUp(unit.id, now) && now >= retargetAt) {
            const assigned = tryAssignAcidSlugPatrolDestination(
                unit,
                g,
                closestPlayer,
                pathsRef,
                moveStartRef,
                now
            );
            if (!assigned) {
                pathsRef[unit.id] = [];
                delete moveStartRef[unit.id];
            }
        }
    }

    // Path following
    const pathCtx: PathContext = { unit, g, pathsRef, moveStartRef, now, isPlayer: false };
    const pathResult = runPathFollowingPhase(pathCtx);

    // Movement
    const movementCtx: MovementContext = {
        unit,
        g,
        unitsRef,
        unitsState,
        targetX: pathResult.targetX,
        targetZ: pathResult.targetZ,
        speedMultiplier: getEffectiveSpeedMultiplier(unit, slugData),
        avoidanceScale: ACID_SLUG_PATROL_AVOIDANCE_SCALE
    };
    runMovementPhase(movementCtx);

    // Acid trail/aura
    const newGridX = Math.floor(g.position.x);
    const newGridZ = Math.floor(g.position.z);
    processAcidTrailAndAura(slugData, scene, acidTilesRef, skillCooldowns, setSkillCooldowns, unit.id, oldGridX, oldGridZ, newGridX, newGridZ, now);

    return true;  // Skip normal attack behavior
}
