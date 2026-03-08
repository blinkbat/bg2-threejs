// =============================================================================
// UNIT AI - Modular AI phases for unit behavior
// =============================================================================

import {
    MOVE_SPEED,
    getDebugSpeedMultiplier,
    AVOIDANCE_RANGE_MULTIPLIER, AVOIDANCE_OVERLAP_STRENGTH,
    AVOIDANCE_STEER_THRESHOLD, AVOIDANCE_STEER_STRENGTH,
    MOVEMENT_MIN_DIST, MOVEMENT_MIN_MAGNITUDE,
    PLAYER_MOVE_TIMEOUT_MS,
    DEFAULT_UNIT_RADIUS
} from "../core/constants";
import { findPath, isBlocked, isPassable } from "./pathfinding";
import {
    canScanForTargets, recordTargetScan, getBlockedTargets,
    recentlyGaveUp, checkPathNeedsRecalc, createPathToTarget,
    hasReachedWaypoint, checkIfStuck, handleGiveUp, clearJitterTracking,
    canRecalculatePath, recordPathRecalculation
} from "./movement";
import { getUnitRadius } from "../rendering/range";
import { clampToGrid, distanceBetween } from "../game/geometry";
import { getAttackRange } from "../game/units";
import { ENEMY_STATS } from "../game/enemyStats";
import { getEffectivePlayerAggroMultiplier } from "../game/equipmentState";
import { hasStatusEffect, isUnitAlive } from "../combat/combatMath";
import { isEnemyUntargetable } from "../gameLoop/enemyBehaviors/untargetable";
import { getUnitById } from "../game/unitQuery";
import type { Unit, UnitGroup } from "../core/types";

function getMovementFlags(unit: Unit): { isFlying: boolean; canTraverseWaterTerrain: boolean } {
    const enemyType = unit.team === "enemy" ? unit.enemyType : undefined;
    return {
        isFlying: !!(enemyType && ENEMY_STATS[enemyType]?.flying === true),
        canTraverseWaterTerrain: enemyType === "baby_kraken"
    };
}

interface TargetingBucketEntry {
    unit: Unit;
    group: UnitGroup;
}

const TARGETING_CELL_SIZE = 4;
const TARGETING_KEY_STRIDE = 1024;
const playerTargetBuckets = new Map<number, TargetingBucketEntry[]>();
const enemyTargetBuckets = new Map<number, TargetingBucketEntry[]>();
const allPlayerTargetEntries: TargetingBucketEntry[] = [];
const allEnemyTargetEntries: TargetingBucketEntry[] = [];
const TARGETING_HASH_SEED = 2166136261;
const TARGETING_HASH_PRIME = 16777619;
let targetingCacheReady = false;
let hasTargetingCacheKey = false;
let lastTargetingCacheKey = 0;
let lastTargetingEntryCount = -1;
let lastTargetingUnitsRef: Record<number, UnitGroup> | null = null;

function getTargetingCell(coord: number): number {
    return Math.floor(coord / TARGETING_CELL_SIZE);
}

function getTargetingBucketKey(cellX: number, cellZ: number): number {
    return cellX * TARGETING_KEY_STRIDE + cellZ;
}

function computeDefeatedHash(defeatedThisFrame: Set<number>): number {
    let hash = 0;
    for (const unitId of defeatedThisFrame) {
        hash ^= Math.imul(unitId, 2654435761);
    }
    return hash >>> 0;
}

function pushTargetingEntry(
    buckets: Map<number, TargetingBucketEntry[]>,
    cellX: number,
    cellZ: number,
    entry: TargetingBucketEntry
): void {
    const key = getTargetingBucketKey(cellX, cellZ);
    const bucket = buckets.get(key);
    if (bucket) {
        bucket.push(entry);
    } else {
        buckets.set(key, [entry]);
    }
}

function forEachCachedTargetsInRange(
    team: "player" | "enemy",
    centerX: number,
    centerZ: number,
    range: number,
    visit: (entry: TargetingBucketEntry) => void
): boolean {
    if (!targetingCacheReady) return false;

    if (!Number.isFinite(range)) {
        const entries = team === "player" ? allPlayerTargetEntries : allEnemyTargetEntries;
        for (const entry of entries) visit(entry);
        return true;
    }

    const bucketMap = team === "player" ? playerTargetBuckets : enemyTargetBuckets;
    const cellX = getTargetingCell(centerX);
    const cellZ = getTargetingCell(centerZ);
    const cellRadius = Math.max(1, Math.ceil(range / TARGETING_CELL_SIZE));

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            const bucket = bucketMap.get(getTargetingBucketKey(cellX + dx, cellZ + dz));
            if (!bucket) continue;
            for (const entry of bucket) {
                visit(entry);
            }
        }
    }

    return true;
}

