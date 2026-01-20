import { useState } from "react";
import { toggleMute, isMuted } from "../audio/sound";

interface HUDProps {
    areaName: string;
    areaFlavor: string;
    alivePlayers: number;
    paused: boolean;
    onTogglePause: () => void;
    onShowHelp: () => void;
    onRestart: () => void;
}

export function HUD({ areaName, areaFlavor, alivePlayers, paused, onTogglePause, onShowHelp, onRestart }: HUDProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    const isDefeat = alivePlayers === 0;

    return (
        <div className="hud glass-panel-light">
            <div className="hud-area">
                <div className={`hud-area-name ${isDefeat ? "defeat" : ""}`}>
                    {isDefeat ? "Defeat!" : areaName}
                </div>
                {!isDefeat && <div className="hud-area-flavor">{areaFlavor}</div>}
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
