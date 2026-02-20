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

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function publishHpBarOverlayFrame(frame: HpBarOverlayFrame): void {
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

