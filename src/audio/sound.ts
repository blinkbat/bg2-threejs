// =============================================================================
// SOUND EFFECTS - 8-bit style using Web Audio API
// =============================================================================

let audioCtx: AudioContext | null = null;
let muted = false;

export const isMuted = () => muted;
export const setMuted = (value: boolean) => { muted = value; };
export const toggleMute = () => { muted = !muted; return muted; };

const getAudioCtx = () => {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
};

const rand = (base: number, variance: number) => base * (1 + (Math.random() - 0.5) * variance);

const playTone = (freq: number, duration: number, volume: number, type: OscillatorType, freqEnd?: number, filterFreq?: number) => {
    if (muted) return;
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const dur = rand(duration, 0.3);
    const vol = rand(volume, 0.2);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 30, ctx.currentTime);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), ctx.currentTime + dur);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFreq ? rand(filterFreq, 0.4) : rand(4000, 0.3), ctx.currentTime);
    filter.Q.setValueAtTime(rand(1, 0.5), ctx.currentTime);

    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
};

// Fireball - whooshing explosion with long decay
const playFireball = () => {
    if (muted) return;
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
    const bufferSize = ctx.sampleRate * 0.4;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
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
const playExplosion = () => {
    if (muted) return;
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
    const bufferSize = ctx.sampleRate * 0.7;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }
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
const playDeath = () => {
    if (muted) return;
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
    const bufferSize = ctx.sampleRate * 1.2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
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

// Heal - chirpy ascending arpeggio
const playHeal = () => {
    if (muted) return;
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
const playWarcry = () => {
    if (muted) return;
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
    setTimeout(() => {
        if (muted) return;
        const echo = ctx.createOscillator();
        const echoGain = ctx.createGain();
        const echoFilter = ctx.createBiquadFilter();
        echo.type = "sawtooth";
        echo.frequency.setValueAtTime(120, ctx.currentTime);
        echo.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
        echoFilter.type = "lowpass";
        echoFilter.frequency.setValueAtTime(600, ctx.currentTime);
        echoGain.gain.setValueAtTime(0.1, ctx.currentTime);
        echoGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        echo.connect(echoFilter);
        echoFilter.connect(echoGain);
        echoGain.connect(ctx.destination);
        echo.start();
        echo.stop(ctx.currentTime + 0.3);
    }, 150);
};

export const soundFns = {
    playMove: () => playTone(800, 0.06, 0.12, "square", undefined, 3000),
    playAttack: () => playTone(440, 0.08, 0.15, "square", 330, 2500),
    playHit: () => playTone(120, 0.15, 0.25, "sawtooth", 40, 800),
    playMiss: () => playTone(200, 0.12, 0.1, "triangle", 400, 2000),
    playFireball,
    playExplosion,
    playHeal,
    playDeath,
    playWarcry,
};
