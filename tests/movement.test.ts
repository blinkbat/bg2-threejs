import { describe, expect, it, beforeEach, vi } from "vitest";
import {
    STUCK_REALLY_STUCK_MS,
    STUCK_REALLY_STUCK_DIST,
    STUCK_MS,
    STUCK_RECOVERY_COOLDOWN,
    UNREACHABLE_COOLDOWN,
    PATH_MAX_DEVIATION,
    PATH_WAYPOINT_REACH_DIST,
} from "../src/core/constants";

vi.mock("../src/ai/pathfinding", () => ({
    findPath: vi.fn(() => [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]),
}));

import {
    checkIfStuck,
    handleGiveUp,
    recentlyGaveUp,
    canRecalculatePath,
    recordPathRecalculation,
    canScanForTargets,
    recordTargetScan,
    getBlockedTargets,
    checkPathNeedsRecalc,
    hasReachedWaypoint,
    createPathToTarget,
    cleanupUnitState,
    resetAllMovementState,
} from "../src/ai/movement";

describe("movement", () => {
    beforeEach(() => {
        resetAllMovementState();
    });

    describe("checkIfStuck", () => {
        it("returns all false when moveStart is undefined", () => {
            const result = checkIfStuck(1, 5, 5, undefined, 1000);
            expect(result.isStuck).toBe(false);
            expect(result.isReallyStuck).toBe(false);
            expect(result.isJittering).toBe(false);
        });

        it("returns not stuck when unit has moved sufficiently", () => {
            const result = checkIfStuck(1, 100, 100, { time: 0, x: 0, z: 0 }, STUCK_MS + 1);
            expect(result.isStuck).toBe(false);
            expect(result.isReallyStuck).toBe(false);
        });

        it("detects stuck when time exceeds threshold and distance is small", () => {
            const result = checkIfStuck(1, 0.01, 0.01, { time: 0, x: 0, z: 0 }, STUCK_MS + 1);
            expect(result.isStuck).toBe(true);
        });

        it("detects really stuck with tighter threshold", () => {
            const tinyDist = STUCK_REALLY_STUCK_DIST * 0.5;
            const result = checkIfStuck(1, tinyDist, 0, { time: 0, x: 0, z: 0 }, STUCK_REALLY_STUCK_MS + 1);
            expect(result.isReallyStuck).toBe(true);
        });

        it("not stuck if time below threshold", () => {
            const result = checkIfStuck(1, 0, 0, { time: 0, x: 0, z: 0 }, STUCK_MS - 1);
            expect(result.isStuck).toBe(false);
        });
    });

    describe("handleGiveUp", () => {
        it("sets recovery cooldown", () => {
            handleGiveUp(1, true, null, 1000);
            expect(recentlyGaveUp(1, 1000)).toBe(true);
            expect(recentlyGaveUp(1, 1000 + STUCK_RECOVERY_COOLDOWN)).toBe(false);
        });

        it("returns clearedTarget=false for player units", () => {
            const result = handleGiveUp(1, true, 50, 1000);
            expect(result.clearedTarget).toBe(false);
            expect(result.failedTargetId).toBeNull();
        });

        it("returns clearedTarget=true for enemy units with attack target", () => {
            const result = handleGiveUp(100, false, 1, 1000);
            expect(result.clearedTarget).toBe(true);
            expect(result.failedTargetId).toBe(1);
        });

        it("marks target as unreachable for enemies", () => {
            handleGiveUp(100, false, 1, 1000);
            const blocked = getBlockedTargets(100, 1000);
            expect(blocked.has(1)).toBe(true);
        });

        it("unreachable targets expire after cooldown", () => {
            handleGiveUp(100, false, 1, 1000);
            const blocked = getBlockedTargets(100, 1000 + UNREACHABLE_COOLDOWN + 1);
            expect(blocked.has(1)).toBe(false);
        });

        it("does not mark target for enemy with no attack target", () => {
            const result = handleGiveUp(100, false, null, 1000);
            expect(result.clearedTarget).toBe(false);
        });
    });

    describe("recentlyGaveUp", () => {
        it("returns false for unknown unit", () => {
            expect(recentlyGaveUp(999, 0)).toBe(false);
        });
    });

    describe("canRecalculatePath / recordPathRecalculation", () => {
        it("allows recalc for unknown unit", () => {
            expect(canRecalculatePath(999, 0)).toBe(true);
        });

        it("blocks recalc during cooldown", () => {
            recordPathRecalculation(1, "target_moved", 1000);
            expect(canRecalculatePath(1, 1050)).toBe(false);
        });

        it("allows recalc after cooldown expires", () => {
            recordPathRecalculation(1, "target_moved", 1000);
            expect(canRecalculatePath(1, 1000 + 100)).toBe(true);
        });

        it("nearTarget multiplier increases cooldown", () => {
            recordPathRecalculation(1, "target_moved", 1000, true);
            // With 4x multiplier, 90ms becomes 360ms
            expect(canRecalculatePath(1, 1000 + 200)).toBe(false);
            expect(canRecalculatePath(1, 1000 + 400)).toBe(true);
        });

        it("no_path has longest cooldown", () => {
            recordPathRecalculation(1, "no_path", 1000);
            expect(canRecalculatePath(1, 1000 + 250)).toBe(false);
        });
    });

    describe("canScanForTargets / recordTargetScan", () => {
        it("allows scan for unknown unit", () => {
            expect(canScanForTargets(1, 1000)).toBe(true);
        });

        it("blocks scan during interval", () => {
            recordTargetScan(1, 1000);
            expect(canScanForTargets(1, 1050)).toBe(false);
        });

        it("allows scan after interval", () => {
            recordTargetScan(1, 1000);
            expect(canScanForTargets(1, 1000 + 1000, 500)).toBe(true);
        });
    });

    describe("checkPathNeedsRecalc", () => {
        it("needs new path when no path exists", () => {
            const result = checkPathNeedsRecalc(undefined, 5, 5);
            expect(result.needsNewPath).toBe(true);
            expect(result.reason).toBe("no_path");
        });

        it("needs new path when path is empty", () => {
            const result = checkPathNeedsRecalc([], 5, 5);
            expect(result.needsNewPath).toBe(true);
            expect(result.reason).toBe("no_path");
        });

        it("does not need recalc when target is near path end", () => {
            const path = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
            const result = checkPathNeedsRecalc(path, 5, 5);
            expect(result.needsNewPath).toBe(false);
        });

        it("needs recalc when target moved far from path end", () => {
            const path = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
            const farX = 5 + PATH_MAX_DEVIATION + 1;
            const result = checkPathNeedsRecalc(path, farX, 5);
            expect(result.needsNewPath).toBe(true);
            expect(result.reason).toBe("target_moved");
        });

        it("needs recalc when unit deviated far from waypoint", () => {
            const path = [{ x: 5, z: 5 }, { x: 10, z: 10 }];
            const farX = 5 + PATH_MAX_DEVIATION * 2 + 1;
            const result = checkPathNeedsRecalc(path, 10, 10, farX, 5);
            expect(result.needsNewPath).toBe(true);
            expect(result.reason).toBe("unit_deviated");
        });
    });

    describe("hasReachedWaypoint", () => {
        it("returns true when at waypoint", () => {
            expect(hasReachedWaypoint(5, 5, 5, 5)).toBe(true);
        });

        it("returns true when within reach distance", () => {
            const small = PATH_WAYPOINT_REACH_DIST * 0.5;
            expect(hasReachedWaypoint(5, 5, 5 + small, 5)).toBe(true);
        });

        it("returns false when beyond reach distance", () => {
            const far = PATH_WAYPOINT_REACH_DIST + 1;
            expect(hasReachedWaypoint(0, 0, far, 0)).toBe(false);
        });
    });

    describe("createPathToTarget", () => {
        it("returns path with first waypoint removed", () => {
            const result = createPathToTarget(0, 0, 2, 0);
            expect(result.success).toBe(true);
            // Mock returns [{x:0,z:0}, {x:1,z:0}, {x:2,z:0}], slice(1) removes start
            expect(result.path).toEqual([{ x: 1, z: 0 }, { x: 2, z: 0 }]);
        });
    });

    describe("cleanupUnitState", () => {
        it("clears all state for a unit", () => {
            handleGiveUp(1, false, 2, 1000);
            recordPathRecalculation(1, "no_path", 1000);
            recordTargetScan(1, 1000);

            cleanupUnitState(1);

            expect(recentlyGaveUp(1, 1000)).toBe(false);
            expect(canRecalculatePath(1, 0)).toBe(true);
            expect(canScanForTargets(1, 10000)).toBe(true);
            expect(getBlockedTargets(1, 1000).size).toBe(0);
        });
    });
});
