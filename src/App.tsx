import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { soundFns } from "./audio";
import { Game } from "./app/Game";
import type { PersistedPlayer } from "./app/gameSetup";
import type { SaveableGameState } from "./app/gameShared";
import { clearPathCache, invalidateDynamicObstacles } from "./ai/pathfinding";
import { ControlsModal } from "./components/ControlsModal";
import { GlossaryModal } from "./components/GlossaryModal";
import { HelpModal } from "./components/HelpModal";
import { SaveLoadModal } from "./components/SaveLoadModal";
import { buildAreaDialogDefinitionMap } from "./dialog/areaDialogs";
import { getDialogDefinitionById } from "./dialog/registry";
import type { DialogDefinition, MenuChainAction } from "./dialog/types";
import {
    getAllEquipment,
    getPartyInventory,
    initializeEquipmentState,
    setAllEquipment,
    setPartyInventory,
} from "./game/equipmentState";
import {
    clearFogVisibilityMemory,
    restoreFogVisibilityMemory,
} from "./game/fogMemory";
import {
    AREAS,
    DEFAULT_STARTING_AREA,
    getCurrentArea,
    setCurrentArea,
    type AreaId,
} from "./game/areas";
import {
    buildSaveSlotData,
    deleteSave,
    getSaveSlots,
    loadGame,
    resolveLoadedSaveState,
    saveGame,
    type DialogTriggerProgress,
    type SaveLoadOperationResult,
    type SaveSlotData,
} from "./game/saveLoad";
import { saveFormationOrder } from "./hooks/formationStorage";
import { saveHotbarAssignments } from "./hooks/hotbarStorage";
import { loadPlaytestSettings } from "./hooks/localStorage";

// =============================================================================
// APP WRAPPER
// =============================================================================

// Transition timing constants
const AREA_FADE_DURATION = 300; // ms for area transition fade in/out
const STARTUP_SCENE_FADE_IN_DURATION = 1400; // ms for initial black-to-scene fade
const STARTUP_FANFARE_LEAD_IN_MS = 550;
type StartupPhase = "title" | "booting" | "running";
type InfoModalKind = "controls" | "help" | "glossary";

function shouldSkipGameIntro(): boolean {
    return loadPlaytestSettings().skipDialogs;
}

