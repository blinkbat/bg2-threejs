type NoiseSampleFn = (index: number, size: number) => number;

export function createNoiseBuffer(
    ctx: AudioContext,
    durationSec: number,
    sampleFn: NoiseSampleFn
): AudioBuffer {
    const size = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
        output[i] = sampleFn(i, size);
    }
    return buffer;
}

export function createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    return createNoiseBuffer(ctx, durationSec, () => Math.random() * 2 - 1);
}
