// =============================================================================
// CREATURE SOUNDS - Screeches, barks, splashes, etc.
// =============================================================================

import { isMuted, getAudioCtx } from "./core";

const NOOP = () => { };

// Broodling screech - high-pitched, creepy insectoid sound
export const playScreech = () => {
    if (isMuted()) return;
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
export const playBroodMotherScreech = () => {
    if (isMuted()) return;
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
export const playGush = () => {
    if (isMuted()) return;
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

// Bark/growl - aggressive dog-like sound for feral hounds
export const playBark = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Sharp bark - aggressive yap with pitch bend
    const bark = ctx.createOscillator();
    const barkGain = ctx.createGain();
    const barkFilter = ctx.createBiquadFilter();
    bark.type = "sawtooth";
    bark.frequency.setValueAtTime(350, ctx.currentTime);
    bark.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.04);
    bark.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.12);
    barkFilter.type = "lowpass";
    barkFilter.frequency.setValueAtTime(1500, ctx.currentTime);
    barkFilter.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
    barkGain.gain.setValueAtTime(0.5, ctx.currentTime);
    barkGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    bark.connect(barkFilter);
    barkFilter.connect(barkGain);
    barkGain.connect(ctx.destination);
    bark.start();
    bark.stop(ctx.currentTime + 0.2);

    // Second bark syllable - quick follow-up
    const bark2 = ctx.createOscillator();
    const bark2Gain = ctx.createGain();
    const bark2Filter = ctx.createBiquadFilter();
    bark2.type = "sawtooth";
    bark2.frequency.setValueAtTime(400, ctx.currentTime + 0.1);
    bark2.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.2);
    bark2Filter.type = "lowpass";
    bark2Filter.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
    bark2Gain.gain.setValueAtTime(0, ctx.currentTime);
    bark2Gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.1);
    bark2Gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    bark2.connect(bark2Filter);
    bark2Filter.connect(bark2Gain);
    bark2Gain.connect(ctx.destination);
    bark2.start();
    bark2.stop(ctx.currentTime + 0.25);

    // Growl undertone - deeper and louder
    const growl = ctx.createOscillator();
    const growlGain = ctx.createGain();
    growl.type = "sawtooth";
    growl.frequency.setValueAtTime(100, ctx.currentTime);
    growl.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.25);
    growlGain.gain.setValueAtTime(0.3, ctx.currentTime);
    growlGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    growl.connect(growlGain);
    growlGain.connect(ctx.destination);
    growl.start();
    growl.stop(ctx.currentTime + 0.3);
};

// Splash - water splash sound for kraken/tentacles
export const playSplash = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    // Noise burst - water splashing
    const splashSize = ctx.sampleRate * 0.35;
    const splashBuffer = ctx.createBuffer(1, splashSize, ctx.sampleRate);
    const splashOutput = splashBuffer.getChannelData(0);
    for (let i = 0; i < splashSize; i++) {
        const t = i / splashSize;
        // Fast attack, medium decay with some bubbling texture
        const envelope = t < 0.05 ? t / 0.05 : Math.exp(-t * 4);
        const bubbles = 1 + Math.sin(i * 0.02) * 0.2 * Math.exp(-t * 6);
        splashOutput[i] = (Math.random() * 2 - 1) * envelope * bubbles;
    }
    const splash = ctx.createBufferSource();
    splash.buffer = splashBuffer;
    const splashFilter = ctx.createBiquadFilter();
    splashFilter.type = "lowpass";
    splashFilter.frequency.setValueAtTime(2000, ctx.currentTime);
    splashFilter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
    const splashGain = ctx.createGain();
    splashGain.gain.setValueAtTime(0.4, ctx.currentTime);
    splashGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    splash.connect(splashFilter);
    splashFilter.connect(splashGain);
    splashGain.connect(ctx.destination);
    splash.start();

    // Low thump - water displacement
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(100, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);
    thumpGain.gain.setValueAtTime(0.3, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start();
    thump.stop(ctx.currentTime + 0.25);

    // Bubbling overtones
    const bubble = ctx.createOscillator();
    const bubbleGain = ctx.createGain();
    bubble.type = "sine";
    bubble.frequency.setValueAtTime(300, ctx.currentTime + 0.1);
    bubble.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.25);
    bubbleGain.gain.setValueAtTime(0, ctx.currentTime);
    bubbleGain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
    bubbleGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    bubble.connect(bubbleGain);
    bubbleGain.connect(ctx.destination);
    bubble.start();
    bubble.stop(ctx.currentTime + 0.3);
};

