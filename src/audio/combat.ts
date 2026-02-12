// =============================================================================
// COMBAT SOUNDS - Fireball, explosion, death, block, etc.
// =============================================================================

import { isMuted, getAudioCtx } from "./core";
import { createNoiseBuffer } from "./noise";

// Fireball - whooshing explosion with long decay
export const playFireball = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Whoosh layer - rising then falling
    const whoosh = ctx.createOscillator();
    const whooshGain = ctx.createGain();
    const whooshFilter = ctx.createBiquadFilter();
    whoosh.type = "sawtooth";
    whoosh.frequency.setValueAtTime(200, ctx.currentTime);
    whoosh.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
    whoosh.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.6);
    whooshFilter.type = "lowpass";
    whooshFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    whooshFilter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.6);
    whooshGain.gain.setValueAtTime(0.15, ctx.currentTime);
    whooshGain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.1);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    whoosh.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    whoosh.start();
    whoosh.stop(ctx.currentTime + 0.6);

    // Crackle layer - noise burst
    const noiseBuffer = createNoiseBuffer(ctx, 0.4, (i, size) => (
        (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.3))
    ));
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1500, ctx.currentTime);
    noiseFilter.Q.setValueAtTime(0.5, ctx.currentTime);
    noiseGain.gain.setValueAtTime(0.12, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(ctx.currentTime + 0.08);
};

// Fireball explosion on impact - deep boom with crackle
export const playExplosion = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Deep boom - louder and longer
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(100, ctx.currentTime);
    boom.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.8);
    boomGain.gain.setValueAtTime(0.5, ctx.currentTime);
    boomGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start();
    boom.stop(ctx.currentTime + 0.9);

    // Sub-bass punch
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(50, ctx.currentTime);
    sub.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.5);
    subGain.gain.setValueAtTime(0.4, ctx.currentTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start();
    sub.stop(ctx.currentTime + 0.6);

    // Crackle/sizzle layer - longer decay
    const noiseBuffer = createNoiseBuffer(ctx, 0.7, (i, size) => (
        (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.25))
    ));
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(600, ctx.currentTime);
    noiseGain.gain.setValueAtTime(0.35, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();
};

// Death - crushed/squashed sound with long bitcrush decay
export const playDeath = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Low crunch - descending tone with longer decay
    const crunch = ctx.createOscillator();
    const crunchGain = ctx.createGain();
    const crunchFilter = ctx.createBiquadFilter();
    crunch.type = "sawtooth";
    crunch.frequency.setValueAtTime(180, ctx.currentTime);
    crunch.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.8);
    crunchFilter.type = "lowpass";
    crunchFilter.frequency.setValueAtTime(800, ctx.currentTime);
    crunchFilter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.8);
    crunchGain.gain.setValueAtTime(0.3, ctx.currentTime);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
    crunch.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(ctx.destination);
    crunch.start();
    crunch.stop(ctx.currentTime + 1.0);

    // Bitcrushed noise - long crackle/crush texture decay
    const noiseBuffer = createNoiseBuffer(ctx, 1.2, () => 0);
    const output = noiseBuffer.getChannelData(0);
    const bufferSize = output.length;
    // Create bitcrushed effect with sample-and-hold
    const bitcrushRate = 12; // samples to hold
    let holdValue = 0;
    for (let i = 0; i < bufferSize; i++) {
        if (i % bitcrushRate === 0) {
            holdValue = (Math.random() * 2 - 1);
        }
        output[i] = holdValue * Math.exp(-i / (bufferSize * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(500, ctx.currentTime);
    noiseFilter.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 1.0);
    noiseFilter.Q.setValueAtTime(1.5, ctx.currentTime);
    noiseGain.gain.setValueAtTime(0.3, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();

    // Thud - low impact
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(80, ctx.currentTime);
    thud.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.4);
    thudGain.gain.setValueAtTime(0.4, ctx.currentTime);
    thudGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start();
    thud.stop(ctx.currentTime + 0.5);
};

// Block - metallic "schiing" sound for shield blocks
export const playBlock = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Sharp metallic ring - the initial impact
    const ring = ctx.createOscillator();
    const ringGain = ctx.createGain();
    const ringFilter = ctx.createBiquadFilter();
    ring.type = "sawtooth";
    ring.frequency.setValueAtTime(1200, ctx.currentTime);
    ring.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.02);
    ring.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.1);
    ring.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.25);
    ringFilter.type = "bandpass";
    ringFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    ringFilter.Q.setValueAtTime(4, ctx.currentTime);
    ringGain.gain.setValueAtTime(0.25, ctx.currentTime);
    ringGain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    ringGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    ring.connect(ringFilter);
    ringFilter.connect(ringGain);
    ringGain.connect(ctx.destination);
    ring.start();
    ring.stop(ctx.currentTime + 0.3);

    // High shimmer - the metallic "shing" overtone
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(3200, ctx.currentTime);
    shimmer.frequency.exponentialRampToValueAtTime(2800, ctx.currentTime + 0.15);
    shimmerGain.gain.setValueAtTime(0.12, ctx.currentTime);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start();
    shimmer.stop(ctx.currentTime + 0.2);

    // Low thud - impact weight
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(180, ctx.currentTime);
    thud.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);
    thudGain.gain.setValueAtTime(0.2, ctx.currentTime);
    thudGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start();
    thud.stop(ctx.currentTime + 0.15);
};
