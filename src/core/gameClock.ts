// =============================================================================
// GAME CLOCK - Pause-aware monotonic clock for visual animations
// =============================================================================
//
// Visual animations (expanding rings, dodge dashes, explosions, etc.) use
// getGameTime() instead of Date.now(). This clock freezes when the game is
// paused, so animations freeze in place and resume seamlessly.
//
// Game-logic timestamps (cooldowns, status effects, action queue) still use
// Date.now() — they are already pause-safe via the pausedRef gate + cooldown
// adjustment in togglePause().
// =============================================================================

let gameTime = 0;
let lastWallTime = 0;
let isPaused = false;

/**
 * Get the current game time (pause-aware).
 * Returns the same value every frame while paused, so elapsed-time
 * calculations yield 0 and animations freeze.
 */
export function getGameTime(): number {
    return gameTime;
}

/**
 * Advance the game clock by the wall-clock delta since last call.
 * Must be called exactly once per frame from the game loop, BEFORE
 * any game logic or animation reads.
 */
export function updateGameClock(): void {
    const wallNow = Date.now();
    if (lastWallTime === 0) {
        // First frame — initialize without advancing
        lastWallTime = wallNow;
        return;
    }
    if (!isPaused) {
        const delta = wallNow - lastWallTime;
        // Cap delta to prevent huge jumps (e.g., tab backgrounded)
        gameTime += Math.min(delta, 200);
    }
    lastWallTime = wallNow;
}

/**
 * Pause the game clock. Subsequent updateGameClock() calls will not
 * advance gameTime.
 */
export function pauseGameClock(): void {
    isPaused = true;
}

/**
 * Resume the game clock. Resets lastWallTime so the first unpaused
 * frame sees no jump from the time spent paused.
 */
export function resumeGameClock(): void {
    isPaused = false;
    lastWallTime = Date.now();
}
