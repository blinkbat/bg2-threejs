interface HUDProps {
    aliveEnemies: number;
    alivePlayers: number;
    paused: boolean;
    onTogglePause: () => void;
}

export function HUD({ aliveEnemies, alivePlayers, paused, onTogglePause }: HUDProps) {
    return (
        <div style={{ position: "absolute", top: 10, left: 10, fontFamily: "monospace", fontSize: 11, color: "#888", background: "rgba(0,0,0,0.6)", padding: "8px 12px", borderRadius: 4 }}>
            <div>Click enemy to attack • Spacebar to pause</div>
            <div>Drag to box-select • Right-drag/Arrows to pan • Scroll to zoom</div>
            <div style={{ marginTop: 6, color: aliveEnemies === 0 ? "#4ade80" : alivePlayers === 0 ? "#f87171" : "#fff" }}>
                {aliveEnemies === 0 ? "Victory!" : alivePlayers === 0 ? "Defeat!" : `Kobolds: ${aliveEnemies}`}
            </div>
            <button onClick={onTogglePause} style={{ marginTop: 6, padding: "4px 10px", background: paused ? "#854d0e" : "#21262d", border: "1px solid #333", color: "#fff", borderRadius: 4, cursor: "pointer" }}>
                {paused ? "▶ Resume" : "⏸ Pause"}
            </button>
        </div>
    );
}
