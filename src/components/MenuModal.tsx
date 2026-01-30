import { useState } from "react";
import {
    Save,
    FolderOpen,
    RotateCcw,
    Volume2,
    VolumeX,
    HelpCircle,
    Bug,
    Map,
    Sparkles,
    Zap,
    X
} from "lucide-react";
import { toggleMute, isMuted } from "../audio/sound";
import { AREAS, type AreaId } from "../game/areas";

interface MenuModalProps {
    onClose: () => void;
    onShowHelp: () => void;
    onRestart: () => void;
    onSaveClick: () => void;
    onLoadClick: () => void;
    debug: boolean;
    onToggleDebug: () => void;
    onWarpToArea?: (areaId: AreaId) => void;
    onAddXp?: (amount: number) => void;
    onToggleFastMove?: () => void;
    fastMoveEnabled?: boolean;
    currentAreaName: string;
}

export function MenuModal({
    onClose,
    onShowHelp,
    onRestart,
    onSaveClick,
    onLoadClick,
    debug,
    onToggleDebug,
    onWarpToArea,
    onAddXp,
    onToggleFastMove,
    fastMoveEnabled,
    currentAreaName
}: MenuModalProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    const handleSave = () => {
        onSaveClick();
        onClose();
    };

    const handleLoad = () => {
        onLoadClick();
        onClose();
    };

    const handleHelp = () => {
        onShowHelp();
        onClose();
    };

    const handleRestart = () => {
        if (confirm("Are you sure you want to restart? All unsaved progress will be lost.")) {
            onRestart();
            onClose();
        }
    };

    const areaList = Object.entries(AREAS).map(([id, data]) => ({
        id: id as AreaId,
        name: data.name
    }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content menu-modal" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Menu</h2>
                    <div className="close-btn" onClick={onClose}><X size={18} /></div>
                </div>

                {/* Game Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Game</div>
                    <div className="menu-buttons">
                        <button className="menu-btn" onClick={handleSave}>
                            <Save size={18} />
                            <span>Save Game</span>
                        </button>
                        <button className="menu-btn" onClick={handleLoad}>
                            <FolderOpen size={18} />
                            <span>Load Game</span>
                        </button>
                        <button className="menu-btn menu-btn-danger" onClick={handleRestart}>
                            <RotateCcw size={18} />
                            <span>Restart</span>
                        </button>
                    </div>
                </div>

                {/* Settings Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Settings</div>
                    <div className="menu-buttons">
                        <button className={`menu-btn ${muted ? "active" : ""}`} onClick={handleToggleMute}>
                            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            <span>{muted ? "Unmute" : "Mute"}</span>
                        </button>
                        <button className="menu-btn" onClick={handleHelp}>
                            <HelpCircle size={18} />
                            <span>Controls</span>
                        </button>
                    </div>
                </div>

                {/* Debug Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Developer</div>
                    <div className="menu-buttons">
                        <button className={`menu-btn ${debug ? "active" : ""}`} onClick={onToggleDebug}>
                            <Bug size={18} />
                            <span>Debug Mode</span>
                        </button>
                    </div>

                    {debug && (
                        <>
                            <div className="menu-subsection">
                                <div className="menu-subsection-title">
                                    <Map size={14} />
                                    <span>Warp to Area</span>
                                </div>
                                <div className="menu-buttons menu-buttons-small">
                                    {onWarpToArea && areaList.map(area => (
                                        <button
                                            key={area.id}
                                            className={`menu-btn menu-btn-small ${currentAreaName === area.name ? "active" : ""}`}
                                            onClick={() => { onWarpToArea(area.id); onClose(); }}
                                        >
                                            {area.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="menu-subsection">
                                <div className="menu-subsection-title">
                                    <Sparkles size={14} />
                                    <span>Cheats</span>
                                </div>
                                <div className="menu-buttons menu-buttons-small">
                                    {onAddXp && (
                                        <>
                                            <button className="menu-btn menu-btn-small" onClick={() => onAddXp(50)}>
                                                +50 XP
                                            </button>
                                            <button className="menu-btn menu-btn-small" onClick={() => onAddXp(500)}>
                                                +500 XP
                                            </button>
                                        </>
                                    )}
                                    {onToggleFastMove && (
                                        <button
                                            className={`menu-btn menu-btn-small ${fastMoveEnabled ? "active" : ""}`}
                                            onClick={onToggleFastMove}
                                        >
                                            <Zap size={14} />
                                            <span>Speed x10</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
