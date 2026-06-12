// =============================================================================
// EFFECT SCHEDULER - Shared per-frame animation updates
// =============================================================================

type EffectAnimationStep = (gameNow: number) => boolean;

// Map keyed by animation id — O(1) cancellation instead of findIndex + splice.
const scheduledEffectAnimations: Map<number, EffectAnimationStep> = new Map();
let nextAnimationId = 1;

/**
 * Schedule an effect animation step callback.
 * Return value is a cancel function that removes the animation from the queue.
 * Step should return true when finished, false to continue next frame.
 */
export function scheduleEffectAnimation(step: EffectAnimationStep): () => void {
    const id = nextAnimationId++;
    scheduledEffectAnimations.set(id, step);

    return () => {
        scheduledEffectAnimations.delete(id);
    };
}

/**
 * Advance all scheduled effect animations for this frame.
 */
export function updateEffectAnimations(gameNow: number): void {
    // Map iteration tolerates deletes during iteration; steps scheduled while
    // iterating are also visited, matching insertion order.
    for (const [id, step] of scheduledEffectAnimations) {
        let finished = false;
        try {
            finished = step(gameNow);
        } catch {
            finished = true;
        }

        if (finished) {
            scheduledEffectAnimations.delete(id);
        }
    }
}

/**
 * Cancel and remove all scheduled animations.
 * Useful during scene teardown/area transitions.
 */
export function clearEffectAnimations(): void {
    scheduledEffectAnimations.clear();
}
