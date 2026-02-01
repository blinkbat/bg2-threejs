import { useState, useEffect, useCallback } from "react";
import { Play, Pause, Menu, Bug } from "lucide-react";
import { MenuModal } from "./MenuModal";
import { AREAS, type AreaId } from "../game/areas";

interface HUDProps {
    areaName: string;
    areaFlavor: string;
    alivePlayers: number;
    paused: boolean;
    onTogglePause: () => void;
    onPause: () => void;
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
    otherModalOpen?: boolean;
    hasSelection?: boolean;
}

export function HUD({
    areaName,
    areaFlavor,
    alivePlayers,
    paused,
    onTogglePause,
    onPause,
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
    otherModalOpen,
    hasSelection
}: HUDProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [debugPanelOpen, setDebugPanelOpen] = useState(false);

    // Enable debug visuals when panel opens, disable when it closes
    useEffect(() => {
        if (debugPanelOpen && !debug) {
            onToggleDebug();
        } else if (!debugPanelOpen && debug) {
            onToggleDebug();
        }
    }, [debugPanelOpen]);

    const areaList = Object.entries(AREAS).map(([id, data]) => ({
        id: id as AreaId,
        name: data.name
    }));

    const isDefeat = alivePlayers === 0;
    const anyModalOpen = menuOpen || otherModalOpen;

    // Handle opening menu - pause and open
    const handleOpenMenu = useCallback(() => {
        if (!paused) {
            onPause();
        }
        setMenuOpen(true);
    }, [paused, onPause]);

    // Handle closing menu
    const handleCloseMenu = useCallback(() => {
        setMenuOpen(false);
    }, []);

    // Handle pause/resume button - only allow resume if no modals open
    const handlePauseResume = useCallback(() => {
        if (paused && anyModalOpen) {
            // Don't allow resume when modals are open
            return;
        }
        onTogglePause();
    }, [paused, anyModalOpen, onTogglePause]);

    // ESC key - close debug panel if open, close menu if open, open menu if no modals/selection
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (debugPanelOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDebugPanelOpen(false);
                } else if (menuOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCloseMenu();
                } else if (!otherModalOpen && !hasSelection) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOpenMenu();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [debugPanelOpen, menuOpen, otherModalOpen, hasSelection, handleCloseMenu, handleOpenMenu]);

    return (
        <>
            <div className="hud glass-panel-light">
                <div className="hud-area">
                    <div className={`hud-area-name ${isDefeat ? "defeat" : ""}`}>
                        {isDefeat ? "Defeat!" : areaName}
                    </div>
                    {!isDefeat && <div className="hud-area-flavor">{areaFlavor}</div>}
                </div>
                <div className="hud-buttons">
                    <button
                        className={`btn btn-with-icon ${paused ? "btn-resume" : "btn-pause"} ${paused && anyModalOpen ? "disabled" : ""}`}
                        onClick={handlePauseResume}
                        title={paused ? "Resume (Space)" : "Pause (Space)"}
                        disabled={paused && anyModalOpen}
                    >
                        {paused ? <Play size={16} /> : <Pause size={16} />}
                        <span>{paused ? "Resume" : "Pause"}</span>
                    </button>
                    <button
                        className="btn btn-with-icon"
                        onClick={handleOpenMenu}
                        title="Menu (Esc to close)"
                    >
                        <Menu size={16} />
                        <span>Menu</span>
                    </button>
                    <button
                        className={`btn btn-with-icon btn-debug ${debugPanelOpen ? "btn-debug-active" : ""}`}
                        onClick={() => setDebugPanelOpen(prev => !prev)}
                        title="Toggle Debug Panel"
                    >
                        <Bug size={16} />
                        <span>Debug</span>
                    </button>
                </div>
                {/* Debug options inline */}
                {debugPanelOpen && (
                    <div className="hud-debug-section">
                        <div className="hud-debug-group">
                            <div className="hud-debug-label">Warp</div>
                            <div className="hud-debug-buttons">
                                {onWarpToArea && areaList.map(area => (
                                    <button
                                        key={area.id}
                                        className={`btn btn-tiny ${areaName === area.name ? "btn-active" : ""}`}
                                        onClick={() => onWarpToArea(area.id)}
                                    >
                                        {area.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="hud-debug-group">
                            <div className="hud-debug-label">Cheats</div>
                            <div className="hud-debug-buttons">
                                {onAddXp && (
                                    <>
                                        <button className="btn btn-tiny" onClick={() => onAddXp(50)}>+50 XP</button>
                                        <button className="btn btn-tiny" onClick={() => onAddXp(500)}>+500 XP</button>
                                    </>
                                )}
                                {onToggleFastMove && (
                                    <button
                                        className={`btn btn-tiny ${fastMoveEnabled ? "btn-active" : ""}`}
                                        onClick={onToggleFastMove}
                                    >
                                        Speed x10
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {menuOpen && (
                <MenuModal
                    onClose={handleCloseMenu}
                    onShowHelp={onShowHelp}
                    onRestart={onRestart}
                    onSaveClick={onSaveClick}
                    onLoadClick={onLoadClick}
                />
            )}
        </>
    );
}
