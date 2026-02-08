// =============================================================================
// UI SOUNDS - Move, gold, level up, secret discovered, food sounds
// =============================================================================

import { isMuted, getAudioCtx } from "./core";

// Gulp - liquid drinking sound
export const playGulp = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Bubble/glug tone - descending with wobble
    const glug = ctx.createOscillator();
    const glugGain = ctx.createGain();
    const glugFilter = ctx.createBiquadFilter();
    glug.type = "sine";
    glug.frequency.setValueAtTime(400, ctx.currentTime);
    glug.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
    glug.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.12);
    glug.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.2);
    glugFilter.type = "lowpass";
    glugFilter.frequency.setValueAtTime(600, ctx.currentTime);
    glugGain.gain.setValueAtTime(0.2, ctx.currentTime);
    glugGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    glug.connect(glugFilter);
    glugFilter.connect(glugGain);
    glugGain.connect(ctx.destination);
    glug.start();
    glug.stop(ctx.currentTime + 0.22);

    // Second glug - slightly higher
    const glug2 = ctx.createOscillator();
    const glug2Gain = ctx.createGain();
    const glug2Filter = ctx.createBiquadFilter();
    glug2.type = "sine";
    glug2.frequency.setValueAtTime(450, ctx.currentTime + 0.1);
    glug2.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.22);
    glug2Filter.type = "lowpass";
    glug2Filter.frequency.setValueAtTime(700, ctx.currentTime);
    glug2Gain.gain.setValueAtTime(0, ctx.currentTime);
    glug2Gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.1);
    glug2Gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    glug2.connect(glug2Filter);
    glug2Filter.connect(glug2Gain);
    glug2Gain.connect(ctx.destination);
    glug2.start();
    glug2.stop(ctx.currentTime + 0.25);
};

// Level Up fanfare - triumphant ascending arpeggio (2s cooldown to prevent overlap)
let lastLevelUpTime = 0;
const LEVEL_UP_COOLDOWN = 2000; // 2 seconds

export const playLevelUp = () => {
    if (isMuted()) return;

    // Check cooldown to prevent overlapping fanfares
    const now = Date.now();
    if (now - lastLevelUpTime < LEVEL_UP_COOLDOWN) return;
    lastLevelUpTime = now;

    const ctx = getAudioCtx();

    // Triumphant arpeggio - C major with octave jump
    const notes = [
        { freq: 523, time: 0 },      // C5
        { freq: 659, time: 0.12 },   // E5
        { freq: 784, time: 0.24 },   // G5
        { freq: 1047, time: 0.36 },  // C6
        { freq: 1319, time: 0.5 },   // E6
        { freq: 1568, time: 0.65 },  // G6
    ];

    notes.forEach(({ freq, time }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + time);
        // Add slight vibrato
        osc.frequency.linearRampToValueAtTime(freq * 1.02, ctx.currentTime + time + 0.08);
        osc.frequency.linearRampToValueAtTime(freq, ctx.currentTime + time + 0.15);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(4000, ctx.currentTime);

        const startTime = ctx.currentTime + time;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.15, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.45);
    });

    // Sustained chord at the end
    const chordNotes = [1047, 1319, 1568]; // C6, E6, G6
    chordNotes.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        const startTime = ctx.currentTime + 0.7;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.4);
    });
};

