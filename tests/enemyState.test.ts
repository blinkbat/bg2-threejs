import { describe, expect, it, beforeEach } from "vitest";
import {
    getEnemyKiteCooldown,
    setEnemyKiteCooldown,
    cleanupEnemyKiteCooldown,
    resetAllEnemyKiteCooldowns,
    isEnemyKiting,
    setEnemyKitingUntil,
    clearEnemyKiting,
    resetAllEnemyKitingState,
    hasBroodMotherScreeched,
    markBroodMotherScreeched,
    resetAllBroodMotherScreeches,
} from "../src/game/enemyState";

describe("enemyState", () => {
    beforeEach(() => {
        resetAllEnemyKiteCooldowns();
        resetAllEnemyKitingState();
        resetAllBroodMotherScreeches();
    });

    describe("kite cooldowns", () => {
        it("returns 0 for unknown unit", () => {
            expect(getEnemyKiteCooldown(999)).toBe(0);
        });

        it("set/get roundtrips correctly", () => {
            setEnemyKiteCooldown(1, 5000);
            expect(getEnemyKiteCooldown(1)).toBe(5000);
        });

        it("units have independent cooldowns", () => {
            setEnemyKiteCooldown(1, 1000);
            setEnemyKiteCooldown(2, 2000);
            expect(getEnemyKiteCooldown(1)).toBe(1000);
            expect(getEnemyKiteCooldown(2)).toBe(2000);
        });

        it("cleanup removes a single unit", () => {
            setEnemyKiteCooldown(1, 1000);
            setEnemyKiteCooldown(2, 2000);
            cleanupEnemyKiteCooldown(1);
            expect(getEnemyKiteCooldown(1)).toBe(0);
            expect(getEnemyKiteCooldown(2)).toBe(2000);
        });

        it("resetAll clears all cooldowns", () => {
            setEnemyKiteCooldown(1, 1000);
            setEnemyKiteCooldown(2, 2000);
            resetAllEnemyKiteCooldowns();
            expect(getEnemyKiteCooldown(1)).toBe(0);
            expect(getEnemyKiteCooldown(2)).toBe(0);
        });
    });

    describe("kiting state", () => {
        it("returns false for unknown unit", () => {
            expect(isEnemyKiting(999, 0)).toBe(false);
        });

        it("returns true while kiting period is active", () => {
            setEnemyKitingUntil(1, 5000);
            expect(isEnemyKiting(1, 4000)).toBe(true);
            expect(isEnemyKiting(1, 4999)).toBe(true);
        });

        it("returns false after kiting period expires", () => {
            setEnemyKitingUntil(1, 5000);
            expect(isEnemyKiting(1, 5000)).toBe(false);
            expect(isEnemyKiting(1, 6000)).toBe(false);
        });

        it("clearEnemyKiting removes a single unit", () => {
            setEnemyKitingUntil(1, 5000);
            setEnemyKitingUntil(2, 6000);
            clearEnemyKiting(1);
            expect(isEnemyKiting(1, 4000)).toBe(false);
            expect(isEnemyKiting(2, 4000)).toBe(true);
        });

        it("resetAll clears all kiting state", () => {
            setEnemyKitingUntil(1, 5000);
            setEnemyKitingUntil(2, 6000);
            resetAllEnemyKitingState();
            expect(isEnemyKiting(1, 4000)).toBe(false);
            expect(isEnemyKiting(2, 4000)).toBe(false);
        });
    });

    describe("brood mother screech", () => {
        it("returns false for unknown unit", () => {
            expect(hasBroodMotherScreeched(999)).toBe(false);
        });

        it("returns true after marking", () => {
            markBroodMotherScreeched(1);
            expect(hasBroodMotherScreeched(1)).toBe(true);
        });

        it("independent per unit", () => {
            markBroodMotherScreeched(1);
            expect(hasBroodMotherScreeched(1)).toBe(true);
            expect(hasBroodMotherScreeched(2)).toBe(false);
        });

        it("resetAll clears all screeches", () => {
            markBroodMotherScreeched(1);
            markBroodMotherScreeched(2);
            resetAllBroodMotherScreeches();
            expect(hasBroodMotherScreeched(1)).toBe(false);
            expect(hasBroodMotherScreeched(2)).toBe(false);
        });
    });
});
