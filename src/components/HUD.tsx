import { useState, useEffect, useCallback, memo } from "react";
import Tippy from "@tippyjs/react";
import { Play, Pause, Menu, Bug } from "lucide-react";
import { MenuModal } from "./MenuModal";
import { JukeboxModal } from "./JukeboxModal";
import { UIColorAdjuster } from "./UIColorAdjuster";
import { AREAS, type AreaId } from "../game/areas";
import type { AutoPauseSettings } from "../hooks/localStorage";

interface LightingTuningSettings {
    shadowsEnabled: boolean;
    exposureScale: number;
    ambientScale: number;
    hemisphereScale: number;
    directionalScale: number;
    shadowRadius: number;
    shadowBias: number;
    shadowNormalBias: number;
    spriteEmissiveScale: number;
    spriteRoughness: number;
    spriteMetalness: number;
}

interface HUDProps {
    areaName: string;
    areaFlavor: string;
    alivePlayers: number;
    paused: boolean;
    onTogglePause: () => void;
    onShowControls: () => void;
    onShowHelp: () => void;
    onShowGlossary: () => void;
    onShowBestiary: () => void;
    onRestart: () => void;
    onSaveClick: () => void;
    onLoadClick: () => void;
    debug: boolean;
    onToggleDebug: () => void;
    autoPauseSettings: AutoPauseSettings;
    onWarpToArea?: (areaId: AreaId) => void;
    onAddXp?: (amount: number) => void;
    onStatBoost?: () => void;
    onTogglePlaytestUnlockAllSkills?: () => void;
    playtestUnlockAllSkillsEnabled?: boolean;
    onTogglePlaytestSkipDialogs?: () => void;
    playtestSkipDialogsEnabled?: boolean;
    onToggleFastMove?: () => void;
    fastMoveEnabled?: boolean;
    onToggleDebugFogOfWar?: () => void;
    debugFogOfWarDisabled?: boolean;
    onToggleAutoPauseEnemySighted: () => void;
    onToggleAutoPauseAllyNearDeath: () => void;
    onToggleAutoPauseAllyKilled: () => void;
    lightingTuning?: LightingTuningSettings;
    onUpdateLightingTuning?: (patch: Partial<LightingTuningSettings>) => void;
    onResetLightingTuning?: () => void;
    lightingTuningOutput?: string;
    menuOpen: boolean;
    jukeboxOpen: boolean;
    onOpenMenu: () => void;
    onCloseMenu: () => void;
    onOpenJukebox: () => void;
    onCloseJukebox: () => void;
    otherModalOpen?: boolean;
    hasSelection?: boolean;
}

