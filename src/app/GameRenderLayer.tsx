import * as React from "react";
import type {
    CharacterStats,
    CombatLogEntry,
    EnemyStats,
    EquipmentSlot,
    SelectionBox,
    Skill,
    Unit,
} from "../core/types";
import { AREAS, type AreaId } from "../game/areas";
import { getAmoebaMaxHpForSplitCount, getMonsterTypeLabel } from "../game/enemyStats";
import { getEnemyUnitStats } from "../game/units";
import { getEffectiveMaxHp, isCorePlayerId, UNIT_DATA } from "../game/playerUnits";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import type { AutoPauseSettings } from "../hooks/localStorage";
import {
    type LightingTuningSettings,
    getPrimaryStatusLabel,
    type LootPickupModalState,
    SPEND_NIGHT_FADE_MS,
} from "./gameShared";
import { CombatLog } from "../components/CombatLog";
import { CommandBar } from "../components/CommandBar";
import { DialogModal } from "../components/DialogModal";
import { EquipmentModal } from "../components/EquipmentModal";
import { SkillTreeModal } from "../components/SkillTreeModal";
import { ItemsModal } from "../components/ItemsModal";
import { FormationIndicator } from "../components/FormationIndicator";
import { HUD } from "../components/HUD";
import { LootPickupModal } from "../components/LootPickupModal";
import { PartyBar } from "../components/PartyBar";
import { UnitPanel } from "../components/UnitPanel";
import { WaystoneTravelModal, type WaystoneDestination } from "../components/WaystoneTravelModal";
import type { ActionQueue } from "../input";
import type { DialogNode, DialogSpeaker, MenuChainAction } from "../dialog/types";

type DialogChoiceOption = React.ComponentProps<typeof DialogModal>["choices"][number];

