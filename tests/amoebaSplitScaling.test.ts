import { beforeEach, describe, expect, it } from "vitest";
import type { Unit } from "../src/core/types";
import { ENEMY_STATS, getAmoebaMaxHpForSplitCount } from "../src/game/enemyStats";
import { clearUnitStatsCache, getUnitStats } from "../src/game/units";

function makeAmoebaUnit(id: number, splitCount: number): Unit {
    return {
        id,
        x: 0,
        z: 0,
        hp: 999,
        team: "enemy",
        enemyType: "giant_amoeba",
        target: null,
        aiEnabled: true,
        splitCount,
    };
}

describe("amoeba split scaling", () => {
    beforeEach(() => {
        clearUnitStatsCache();
    });

    it("decreases max HP for each split stage", () => {
        const hp0 = getAmoebaMaxHpForSplitCount(0);
        const hp1 = getAmoebaMaxHpForSplitCount(1);
        const hp2 = getAmoebaMaxHpForSplitCount(2);
        const hp3 = getAmoebaMaxHpForSplitCount(3);

        expect(hp0).toBe(ENEMY_STATS.giant_amoeba.maxHp);
        expect(hp1).toBeLessThan(hp0);
        expect(hp2).toBeLessThan(hp1);
        expect(hp3).toBeLessThan(hp2);
    });

    it("applies split-stage max HP when resolving amoeba stats", () => {
        const stage0Stats = getUnitStats(makeAmoebaUnit(900, 0));
        const stage2Stats = getUnitStats(makeAmoebaUnit(901, 2));

        expect(stage0Stats.maxHp).toBe(getAmoebaMaxHpForSplitCount(0));
        expect(stage2Stats.maxHp).toBe(getAmoebaMaxHpForSplitCount(2));
    });

    it("keys cached enemy stats by split stage for amoebas", () => {
        const sharedId = 902;
        const stage0Stats = getUnitStats(makeAmoebaUnit(sharedId, 0));
        const stage1Stats = getUnitStats(makeAmoebaUnit(sharedId, 1));

        expect(stage0Stats.maxHp).toBe(getAmoebaMaxHpForSplitCount(0));
        expect(stage1Stats.maxHp).toBe(getAmoebaMaxHpForSplitCount(1));
        expect(stage1Stats.maxHp).toBeLessThan(stage0Stats.maxHp);
    });
});
