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
    // Capture current context to validate it hasn't been replaced
    const currentCtx = ctx;
    setTimeout(() => {
        if (muted) return;
        // Ensure audio context is still valid and is the same context
        if (currentCtx.state === "closed" || audioCtx !== currentCtx) return;
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

// Broodling screech - high-pitched, creepy insectoid sound
const playScreech = () => {
    if (muted) return;
    const ctx = getAudioCtx();

    // Main screech - high pitched descending tone
    const screech = ctx.createOscillator();
    const screechGain = ctx.createGain();
    const screechFilter = ctx.createBiquadFilter();
    screech.type = "sawtooth";
    screech.frequency.setValueAtTime(2400, ctx.currentTime);
    screech.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.08);
    screech.frequency.exponentialRampToValueAtTime(2200, ctx.currentTime + 0.15);
    screech.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);
    screechFilter.type = "bandpass";
    screechFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    screechFilter.Q.setValueAtTime(2, ctx.currentTime);
    screechGain.gain.setValueAtTime(0.15, ctx.currentTime);
    screechGain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    screechGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    screech.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(ctx.destination);
    screech.start();
    screech.stop(ctx.currentTime + 0.3);

    // Chittering overtone - adds creepy insect quality
    const chitter = ctx.createOscillator();
    const chitterGain = ctx.createGain();
    chitter.type = "square";
    chitter.frequency.setValueAtTime(3200, ctx.currentTime);
    chitter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.2);
    chitterGain.gain.setValueAtTime(0.06, ctx.currentTime);
    chitterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    chitter.connect(chitterGain);
    chitterGain.connect(ctx.destination);
    chitter.start();
    chitter.stop(ctx.currentTime + 0.25);
};

// Brood Mother screech - longer, higher, more menacing than broodling screech
const playBroodMotherScreech = () => {
    if (muted) return;
    const ctx = getAudioCtx();

    // Main screech - higher pitched, longer sustain, more dramatic
    const screech = ctx.createOscillator();
    const screechGain = ctx.createGain();
    const screechFilter = ctx.createBiquadFilter();
    screech.type = "sawtooth";
    screech.frequency.setValueAtTime(3200, ctx.currentTime);  // Higher start
    screech.frequency.exponentialRampToValueAtTime(2800, ctx.currentTime + 0.1);
    screech.frequency.exponentialRampToValueAtTime(3400, ctx.currentTime + 0.25);  // Rise up
    screech.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.4);
    screech.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.7);  // Long descent
    screechFilter.type = "bandpass";
    screechFilter.frequency.setValueAtTime(2800, ctx.currentTime);
    screechFilter.Q.setValueAtTime(3, ctx.currentTime);  // Sharper resonance
    screechGain.gain.setValueAtTime(0.2, ctx.currentTime);
    screechGain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.1);
    screechGain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.4);
    screechGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    screech.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(ctx.destination);
    screech.start();
    screech.stop(ctx.currentTime + 0.7);

    // High harmonic layer - piercing overtone
    const harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    harmonic.type = "sine";
    harmonic.frequency.setValueAtTime(4800, ctx.currentTime);
    harmonic.frequency.exponentialRampToValueAtTime(4200, ctx.currentTime + 0.3);
    harmonic.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.6);
    harmonicGain.gain.setValueAtTime(0.08, ctx.currentTime);
    harmonicGain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.15);
    harmonicGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(ctx.destination);
    harmonic.start();
    harmonic.stop(ctx.currentTime + 0.6);

    // Chittering undertone - creepy layered effect
    const chitter = ctx.createOscillator();
    const chitterGain = ctx.createGain();
    chitter.type = "square";
    chitter.frequency.setValueAtTime(4000, ctx.currentTime);
    chitter.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + 0.5);
    chitterGain.gain.setValueAtTime(0.05, ctx.currentTime);
    chitterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    chitter.connect(chitterGain);
    chitterGain.connect(ctx.destination);
    chitter.start();
    chitter.stop(ctx.currentTime + 0.55);
};

// Rip/Tear - velcro-like tearing sound for amoeba splits
const playGush = () => {
    if (muted) return;
    const ctx = getAudioCtx();
    const duration = 0.35;

    // Crackly noise with rising pitch - the "rrrriiIIP" effect
    const bufferSize = ctx.sampleRate * duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        // Crackly texture - random pops and clicks
        const t = i / bufferSize;
        const crackle = Math.random() > 0.7 ? (Math.random() * 2 - 1) : 0;
        const base = (Math.random() * 2 - 1) * 0.3;
        output[i] = (base + crackle) * (1 - t * 0.3);  // Slight decay
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // Highpass filter that sweeps up - creates the rising "riiip"
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.setValueAtTime(200, ctx.currentTime);
    hpFilter.frequency.exponentialRampToValueAtTime(2000, ctx.currentTime + duration * 0.8);
    hpFilter.Q.setValueAtTime(2, ctx.currentTime);

    // Bandpass for texture
    const bpFilter = ctx.createBiquadFilter();
    bpFilter.type = "bandpass";
    bpFilter.frequency.setValueAtTime(800, ctx.currentTime);
    bpFilter.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + duration);
    bpFilter.Q.setValueAtTime(1.5, ctx.currentTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, ctx.currentTime);
    noiseGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + duration * 0.6);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    noise.connect(hpFilter);
    hpFilter.connect(bpFilter);
    bpFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();

    // Add a slight rising tone for emphasis
    const tone = ctx.createOscillator();
    const toneGain = ctx.createGain();
    tone.type = "sawtooth";
    tone.frequency.setValueAtTime(150, ctx.currentTime);
    tone.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + duration * 0.7);
    toneGain.gain.setValueAtTime(0.08, ctx.currentTime);
    toneGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration * 0.8);
    tone.connect(toneGain);
    toneGain.connect(ctx.destination);
    tone.start();
    tone.stop(ctx.currentTime + duration);
};

// Magic Wave - pure crackling/static sound, no tonal elements
const playMagicWave = () => {
    if (muted) return;
    const ctx = getAudioCtx();
    const duration = 0.9;

    // White noise source using buffer - the core of the crackle
    const bufferSize = ctx.sampleRate * duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

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

// Gulp - liquid drinking sound
const playGulp = () => {
    if (muted) return;
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

// Crunch - food eating sound
const playCrunch = () => {
    if (muted) return;
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
    playScreech,
    playBroodMotherScreech,
    playMagicWave,
    playGush,
    playGulp,
    playCrunch,
};