export function updateTargetingCache(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    defeatedThisFrame: Set<number>
): void {
    if (lastTargetingUnitsRef !== unitsRef) {
        hasTargetingCacheKey = false;
        lastTargetingUnitsRef = unitsRef;
    }

    let key = TARGETING_HASH_SEED;
    let entryCount = 0;
    const defeatedHash = computeDefeatedHash(defeatedThisFrame);

    for (const unit of unitsState) {
        if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) continue;
        if (unit.team === "neutral") continue;
        if (hasStatusEffect(unit, "divine_lattice")) continue;

        const group = unitsRef[unit.id];
        if (!group) continue;

        const cellX = getTargetingCell(group.position.x);
        const cellZ = getTargetingCell(group.position.z);
        const teamMarker = unit.team === "player" ? 1 : 2;
        key = Math.imul(key ^ unit.id, TARGETING_HASH_PRIME);
        key = Math.imul(key ^ teamMarker, TARGETING_HASH_PRIME);
        key = Math.imul(key ^ cellX, TARGETING_HASH_PRIME);
        key = Math.imul(key ^ cellZ, TARGETING_HASH_PRIME);
        entryCount++;
    }

    key = Math.imul(key ^ defeatedHash, TARGETING_HASH_PRIME) >>> 0;
    if (hasTargetingCacheKey && key === lastTargetingCacheKey && entryCount === lastTargetingEntryCount) {
        targetingCacheReady = true;
        return;
    }

    targetingCacheReady = true;
    playerTargetBuckets.clear();
    enemyTargetBuckets.clear();
    allPlayerTargetEntries.length = 0;
    allEnemyTargetEntries.length = 0;

    for (const unit of unitsState) {
        if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) continue;
        if (unit.team === "neutral") continue;
        if (hasStatusEffect(unit, "divine_lattice")) continue;

        const group = unitsRef[unit.id];
        if (!group) continue;

        const entry: TargetingBucketEntry = { unit, group };
        const cellX = getTargetingCell(group.position.x);
        const cellZ = getTargetingCell(group.position.z);
        if (unit.team === "player") {
            allPlayerTargetEntries.push(entry);
            pushTargetingEntry(playerTargetBuckets, cellX, cellZ, entry);
        } else {
            allEnemyTargetEntries.push(entry);
            pushTargetingEntry(enemyTargetBuckets, cellX, cellZ, entry);
        }
    }

    hasTargetingCacheKey = true;
    lastTargetingCacheKey = key;
    lastTargetingEntryCount = entryCount;
}

/**
 * Check if a broodling's mother can see any player.
 * Returns the nearest player to the broodling if mother can see ANY player.
 * Broodlings act like guided missiles while their mother lives.
 */
function getMothersSightTarget(
    unit: Unit,
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    defeatedThisFrame: Set<number>
): { targetId: number; dist: number } | null {
    // Only applies to broodlings with a living mother
    if (unit.enemyType !== "broodling" || !unit.spawnedBy) return null;

    const mother = getUnitById(unit.spawnedBy!);
    if (!mother || mother.hp <= 0) return null;

    const motherG = unitsRef[mother.id];
    if (!motherG) return null;

    const broodlingG = unitsRef[unit.id];
    if (!broodlingG) return null;

    // Check if mother can see ANY player (use mother's aggro range)
    const motherStats = ENEMY_STATS.brood_mother;
    let motherCanSeeAnyPlayer = false;

    for (const player of unitsState) {
        if (player.team !== "player" || player.hp <= 0) continue;
        if (hasStatusEffect(player, "divine_lattice")) continue;
        if (defeatedThisFrame.has(player.id)) continue;

        const playerG = unitsRef[player.id];
        if (!playerG) continue;

        // Distance from MOTHER to player
        const motherToPlayer = Math.hypot(
            motherG.position.x - playerG.position.x,
            motherG.position.z - playerG.position.z
        );

        if (motherToPlayer <= motherStats.aggroRange) {
            motherCanSeeAnyPlayer = true;
            break;
        }
    }

    // If mother can't see anyone, broodling relies on its own limited sight
    if (!motherCanSeeAnyPlayer) return null;

    // Mother can see players - broodling picks the highest-threat player
    // (distance weighted by player aggro multipliers).
    let nearestTarget: { targetId: number; score: number } | null = null;

    for (const player of unitsState) {
        if (player.team !== "player" || player.hp <= 0) continue;
        if (hasStatusEffect(player, "divine_lattice")) continue;
        if (defeatedThisFrame.has(player.id)) continue;

        const playerG = unitsRef[player.id];
        if (!playerG) continue;

        const broodlingToPlayer = Math.hypot(
            broodlingG.position.x - playerG.position.x,
            broodlingG.position.z - playerG.position.z
        );
        const aggroMultiplier = getEffectivePlayerAggroMultiplier(player.id);
        const score = broodlingToPlayer * aggroMultiplier;

        if (!nearestTarget || score < nearestTarget.score) {
            nearestTarget = { targetId: player.id, score };
        }
    }

    return nearestTarget ? { targetId: nearestTarget.targetId, dist: nearestTarget.score } : null;
}

// =============================================================================
// TARGETING PHASE
// =============================================================================

export interface TargetingContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    visibility: number[][];
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    now: number;
    defeatedThisFrame: Set<number>;
    aggroRange: number;
    hasFrontShield?: boolean;  // Front-shielded enemies reacquire targets immediately
    hasAggressiveTargeting?: boolean;  // Boss enemies that aggressively retarget
    hasFastRetargeting?: boolean;  // Medium+ or slow enemies retarget more aggressively
}

const FAST_RETARGET_SCAN_INTERVAL = 250;

/**
 * Check if the current attack target is still valid (alive, not defeated, not untargetable).
 */
