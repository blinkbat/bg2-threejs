// =============================================================================
// SPELL SOUNDS - Heal, warcry, magic wave, shield, thunder, vines
// =============================================================================

import { isMuted, getAudioCtx, getAudioContext } from "./core";
import { createNoiseBuffer, createWhiteNoiseBuffer } from "./noise";

// Heal - chirpy ascending arpeggio
export const playHeal = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6

    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        // Add slight vibrato
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
        osc.frequency.linearRampToValueAtTime(freq * 1.02, ctx.currentTime + i * 0.08 + 0.05);
        osc.frequency.linearRampToValueAtTime(freq, ctx.currentTime + i * 0.08 + 0.1);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(3000, ctx.currentTime);

        const startTime = ctx.currentTime + i * 0.08;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.25);
    });
};

// Warcry - aggressive shout with echo
export const playWarcry = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Main shout - rising then falling tone
    const shout = ctx.createOscillator();
    const shoutGain = ctx.createGain();
    const shoutFilter = ctx.createBiquadFilter();
    shout.type = "sawtooth";
    shout.frequency.setValueAtTime(150, ctx.currentTime);
    shout.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);
    shout.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.5);
    shoutFilter.type = "lowpass";
    shoutFilter.frequency.setValueAtTime(1200, ctx.currentTime);
    shoutFilter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.5);
    shoutGain.gain.setValueAtTime(0.35, ctx.currentTime);
    shoutGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    shout.connect(shoutFilter);
    shoutFilter.connect(shoutGain);
    shoutGain.connect(ctx.destination);
    shout.start();
    shout.stop(ctx.currentTime + 0.5);

    // Harmonic layer for aggression
    const harm = ctx.createOscillator();
    const harmGain = ctx.createGain();
    harm.type = "square";
    harm.frequency.setValueAtTime(200, ctx.currentTime);
    harm.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
    harm.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.4);
    harmGain.gain.setValueAtTime(0.15, ctx.currentTime);
    harmGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    harm.connect(harmGain);
    harmGain.connect(ctx.destination);
    harm.start();
    harm.stop(ctx.currentTime + 0.4);

    // Echo/reverb effect - delayed quieter repeat
    // Capture current context to validate it hasn't been replaced
    const currentCtx = ctx;
    setTimeout(() => {
        if (isMuted()) return;
        // Ensure audio context is still valid and is the same context
        if (currentCtx.state === "closed" || getAudioContext() !== currentCtx) return;
        const echo = currentCtx.createOscillator();
        const echoGain = currentCtx.createGain();
        const echoFilter = currentCtx.createBiquadFilter();
        echo.type = "sawtooth";
        echo.frequency.setValueAtTime(120, currentCtx.currentTime);
        echo.frequency.exponentialRampToValueAtTime(80, currentCtx.currentTime + 0.3);
        echoFilter.type = "lowpass";
        echoFilter.frequency.setValueAtTime(600, currentCtx.currentTime);
        echoGain.gain.setValueAtTime(0.1, currentCtx.currentTime);
        echoGain.gain.exponentialRampToValueAtTime(0.001, currentCtx.currentTime + 0.3);
        echo.connect(echoFilter);
        echoFilter.connect(echoGain);
        echoGain.connect(currentCtx.destination);
        echo.start();
        echo.stop(currentCtx.currentTime + 0.3);
    }, 150);
};

// Magic Wave - pure crackling/static sound, no tonal elements
export const playMagicWave = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();
    const duration = 0.9;

    // White noise source using buffer - the core of the crackle
    const noiseBuffer = createWhiteNoiseBuffer(ctx, duration);

    // Noise layer 1 - main crackle with highpass filter
    const noise1 = ctx.createBufferSource();
    noise1.buffer = noiseBuffer;
    const noise1Filter = ctx.createBiquadFilter();
    noise1Filter.type = "highpass";
    noise1Filter.frequency.setValueAtTime(2000, ctx.currentTime);
    const noise1Gain = ctx.createGain();
    noise1Gain.gain.setValueAtTime(0.12, ctx.currentTime);
    noise1Gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.1);
    noise1Gain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + duration * 0.5);
    noise1Gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + duration);
    noise1.connect(noise1Filter);
    noise1Filter.connect(noise1Gain);
    noise1Gain.connect(ctx.destination);
    noise1.start();
    noise1.stop(ctx.currentTime + duration);

    // Noise layer 2 - bandpass filtered for mid crackle texture
    const noise2 = ctx.createBufferSource();
    noise2.buffer = noiseBuffer;
    const noise2Filter = ctx.createBiquadFilter();
    noise2Filter.type = "bandpass";
    noise2Filter.frequency.setValueAtTime(4000, ctx.currentTime);
    noise2Filter.Q.setValueAtTime(1.5, ctx.currentTime);
    const noise2Gain = ctx.createGain();
    noise2Gain.gain.setValueAtTime(0.08, ctx.currentTime);
    noise2Gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.15);
    noise2Gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + duration);
    noise2.connect(noise2Filter);
    noise2Filter.connect(noise2Gain);
    noise2Gain.connect(ctx.destination);
    noise2.start();
    noise2.stop(ctx.currentTime + duration);

    // Noise layer 3 - very high freq sizzle
    const noise3 = ctx.createBufferSource();
    noise3.buffer = noiseBuffer;
    const noise3Filter = ctx.createBiquadFilter();
    noise3Filter.type = "highpass";
    noise3Filter.frequency.setValueAtTime(6000, ctx.currentTime);
    const noise3Gain = ctx.createGain();
    noise3Gain.gain.setValueAtTime(0.05, ctx.currentTime);
    noise3Gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.2);
    noise3Gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + duration);
    noise3.connect(noise3Filter);
    noise3Filter.connect(noise3Gain);
    noise3Gain.connect(ctx.destination);
    noise3.start();
    noise3.stop(ctx.currentTime + duration);
};