export default function App() {
    const [skipIntroByDefault] = useState<boolean>(shouldSkipGameIntro);
    const [gameKey, setGameKey] = useState(0);
    const [openInfoModal, setOpenInfoModal] = useState<InfoModalKind | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [jukeboxOpen, setJukeboxOpen] = useState(false);
    const pendingChainActionRef = useRef<MenuChainAction | null>(null);
    const [persistedPlayers, setPersistedPlayers] = useState<PersistedPlayer[] | null>(null);
    const [spawnPoint, setSpawnPoint] = useState<{ x: number; z: number } | null>(null);
    const [spawnDirection, setSpawnDirection] = useState<"north" | "south" | "east" | "west" | undefined>(undefined);
    const [showSaveLoad, setShowSaveLoad] = useState(false);
    const [saveLoadMode, setSaveLoadMode] = useState<"save" | "load">("save");
    const [hasSaves] = useState(() => getSaveSlots().some(s => s !== null));
    const [initialOpenedChests, setInitialOpenedChests] = useState<Set<string> | null>(null);
    const [initialOpenedSecretDoors, setInitialOpenedSecretDoors] = useState<Set<string> | null>(null);
    const [initialActivatedWaystones, setInitialActivatedWaystones] = useState<Set<string> | null>(null);
    const [initialGold, setInitialGold] = useState<number | null>(null);
    const [initialKilledEnemies, setInitialKilledEnemies] = useState<Set<string> | null>(null);
    const [initialEnemyPositions, setInitialEnemyPositions] = useState<Partial<Record<string, { x: number; z: number }>> | null>(null);
    const [initialDialogTriggerProgress, setInitialDialogTriggerProgress] = useState<DialogTriggerProgress | null>(null);
    const [initialLastWaystone, setInitialLastWaystone] = useState<{ areaId: AreaId; waystoneIndex: number } | null>(null);
    const [savePreviewState, setSavePreviewState] = useState<SaveSlotData | null>(null);
    const [saveDisabledReason, setSaveDisabledReason] = useState<string | null>(null);
    const gameStateRef = useRef<(() => SaveableGameState) | null>(null);
    const startDialogRef = useRef<((definition: DialogDefinition) => void) | null>(null);
    const [startupPhase, setStartupPhase] = useState<StartupPhase>(skipIntroByDefault ? "running" : "title");
    const [gameMounted, setGameMounted] = useState(skipIntroByDefault);
    const [dialogTriggersEnabled, setDialogTriggersEnabled] = useState(skipIntroByDefault);

    // Transition overlay state (starts opaque unless intro is skipped)
    const [transitionOpacity, setTransitionOpacity] = useState(skipIntroByDefault ? 0 : 1);
    const pendingTransition = useRef<{ players: PersistedPlayer[]; targetArea: AreaId; spawn: { x: number; z: number }; direction?: "north" | "south" | "east" | "west" } | null>(null);
    const transitionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupBootTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const startupReadyTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const skipNextFogSaveOnUnmountRef = useRef(false);

    const setCurrentAreaWithPathReset = useCallback((areaId: AreaId) => {
        setCurrentArea(areaId);
        clearPathCache();
        invalidateDynamicObstacles();
    }, []);

    const startStartupBoot = useCallback((options?: { playFanfare?: boolean; mountDelayMs?: number }) => {
        const playFanfare = options?.playFanfare ?? false;
        const mountDelayMs = options?.mountDelayMs ?? 0;

        setStartupPhase("booting");
        setDialogTriggersEnabled(false);
        setTransitionOpacity(1);
        if (playFanfare) {
            soundFns.playGameStartFanfare();
        }

        if (startupBootTimeoutRef.current !== null) {
            window.clearTimeout(startupBootTimeoutRef.current);
            startupBootTimeoutRef.current = null;
        }

        if (mountDelayMs <= 0) {
            setGameMounted(true);
            return;
        }

        startupBootTimeoutRef.current = window.setTimeout(() => {
            startupBootTimeoutRef.current = null;
            setGameMounted(true);
        }, mountDelayMs);
    }, []);

    const handleStartGame = useCallback(() => {
        if (startupPhase !== "title") return;
        startStartupBoot({ playFanfare: true, mountDelayMs: STARTUP_FANFARE_LEAD_IN_MS });
    }, [startupPhase, startStartupBoot]);

    const executePendingChain = useCallback(() => {
        const action = pendingChainActionRef.current;
        pendingChainActionRef.current = null;
        if (!action) return;
        if (action.type === "open_menu") {
            // Dispatch without passing a chain to prevent infinite loops
            const id = action.menuId;
            if (id === "controls" || id === "startup_controls") { setOpenInfoModal("controls"); }
            else if (id === "help") { setOpenInfoModal("help"); }
            else if (id === "glossary") { setOpenInfoModal("glossary"); }
            else if (id === "save_game") { setSaveLoadMode("save"); setShowSaveLoad(true); }
            else if (id === "load_game") { setSaveLoadMode("load"); setShowSaveLoad(true); }
            else if (id === "equipment") { /* equipment needs a unit — skip if no obvious target */ }
            else if (id === "menu") { setMenuOpen(true); }
            else if (id === "jukebox") { setJukeboxOpen(true); }
        }
        if (action.type === "open_dialog") {
            const area = getCurrentArea();
            const areaDialogs = buildAreaDialogDefinitionMap(area.dialogs);
            const definition = areaDialogs.get(action.dialogId) ?? getDialogDefinitionById(action.dialogId);
            if (definition) {
                const overriddenDefinition = action.startNodeId && definition.nodes[action.startNodeId]
                    ? { ...definition, startNodeId: action.startNodeId }
                    : definition;
                startDialogRef.current?.(overriddenDefinition);
            }
        }
    }, []);

    const handleShowControls = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("controls");
    }, []);

    const handleShowHelp = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("help");
    }, []);

    const handleShowGlossary = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setOpenInfoModal("glossary");
    }, []);

    const handleCloseInfoModal = useCallback(() => {
        pendingChainActionRef.current = null;
        setOpenInfoModal(null);
    }, []);

    const handleCloseHelpModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleConfirmControlsModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleCloseGlossaryModal = useCallback(() => {
        setOpenInfoModal(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenMenu = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setMenuOpen(true);
    }, []);

    const handleCloseMenu = useCallback(() => {
        setMenuOpen(false);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenJukebox = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setJukeboxOpen(true);
    }, []);

    const handleCloseJukebox = useCallback(() => {
        setJukeboxOpen(false);
        executePendingChain();
    }, [executePendingChain]);

    const handleFullRestart = () => {
        const skipIntro = shouldSkipGameIntro();
        if (gameMounted) {
            skipNextFogSaveOnUnmountRef.current = true;
        }

        if (transitionTimeoutRef.current !== null) {
            window.clearTimeout(transitionTimeoutRef.current);
            transitionTimeoutRef.current = null;
        }
        if (startupBootTimeoutRef.current !== null) {
            window.clearTimeout(startupBootTimeoutRef.current);
            startupBootTimeoutRef.current = null;
        }
        if (startupReadyTimeoutRef.current !== null) {
            window.clearTimeout(startupReadyTimeoutRef.current);
            startupReadyTimeoutRef.current = null;
        }
        pendingTransition.current = null;
        setStartupPhase(skipIntro ? "running" : "title");
        setGameMounted(skipIntro);
        setDialogTriggersEnabled(skipIntro);
        setTransitionOpacity(skipIntro ? 0 : 1);
        setOpenInfoModal(null);
        setMenuOpen(false);
        setJukeboxOpen(false);
        pendingChainActionRef.current = null;
        setShowSaveLoad(false);
        setSavePreviewState(null);
        setPersistedPlayers(null);
        setSpawnPoint(null);
        setSpawnDirection(undefined);
        setInitialOpenedChests(null);
        setInitialOpenedSecretDoors(null);
        setInitialActivatedWaystones(null);
        setInitialGold(null);
        setInitialKilledEnemies(null);
        setInitialEnemyPositions(null);
        setInitialDialogTriggerProgress(null);
        setInitialLastWaystone(null);
        clearFogVisibilityMemory();
        initializeEquipmentState();
        setCurrentAreaWithPathReset(DEFAULT_STARTING_AREA);
        setGameKey(k => k + 1);
    };

    const handleAreaTransition = (players: PersistedPlayer[], targetArea: AreaId, spawn: { x: number; z: number }, direction?: "north" | "south" | "east" | "west") => {
        if (!AREAS[targetArea]) {
            if (import.meta.env.DEV) {
                console.warn(`[app] Ignoring transition to unknown area "${targetArea}".`);
            }
            return;
        }

        // Persist world progression across the forced Game remount on area transitions.
        setInitialEnemyPositions(null);
        const worldState = gameStateRef.current?.();
        if (worldState) {
            setInitialOpenedChests(new Set(worldState.openedChests));
            setInitialOpenedSecretDoors(new Set(worldState.openedSecretDoors));
            setInitialActivatedWaystones(new Set(worldState.activatedWaystones));
            setInitialKilledEnemies(new Set(worldState.killedEnemies));
            setInitialGold(worldState.gold);
            setInitialDialogTriggerProgress(worldState.dialogTriggerProgress);
            setInitialLastWaystone(worldState.lastWaystone ?? null);
        }

        // Store pending transition and start fade to black
        pendingTransition.current = { players, targetArea, spawn, direction };
        setTransitionOpacity(1);
        soundFns.playFootsteps();

        // After fade completes, execute the actual transition
        if (transitionTimeoutRef.current !== null) {
            window.clearTimeout(transitionTimeoutRef.current);
        }
        transitionTimeoutRef.current = window.setTimeout(() => {
            transitionTimeoutRef.current = null;
            if (pendingTransition.current) {
                const { players: p, targetArea: area, spawn: s, direction: dir } = pendingTransition.current;
                setPersistedPlayers(p);
                setSpawnPoint(s);
                setSpawnDirection(dir);
                setCurrentAreaWithPathReset(area);
                setGameKey(k => k + 1);
            }
        }, AREA_FADE_DURATION);
    };

    useEffect(() => {
        return () => {
            if (transitionTimeoutRef.current !== null) {
                window.clearTimeout(transitionTimeoutRef.current);
                transitionTimeoutRef.current = null;
            }
            if (startupBootTimeoutRef.current !== null) {
                window.clearTimeout(startupBootTimeoutRef.current);
                startupBootTimeoutRef.current = null;
            }
            if (startupReadyTimeoutRef.current !== null) {
                window.clearTimeout(startupReadyTimeoutRef.current);
                startupReadyTimeoutRef.current = null;
            }
        };
    }, []);

    const handleSceneReady = useCallback(() => {
        // Scene is ready, fade out the overlay
        pendingTransition.current = null;
        if (startupPhase === "booting") {
            setTransitionOpacity(0);
            if (startupReadyTimeoutRef.current !== null) {
                window.clearTimeout(startupReadyTimeoutRef.current);
            }
            startupReadyTimeoutRef.current = window.setTimeout(() => {
                startupReadyTimeoutRef.current = null;
                setDialogTriggersEnabled(true);
                setStartupPhase("running");
            }, STARTUP_SCENE_FADE_IN_DURATION);
            return;
        }
        setTransitionOpacity(0);
    }, [startupPhase]);

    const transitionDurationMs = startupPhase === "booting"
        ? STARTUP_SCENE_FADE_IN_DURATION
        : AREA_FADE_DURATION;

    const buildCurrentSavePreview = useCallback((timestamp: number): SaveSlotData | null => {
        if (!gameStateRef.current) return null;
        const state = gameStateRef.current();
        const areaData = AREAS[state.currentAreaId];
        const slotName = areaData?.name ?? state.currentAreaId;
        return buildSaveSlotData({
            timestamp,
            slotName,
            state,
            equipment: getAllEquipment(),
            inventory: getPartyInventory(),
        });
    }, []);

    useEffect(() => {
        if (!showSaveLoad) return;
        const interval = setInterval(() => {
            const saveState = gameStateRef.current?.();
            setSaveDisabledReason(saveLoadMode === "save" ? (saveState?.saveLockReason ?? null) : null);
            const preview = buildCurrentSavePreview(Date.now());
            if (preview) {
                setSavePreviewState(preview);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [showSaveLoad, saveLoadMode, buildCurrentSavePreview]);

    const handleSave = (slot: number): SaveLoadOperationResult => {
        if (!gameStateRef.current) {
            return {
                ok: false,
                code: "invalid_save_data",
                error: "Game state is unavailable. Please try again.",
            };
        }
        const state = gameStateRef.current();
        if (state.saveLockReason) {
            return {
                ok: false,
                code: "invalid_save_data",
                error: state.saveLockReason,
            };
        }
        const areaData = AREAS[state.currentAreaId];
        const saveData = buildSaveSlotData({
            timestamp: Date.now(),
            slotName: areaData?.name ?? state.currentAreaId,
            state,
            equipment: getAllEquipment(),
            inventory: getPartyInventory(),
        });
        return saveGame(slot, saveData);
    };

    const handleLoad = (slot: number): SaveLoadOperationResult => {
        const loaded = loadGame(slot);
        if (!loaded.ok) return loaded;

        const resolved = resolveLoadedSaveState(loaded.data, AREAS);
        if (!resolved.ok) return resolved;

        const saveData = resolved.data;
        const loadingFromTitleScreen = startupPhase === "title";
        if (gameMounted) {
            skipNextFogSaveOnUnmountRef.current = true;
        }

        restoreFogVisibilityMemory(saveData.fogVisibilityByArea);
        setAllEquipment(saveData.equipment);
        setPartyInventory(saveData.inventory);
        setCurrentAreaWithPathReset(saveData.areaId);
        setInitialOpenedChests(new Set(saveData.openedChests));
        setInitialOpenedSecretDoors(new Set(saveData.openedSecretDoors));
        setInitialActivatedWaystones(new Set(saveData.activatedWaystones));
        setInitialKilledEnemies(new Set(saveData.killedEnemies));
        setInitialGold(saveData.gold);
        setInitialEnemyPositions(saveData.enemyPositions ?? null);
        setPersistedPlayers(saveData.players);
        setInitialDialogTriggerProgress(saveData.dialogTriggerProgress);
        setInitialLastWaystone(saveData.lastWaystone ?? null);
        setSpawnPoint(saveData.spawnPoint);
        // Restore UI state to localStorage so Game reads it on remount
        if (saveData.hotbarAssignments) saveHotbarAssignments(saveData.hotbarAssignments);
        if (saveData.formationOrder) saveFormationOrder(saveData.formationOrder);
        if (loadingFromTitleScreen) {
            // Restore loads should boot straight into the saved scene without the new-game fanfare delay.
            startStartupBoot();
        }
        setGameKey(k => k + 1);
        return { ok: true };
    };

    const handleDelete = (slot: number): SaveLoadOperationResult => {
        return deleteSave(slot);
    };

    const openSaveLoadModal = useCallback((mode: "save" | "load", options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        setSaveLoadMode(mode);
        setShowSaveLoad(true);
        const saveState = gameStateRef.current?.();
        setSaveDisabledReason(mode === "save" ? (saveState?.saveLockReason ?? null) : null);
        setSavePreviewState(buildCurrentSavePreview(Date.now()));
    }, [buildCurrentSavePreview]);

    const closeSaveLoadModal = useCallback(() => {
        setShowSaveLoad(false);
        setSavePreviewState(null);
        setSaveDisabledReason(null);
        executePendingChain();
    }, [executePendingChain]);

    const handleOpenEquipment = useCallback((options?: { chainAction?: MenuChainAction }) => {
        pendingChainActionRef.current = options?.chainAction ?? null;
        // Equipment modal needs a unitId — opened via unit panel in standalone mode;
        // from dialog, just set chain and let the existing equipment open flow handle it.
        // For now, we don't auto-open equipment from dialog (needs a selected unit).
    }, []);

    const handleCloseEquipment = useCallback(() => {
        executePendingChain();
    }, [executePendingChain]);

    useEffect(() => {
        if (startupPhase !== "title" || showSaveLoad) return;

        const onAnyKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            handleStartGame();
        };

        window.addEventListener("keydown", onAnyKeyDown, true);
        return () => window.removeEventListener("keydown", onAnyKeyDown, true);
    }, [startupPhase, handleStartGame, showSaveLoad]);

    return (
        <>
            {gameMounted && (
                <Game
                    key={gameKey} onRestart={handleFullRestart} onAreaTransition={handleAreaTransition}
                    onShowControls={handleShowControls} onShowHelp={handleShowHelp} onShowGlossary={handleShowGlossary} onCloseInfoModal={handleCloseInfoModal}
                    infoModalOpen={openInfoModal !== null} saveLoadOpen={showSaveLoad}
                    menuOpen={menuOpen} jukeboxOpen={jukeboxOpen}
                    persistedPlayers={persistedPlayers} spawnPoint={spawnPoint} spawnDirection={spawnDirection}
                    onSaveClick={(opts) => openSaveLoadModal("save", opts)}
                    onLoadClick={(opts) => openSaveLoadModal("load", opts)}
                    onOpenMenu={handleOpenMenu} onCloseMenu={handleCloseMenu}
                    onOpenJukebox={handleOpenJukebox} onCloseJukebox={handleCloseJukebox}
                    onOpenEquipment={handleOpenEquipment} onCloseEquipment={handleCloseEquipment}
                    gameStateRef={gameStateRef} startDialogRef={startDialogRef}
                    initialOpenedChests={initialOpenedChests} initialOpenedSecretDoors={initialOpenedSecretDoors} initialActivatedWaystones={initialActivatedWaystones}
                    initialGold={initialGold} initialKilledEnemies={initialKilledEnemies} initialEnemyPositions={initialEnemyPositions}
                    initialDialogTriggerProgress={initialDialogTriggerProgress}
                    initialLastWaystone={initialLastWaystone}
                    dialogTriggersEnabled={dialogTriggersEnabled}
                    skipNextFogSaveOnUnmountRef={skipNextFogSaveOnUnmountRef}
                    onReady={handleSceneReady}
                />
            )}
            {gameMounted && openInfoModal === "controls" && <ControlsModal onClose={handleCloseInfoModal} onConfirm={handleConfirmControlsModal} />}
            {gameMounted && openInfoModal === "help" && <HelpModal onClose={handleCloseHelpModal} />}
            {gameMounted && openInfoModal === "glossary" && <GlossaryModal onClose={handleCloseGlossaryModal} />}
            {showSaveLoad && (
                <SaveLoadModal
                    mode={saveLoadMode}
                    onClose={closeSaveLoadModal}
                    onSave={handleSave}
                    onLoad={handleLoad}
                    onDelete={handleDelete}
                    currentState={savePreviewState}
                    saveDisabledReason={saveDisabledReason}
                    overlayClassName={startupPhase === "title" ? "modal-overlay--startup" : undefined}
                />
            )}
            {startupPhase === "title" && (
                <div className="startup-title-screen">
                    <div className="startup-title-card">
                        <h1 className="startup-title-text">Archipelago</h1>
                        <div className="startup-title-buttons">
                            <button className="startup-title-btn startup-title-btn-new" onClick={handleStartGame}>
                                New Game
                            </button>
                            {hasSaves && (
                                <button className="startup-title-btn startup-title-btn-load" onClick={() => { setSaveLoadMode("load"); setShowSaveLoad(true); }}>
                                    Load Game
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Transition overlay - fades to black during area transitions */}
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: startupPhase === "running" ? "var(--ui-color-overlay-strong)" : "#000000",
                    opacity: transitionOpacity,
                    pointerEvents: transitionOpacity > 0 ? "all" : "none",
                    transition: `opacity ${transitionDurationMs}ms ease-in-out`,
                    zIndex: 9999
                }}
            />
            <Analytics />
            <SpeedInsights />
        </>
    );
}

