// =============================================================================
// SOUND EFFECTS - 8-bit style using Web Audio API
// =============================================================================

let audioCtx: AudioContext | null = null;

const getAudioCtx = () => {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
};

const rand = (base: number, variance: number) => base * (1 + (Math.random() - 0.5) * variance);

const playTone = (freq: number, duration: number, volume: number, type: OscillatorType, freqEnd?: number, filterFreq?: number) => {
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

export const soundFns = {
    playMove: () => playTone(800, 0.06, 0.12, "square", undefined, 3000),
    playAttack: () => playTone(440, 0.08, 0.15, "square", 330, 2500),
    playHit: () => playTone(120, 0.15, 0.25, "sawtooth", 40, 800),
    playMiss: () => playTone(200, 0.12, 0.1, "triangle", 400, 2000),
};