interface GameRenderLayerProps {
    actionQueue: ActionQueue;
    autoPauseSettings: AutoPauseSettings;
    combatLog: CombatLogEntry[];
    commandMode: "attackMove" | null;
    consumableTargetingMode: { userId: number; itemId: string } | null;
    currentAreaFlavor: string;
    currentAreaId: AreaId;
    currentAreaName: string;
    currentDialogNode: DialogNode | null;
    currentDialogSpeaker: DialogSpeaker | null;
    debug: boolean;
    debugFogOfWarDisabled: boolean;
    dialogChoiceOptions: DialogChoiceOption[];
    dialogVisibleText: string;
    equipmentModalOpen: boolean;
    equipmentModalUnitId: number | null;
    fastMove: boolean;
    formationOrder: number[];
    fps: number;
    gold: number;
    hotbarAssignments: HotbarAssignments;
    hoveredChest: { x: number; y: number; chestIndex: number; chestX: number; chestZ: number } | null;
    hoveredDoor: { targetArea: string; x: number; y: number } | null;
    hoveredEnemy: { id: number; x: number; y: number } | null;
    hoveredLootBag: { x: number; y: number; gold: number; hasItems: boolean } | null;
    hoveredPlayer: { id: number; x: number; y: number } | null;
    hoveredSecretDoor: { x: number; y: number } | null;
    hoveredWaystone: { x: number; y: number } | null;
    isDialogTyping: boolean;
    lightingTuning: LightingTuningSettings;
    lightingTuningOutput: string;
    lootPickupModalState: LootPickupModalState | null;
    jukeboxOpen: boolean;
    menuOpen: boolean;
    openedChests: Set<string>;
    otherModalOpen: boolean;
    paused: boolean;
    playtestSettings: { unlockAllSkills: boolean; skipDialogs: boolean };
    queuedActions: { unitId: number; skillName: string }[];
    selBox: SelectionBox | null;
    selectedConsumableCooldownEnd: number;
    selectedIds: number[];
    showPanel: boolean;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    sleepFadeOpacity: number;
    targetingMode: { casterId: number; skill: Skill; displacementTargetId?: number } | null;
    units: Unit[];
    waystoneTravelDestinations: WaystoneDestination[] | null;
    containerRef: React.RefObject<HTMLDivElement | null>;
    canContinueWithoutChoices: boolean;
    closeDialog: () => void;
    closeWaystoneTravelModal: () => void;
    continueDialogWithoutChoices: () => void;
    handleAddXp: (amount: number) => void;
    handleAssignSkill: (unitId: number, slotIndex: number, skillName: string | null) => void;
    handleAttackMove: () => void;
    handleCancelQueuedConsumable: (itemId: string, targetUnitId: number) => void;
    handleCancelQueuedSkill: (unitId: number, skill: Skill) => void;
    handleCastSkill: (unitId: number, skill: Skill) => void;
    handleChangeEquipmentUnit: (id: number) => void;
    handleChangeSkillTreeUnit: (id: number) => void;
    handleChangeItemsUnit: (id: number) => void;
    handleCloseEquipmentModal: () => void;
    handleCloseSkillTreeModal: () => void;
    handleCloseItemsModal: () => void;
    handleClosePanel: () => void;
    handleOpenEquipmentModal: (unitId: number) => void;
    handleOpenSkillTreeModal: (unitId: number) => void;
    handleOpenItemsModal: (unitId: number) => void;
    handleDeselectAllPlayers: () => void;
    handleEquipItem: (unitId: number, itemId: string, slot: EquipmentSlot) => void;
    handleHold: () => void;
    handleIncrementStat: (id: number, stat: keyof CharacterStats) => void;
    handleLearnSkill: (id: number, skillName: string) => void;
    handleMoveEquippedItem: (unitId: number, fromSlot: EquipmentSlot, toSlot: EquipmentSlot) => void;
    handleReorderFormation: (newOrder: number[]) => void;
    handleResetLightingTuning: () => void;
    handleSelectAllPlayers: () => void;
    handleStatBoost: () => void;
    handleStop: () => void;
    handleTargetUnit: (targetUnitId: number) => void;
    handleToggleAI: (id: number) => void;
    handleToggleDebug: () => void;
    handleToggleDebugFogOfWar: () => void;
    handleToggleFastMove: () => void;
    handleToggleAutoPauseAllyKilled: () => void;
    handleToggleAutoPauseAllyNearDeath: () => void;
    handleToggleAutoPauseEnemySighted: () => void;
    handleTogglePartyAutoAttack: () => void;
    handleTogglePause: () => void;
    handleTogglePlaytestSkipDialogs: () => void;
    handleTogglePlaytestUnlockAllSkills: () => void;
    handleUnequipItem: (unitId: number, slot: EquipmentSlot) => void;
    handleUpdateLightingTuning: (patch: Partial<LightingTuningSettings>) => void;
    handleUseConsumable: (itemId: string, targetUnitId: number) => void;
    handleWarpToArea: (areaId: AreaId) => void;
    handleWaystoneTravel: (destination: WaystoneDestination) => void;
    chooseDialogOption: (choiceId: string) => void;
    onCloseJukebox: () => void;
    onCloseMenu: () => void;
    onLoadClick: (options?: { chainAction?: MenuChainAction }) => void;
    onOpenJukebox: () => void;
    onOpenMenu: () => void;
    onRestart: () => void;
    onSaveClick: (options?: { chainAction?: MenuChainAction }) => void;
    onShowControls: () => void;
    onShowGlossary: () => void;
    onShowBestiary: () => void;
    onShowHelp: () => void;
    skillTreeModalOpen: boolean;
    skillTreeModalUnitId: number | null;
    itemsModalOpen: boolean;
    itemsModalUnitId: number | null;
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
    skipDialogTyping: () => void;
    takeLootPickup: () => void;
}

function getHealthStatusColor(pct: number): string {
    if (pct >= 1) return "var(--ui-color-accent-success)";
    if (pct > 0.75) return "var(--ui-color-accent-success-bright)";
    if (pct > 0.5) return "var(--ui-color-accent-warning)";
    if (pct > 0.25) return "var(--ui-color-accent-warning)";
    return "var(--ui-color-accent-danger)";
}

function getEnemyDisplayMaxHp(unit: Unit, stats: EnemyStats): number {
    if (unit.enemyType === "giant_amoeba") {
        return getAmoebaMaxHpForSplitCount(unit.splitCount ?? 0);
    }

    return stats.maxHp;
}

