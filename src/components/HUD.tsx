import { useState } from "react";
import { toggleMute, isMuted } from "../audio/sound";

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

    const statusClass = aliveEnemies === 0 ? "victory" : alivePlayers === 0 ? "defeat" : "";

    return (
        <div className="hud glass-panel-light">
            <div className={`hud-status ${statusClass}`}>
                {aliveEnemies === 0 ? "Victory!" : alivePlayers === 0 ? "Defeat!" : `Foes remaining: ${aliveEnemies}`}
            </div>
            <div className="hud-buttons">
                <button className={`btn btn-pause ${paused ? "active" : ""}`} onClick={onTogglePause}>
                    {paused ? "Resume" : "Pause"}
                </button>
                <button className="btn" onClick={onShowHelp}>
                    Help
                </button>
                <button className={`btn btn-mute ${muted ? "active" : ""}`} onClick={handleToggleMute}>
                    {muted ? "Unmute" : "Mute"}
                </button>
                <button className="btn btn-restart" onClick={onRestart}>
                    Restart
                </button>
            </div>
        </div>
    );
}