// Energy Shield - ethereal whoosh with crystalline shimmer
export const playEnergyShield = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Whoosh sweep - filtered noise rising in pitch
    const noiseBuffer = createWhiteNoiseBuffer(ctx, 0.5);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(400, ctx.currentTime);
    noiseFilter.frequency.exponentialRampToValueAtTime(2000, ctx.currentTime + 0.15);
    noiseFilter.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);
    noiseFilter.Q.setValueAtTime(2, ctx.currentTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, ctx.currentTime);
    noiseGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    noiseGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.15);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + 0.4);

    // Crystalline shimmer - high sine tones
    const shimmerNotes = [1047, 1319, 1760]; // C6, E6, A6
    shimmerNotes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        const startTime = ctx.currentTime + i * 0.03;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.3);
    });

    // Low resonant hum - gives weight to the shield
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.type = "sine";
    hum.frequency.setValueAtTime(110, ctx.currentTime);
    humGain.gain.setValueAtTime(0, ctx.currentTime);
    humGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    humGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    hum.connect(humGain);
    humGain.connect(ctx.destination);
    hum.start();
    hum.stop(ctx.currentTime + 0.35);
};

// Thunder crack - sharp lightning strike with rumble
export const playThunder = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Sharp initial CRACK - white noise burst with very fast attack
    const crackBuffer = createNoiseBuffer(ctx, 0.08, (i, size) => {
        const t = i / size;
        const envelope = t < 0.05 ? t / 0.05 : Math.exp(-t * 15);
        return (Math.random() * 2 - 1) * envelope;
    });
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuffer;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.setValueAtTime(1500, ctx.currentTime);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.5, ctx.currentTime);
    crackGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(ctx.destination);
    crack.start();

    // Mid-frequency crackle layer - the "CRRACK" texture
    const crackleBuffer = createNoiseBuffer(ctx, 0.15, (i, size) => {
        const t = i / size;
        const spike = Math.random() > 0.85 ? 1 : 0.3;
        return (Math.random() * 2 - 1) * spike * Math.exp(-t * 8);
    });
    const crackle = ctx.createBufferSource();
    crackle.buffer = crackleBuffer;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = "bandpass";
    crackleFilter.frequency.setValueAtTime(3000, ctx.currentTime);
    crackleFilter.Q.setValueAtTime(1, ctx.currentTime);
    const crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(0.35, ctx.currentTime);
    crackleGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    crackle.connect(crackleFilter);
    crackleFilter.connect(crackleGain);
    crackleGain.connect(ctx.destination);
    crackle.start();

    // Deep rumble - follows the crack
    const rumble = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumble.type = "sawtooth";
    rumble.frequency.setValueAtTime(80, ctx.currentTime);
    rumble.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
    rumbleGain.gain.setValueAtTime(0, ctx.currentTime);
    rumbleGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    rumble.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumble.start();
    rumble.stop(ctx.currentTime + 0.5);

    // Sub-bass thump - impact feeling
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(60, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.3);
    thumpGain.gain.setValueAtTime(0.3, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start();
    thump.stop(ctx.currentTime + 0.35);
};

// Vines - earthy rustling/growing sound for entangle
export const playVines = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Rustling noise - filtered for organic feel
    const rustleBuffer = createNoiseBuffer(ctx, 0.4, (i, size) => {
        const t = i / size;
        const rustle = Math.random() * 2 - 1;
        const envelope = Math.sin(t * Math.PI) * (1 + Math.sin(t * 20) * 0.3);
        return rustle * envelope * 0.4;
    });
    const rustleNoise = ctx.createBufferSource();
    rustleNoise.buffer = rustleBuffer;
    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = "bandpass";
    rustleFilter.frequency.setValueAtTime(800, ctx.currentTime);
    rustleFilter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.4);
    rustleFilter.Q.setValueAtTime(2, ctx.currentTime);
    const rustleGain = ctx.createGain();
    rustleGain.gain.setValueAtTime(0.3, ctx.currentTime);
    rustleGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    rustleNoise.connect(rustleFilter);
    rustleFilter.connect(rustleGain);
    rustleGain.connect(ctx.destination);
    rustleNoise.start();

    // Low earthy tone - vines rising from ground
    const earth = ctx.createOscillator();
    const earthGain = ctx.createGain();
    earth.type = "triangle";
    earth.frequency.setValueAtTime(60, ctx.currentTime);
    earth.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.15);
    earth.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.35);
    earthGain.gain.setValueAtTime(0.2, ctx.currentTime);
    earthGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    earth.connect(earthGain);
    earthGain.connect(ctx.destination);
    earth.start();
    earth.stop(ctx.currentTime + 0.4);

    // Snap/grab sound at the end
    const snap = ctx.createOscillator();
    const snapGain = ctx.createGain();
    snap.type = "square";
    snap.frequency.setValueAtTime(300, ctx.currentTime + 0.25);
    snap.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.35);
    snapGain.gain.setValueAtTime(0, ctx.currentTime);
    snapGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.25);
    snapGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    snap.connect(snapGain);
    snapGain.connect(ctx.destination);
    snap.start();
    snap.stop(ctx.currentTime + 0.35);
};
