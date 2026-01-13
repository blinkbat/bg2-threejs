import { useState } from "react";
import { toggleMute, isMuted } from "../sound";

interface HUDProps {
    aliveEnemies: number;
    alivePlayers: number;
    paused: boolean;
    onTogglePause: () => void;
    onShowHelp: () => void;
    onRestart: () => void;
}

export function HUD({ aliveEnemies, alivePlayers, paused, onTogglePause, onShowHelp, onRestart }: HUDProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    const buttonStyle = {
        padding: "6px 14px",
        background: "#21262d",
        border: "1px solid #444",
        color: "#fff",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: 12
    };

    return (
        <div style={{
            position: "absolute",
            top: 12,
            left: 12,
            fontFamily: "monospace",
            background: "rgba(15,15,25,0.7)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            padding: "12px 16px",
            borderRadius: 6,
            border: "1px solid rgba(60,60,90,0.4)"
        }}>
            <div style={{
                marginBottom: 10,
                fontSize: 14,
                fontWeight: "bold",
                color: aliveEnemies === 0 ? "#4ade80" : alivePlayers === 0 ? "#f87171" : "#fff"
            }}>
                {aliveEnemies === 0 ? "Victory!" : alivePlayers === 0 ? "Defeat!" : `Foes remaining: ${aliveEnemies}`}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <button
                    onClick={onTogglePause}
                    style={{ ...buttonStyle, background: paused ? "#854d0e" : "#21262d" }}
                >
                    {paused ? "Resume" : "Pause"}
                </button>
                <button onClick={onShowHelp} style={buttonStyle}>
                    Help
                </button>
                <button
                    onClick={handleToggleMute}
                    style={{ ...buttonStyle, background: muted ? "#7f1d1d" : "#21262d" }}
                >
                    {muted ? "Unmute" : "Mute"}
                </button>
                <button
                    onClick={onRestart}
                    style={{ ...buttonStyle, background: "#1e3a5f" }}
                >
                    Restart
                </button>
            </div>
        </div>
    );
}
