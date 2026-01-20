import { useState } from "react";
import { toggleMute, isMuted } from "../audio/sound";

interface HUDProps {
    aliveEnemies: number;
    alivePlayers: number;
    paused: boolean;
    areaHasEnemies: boolean;  // Whether current area has enemy spawns
    onTogglePause: () => void;
    onShowHelp: () => void;
    onRestart: () => void;
}

export function HUD({ aliveEnemies, alivePlayers, paused, areaHasEnemies, onTogglePause, onShowHelp, onRestart }: HUDProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    // Only show victory if the area has enemies and they're all defeated
    const isVictory = areaHasEnemies && aliveEnemies === 0;
    const statusClass = isVictory ? "victory" : alivePlayers === 0 ? "defeat" : "";

    return (
        <div className="hud glass-panel-light">
            <div className={`hud-status ${statusClass}`}>
                {isVictory ? "Victory!" : alivePlayers === 0 ? "Defeat!" : areaHasEnemies ? `Foes remaining: ${aliveEnemies}` : "Exploring..."}
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