function validateCurrentTarget(
    currentTarget: number | null | undefined,
    defeatedThisFrame: Set<number>
): { valid: boolean; targetUnit: Unit | undefined } {
    if (currentTarget === null || currentTarget === undefined) {
        return { valid: false, targetUnit: undefined };
    }
    const targetUnit = getUnitById(currentTarget);
    // Invalid if dead, defeated this frame, or currently untargetable.
    const valid = targetUnit !== undefined &&
        isUnitAlive(targetUnit, defeatedThisFrame) &&
        !isEnemyUntargetable(currentTarget);
    return { valid, targetUnit };
}

/**
 * Find the highest-priority valid enemy target within aggro range.
 * If alerted is true, ignores aggro range and searches entire map.
 * Broodlings can also see through their mother's eyes if she's alive.
 */
function findNearestTarget(ctx: TargetingContext, alerted: boolean = false): number | null {
    const { unit, g, unitsRef, unitsState, visibility, now, defeatedThisFrame, aggroRange } = ctx;
    const isPlayer = unit.team === "player";
    const enemyTeam = isPlayer ? "enemy" : "player";

    // For enemies, get list of targets they recently couldn't reach
    const blockedTargets = !isPlayer ? getBlockedTargets(unit.id, now) : null;

    let nearest: number | null = null;
    // Alerted enemies search the whole map, otherwise use aggro range.
    let nearestScore = alerted ? Infinity : aggroRange;

    // Broodlings can see through their mother's eyes - they act as guided missiles
    // If mother can see ANY player, broodling targets the nearest player to itself
    // regardless of the broodling's own limited aggro range
    if (!isPlayer && unit.enemyType === "broodling") {
        const motherTarget = getMothersSightTarget(unit, unitsState, unitsRef, defeatedThisFrame);
        if (motherTarget && !blockedTargets?.has(motherTarget.targetId)) {
            // Mother can see a player - broodling ALWAYS targets them (missile behavior)
            // Set this as the target and use its distance as the reference
            nearest = motherTarget.targetId;
            nearestScore = motherTarget.dist;
            // Return early - broodlings with mother sight don't need to check their own limited range
            return nearest;
        }
    }

    const evaluateCandidate = (candidate: Unit, candidateGroup: UnitGroup): void => {
        if (candidate.team !== enemyTeam || candidate.hp <= 0) return;
        if (hasStatusEffect(candidate, "divine_lattice")) return;
        if (defeatedThisFrame.has(candidate.id)) return;
        if (blockedTargets?.has(candidate.id)) return;
        // Skip untargetable enemies.
        if (isEnemyUntargetable(candidate.id)) return;

        // Players need line of sight, enemies see all
        if (isPlayer) {
            const enemyX = Math.floor(candidateGroup.position.x);
            const enemyZ = Math.floor(candidateGroup.position.z);
            if (visibility[enemyX]?.[enemyZ] !== 2) return;
        }

        const d = distanceBetween(g.position, candidateGroup.position);
        const score = !isPlayer
            ? d * getEffectivePlayerAggroMultiplier(candidate.id)
            : d;
        if (score < nearestScore) {
            nearestScore = score;
            nearest = candidate.id;
        }
    };

    if (isPlayer) {
        const usedCache = forEachCachedTargetsInRange(
            "enemy",
            g.position.x,
            g.position.z,
            alerted ? Number.POSITIVE_INFINITY : aggroRange,
            entry => evaluateCandidate(entry.unit, entry.group)
        );
        if (!usedCache) {
            for (const enemy of unitsState) {
                if (enemy.team !== "enemy" || enemy.hp <= 0) continue;
                const eg = unitsRef[enemy.id];
                if (!eg) continue;
                evaluateCandidate(enemy, eg);
            }
        }
    } else {
        const usedCache = forEachCachedTargetsInRange(
            "player",
            g.position.x,
            g.position.z,
            Number.POSITIVE_INFINITY,
            entry => evaluateCandidate(entry.unit, entry.group)
        );
        if (!usedCache) {
            for (const player of unitsState) {
                if (player.team !== "player" || player.hp <= 0) continue;
                const pg = unitsRef[player.id];
                if (!pg) continue;
                evaluateCandidate(player, pg);
            }
        }
    }

    return nearest;
}

/**
 * Acquire a new target and calculate path to it.
 * Returns true if path was found or unit is already in range, false if target is unreachable.
 */
function acquireTarget(ctx: TargetingContext, targetId: number): boolean {
    const { unit, g, unitsRef, pathsRef, moveStartRef, now } = ctx;
    const isPlayer = unit.team === "player";

    const targetG = unitsRef[targetId];
    if (!targetG) {
        pathsRef[unit.id] = [];
        return false;
    }

    const dist = distanceBetween(g.position, targetG.position);
    const attackRange = getAttackRange(unit);

    // Hold position: only engage targets already in range
    if (isPlayer && unit.holdPosition) {
        if (dist < attackRange) {
            g.userData.attackTarget = targetId;
            pathsRef[unit.id] = [];
            return true;
        }
        return false;
    }

    g.userData.attackTarget = targetId;

    if (dist < attackRange) {
        // Already in attack range, no path needed
        pathsRef[unit.id] = [];
        return true;
    }

    const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);
    const path = findPath(
        g.position.x,
        g.position.z,
        targetG.position.x,
        targetG.position.z,
        0,
        isFlying,
        canTraverseWaterTerrain
    );
    if (path && path.length > 0) {
        pathsRef[unit.id] = path.slice(1);
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        clearJitterTracking(unit.id);  // Reset jitter detection for new path
        return true;
    } else {
        // No path found and not in range - mark as unreachable for enemies
        pathsRef[unit.id] = [];
        if (!isPlayer) {
            handleGiveUp(unit.id, isPlayer, targetId, now);
            g.userData.attackTarget = null;
        }
        return false;
    }
}

