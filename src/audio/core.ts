// =============================================================================
// AUDIO CORE - Shared state and helper functions
// =============================================================================

let audioCtx: AudioContext | null = null;
let muted = false;

export const isMuted = () => muted;
export const toggleMute = () => { muted = !muted; return muted; };

export const getAudioCtx = () => {
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioContext();
    return audioCtx;
};

const rand = (base: number, variance: number) => base * (1 + (Math.random() - 0.5) * variance);

export const playTone = (freq: number, duration: number, volume: number, type: OscillatorType, freqEnd?: number, filterFreq?: number) => {
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

// Re-export audioCtx getter for modules that need direct access to context state
export const getAudioContext = () => audioCtx;