export const HUD = memo(function HUD({
    areaName,
    areaFlavor,
    alivePlayers,
    paused,
    onTogglePause,
    onShowControls,
    onShowHelp,
    onShowGlossary,
    onShowBestiary,
    onRestart,
    onSaveClick,
    onLoadClick,
    debug,
    onToggleDebug,
    autoPauseSettings,
    onWarpToArea,
    onAddXp,
    onStatBoost,
    onTogglePlaytestUnlockAllSkills,
    playtestUnlockAllSkillsEnabled,
    onTogglePlaytestSkipDialogs,
    playtestSkipDialogsEnabled,
    onToggleFastMove,
    fastMoveEnabled,
    onToggleDebugFogOfWar,
    debugFogOfWarDisabled,
    onToggleAutoPauseEnemySighted,
    onToggleAutoPauseAllyNearDeath,
    onToggleAutoPauseAllyKilled,
    lightingTuning,
    onUpdateLightingTuning,
    onResetLightingTuning,
    lightingTuningOutput,
    menuOpen,
    jukeboxOpen,
    onOpenMenu,
    onCloseMenu,
    onOpenJukebox,
    onCloseJukebox,
    otherModalOpen,
    hasSelection
}: HUDProps) {
    const TESTING_ROOM_ID = "testing_room" as AreaId;
    const [debugPanelOpen, setDebugPanelOpen] = useState(false);
    const [lightingCopied, setLightingCopied] = useState(false);
    const [lightingExpanded, setLightingExpanded] = useState(false);

    // Enable debug visuals when panel opens, disable when it closes
    useEffect(() => {
        if (debugPanelOpen && !debug) {
            onToggleDebug();
        } else if (!debugPanelOpen && debug) {
            onToggleDebug();
        }
    }, [debugPanelOpen, debug, onToggleDebug]);

    const areaList = Object.entries(AREAS).map(([id, data]) => ({
        id: id as AreaId,
        name: data.name
    }));
    const warpAreaList = areaList.filter(area => area.id !== TESTING_ROOM_ID);

    const isDefeat = alivePlayers === 0;
    const anyModalOpen = menuOpen || jukeboxOpen || otherModalOpen;

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
            if (e.defaultPrevented) return;
            if (e.key === "Escape") {
                if (debugPanelOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDebugPanelOpen(false);
                } else if (menuOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseMenu();
                } else if (!otherModalOpen && !hasSelection) {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenMenu();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [debugPanelOpen, menuOpen, otherModalOpen, hasSelection, onCloseMenu, onOpenMenu]);

    const copyLightingOutput = useCallback(() => {
        if (!lightingTuningOutput) return;
        navigator.clipboard.writeText(lightingTuningOutput).then(() => {
            setLightingCopied(true);
            window.setTimeout(() => setLightingCopied(false), 1200);
        }).catch(() => {
            setLightingCopied(false);
        });
    }, [lightingTuningOutput]);

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
                    <Tippy content={paused ? "Resume (Space)" : "Pause (Space)"} placement="bottom" delay={[300, 0]}>
                        <button
                            className={`btn btn-with-icon ${paused ? "btn-resume" : "btn-pause"} ${paused && anyModalOpen ? "disabled" : ""}`}
                            onClick={handlePauseResume}
                            disabled={paused && anyModalOpen}
                        >
                            {paused ? <Play size={16} /> : <Pause size={16} />}
                            <span>{paused ? "Resume" : "Pause"}</span>
                        </button>
                    </Tippy>
                    <Tippy content="Menu (Esc)" placement="bottom" delay={[300, 0]}>
                        <button
                            className="btn btn-with-icon"
                            onClick={onOpenMenu}
                        >
                            <Menu size={16} />
                            <span>Menu</span>
                        </button>
                    </Tippy>
                    <Tippy content="Toggle Debug Panel" placement="bottom" delay={[300, 0]}>
                        <button
                            className={`btn btn-with-icon btn-debug ${debugPanelOpen ? "btn-debug-active" : ""}`}
                            onClick={() => setDebugPanelOpen(prev => !prev)}
                        >
                            <Bug size={16} />
                            <span>Debug</span>
                        </button>
                    </Tippy>
                </div>
                {/* Debug options inline */}
                {debugPanelOpen && (
                    <div className="hud-debug-section">
                        <div className="hud-debug-group">
                            <div className="hud-debug-label">Playtest Mode</div>
                            <div className="hud-debug-buttons">
                                {onTogglePlaytestUnlockAllSkills && (
                                    <button
                                        className={`btn btn-tiny ${playtestUnlockAllSkillsEnabled ? "btn-active" : ""}`}
                                        onClick={onTogglePlaytestUnlockAllSkills}
                                    >
                                        Unlock Skills
                                    </button>
                                )}
                                {onTogglePlaytestSkipDialogs && (
                                    <button
                                        className={`btn btn-tiny ${playtestSkipDialogsEnabled ? "btn-active" : ""}`}
                                        onClick={onTogglePlaytestSkipDialogs}
                                    >
                                        Skip Dialogs
                                    </button>
                                )}
                                {onWarpToArea && (
                                    <button
                                        className={`btn btn-tiny ${areaName === AREAS[TESTING_ROOM_ID].name ? "btn-active" : ""}`}
                                        onClick={() => onWarpToArea(TESTING_ROOM_ID)}
                                    >
                                        Testing Room
                                    </button>
                                )}
                                <button
                                    className="btn btn-tiny"
                                    onClick={() => {
                                        if (!paused) {
                                            onTogglePause();
                                        }
                                        onOpenJukebox();
                                    }}
                                >
                                    Jukebox
                                </button>
                            </div>
                        </div>
                        <div className="hud-debug-group">
                            <div className="hud-debug-label">Warp</div>
                            <div className="hud-debug-buttons">
                                {onWarpToArea && warpAreaList.map(area => (
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
                                        <button className="btn btn-tiny" onClick={() => onAddXp(50)}>+50 Experience</button>
                                        <button className="btn btn-tiny" onClick={() => onAddXp(500)}>+500 Experience</button>
                                    </>
                                )}
                                {onStatBoost && (
                                    <button className="btn btn-tiny" onClick={onStatBoost}>+10 Stats</button>
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
                        {onToggleDebugFogOfWar && (
                            <div className="hud-debug-group">
                                <div className="hud-debug-label">Visuals</div>
                                <div className="hud-debug-buttons">
                                    <button
                                        className={`btn btn-tiny ${debugFogOfWarDisabled ? "btn-active" : ""}`}
                                        onClick={onToggleDebugFogOfWar}
                                    >
                                        Hide FoW
                                    </button>
                                </div>
                            </div>
                        )}

                        <UIColorAdjuster />

                        {lightingTuning && onUpdateLightingTuning && (
                            <div className="hud-debug-group">
                                <div className="hud-debug-group-header">
                                    <div className="hud-debug-label">Lighting</div>
                                    <button
                                        className="btn btn-tiny hud-debug-expand-btn"
                                        onClick={() => setLightingExpanded(prev => !prev)}
                                    >
                                        {lightingExpanded ? "Hide" : "Show"}
                                    </button>
                                </div>
                                {lightingExpanded && (
                                    <>
                                        <div className="hud-debug-controls">
                                            <label className="hud-debug-toggle">
                                                <input
                                                    type="checkbox"
                                                    checked={lightingTuning.shadowsEnabled}
                                                    onChange={e => onUpdateLightingTuning({ shadowsEnabled: e.target.checked })}
                                                />
                                                Shadows
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Exposure x{lightingTuning.exposureScale.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0.5"
                                                    max="1.8"
                                                    step="0.01"
                                                    value={lightingTuning.exposureScale}
                                                    onChange={e => onUpdateLightingTuning({ exposureScale: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Ambient x{lightingTuning.ambientScale.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.01"
                                                    value={lightingTuning.ambientScale}
                                                    onChange={e => onUpdateLightingTuning({ ambientScale: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Hemisphere x{lightingTuning.hemisphereScale.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.01"
                                                    value={lightingTuning.hemisphereScale}
                                                    onChange={e => onUpdateLightingTuning({ hemisphereScale: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Directional x{lightingTuning.directionalScale.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.01"
                                                    value={lightingTuning.directionalScale}
                                                    onChange={e => onUpdateLightingTuning({ directionalScale: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Shadow Radius {lightingTuning.shadowRadius.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="6"
                                                    step="0.1"
                                                    value={lightingTuning.shadowRadius}
                                                    onChange={e => onUpdateLightingTuning({ shadowRadius: parseFloat(e.target.value) })}
                                                    disabled={!lightingTuning.shadowsEnabled}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Shadow Bias {lightingTuning.shadowBias.toFixed(5)}</span>
                                                <input
                                                    type="range"
                                                    min="-0.002"
                                                    max="0.001"
                                                    step="0.00005"
                                                    value={lightingTuning.shadowBias}
                                                    onChange={e => onUpdateLightingTuning({ shadowBias: parseFloat(e.target.value) })}
                                                    disabled={!lightingTuning.shadowsEnabled}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Shadow Normal Bias {lightingTuning.shadowNormalBias.toFixed(3)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="0.05"
                                                    step="0.001"
                                                    value={lightingTuning.shadowNormalBias}
                                                    onChange={e => onUpdateLightingTuning({ shadowNormalBias: parseFloat(e.target.value) })}
                                                    disabled={!lightingTuning.shadowsEnabled}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Sprite Emissive x{lightingTuning.spriteEmissiveScale.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="3"
                                                    step="0.05"
                                                    value={lightingTuning.spriteEmissiveScale}
                                                    onChange={e => onUpdateLightingTuning({ spriteEmissiveScale: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Sprite Roughness {lightingTuning.spriteRoughness.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={lightingTuning.spriteRoughness}
                                                    onChange={e => onUpdateLightingTuning({ spriteRoughness: parseFloat(e.target.value) })}
                                                />
                                            </label>

                                            <label className="hud-debug-control">
                                                <span>Sprite Metalness {lightingTuning.spriteMetalness.toFixed(2)}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={lightingTuning.spriteMetalness}
                                                    onChange={e => onUpdateLightingTuning({ spriteMetalness: parseFloat(e.target.value) })}
                                                />
                                            </label>
                                        </div>
                                        <div className="hud-debug-buttons">
                                            {onResetLightingTuning && (
                                                <button className="btn btn-tiny" onClick={onResetLightingTuning}>Reset Lighting</button>
                                            )}
                                            <button className="btn btn-tiny" onClick={copyLightingOutput}>
                                                {lightingCopied ? "Copied" : "Copy Lighting"}
                                            </button>
                                        </div>
                                        {lightingTuningOutput && (
                                            <textarea className="hud-debug-output" readOnly value={lightingTuningOutput} />
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {menuOpen && (
                <MenuModal
                    onClose={onCloseMenu}
                    onShowControls={onShowControls}
                    onShowHelp={onShowHelp}
                    onShowGlossary={onShowGlossary}
                    onShowBestiary={onShowBestiary}
                    onRestart={onRestart}
                    onSaveClick={onSaveClick}
                    onLoadClick={onLoadClick}
                    autoPauseSettings={autoPauseSettings}
                    onToggleAutoPauseEnemySighted={onToggleAutoPauseEnemySighted}
                    onToggleAutoPauseAllyNearDeath={onToggleAutoPauseAllyNearDeath}
                    onToggleAutoPauseAllyKilled={onToggleAutoPauseAllyKilled}
                />
            )}

            {jukeboxOpen && (
                <JukeboxModal onClose={onCloseJukebox} />
            )}
        </>
    );
});