/**
 * Find the unit that recently damaged this enemy (for front-shielded enemies).
 * Returns the unit ID if they're still alive and in aggro range.
 */
function findRecentDamageSource(ctx: TargetingContext): number | null {
    const { g, unitsRef, unitsState, defeatedThisFrame, aggroRange, now } = ctx;
    const damageSource = g.userData.lastDamageSource;

    // Only consider damage from last 2 seconds (recent attack)
    if (!damageSource || (now - damageSource.time) > 2000) {
        return null;
    }

    // Find the player closest to the damage source position
    // (Since we track position, not ID, find closest player to that spot)
    // Use larger radius since players move around while attacking
    let closestId: number | null = null;
    let closestDist = 4.0;  // Must be within 4 units of the tracked position

    const evaluatePlayer = (player: Unit, pg: UnitGroup): void => {
        if (player.team !== "player" || player.hp <= 0) return;
        if (hasStatusEffect(player, "divine_lattice")) return;
        if (defeatedThisFrame.has(player.id)) return;

        // Check if this player is near the damage source position
        const distToSource = Math.hypot(
            pg.position.x - damageSource.x,
            pg.position.z - damageSource.z
        );

        // And also in aggro range from the enemy (extended for flankers)
        const distToEnemy = Math.hypot(
            pg.position.x - g.position.x,
            pg.position.z - g.position.z
        );

        if (distToSource < closestDist && distToEnemy <= aggroRange * 2) {
            closestDist = distToSource;
            closestId = player.id;
        }
    };

    const usedCache = forEachCachedTargetsInRange(
        "player",
        damageSource.x,
        damageSource.z,
        closestDist,
        entry => evaluatePlayer(entry.unit, entry.group)
    );
    if (!usedCache) {
        for (const player of unitsState) {
            if (player.team !== "player" || player.hp <= 0) continue;
            const pg = unitsRef[player.id];
            if (!pg) continue;
            evaluatePlayer(player, pg);
        }
    }

    return closestId;
}

/**
 * Run the targeting phase - validate current target or find a new one.
 */
export function runTargetingPhase(ctx: TargetingContext): void {
    const { unit, g, pathsRef, now, hasFrontShield } = ctx;
    const isPlayer = unit.team === "player";
    const usesFastRetargeting = !isPlayer && ctx.hasFastRetargeting === true;
    if (hasStatusEffect(unit, "divine_lattice")) {
        g.userData.attackTarget = null;
        return;
    }
    const shouldAutoTarget = isPlayer ? unit.aiEnabled : true;

    // Check if enemy is alerted (was hit by a player)
    const isAlerted = !isPlayer && g.userData.alerted === true;

    // Check if current target is still valid
    let { valid: targetStillValid } = validateCurrentTarget(
        g.userData.attackTarget,
        ctx.defeatedThisFrame
    );
    let targetProtectedByLattice = false;
    if (targetStillValid && g.userData.attackTarget !== null) {
        const protectedTarget = getUnitById(g.userData.attackTarget);
        if (protectedTarget && hasStatusEffect(protectedTarget, "divine_lattice")) {
            targetStillValid = false;
            targetProtectedByLattice = true;
        }
    }

    if (!targetStillValid) {
        g.userData.attackTarget = null;
        if (!isPlayer && targetProtectedByLattice) {
            pathsRef[unit.id] = [];
        }
    }

    // Alerted enemies immediately search for nearest target, ignoring normal constraints
    if (isAlerted && !targetStillValid) {
        const nearest = findNearestTarget(ctx, true);
        if (nearest !== null) {
            acquireTarget(ctx, nearest);
        }
        // Clear alerted flag once they've acquired a target (or tried to)
        g.userData.alerted = false;
        return;
    }

    // Aggressive damage-source retargeting for shielded enemies and explicit boss configs.
    const shouldRetargetToDamageSource = (hasFrontShield || ctx.hasAggressiveTargeting) && !isPlayer;
    if (shouldRetargetToDamageSource) {
        // ALWAYS check for recent damage source - switch targets if someone hit us
        const damageSourceTarget = findRecentDamageSource(ctx);
        if (damageSourceTarget !== null && damageSourceTarget !== g.userData.attackTarget) {
            // Switch to whoever is attacking us
            acquireTarget(ctx, damageSourceTarget);
            recordTargetScan(unit.id, now);
            return;
        }
    }

    // Fast-retarget units (medium+ or slow movers) bypass scan cooldown when target is lost.
    if (!isPlayer && (shouldRetargetToDamageSource || usesFastRetargeting) && !targetStillValid && !recentlyGaveUp(unit.id, now)) {
        const nearest = findNearestTarget(ctx);
        if (nearest !== null) {
            acquireTarget(ctx, nearest);
            recordTargetScan(unit.id, now);
            return;
        }
    }

    // Determine if we should look for a new target
    const hasActivePath = pathsRef[unit.id]?.length > 0;
    const isAttackMoving = isPlayer && g.userData.attackMoveTarget !== undefined;
    const isExecutingMoveCommand = (hasActivePath || g.userData.pendingMove) && g.userData.attackTarget === null && !isAttackMoving;
    const canAutoTarget = shouldAutoTarget && !targetStillValid && !isExecutingMoveCommand;
    const canScan = usesFastRetargeting
        ? canScanForTargets(unit.id, now, FAST_RETARGET_SCAN_INTERVAL)
        : canScanForTargets(unit.id, now);

    if (canAutoTarget && canScan) {
        recordTargetScan(unit.id, now);

        // Don't start new path if we recently gave up (prevents jitter)
        if (!recentlyGaveUp(unit.id, now)) {
            const nearest = findNearestTarget(ctx);
            if (nearest !== null) {
                acquireTarget(ctx, nearest);
            }
        }
    }
}

