import { afterEach, describe, expect, it, vi } from "vitest";

async function loadGameClockModule() {
    vi.resetModules();
    return import("../src/core/gameClock");
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("gameClock", () => {
    it("initializes on first frame and caps per-frame advance at 200ms", async () => {
        const clock = await loadGameClockModule();
        const nowSpy = vi.spyOn(Date, "now");

        nowSpy.mockReturnValueOnce(1000);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(0);

        nowSpy.mockReturnValueOnce(1120);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(120);

        nowSpy.mockReturnValueOnce(1700);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(320);
    });

    it("freezes while paused and resumes without including paused time", async () => {
        const clock = await loadGameClockModule();
        const nowSpy = vi.spyOn(Date, "now");

        nowSpy.mockReturnValueOnce(1000);
        clock.updateGameClock();
        nowSpy.mockReturnValueOnce(1100);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(100);

        clock.pauseGameClock();
        nowSpy.mockReturnValueOnce(1600);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(100);

        nowSpy.mockReturnValueOnce(1700);
        clock.resumeGameClock();
        nowSpy.mockReturnValueOnce(1760);
        clock.updateGameClock();
        expect(clock.getGameTime()).toBe(160);
    });

    it("accumulateDelta mutates elapsed and respects maxDelta", async () => {
        const clock = await loadGameClockModule();
        const tracker = { elapsedTime: 15, lastUpdateTime: 100 };

        const firstDelta = clock.accumulateDelta(tracker, 280);
        expect(firstDelta).toBe(100);
        expect(tracker).toEqual({ elapsedTime: 115, lastUpdateTime: 280 });

        const secondDelta = clock.accumulateDelta(tracker, 360, 50);
        expect(secondDelta).toBe(50);
        expect(tracker).toEqual({ elapsedTime: 165, lastUpdateTime: 360 });
    });
});
