import { useEffect, useState } from "react";

/**
 * Returns a display timestamp suitable for cooldown UI.
 * While paused, the value is frozen; while running, it updates on an interval.
 */
export function useDisplayTime(paused: boolean, tickMs: number = 100): number {
    const [displayTime, setDisplayTime] = useState(() => Date.now());

    useEffect(() => {
        let frameId = 0;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        const updateTime = () => setDisplayTime(Date.now());
        updateTime();

        if (paused) {
            return;
        }

        // For smooth cooldown fills, sync updates with the browser render loop.
        if (tickMs <= 16) {
            const animate = () => {
                updateTime();
                frameId = requestAnimationFrame(animate);
            };
            frameId = requestAnimationFrame(animate);
            return () => cancelAnimationFrame(frameId);
        }

        intervalId = setInterval(updateTime, tickMs);
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [paused, tickMs]);

    return displayTime;
}