// =============================================================================
// PATH FOLLOWING PHASE
// =============================================================================

export interface PathContext {
    unit: Unit;
    g: UnitGroup;
    pathsRef: Record<number, { x: number; z: number }[]>;
    moveStartRef: Record<number, { time: number; x: number; z: number }>;
    now: number;
    isPlayer: boolean;
}

const PATH_SHORTCUT_MAX_LOOKAHEAD = 4;
const PATH_SHORTCUT_SAMPLE_STEP = 0.35;
const LOCAL_DETOUR_DISTANCE = 1.15;
const LOCAL_DETOUR_ANGLE_OFFSETS = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (Math.PI * 3) / 4, -(Math.PI * 3) / 4];

function hasPassableSegment(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): boolean {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / PATH_SHORTCUT_SAMPLE_STEP));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sampleX = startX + dx * t;
        const sampleZ = startZ + dz * t;
        if (!isPassable(Math.floor(sampleX), Math.floor(sampleZ), flying, canTraverseWaterTerrain)) {
            return false;
        }
    }
    return true;
}

function tryBuildLocalDetourPath(
    currentX: number,
    currentZ: number,
    towardX: number,
    towardZ: number,
    finalGoalX: number,
    finalGoalZ: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): { x: number; z: number }[] | null {
    const baseAngle = Math.atan2(towardZ - currentZ, towardX - currentX);

    for (const offset of LOCAL_DETOUR_ANGLE_OFFSETS) {
        const angle = baseAngle + offset;
        const detourX = currentX + Math.cos(angle) * LOCAL_DETOUR_DISTANCE;
        const detourZ = currentZ + Math.sin(angle) * LOCAL_DETOUR_DISTANCE;

        if (!isPassable(Math.floor(detourX), Math.floor(detourZ), flying, canTraverseWaterTerrain)) {
            continue;
        }

        const toDetour = createPathToTarget(
            currentX,
            currentZ,
            detourX,
            detourZ,
            flying,
            canTraverseWaterTerrain
        );
        if (!toDetour.success || toDetour.path.length === 0) {
            continue;
        }

        const toGoal = createPathToTarget(
            detourX,
            detourZ,
            finalGoalX,
            finalGoalZ,
            flying,
            canTraverseWaterTerrain
        );
        if (toGoal.success && toGoal.path.length > 0) {
            return [...toDetour.path, ...toGoal.path];
        }

        return toDetour.path;
    }

    return null;
}

/**
 * Run the path following phase - advance along path, handle stuck detection.
 * Returns the current movement target position.
 */
