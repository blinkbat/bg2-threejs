import { useSyncExternalStore } from "react";
import {
    getHpBarOverlaySnapshot,
    subscribeHpBarOverlay
} from "../hooks/hpBarOverlayStore";
import { getHpColor } from "../combat/combatMath";

export function HpBarsOverlay() {
    const snapshot = useSyncExternalStore(
        subscribeHpBarOverlay,
        getHpBarOverlaySnapshot,
        getHpBarOverlaySnapshot
    );

    const barWidth = Math.max(16, 24 * snapshot.scale);
    const barHeight = Math.max(2, 3 * snapshot.scale);

    return (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {snapshot.bars.map(bar => {
                if (!bar.visible) return null;
                const maxHp = Math.max(1, bar.maxHp);
                const pct = Math.max(0, Math.min(1, bar.hp / maxHp));
                const color = getHpColor(pct * 100);
                const x = bar.x - barWidth * 0.5;
                const y = bar.y - barHeight * 0.5;

                return (
                    <div
                        key={bar.id}
                        style={{
                            position: "absolute",
                            width: barWidth,
                            height: barHeight,
                            backgroundColor: "var(--ui-color-surface-alt)",
                            transform: `translate3d(${x}px, ${y}px, 0)`,
                            willChange: "transform"
                        }}
                    >
                        <div
                            style={{
                                width: `${pct * 100}%`,
                                height: "100%",
                                backgroundColor: color,
                                transition: "width 90ms linear"
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
