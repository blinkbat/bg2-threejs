// =============================================================================
// EFFECT SCHEDULER - Shared per-frame animation updates
// =============================================================================

type EffectAnimationStep = (gameNow: number) => boolean;

interface ScheduledEffectAnimation {
    id: number;
    step: EffectAnimationStep;
}

const scheduledEffectAnimations: ScheduledEffectAnimation[] = [];
let nextAnimationId = 1;

/**
 * Schedule an effect animation step callback.
 * Return value is a cancel function that removes the animation from the queue.
 * Step should return true when finished, false to continue next frame.
 */
export function scheduleEffectAnimation(step: EffectAnimationStep): () => void {
    const id = nextAnimationId++;
    scheduledEffectAnimations.push({ id, step });

    return () => {
        const index = scheduledEffectAnimations.findIndex(animation => animation.id === id);
        if (index >= 0) {
            scheduledEffectAnimations.splice(index, 1);
        }
    };
}

/**
 * Advance all scheduled effect animations for this frame.
 */
export function updateEffectAnimations(gameNow: number): void {
    for (let index = scheduledEffectAnimations.length - 1; index >= 0; index--) {
        const animation = scheduledEffectAnimations[index];
        let finished = false;
        try {
            finished = animation.step(gameNow);
        } catch {
            finished = true;
        }

        if (finished) {
            scheduledEffectAnimations.splice(index, 1);
        }
    }
}

/**
 * Cancel and remove all scheduled animations.
 * Useful during scene teardown/area transitions.
 */
export function clearEffectAnimations(): void {
    scheduledEffectAnimations.length = 0;
}