// Metallic squeal - harsh resonant scrape for basilisk glare
export const playMetallicSqueal = () => {
    if (isMuted()) return;
    const ctx = getAudioCtx();

    const squeal = ctx.createOscillator();
    const squealGain = ctx.createGain();
    const squealFilter = ctx.createBiquadFilter();
    squeal.type = "sawtooth";
    squeal.frequency.setValueAtTime(1400, ctx.currentTime);
    squeal.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.08);
    squeal.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.32);
    squealFilter.type = "bandpass";
    squealFilter.frequency.setValueAtTime(2200, ctx.currentTime);
    squealFilter.Q.setValueAtTime(8, ctx.currentTime);
    squealGain.gain.setValueAtTime(0.22, ctx.currentTime);
    squealGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    squeal.connect(squealFilter);
    squealFilter.connect(squealGain);
    squealGain.connect(ctx.destination);
    squeal.start();
    squeal.stop(ctx.currentTime + 0.35);

    const scrapeSize = Math.floor(ctx.sampleRate * 0.24);
    const scrapeBuffer = ctx.createBuffer(1, scrapeSize, ctx.sampleRate);
    const scrapeOutput = scrapeBuffer.getChannelData(0);
    for (let i = 0; i < scrapeSize; i++) {
        const t = i / scrapeSize;
        const grit = Math.random() > 0.7 ? (Math.random() * 2 - 1) : 0;
        scrapeOutput[i] = (Math.random() * 2 - 1) * (0.25 + grit) * Math.exp(-t * 5);
    }

    const scrape = ctx.createBufferSource();
    scrape.buffer = scrapeBuffer;
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = "highpass";
    scrapeFilter.frequency.setValueAtTime(2400, ctx.currentTime);
    const scrapeGain = ctx.createGain();
    scrapeGain.gain.setValueAtTime(0.12, ctx.currentTime);
    scrapeGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.24);
    scrape.connect(scrapeFilter);
    scrapeFilter.connect(scrapeGain);
    scrapeGain.connect(ctx.destination);
    scrape.start();
};

// Sustained scratchy flame layer for channeling fire breath
export const startFireBreathScratch = (): (() => void) => {
    if (isMuted()) return NOOP;

    const ctx = getAudioCtx();

    const noiseLength = Math.floor(ctx.sampleRate * 1.5);
    const noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < noiseLength; i++) {
        const white = Math.random() * 2 - 1;
        smooth = smooth * 0.7 + white * 0.3;
        output[i] = smooth * (0.7 + Math.random() * 0.3);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(500, ctx.currentTime);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1500, ctx.currentTime);
    bandpass.Q.setValueAtTime(1.3, ctx.currentTime);

    const growl = ctx.createOscillator();
    growl.type = "sawtooth";
    growl.frequency.setValueAtTime(75, ctx.currentTime);
    growl.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.5);
    growl.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 1.2);

    const growlGain = ctx.createGain();
    growlGain.gain.setValueAtTime(0.05, ctx.currentTime);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = "triangle";
    lfo.frequency.setValueAtTime(16, ctx.currentTime);
    lfoGain.gain.setValueAtTime(400, ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(bandpass.frequency);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.08);

    noise.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(masterGain);

    growl.connect(growlGain);
    growlGain.connect(masterGain);

    masterGain.connect(ctx.destination);

    noise.start();
    growl.start();
    lfo.start();

    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;

        const stopAt = ctx.currentTime + 0.08;
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setValueAtTime(Math.max(masterGain.gain.value, 0.0001), ctx.currentTime);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

        try {
            noise.stop(stopAt + 0.02);
            growl.stop(stopAt + 0.02);
            lfo.stop(stopAt + 0.02);
        } catch {
            // ignore if already stopped
        }
    };
};
