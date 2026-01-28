import { useState } from "react";
import { toggleMute, isMuted } from "../audio/sound";
import { AREAS, type AreaId } from "../game/areas";

interface HUDProps {
    areaName: string;
    areaFlavor: string;
    alivePlayers: number;
    paused: boolean;
    gold: number;
    onTogglePause: () => void;
    onShowHelp: () => void;
    onRestart: () => void;
    debug: boolean;
    onToggleDebug: () => void;
    onWarpToArea?: (areaId: AreaId) => void;
    onAddXp?: () => void;
}

export function HUD({ areaName, areaFlavor, alivePlayers, paused, gold, onTogglePause, onShowHelp, onRestart, debug, onToggleDebug, onWarpToArea, onAddXp }: HUDProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    const isDefeat = alivePlayers === 0;

    // Get all available areas for the debug warp menu
    const areaList = Object.entries(AREAS).map(([id, data]) => ({
        id: id as AreaId,
        name: data.name
    }));

    return (
        <div className="hud glass-panel-light">
            <div className="hud-area">
                <div className={`hud-area-name ${isDefeat ? "defeat" : ""}`}>
                    {isDefeat ? "Defeat!" : areaName}
                </div>
                {!isDefeat && <div className="hud-area-flavor">{areaFlavor}</div>}
                {gold > 0 && <div className="hud-gold">{gold} gold</div>}
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
                <button className={`btn ${debug ? "active" : ""}`} onClick={onToggleDebug}>
                    Debug
                </button>
            </div>
            {debug && (
                <div className="debug-warp-menu">
                    {onWarpToArea && (
                        <>
                            <span className="debug-label">Warp:</span>
                            {areaList.map(area => (
                                <button
                                    key={area.id}
                                    className={`btn btn-warp ${areaName === area.name ? "active" : ""}`}
                                    onClick={() => onWarpToArea(area.id)}
                                >
                                    {area.name}
                                </button>
                            ))}
                        </>
                    )}
                    {onAddXp && (
                        <button className="btn btn-warp" onClick={onAddXp}>
                            +50 XP
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