export function GameRenderLayer({
    actionQueue,
    autoPauseSettings,
    canContinueWithoutChoices,
    closeDialog,
    closeWaystoneTravelModal,
    combatLog,
    chooseDialogOption,
    commandMode,
    consumableTargetingMode,
    containerRef,
    continueDialogWithoutChoices,
    currentAreaFlavor,
    currentAreaId,
    currentAreaName,
    currentDialogNode,
    currentDialogSpeaker,
    debug,
    debugFogOfWarDisabled,
    dialogChoiceOptions,
    dialogVisibleText,
    equipmentModalOpen,
    equipmentModalUnitId,
    fastMove,
    formationOrder,
    fps,
    gold,
    handleAddXp,
    handleAssignSkill,
    handleAttackMove,
    handleCancelQueuedConsumable,
    // handleCancelQueuedSkill — kept in interface, not destructured (used by skill tree modal in future)
    handleCastSkill,
    handleChangeEquipmentUnit,
    handleChangeSkillTreeUnit,
    handleChangeItemsUnit,
    handleCloseEquipmentModal,
    handleCloseSkillTreeModal,
    handleCloseItemsModal,
    handleClosePanel,
    handleOpenEquipmentModal,
    handleOpenSkillTreeModal,
    handleOpenItemsModal,
    handleDeselectAllPlayers,
    handleEquipItem,
    handleHold,
    handleIncrementStat,
    handleLearnSkill,
    handleMoveEquippedItem,
    handleReorderFormation,
    handleResetLightingTuning,
    handleSelectAllPlayers,
    handleStatBoost,
    handleStop,
    handleTargetUnit,
    handleToggleAI,
    handleToggleDebug,
    handleToggleDebugFogOfWar,
    handleToggleFastMove,
    handleToggleAutoPauseAllyKilled,
    handleToggleAutoPauseAllyNearDeath,
    handleToggleAutoPauseEnemySighted,
    handleTogglePartyAutoAttack,
    handleTogglePause,
    handleTogglePlaytestSkipDialogs,
    handleTogglePlaytestUnlockAllSkills,
    handleUnequipItem,
    handleUpdateLightingTuning,
    handleUseConsumable,
    handleWarpToArea,
    handleWaystoneTravel,
    hotbarAssignments,
    jukeboxOpen,
    hoveredChest,
    hoveredDoor,
    hoveredEnemy,
    hoveredLootBag,
    hoveredPlayer,
    hoveredSecretDoor,
    hoveredWaystone,
    isDialogTyping,
    lightingTuning,
    lightingTuningOutput,
    lootPickupModalState,
    menuOpen,
    onCloseJukebox,
    onCloseMenu,
    onLoadClick,
    onOpenJukebox,
    onOpenMenu,
    onRestart,
    onSaveClick,
    onShowControls,
    onShowGlossary,
    onShowBestiary,
    onShowHelp,
    openedChests,
    otherModalOpen,
    paused,
    playtestSettings,
    queuedActions,
    selBox,
    selectedConsumableCooldownEnd,
    selectedIds,
    skillTreeModalOpen,
    skillTreeModalUnitId,
    itemsModalOpen,
    itemsModalUnitId,
    setSelectedIds,
    showPanel,
    skillCooldowns,
    skipDialogTyping,
    sleepFadeOpacity,
    takeLootPickup,
    targetingMode,
    units,
    waystoneTravelDestinations,
}: GameRenderLayerProps) {
    const playerUnits = React.useMemo(
        () => units.filter(unit => unit.team === "player"),
        [units]
    );
    const unitsById = React.useMemo(() => {
        const byId = new Map<number, Unit>();
        for (const unit of units) {
            byId.set(unit.id, unit);
        }
        return byId;
    }, [units]);
    const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
    const alivePlayers = React.useMemo(
        () => playerUnits.reduce((count, unit) => count + (isCorePlayerId(unit.id) && unit.hp > 0 ? 1 : 0), 0),
        [playerUnits]
    );
    const holdActive = React.useMemo(
        () => units.some(unit => selectedIdSet.has(unit.id) && unit.holdPosition),
        [selectedIdSet, units]
    );
    const partyAutoAttackActive = React.useMemo(
        () => playerUnits.length > 0 && playerUnits.every(unit => unit.aiEnabled),
        [playerUnits]
    );
    const hoveredEnemyUnit = React.useMemo(
        () => (hoveredEnemy ? unitsById.get(hoveredEnemy.id) : undefined),
        [hoveredEnemy, unitsById]
    );
    const hoveredPlayerUnit = React.useMemo(
        () => (hoveredPlayer ? unitsById.get(hoveredPlayer.id) : undefined),
        [hoveredPlayer, unitsById]
    );
    const selectedQueuedActionEntry = selectedIds.length === 1
        ? queuedActions.find(entry => entry.unitId === selectedIds[0])
        : undefined;
    const selectedPanelQueuedAction = selectedQueuedActionEntry
        ? actionQueue[selectedIds[0]]
        : undefined;
    const selectedHotbarQueuedAction = selectedIds.length === 1
        ? actionQueue[selectedIds[0]]
        : undefined;
    const queuedPanelAction = selectedPanelQueuedAction?.type === "skill"
        ? { type: "skill" as const, skillName: selectedPanelQueuedAction.skill.name }
        : selectedPanelQueuedAction?.type === "consumable"
            ? { type: "consumable" as const, itemId: selectedPanelQueuedAction.itemId }
            : null;
    const selectedHotbarQueuedSkillName = selectedHotbarQueuedAction?.type === "skill"
        ? selectedHotbarQueuedAction.skill.name
        : null;

    return (
        <div
            className={(equipmentModalOpen || skillTreeModalOpen || itemsModalOpen) ? "equip-modal-active" : undefined}
            style={{
                width: "100%",
                height: "100vh",
                position: "relative",
                cursor: (targetingMode || consumableTargetingMode || commandMode === "attackMove")
                    ? "crosshair"
                    : "default",
            }}
        >
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: "100%",
                    filter: paused ? "saturate(0.4) brightness(0.85)" : "none",
                    transition: "filter 0.2s",
                }}
            />
            {selBox && (
                <div
                    style={{
                        position: "absolute",
                        left: selBox.left,
                        top: selBox.top,
                        width: selBox.width,
                        height: selBox.height,
                        border: "1px solid var(--ui-color-selection-border)",
                        backgroundColor: "var(--ui-color-selection-fill)",
                        pointerEvents: "none",
                    }}
                />
            )}
            {hoveredEnemy && (() => {
                const enemy = hoveredEnemyUnit;
                if (!enemy?.enemyType || enemy.hp <= 0) return null;
                const stats = getEnemyUnitStats(enemy);
                const maxHp = getEnemyDisplayMaxHp(enemy, stats);
                const monsterTypeLabel = getMonsterTypeLabel(stats.monsterType);
                const primaryStatusLabel = getPrimaryStatusLabel(enemy.statusEffects);
                const pct = enemy.hp / maxHp;
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = getHealthStatusColor(pct);
                return (
                    <div className="enemy-tooltip enemy-tooltip--enemy" style={{ left: hoveredEnemy.x + 12, top: hoveredEnemy.y - 10 }}>
                        <div className="enemy-tooltip-name enemy-tooltip-name--enemy">{stats.name}</div>
                        <div className="enemy-tooltip-type">{monsterTypeLabel}</div>
                        <div className="enemy-tooltip-status enemy-tooltip-status-line">
                            {primaryStatusLabel && (
                                <>
                                    <span className="enemy-tooltip-effect">{primaryStatusLabel}</span>
                                    <span className="enemy-tooltip-separator">&middot;</span>
                                </>
                            )}
                            <span style={{ color: statusColor }}>{status}</span>
                        </div>
                        {debug && (
                            <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-text-dim)" }}>
                                {enemy.hp}/{maxHp} HP
                            </div>
                        )}
                    </div>
                );
            })()}
            {hoveredChest && (
                <div className="enemy-tooltip" style={{ left: hoveredChest.x + 12, top: hoveredChest.y - 10 }}>
                    <div className="enemy-tooltip-name">
                        {openedChests.has(`${currentAreaId}-${hoveredChest.chestIndex}`) ? "Empty Chest" : "Chest"}
                    </div>
                </div>
            )}
            {hoveredPlayer && (() => {
                const player = hoveredPlayerUnit;
                if (!player || player.hp <= 0) return null;
                const data = UNIT_DATA[player.id];
                if (!data) return null;
                const pct = player.hp / getEffectiveMaxHp(player.id, player);
                const status = pct >= 1 ? "Unharmed" : pct > 0.75 ? "Scuffed" : pct > 0.5 ? "Injured" : pct > 0.25 ? "Badly wounded" : "Near death";
                const statusColor = getHealthStatusColor(pct);
                return (
                    <div className="enemy-tooltip" style={{ left: hoveredPlayer.x + 12, top: hoveredPlayer.y - 10 }}>
                        <div className="enemy-tooltip-name">{data.name}</div>
                        <div className="enemy-tooltip-status" style={{ color: statusColor }}>{status}</div>
                    </div>
                );
            })()}
            {hoveredDoor && (
                <div className="enemy-tooltip" style={{ left: hoveredDoor.x + 12, top: hoveredDoor.y - 10 }}>
                    <div className="enemy-tooltip-name">Travel</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-primary-bright)" }}>
                        {AREAS[hoveredDoor.targetArea as AreaId]?.name ?? hoveredDoor.targetArea}
                    </div>
                </div>
            )}
            {hoveredWaystone && (
                <div className="enemy-tooltip" style={{ left: hoveredWaystone.x + 12, top: hoveredWaystone.y - 10 }}>
                    <div className="enemy-tooltip-name">Waystone</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-primary-bright)" }}>
                        Fast travel
                    </div>
                </div>
            )}
            {hoveredSecretDoor && (
                <div className="enemy-tooltip" style={{ left: hoveredSecretDoor.x + 12, top: hoveredSecretDoor.y - 10 }}>
                    <div className="enemy-tooltip-name">Cracked wall</div>
                </div>
            )}
            {hoveredLootBag && (
                <div className="enemy-tooltip" style={{ left: hoveredLootBag.x + 12, top: hoveredLootBag.y - 10 }}>
                    <div className="enemy-tooltip-name">Looted Corpse</div>
                    <div className="enemy-tooltip-status" style={{ color: "var(--ui-color-accent-gold)" }}>
                        {hoveredLootBag.gold > 0
                            ? `${hoveredLootBag.gold} Gold`
                            : hoveredLootBag.hasItems
                                ? "Contains items"
                                : "Empty"}
                    </div>
                </div>
            )}
            {currentDialogNode && currentDialogSpeaker && (
                <DialogModal
                    speakerName={currentDialogSpeaker.name}
                    portraitSrc={currentDialogSpeaker.portraitSrc}
                    portraitTint={currentDialogSpeaker.portraitTint}
                    visibleText={dialogVisibleText}
                    isTyping={isDialogTyping}
                    choices={dialogChoiceOptions}
                    canContinueWithoutChoices={canContinueWithoutChoices}
                    continueLabel={currentDialogNode.continueLabel ?? "Continue"}
                    onSkipTyping={skipDialogTyping}
                    onSkipDialog={closeDialog}
                    onContinueWithoutChoices={continueDialogWithoutChoices}
                    onChoose={chooseDialogOption}
                />
            )}
            {lootPickupModalState && (
                <LootPickupModal
                    sourceLabel={lootPickupModalState.sourceLabel}
                    entries={lootPickupModalState.entries}
                    onTake={takeLootPickup}
                />
            )}
            {waystoneTravelDestinations && (
                <WaystoneTravelModal
                    currentAreaName={currentAreaName}
                    destinations={waystoneTravelDestinations}
                    onTravel={handleWaystoneTravel}
                    onClose={closeWaystoneTravelModal}
                />
            )}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "var(--ui-color-overlay-strong)",
                    opacity: sleepFadeOpacity,
                    pointerEvents: sleepFadeOpacity > 0 ? "all" : "none",
                    transition: `opacity ${SPEND_NIGHT_FADE_MS}ms ease-in-out`,
                    zIndex: 9500,
                }}
            />
            <div style={{ position: "absolute", top: 10, right: 10, color: "var(--ui-color-text-dim)", fontSize: 11, opacity: 0.6 }}>
                {fps} fps
            </div>
            <HUD
                areaName={currentAreaName}
                areaFlavor={currentAreaFlavor}
                alivePlayers={alivePlayers}
                paused={paused}
                onTogglePause={handleTogglePause}
                onShowControls={onShowControls}
                onShowHelp={onShowHelp}
                onShowGlossary={onShowGlossary}
                onShowBestiary={onShowBestiary}
                onRestart={onRestart}
                onSaveClick={onSaveClick}
                onLoadClick={onLoadClick}
                debug={debug}
                onToggleDebug={handleToggleDebug}
                onWarpToArea={handleWarpToArea}
                onAddXp={handleAddXp}
                onStatBoost={handleStatBoost}
                autoPauseSettings={autoPauseSettings}
                onTogglePlaytestUnlockAllSkills={handleTogglePlaytestUnlockAllSkills}
                playtestUnlockAllSkillsEnabled={playtestSettings.unlockAllSkills}
                onTogglePlaytestSkipDialogs={handleTogglePlaytestSkipDialogs}
                playtestSkipDialogsEnabled={playtestSettings.skipDialogs}
                onToggleFastMove={handleToggleFastMove}
                fastMoveEnabled={fastMove}
                onToggleDebugFogOfWar={handleToggleDebugFogOfWar}
                debugFogOfWarDisabled={debugFogOfWarDisabled}
                onToggleAutoPauseEnemySighted={handleToggleAutoPauseEnemySighted}
                onToggleAutoPauseAllyNearDeath={handleToggleAutoPauseAllyNearDeath}
                onToggleAutoPauseAllyKilled={handleToggleAutoPauseAllyKilled}
                lightingTuning={lightingTuning}
                onUpdateLightingTuning={handleUpdateLightingTuning}
                onResetLightingTuning={handleResetLightingTuning}
                lightingTuningOutput={lightingTuningOutput}
                menuOpen={menuOpen}
                jukeboxOpen={jukeboxOpen}
                onOpenMenu={onOpenMenu}
                onCloseMenu={onCloseMenu}
                onOpenJukebox={onOpenJukebox}
                onCloseJukebox={onCloseJukebox}
                otherModalOpen={otherModalOpen}
                hasSelection={selectedIds.length > 0}
            />
            <CombatLog log={combatLog} />
            <FormationIndicator units={playerUnits} formationOrder={formationOrder} onReorderFormation={handleReorderFormation} />
            <div className="bottom-bar-container">
                <CommandBar
                    commandMode={commandMode}
                    onStop={handleStop}
                    onHold={handleHold}
                    onAttackMove={handleAttackMove}
                    onSelectAll={handleSelectAllPlayers}
                    onDeselectAll={handleDeselectAllPlayers}
                    onToggleAutoAttack={handleTogglePartyAutoAttack}
                    hasSelection={selectedIds.length > 0}
                    holdActive={holdActive}
                    partyAutoAttackActive={partyAutoAttackActive}
                />
                <PartyBar
                    units={playerUnits}
                    selectedIds={selectedIds}
                    onSelect={setSelectedIds}
                    targetingMode={targetingMode}
                    consumableTargetingMode={consumableTargetingMode}
                    onTargetUnit={handleTargetUnit}
                    hotbarAssignments={hotbarAssignments}
                    onAssignSkill={handleAssignSkill}
                    onCastSkill={handleCastSkill}
                    skillCooldowns={skillCooldowns}
                    queuedSkillName={selectedHotbarQueuedSkillName}
                    paused={paused}
                    formationOrder={formationOrder}
                    onReorderFormation={handleReorderFormation}
                    hideHotbar={equipmentModalOpen || itemsModalOpen}
                    tooltipsDisabled={equipmentModalOpen || skillTreeModalOpen || itemsModalOpen || menuOpen || otherModalOpen}
                />
            </div>
            {showPanel && selectedIds.length === 1 && (
                <UnitPanel
                    unitId={selectedIds[0]}
                    units={playerUnits}
                    onClose={handleClosePanel}
                    onToggleAI={handleToggleAI}
                    paused={paused}
                    onOpenEquipment={handleOpenEquipmentModal}
                    onOpenSkillTree={handleOpenSkillTreeModal}
                    onOpenItems={handleOpenItemsModal}
                    equipmentModalOpen={equipmentModalOpen}
                    skillTreeModalOpen={skillTreeModalOpen}
                    itemsModalOpen={itemsModalOpen}
                    onIncrementStat={handleIncrementStat}
                />
            )}
            {equipmentModalUnitId !== null && (
                <EquipmentModal
                    key={equipmentModalUnitId}
                    unitId={equipmentModalUnitId}
                    onClose={handleCloseEquipmentModal}
                    onEquipItem={handleEquipItem}
                    onUnequipItem={handleUnequipItem}
                    onMoveEquippedItem={handleMoveEquippedItem}
                    onChangeUnit={handleChangeEquipmentUnit}
                    formationOrder={formationOrder}
                />
            )}
            {skillTreeModalUnitId !== null && (
                <SkillTreeModal
                    key={skillTreeModalUnitId}
                    unitId={skillTreeModalUnitId}
                    units={playerUnits}
                    onClose={handleCloseSkillTreeModal}
                    onChangeUnit={handleChangeSkillTreeUnit}
                    onLearnSkill={handleLearnSkill}
                    formationOrder={formationOrder}
                />
            )}
            {itemsModalUnitId !== null && (
                <ItemsModal
                    key={itemsModalUnitId}
                    unitId={itemsModalUnitId}
                    units={playerUnits}
                    onClose={handleCloseItemsModal}
                    onChangeUnit={handleChangeItemsUnit}
                    onUseConsumable={handleUseConsumable}
                    onCancelQueuedConsumable={handleCancelQueuedConsumable}
                    consumableCooldownEnd={selectedConsumableCooldownEnd}
                    queuedAction={queuedPanelAction}
                    gold={gold}
                    paused={paused}
                    formationOrder={formationOrder}
                />
            )}
        </div>
    );
}