export function runPathFollowingPhase(ctx: PathContext): { targetX: number; targetZ: number } {
    const { unit, g, pathsRef, moveStartRef, now, isPlayer } = ctx;
    const path = pathsRef[unit.id];
    const isPlayerMoveCommand = isPlayer && g.userData.attackTarget === null;

    let targetX = g.position.x;
    let targetZ = g.position.z;

    if (path && path.length > 0) {
        targetX = path[0].x;
        targetZ = path[0].z;
        const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);

        // Try to skip near-term waypoints when a direct segment is clear.
        if (path.length > 1) {
            const maxLookahead = Math.min(PATH_SHORTCUT_MAX_LOOKAHEAD, path.length - 1);
            for (let i = maxLookahead; i >= 1; i--) {
                const candidate = path[i];
                if (hasPassableSegment(
                    g.position.x,
                    g.position.z,
                    candidate.x,
                    candidate.z,
                    isFlying,
                    canTraverseWaterTerrain
                )) {
                    path.splice(0, i);
                    targetX = path[0].x;
                    targetZ = path[0].z;
                    break;
                }
            }
        }

        // Check if we've reached the current waypoint
        if (hasReachedWaypoint(g.position.x, g.position.z, targetX, targetZ)) {
            path.shift();
            moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
            if (path.length === 0 && isPlayerMoveCommand) {
                delete moveStartRef[unit.id];
                delete g.userData.moveTarget;
                delete g.userData.formationRegroupAttempted;
                delete g.userData.formationRamp;
            }
        }

        // Stuck detection - give up if barely moving or jittering
        // Player move commands use a longer absolute timeout to avoid
        // giving up too quickly during crowded formation movement
        const moveStart = moveStartRef[unit.id];
        const stuckResult = isPlayerMoveCommand
            ? { isStuck: false, isReallyStuck: !!(moveStart && (now - moveStart.time) > PLAYER_MOVE_TIMEOUT_MS), isJittering: false }
            : checkIfStuck(unit.id, g.position.x, g.position.z, moveStart, now);

        if (stuckResult.isReallyStuck || stuckResult.isStuck || stuckResult.isJittering) {
            // Player formation commands get one forced repath before giving up.
            const shouldRegroup = isPlayerMoveCommand && stuckResult.isReallyStuck && !g.userData.formationRegroupAttempted;
            if (shouldRegroup) {
                const regroupTarget = g.userData.moveTarget ?? path[path.length - 1] ?? { x: targetX, z: targetZ };
                const regroupPath = createPathToTarget(g.position.x, g.position.z, regroupTarget.x, regroupTarget.z);
                if (regroupPath.success && regroupPath.path.length > 0) {
                    pathsRef[unit.id] = regroupPath.path;
                    moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                    g.userData.formationRegroupAttempted = true;
                    clearJitterTracking(unit.id);
                    const nextWaypoint = pathsRef[unit.id][0];
                    if (nextWaypoint) {
                        return { targetX: nextWaypoint.x, targetZ: nextWaypoint.z };
                    }
                }
            }

            // All units: try one local sidestep route around corners/crowds before giving up.
            const finalGoal = g.userData.moveTarget ?? path[path.length - 1] ?? { x: targetX, z: targetZ };
            const detourPath = tryBuildLocalDetourPath(
                g.position.x,
                g.position.z,
                targetX,
                targetZ,
                finalGoal.x,
                finalGoal.z,
                isFlying,
                canTraverseWaterTerrain
            );
            if (detourPath && detourPath.length > 0) {
                pathsRef[unit.id] = detourPath;
                moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
                clearJitterTracking(unit.id);
                return { targetX: detourPath[0].x, targetZ: detourPath[0].z };
            }

            pathsRef[unit.id] = [];
            delete moveStartRef[unit.id];
            if (isPlayerMoveCommand) {
                delete g.userData.moveTarget;
                delete g.userData.formationRegroupAttempted;
                delete g.userData.formationRamp;
            }

            // Handle give up - updates internal state and returns info about cleared target
            const giveUpResult = handleGiveUp(unit.id, isPlayer, g.userData.attackTarget, now);
            if (giveUpResult.clearedTarget) {
                g.userData.attackTarget = null;
            }
        }
    }

    return { targetX, targetZ };
}

// =============================================================================
// MOVEMENT PHASE
// =============================================================================

export interface MovementContext {
    unit: Unit;
    g: UnitGroup;
    unitsRef: Record<number, UnitGroup>;
    unitsState: Unit[];
    targetX: number;
    targetZ: number;
    speedMultiplier?: number;  // Optional movement speed multiplier (default 1.0)
}

interface AvoidanceBucketEntry {
    unit: Unit;
    group: UnitGroup;
}

const AVOIDANCE_CELL_SIZE = 2;
const AVOIDANCE_KEY_STRIDE = 1024;
const avoidanceBuckets = new Map<number, AvoidanceBucketEntry[]>();
let maxAvoidanceRadius = DEFAULT_UNIT_RADIUS;
// Dirty flag: track unit cell positions to skip rebuild when nothing moved
let lastAvoidancePositionKey = 0;
let lastAvoidanceUnitCount = -1;
const MAX_WALL_CLEARANCE = 0.45;
const MIN_WALL_CLEARANCE = 0.2;
const WALL_CLEARANCE_RATIO = 0.65;
const WALL_CLEARANCE_EPSILON = 0.001;

function getAvoidanceBucketKey(cellX: number, cellZ: number): number {
    return cellX * AVOIDANCE_KEY_STRIDE + cellZ;
}

function getAvoidanceCell(coord: number): number {
    return Math.floor(coord / AVOIDANCE_CELL_SIZE);
}

/**
 * Build a lightweight spatial hash once per frame so local avoidance
 * checks don't scan every unit for every mover.
 * Uses a position-based dirty flag to skip rebuild when no unit has moved cells.
 */
export function updateAvoidanceCache(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>
): void {
    // Quick dirty check: hash all alive unit cell positions
    let positionKey = 2166136261;
    let aliveCount = 0;
    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const group = unitsRef[unit.id];
        if (!group) continue;
        aliveCount++;
        const cx = getAvoidanceCell(group.position.x);
        const cz = getAvoidanceCell(group.position.z);
        positionKey = Math.imul(positionKey ^ (unit.id * 1024 + cx * 32 + cz), 16777619);
    }
    positionKey = positionKey >>> 0;

    if (positionKey === lastAvoidancePositionKey && aliveCount === lastAvoidanceUnitCount) {
        return;
    }
    lastAvoidancePositionKey = positionKey;
    lastAvoidanceUnitCount = aliveCount;

    avoidanceBuckets.clear();
    maxAvoidanceRadius = DEFAULT_UNIT_RADIUS;

    for (const unit of unitsState) {
        if (unit.hp <= 0) continue;
        const group = unitsRef[unit.id];
        if (!group) continue;

        const unitRadius = getUnitRadius(unit);
        if (unitRadius > maxAvoidanceRadius) {
            maxAvoidanceRadius = unitRadius;
        }

        const cellX = getAvoidanceCell(group.position.x);
        const cellZ = getAvoidanceCell(group.position.z);
        const key = getAvoidanceBucketKey(cellX, cellZ);
        const bucket = avoidanceBuckets.get(key);
        if (bucket) {
            bucket.push({ unit, group });
        } else {
            avoidanceBuckets.set(key, [{ unit, group }]);
        }
    }
}

