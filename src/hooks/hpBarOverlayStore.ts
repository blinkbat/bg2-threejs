export interface HpBarOverlayEntry {
    id: number;
    x: number;
    y: number;
    visible: boolean;
    hp: number;
    maxHp: number;
}

export interface HpBarOverlayFrame {
    bars: HpBarOverlayEntry[];
    scale: number;
}

interface HpBarOverlaySnapshot extends HpBarOverlayFrame {
    version: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let currentSnapshot: HpBarOverlaySnapshot = {
    bars: [],
    scale: 1,
    version: 0
};
const HP_BAR_POSITION_EPSILON = 0.5;

function areFramesEquivalent(
    previous: HpBarOverlaySnapshot,
    next: HpBarOverlayFrame
): boolean {
    if (Math.abs(previous.scale - next.scale) > 0.001) return false;
    if (previous.bars.length !== next.bars.length) return false;

    for (let i = 0; i < previous.bars.length; i++) {
        const a = previous.bars[i];
        const b = next.bars[i];
        if (
            a.id !== b.id
            || a.visible !== b.visible
            || a.hp !== b.hp
            || a.maxHp !== b.maxHp
            || Math.abs(a.x - b.x) > HP_BAR_POSITION_EPSILON
            || Math.abs(a.y - b.y) > HP_BAR_POSITION_EPSILON
        ) {
            return false;
        }
    }

    return true;
}

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function publishHpBarOverlayFrame(frame: HpBarOverlayFrame): void {
    if (areFramesEquivalent(currentSnapshot, frame)) {
        return;
    }
    currentSnapshot = {
        ...frame,
        version: currentSnapshot.version + 1
    };
    emit();
}

export function resetHpBarOverlayFrame(): void {
    currentSnapshot = {
        bars: [],
        scale: 1,
        version: currentSnapshot.version + 1
    };
    emit();
}

export function subscribeHpBarOverlay(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getHpBarOverlaySnapshot(): HpBarOverlaySnapshot {
    return currentSnapshot;
}