// Secret discovered - mysterious Zelda-style ascending chime
export const playSecretDiscovered = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Classic secret discovery arpeggio - ascending minor with shimmer
    const notes = [
        { freq: 392, time: 0 },      // G4
        { freq: 466, time: 0.08 },   // Bb4
        { freq: 523, time: 0.16 },   // C5
        { freq: 622, time: 0.24 },   // Eb5
        { freq: 784, time: 0.32 },   // G5
        { freq: 932, time: 0.4 },    // Bb5
    ];

    notes.forEach(({ freq, time }) => {
        // Main tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + time);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(3000, ctx.currentTime);

        const startTime = ctx.currentTime + time;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.45);

        // Shimmer overtone (octave above)
        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.type = "sine";
        shimmer.frequency.setValueAtTime(freq * 2, ctx.currentTime + time);

        shimmerGain.gain.setValueAtTime(0, startTime);
        shimmerGain.gain.linearRampToValueAtTime(0.06, startTime + 0.02);
        shimmerGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

        shimmer.connect(shimmerGain);
        shimmerGain.connect(ctx.destination);
        shimmer.start(startTime);
        shimmer.stop(startTime + 0.35);
    });

    // Final sustained mystery chord
    const chordNotes = [784, 932, 1175]; // G5, Bb5, D6 (minor)
    chordNotes.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        const startTime = ctx.currentTime + 0.5;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.12, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.65);
    });
};

// Crunch - food eating sound
export const playCrunch = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Crunchy noise burst
    const bufferSize = ctx.sampleRate * 0.15;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    // Bitcrushed crackle texture
    const crushRate = 8;
    let holdValue = 0;
    for (let i = 0; i < bufferSize; i++) {
        if (i % crushRate === 0) {
            holdValue = Math.random() * 2 - 1;
        }
        output[i] = holdValue * Math.exp(-i / (bufferSize * 0.4));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    noiseFilter.Q.setValueAtTime(1, ctx.currentTime);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();

    // Low crunch tone
    const crunch = ctx.createOscillator();
    const crunchGain = ctx.createGain();
    crunch.type = "sawtooth";
    crunch.frequency.setValueAtTime(200, ctx.currentTime);
    crunch.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);
    crunchGain.gain.setValueAtTime(0.15, ctx.currentTime);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    crunch.connect(crunchGain);
    crunchGain.connect(ctx.destination);
    crunch.start();
    crunch.stop(ctx.currentTime + 0.12);
};

// Fading footsteps - for area transitions
export const playFootsteps = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Series of footsteps that fade out
    const steps = 6;
    for (let i = 0; i < steps; i++) {
        const time = i * 0.15;  // 150ms between steps
        const volume = 0.3 * (1 - i / steps);  // Fade out

        // Low thud - foot impact
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        const thudFilter = ctx.createBiquadFilter();

        thud.type = "sine";
        thud.frequency.setValueAtTime(80 + Math.random() * 20, ctx.currentTime + time);
        thud.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + time + 0.08);

        thudFilter.type = "lowpass";
        thudFilter.frequency.setValueAtTime(200, ctx.currentTime + time);

        const startTime = ctx.currentTime + time;
        thudGain.gain.setValueAtTime(0, startTime);
        thudGain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        thudGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

        thud.connect(thudFilter);
        thudFilter.connect(thudGain);
        thudGain.connect(ctx.destination);
        thud.start(startTime);
        thud.stop(startTime + 0.12);

        // Scuff noise - stone floor texture
        const bufferSize = Math.floor(ctx.sampleRate * 0.06);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let j = 0; j < bufferSize; j++) {
            output[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.3));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime + time);
        noiseFilter.Q.setValueAtTime(2, ctx.currentTime + time);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.5, ctx.currentTime + time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + 0.06);
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noise.start(startTime + 0.01);
    }
};

// Gold coin pickup - satisfying jingle
export const playGold = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Coin jingle - quick ascending notes
    const notes = [
        { freq: 1047, time: 0 },      // C6
        { freq: 1319, time: 0.05 },   // E6
        { freq: 1568, time: 0.1 },    // G6
    ];

    notes.forEach(({ freq, time }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + time);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(4000, ctx.currentTime);

        const startTime = ctx.currentTime + time;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.15, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
    });

    // Metallic shimmer - coin glint
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(2637, ctx.currentTime);  // E7
    shimmer.frequency.exponentialRampToValueAtTime(2093, ctx.currentTime + 0.1);  // C7
    shimmerGain.gain.setValueAtTime(0.05, ctx.currentTime);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start();
    shimmer.stop(ctx.currentTime + 0.15);
};