/**
 * Calculate avoidance vector from nearby units.
 * Player formation moves keep steering at reduced strength for cohesion.
 */
function calculateAvoidance(ctx: MovementContext, desiredX: number, desiredZ: number): { avoidX: number; avoidZ: number } {
    const { unit, g } = ctx;

    // Player formation movement keeps steering mild instead of fully disabled.
    const formationMove = unit.team === "player" && g.userData.attackTarget === null;
    const steeringScale = formationMove ? 0.35 : 1.0;

    const myRadius = getUnitRadius(unit);
    let avoidX = 0, avoidZ = 0;
    const centerX = getAvoidanceCell(g.position.x);
    const centerZ = getAvoidanceCell(g.position.z);
    const maxInteractionDist = (myRadius + maxAvoidanceRadius) * AVOIDANCE_RANGE_MULTIPLIER;
    const neighborRadius = Math.max(1, Math.ceil(maxInteractionDist / AVOIDANCE_CELL_SIZE));

    for (let dx = -neighborRadius; dx <= neighborRadius; dx++) {
        for (let dz = -neighborRadius; dz <= neighborRadius; dz++) {
            const bucket = avoidanceBuckets.get(getAvoidanceBucketKey(centerX + dx, centerZ + dz));
            if (!bucket) continue;

            for (const entry of bucket) {
                const otherU = entry.unit;
                if (otherU.id === unit.id || otherU.hp <= 0) continue;
                const otherG = entry.group;

                const otherRadius = getUnitRadius(otherU);
                const combinedRadius = myRadius + otherRadius;
                const ox = otherG.position.x - g.position.x;
                const oz = otherG.position.z - g.position.z;
                const oDist = Math.hypot(ox, oz);

                if (oDist < combinedRadius * AVOIDANCE_RANGE_MULTIPLIER && oDist > MOVEMENT_MIN_MAGNITUDE) {
                    // Hard separation when overlapping - push directly away
                    if (oDist < combinedRadius) {
                        const sepStrength = (combinedRadius - oDist) / combinedRadius;
                        avoidX -= (ox / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
                        avoidZ -= (oz / oDist) * sepStrength * AVOIDANCE_OVERLAP_STRENGTH;
                    }
                    // Steering when unit is ahead and close
                    else {
                        const dot = (ox * desiredX + oz * desiredZ) / oDist;
                        if (dot > AVOIDANCE_STEER_THRESHOLD) {
                            const steerStrength = (combinedRadius * AVOIDANCE_RANGE_MULTIPLIER - oDist) / (combinedRadius * AVOIDANCE_STEER_STRENGTH);
                            // Use XOR of unit IDs to determine which unit steers which way
                            const steerRight = (unit.id ^ otherU.id) % 2 === 0;
                            const perpX = steerRight ? -desiredZ : desiredZ;
                            const perpZ = steerRight ? desiredX : -desiredX;
                            avoidX += perpX * steerStrength * AVOIDANCE_STEER_STRENGTH * steeringScale;
                            avoidZ += perpZ * steerStrength * AVOIDANCE_STEER_STRENGTH * steeringScale;
                        }
                    }
                }
            }
        }
    }

    return { avoidX, avoidZ };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getWallClearance(unit: Unit): number {
    const radius = getUnitRadius(unit);
    return clamp(radius * WALL_CLEARANCE_RATIO, MIN_WALL_CLEARANCE, MAX_WALL_CLEARANCE);
}

function resolveWallClearance(
    unit: Unit,
    x: number,
    z: number,
    flying: boolean,
    canTraverseWaterTerrain: boolean
): { x: number; z: number } | null {
    if (!isPassable(Math.floor(x), Math.floor(z), flying, canTraverseWaterTerrain)) {
        return null;
    }

    const clearance = getWallClearance(unit);
    const clearanceSq = clearance * clearance;
    let adjustedX = clampToGrid(x, 0.5, "x");
    let adjustedZ = clampToGrid(z, 0.5, "z");

    for (let iteration = 0; iteration < 2; iteration++) {
        const centerCellX = Math.floor(adjustedX);
        const centerCellZ = Math.floor(adjustedZ);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const cellX = centerCellX + dx;
                const cellZ = centerCellZ + dz;
                if (!isBlocked(cellX, cellZ)) continue;

                const nearestX = clamp(adjustedX, cellX, cellX + 1);
                const nearestZ = clamp(adjustedZ, cellZ, cellZ + 1);
                let diffX = adjustedX - nearestX;
                let diffZ = adjustedZ - nearestZ;
                let distanceSq = diffX * diffX + diffZ * diffZ;

                if (distanceSq >= clearanceSq) continue;

                if (distanceSq < WALL_CLEARANCE_EPSILON) {
                    // Candidate sits exactly on the wall boundary; push away from cell center.
                    diffX = adjustedX - (cellX + 0.5);
                    diffZ = adjustedZ - (cellZ + 0.5);
                    const norm = Math.hypot(diffX, diffZ) || 1;
                    adjustedX += (diffX / norm) * (clearance + WALL_CLEARANCE_EPSILON);
                    adjustedZ += (diffZ / norm) * (clearance + WALL_CLEARANCE_EPSILON);
                } else {
                    const distance = Math.sqrt(distanceSq);
                    const push = clearance - distance;
                    adjustedX += (diffX / distance) * push;
                    adjustedZ += (diffZ / distance) * push;
                }

                adjustedX = clampToGrid(adjustedX, 0.5, "x");
                adjustedZ = clampToGrid(adjustedZ, 0.5, "z");
                distanceSq = diffX * diffX + diffZ * diffZ;
            }
        }
    }

    if (!isPassable(Math.floor(adjustedX), Math.floor(adjustedZ), flying, canTraverseWaterTerrain)) {
        return null;
    }

    return { x: adjustedX, z: adjustedZ };
}

