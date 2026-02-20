import { useEffect, useState } from "react";

type TimeListener = (time: number) => void;

const rafListeners = new Set<TimeListener>();
let rafFrameId = 0;

interface IntervalPool {
    listeners: Set<TimeListener>;
    timerId: ReturnType<typeof setInterval> | null;
}

const intervalPools = new Map<number, IntervalPool>();

function runRafTicker(): void {
    const now = Date.now();
    for (const listener of rafListeners) {
        listener(now);
    }

    if (rafListeners.size === 0) {
        rafFrameId = 0;
        return;
    }

    rafFrameId = requestAnimationFrame(runRafTicker);
}

function subscribeRaf(listener: TimeListener): () => void {
    rafListeners.add(listener);

    if (rafFrameId === 0) {
        rafFrameId = requestAnimationFrame(runRafTicker);
    }

    return () => {
        rafListeners.delete(listener);
        if (rafListeners.size === 0 && rafFrameId !== 0) {
            cancelAnimationFrame(rafFrameId);
            rafFrameId = 0;
        }
    };
}

function subscribeInterval(tickMs: number, listener: TimeListener): () => void {
    let pool = intervalPools.get(tickMs);
    if (!pool) {
        pool = { listeners: new Set<TimeListener>(), timerId: null };
        intervalPools.set(tickMs, pool);
    }

    pool.listeners.add(listener);
    if (pool.timerId === null) {
        pool.timerId = setInterval(() => {
            const now = Date.now();
            const activePool = intervalPools.get(tickMs);
            if (!activePool) return;
            for (const entry of activePool.listeners) {
                entry(now);
            }
        }, tickMs);
    }

    return () => {
        const activePool = intervalPools.get(tickMs);
        if (!activePool) return;

        activePool.listeners.delete(listener);
        if (activePool.listeners.size === 0) {
            if (activePool.timerId !== null) {
                clearInterval(activePool.timerId);
            }
            intervalPools.delete(tickMs);
        }
    };
}

/**
 * Returns a display timestamp suitable for cooldown UI.
 * While paused, the value is frozen; while running, it updates on an interval.
 */
export function useDisplayTime(paused: boolean, tickMs: number = 100): number {
    const [displayTime, setDisplayTime] = useState(() => Date.now());

    useEffect(() => {
        const listener: TimeListener = (time) => setDisplayTime(time);
        listener(Date.now());

        if (paused) {
            return;
        }

        // For smooth cooldown fills, sync updates with the browser render loop.
        if (tickMs <= 16) {
            return subscribeRaf(listener);
        }

        return subscribeInterval(tickMs, listener);
    }, [paused, tickMs]);

    return displayTime;
}