/**
 * Try to move with wall sliding - if direct movement blocked, try sliding along walls.
 */
function applyWallSliding(
    unit: Unit,
    g: UnitGroup,
    moveX: number,
    moveZ: number,
    flying: boolean = false,
    canTraverseWaterTerrain: boolean = false
): void {
    const newX = g.position.x + moveX;
    const newZ = g.position.z + moveZ;

    const direct = resolveWallClearance(unit, newX, newZ, flying, canTraverseWaterTerrain);
    if (direct) {
        g.position.x = direct.x;
        g.position.z = direct.z;
    } else {
        // Try wall sliding - move along one axis if the other is blocked
        const xOnlyX = g.position.x + moveX;
        const xOnly = resolveWallClearance(unit, xOnlyX, g.position.z, flying, canTraverseWaterTerrain);
        const canMoveX = xOnly !== null;

        const zOnlyZ = g.position.z + moveZ;
        const zOnly = resolveWallClearance(unit, g.position.x, zOnlyZ, flying, canTraverseWaterTerrain);
        const canMoveZ = zOnly !== null;

        if (canMoveX && Math.abs(moveX) > Math.abs(moveZ)) {
            g.position.x = xOnly.x;
            g.position.z = xOnly.z;
        } else if (canMoveZ) {
            g.position.x = zOnly.x;
            g.position.z = zOnly.z;
        } else if (canMoveX) {
            g.position.x = xOnly.x;
            g.position.z = xOnly.z;
        }
        // If neither axis is valid, unit doesn't move (stuck against corner)
    }
}

/**
 * Run the movement phase - move towards target with avoidance and wall sliding.
 */
export function runMovementPhase(ctx: MovementContext): void {
    const { unit, g, targetX, targetZ, speedMultiplier = 1.0 } = ctx;
    const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);

    // Keep units out of wall overlap even when idle or waiting on target updates.
    const settled = resolveWallClearance(unit, g.position.x, g.position.z, isFlying, canTraverseWaterTerrain);
    if (settled) {
        g.position.x = settled.x;
        g.position.z = settled.z;
    }

    const dx = targetX - g.position.x;
    const dz = targetZ - g.position.z;
    const distToTarget = Math.hypot(dx, dz);

    if (distToTarget <= MOVEMENT_MIN_DIST) return;

    // Calculate desired direction
    const desiredX = dx / distToTarget;
    const desiredZ = dz / distToTarget;

    // Calculate avoidance from other units
    const { avoidX, avoidZ } = calculateAvoidance(ctx, desiredX, desiredZ);

    // Combine desired direction with avoidance
    let moveX = desiredX + avoidX;
    let moveZ = desiredZ + avoidZ;
    const moveMag = Math.hypot(moveX, moveZ);

    if (moveMag > MOVEMENT_MIN_MAGNITUDE) {
        // Normalize and apply speed (with optional multiplier for faster/slower enemies)
        const speed = MOVE_SPEED * speedMultiplier * getDebugSpeedMultiplier();
        moveX = (moveX / moveMag) * speed;
        moveZ = (moveZ / moveMag) * speed;

        // Apply movement with wall sliding
        applyWallSliding(unit, g, moveX, moveZ, isFlying, canTraverseWaterTerrain);
    }
}

// =============================================================================
// PATH RECALCULATION
// =============================================================================

/**
 * Recalculate path to target if needed (target moved, unit deviated, etc).
 */
export function recalculatePathIfNeeded(
    unit: Unit,
    g: UnitGroup,
    targetX: number,
    targetZ: number,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    now: number
): void {
    if (recentlyGaveUp(unit.id, now)) return;

    const { needsNewPath, reason } = checkPathNeedsRecalc(
        pathsRef[unit.id],
        targetX,
        targetZ,
        g.position.x,
        g.position.z
    );

    if (!needsNewPath) return;
    if (!canRecalculatePath(unit.id, now)) return;

    const { isFlying, canTraverseWaterTerrain } = getMovementFlags(unit);
    const result = createPathToTarget(
        g.position.x,
        g.position.z,
        targetX,
        targetZ,
        isFlying,
        canTraverseWaterTerrain
    );
    recordPathRecalculation(unit.id, reason, now);
    pathsRef[unit.id] = result.path;
    if (result.success) {
        moveStartRef[unit.id] = { time: now, x: g.position.x, z: g.position.z };
        clearJitterTracking(unit.id);  // Reset jitter detection for new path
    }
}
