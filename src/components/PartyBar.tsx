import { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill, StatusEffectType } from "../core/types";
import {
    COLORS,
    ANCESTOR_AURA_DAMAGE_BONUS,
    ANCESTOR_AURA_RANGE,
    VISHAS_EYES_ORB_HEAL_RADIUS
} from "../core/constants";
import { UNIT_DATA, getEffectiveMaxHp, getEffectiveMaxMana, isCorePlayerId } from "../game/playerUnits";
import { getPlayerUnitColor } from "../game/unitColors";
import { getHpPercentage, getHpColor } from "../combat/combatMath";
import { SkillHotbar } from "./SkillHotbar";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import { getPortrait } from "./portraitRegistry";

/** Drag type for portrait reordering — distinct from skill drags */
const PORTRAIT_DRAG_TYPE = "application/x-portrait";

const EFFECT_ICONS: Record<StatusEffectType, { icon: string; color: string }> = {
    burn: { icon: "F", color: COLORS.burnText },
    poison: { icon: "☠", color: COLORS.poisonText },
    shielded: { icon: "🛡", color: COLORS.shieldedText },
    stunned: { icon: "💫", color: COLORS.stunnedText },
    cleansed: { icon: "✨", color: COLORS.cleansedText },
    defiance: { icon: "⚔", color: COLORS.defianceText },
    pinned: { icon: "📌", color: COLORS.pinnedText },
    slowed: { icon: "🐌", color: COLORS.slowedText },
    energy_shield: { icon: "🔮", color: COLORS.energyShieldText },
    qi_drain: { icon: "💔", color: COLORS.qiDrainText },
    doom: { icon: "💀", color: COLORS.doomText },
    regen: { icon: "💚", color: COLORS.regenText },
    invul: { icon: "🔰", color: COLORS.invulText },
    silenced: { icon: "🔇", color: COLORS.silencedText },
    chilled: { icon: "❄", color: COLORS.chilledText },
    sleep: { icon: "💤", color: COLORS.sleepText },
    sun_stance: { icon: "☀", color: COLORS.sunStanceText },
    thorns: { icon: "✹", color: COLORS.thornsText },
    highland_defense: { icon: "⛰", color: COLORS.highlandDefenseText },
    divine_lattice: { icon: "◈", color: COLORS.divineLatticeText },
    constricted: { icon: "⬇", color: COLORS.constrictedText },
    hamstrung: { icon: "🦵", color: COLORS.hamstrungText },
    blind: { icon: "👁", color: COLORS.blindText },
    vanquishing_light: { icon: "⊕", color: COLORS.holyGroundText },
    enraged: { icon: "💢", color: COLORS.enragedText },
    feared: { icon: "😱", color: COLORS.fearedText },
    blood_marked: { icon: "🩸", color: COLORS.bloodMarkedText },
};

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
    targetingMode?: { casterId: number; skill: Skill; displacementTargetId?: number } | null;
    consumableTargetingMode?: { userId: number; itemId: string } | null;
    onTargetUnit?: (targetUnitId: number) => void;
    // Hotbar props
    hotbarAssignments?: HotbarAssignments;
    onAssignSkill?: (unitId: number, slotIndex: number, skillName: string | null) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
    // Formation reorder
    formationOrder?: number[];
    onReorderFormation?: (newOrder: number[]) => void;
    hideHotbar?: boolean;
}

function PartyBarComponent({
    units,
    selectedIds,
    onSelect,
    targetingMode,
    consumableTargetingMode,
    onTargetUnit,
    hotbarAssignments = {},
    onAssignSkill,
    onCastSkill,
    skillCooldowns = {},
    paused = false,
    formationOrder = [],
    onReorderFormation,
    hideHotbar = false,
}: PartyBarProps) {
    const playerUnits = useMemo(() => units.filter((u: Unit) => u.team === "player"), [units]);
    const corePlayerUnits = useMemo(() => playerUnits.filter(u => isCorePlayerId(u.id)), [playerUnits]);
    const summonUnits = useMemo(() => playerUnits.filter(u => !isCorePlayerId(u.id) && !!u.summonType), [playerUnits]);
    const effectiveOrder = useMemo(() => {
        const playerIds = corePlayerUnits.map(u => u.id);
        return buildEffectiveFormationOrder(playerIds, formationOrder);
    }, [corePlayerUnits, formationOrder]);
    const effectiveOrderIndex = useMemo(() => {
        const indexById = new Map<number, number>();
        for (let i = 0; i < effectiveOrder.length; i++) {
            indexById.set(effectiveOrder[i], i);
        }
        return indexById;
    }, [effectiveOrder]);
    const effectiveOrderRef = useRef(effectiveOrder);
    useEffect(() => {
        effectiveOrderRef.current = effectiveOrder;
    }, [effectiveOrder]);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ unitId: number; x: number; y: number } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    // Drag state — insertIdx is the gap index (0 = before first, N = after last)
    const dragIdRef = useRef<number | null>(null);
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [insertIdx, setInsertIdx] = useState<number | null>(null);
    const barRef = useRef<HTMLDivElement>(null);

    // Close context menu on click-away or Escape
    useEffect(() => {
        if (!contextMenu) return;
        const onClickAway = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
        window.addEventListener("mousedown", onClickAway);
        window.addEventListener("keydown", onEsc);
        return () => { window.removeEventListener("mousedown", onClickAway); window.removeEventListener("keydown", onEsc); };
    }, [contextMenu]);

    const swapFormation = useCallback((unitId: number, direction: -1 | 1) => {
        const order = effectiveOrderRef.current;
        const idx = order.indexOf(unitId);
        const targetIdx = idx + direction;
        if (idx === -1 || targetIdx < 0 || targetIdx >= order.length) return;
        const newOrder = [...order];
        [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
        onReorderFormation?.(newOrder);
        setContextMenu(null);
    }, [onReorderFormation]);

    /** Compute the insert gap from a clientX anywhere in the bar */
    const computeInsertIdxFromX = useCallback((fromId: number, clientX: number) => {
        if (!barRef.current) return null;
        const portraits = barRef.current.querySelectorAll<HTMLElement>(".party-portrait");
        // Find which gap the cursor is closest to
        let gap = portraits.length; // default: after last
        for (let i = 0; i < portraits.length; i++) {
            const rect = portraits[i].getBoundingClientRect();
            const mid = rect.left + rect.width / 2;
            if (clientX < mid) { gap = i; break; }
        }
        // No-op check: dropping here wouldn't move the unit
        const fromIdx = effectiveOrderRef.current.indexOf(fromId);
        if (fromIdx === -1) return null;
        if (gap === fromIdx || gap === fromIdx + 1) return null;
        return gap;
    }, []);

    /** Execute the drop at the current insertIdx */
    const executeDrop = useCallback(() => {
        const fromId = dragIdRef.current;
        const gap = insertIdx;
        dragIdRef.current = null;
        setDraggingId(null);
        setInsertIdx(null);
        if (fromId === null || gap === null) return;
        const order = effectiveOrderRef.current;
        const fromIdx = order.indexOf(fromId);
        if (fromIdx === -1) return;
        const newOrder = order.filter(id => id !== fromId);
        // Adjust gap for the removal
        const adjustedGap = gap > fromIdx ? gap - 1 : gap;
        newOrder.splice(adjustedGap, 0, fromId);
        onReorderFormation?.(newOrder);
    }, [insertIdx, onReorderFormation]);

    const handlePortraitClick = useCallback((e: React.MouseEvent, unit: Unit) => {
        e.stopPropagation();

        const isTargetingAlly = targetingMode?.skill.targetType === "ally";
        const isTargetingUnit = targetingMode?.skill.targetType === "unit";
        const isReviveSkill = targetingMode?.skill.type === "revive";
        const isTargetingDeadAlly = consumableTargetingMode !== null && consumableTargetingMode !== undefined;

        if (isTargetingDeadAlly && unit.hp <= 0 && onTargetUnit) {
            onTargetUnit(unit.id);
            return;
        }
        if (targetingMode && (isTargetingAlly || isTargetingUnit) && isReviveSkill && unit.hp <= 0 && onTargetUnit) {
            onTargetUnit(unit.id);
            return;
        }
        if (unit.hp <= 0) return;
        if (targetingMode && (isTargetingAlly || isTargetingUnit) && onTargetUnit) {
            onTargetUnit(unit.id);
            return;
        }
        onSelect(e.shiftKey
            ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id]
            : [unit.id]
        );
    }, [consumableTargetingMode, onSelect, onTargetUnit, targetingMode]);

    // Sort playerUnits by effective formation order for rendering.
    const sortedUnits = useMemo(() => {
        const ordered = [...corePlayerUnits];
        ordered.sort((a, b) => {
            const aIndex = effectiveOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const bIndex = effectiveOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return aIndex - bIndex;
        });
        return ordered;
    }, [corePlayerUnits, effectiveOrderIndex]);

    // Dragged unit color for the spacer bar
    const dragColor = draggingId !== null ? getPlayerUnitColor(draggingId) : "var(--ui-color-text-dim)";

    // Spacer element — a real flex child that receives drag events
    const spacer = (
        <div
            key="drop-spacer"
            className="drop-spacer"
            style={{ "--drop-color": dragColor } as React.CSSProperties}
            onDragOver={(e) => { if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => { if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return; e.preventDefault(); executeDrop(); }}
        />
    );

    // Targeting state (computed once, shared by portraits + summon chips)
    const isTargetingAlly = targetingMode?.skill.targetType === "ally";
    const isTargetingUnit = targetingMode?.skill.targetType === "unit";
    const isReviveSkill = targetingMode?.skill.type === "revive";
    const isTargetingDeadAlly = consumableTargetingMode !== null && consumableTargetingMode !== undefined;
    const isAnyTargeting = !!(isTargetingAlly || isTargetingUnit || isTargetingDeadAlly);
    const getIsValidTarget = (unit: Unit) =>
        (targetingMode && (isTargetingAlly || isTargetingUnit) && (isReviveSkill ? unit.hp <= 0 : unit.hp > 0)) ||
        (isTargetingDeadAlly && unit.hp <= 0 && unit.team === "player");

    // Build elements array with spacer inserted at the active gap
    const elements: React.ReactNode[] = [];
    sortedUnits.forEach((unit: Unit, renderIndex: number) => {
        // Insert spacer before this portrait if needed
        if (insertIdx === renderIndex) elements.push(spacer);

        const data = UNIT_DATA[unit.id];
        if (!data) return;
        const isSelected = selectedIds.includes(unit.id);
        const effectiveMaxHp = getEffectiveMaxHp(unit.id, unit);
        const hpPct = getHpPercentage(unit.hp, effectiveMaxHp);
        const hpColor = getHpColor(hpPct);
        const effectiveMaxMana = getEffectiveMaxMana(unit.id, unit);
        const hasMana = effectiveMaxMana > 0;
        const manaPct = hasMana ? getHpPercentage(unit.mana ?? 0, effectiveMaxMana) : 0;

        const isValidTarget = getIsValidTarget(unit);

        const handleContextMenu = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ unitId: unit.id, x: e.clientX, y: e.clientY });
        };

        const orderIdx = effectiveOrderIndex.get(unit.id) ?? -1;
        const isDragSource = draggingId === unit.id;

        const portraitClass = [
            "party-portrait",
            isSelected ? "selected" : "",
            isValidTarget ? "valid-target" : "",
            unit.hp <= 0 ? "dead" : "",
            isAnyTargeting ? "targeting" : "",
            isDragSource ? "dragging" : ""
        ].filter(Boolean).join(" ");

        const hasUnspentPoints = (unit.statPoints ?? 0) > 0 || (unit.skillPoints ?? 0) > 0;
        const unspentHint = hasUnspentPoints
            ? [
                (unit.statPoints ?? 0) > 0 ? `${unit.statPoints} stat point${unit.statPoints! > 1 ? "s" : ""}` : "",
                (unit.skillPoints ?? 0) > 0 ? `${unit.skillPoints} skill point${unit.skillPoints! > 1 ? "s" : ""}` : ""
            ].filter(Boolean).join(", ") + " to spend"
            : "";
        const showHotbar = isSelected && selectedIds.length === 1 && onAssignSkill && !hideHotbar;

        const portraitDiv = (
            <div
                key={unit.id}
                className={portraitClass}
                onClick={(e) => handlePortraitClick(e, unit)}
                onContextMenu={handleContextMenu}
                draggable={unit.hp > 0}
                onDragStart={(e) => {
                    if (e.target !== e.currentTarget) return;
                    dragIdRef.current = unit.id;
                    setDraggingId(unit.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(PORTRAIT_DRAG_TYPE, String(unit.id));
                }}
                onDragEnd={() => {
                    dragIdRef.current = null;
                    setDraggingId(null);
                    setInsertIdx(null);
                }}
                onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragIdRef.current !== null && dragIdRef.current !== unit.id) {
                        setInsertIdx(computeInsertIdxFromX(dragIdRef.current, e.clientX));
                    }
                }}
                onDrop={(e) => {
                    if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return;
                    e.preventDefault();
                    executeDrop();
                }}
            >
                {/* Show hotbar above selected unit */}
                {showHotbar && (
                    <div className="party-bar-hotbar">
                        <SkillHotbar
                            unit={unit}
                            hotbarAssignments={hotbarAssignments}
                            onAssignSkill={onAssignSkill}
                            onCastSkill={onCastSkill}
                            skillCooldowns={skillCooldowns}
                            paused={paused}
                        />
                    </div>
                )}
                <div className={`portrait-icon${unit.holdPosition ? " hold-active" : ""}`} style={{ background: `${getPlayerUnitColor(unit.id)} url(${getPortrait(data.class)}) center / cover` }}>
                    <span className="portrait-fkey">F{renderIndex + 1}</span>
                    {hasUnspentPoints && <span className="levelup-badge">+</span>}
                    {unit.statusEffects && unit.statusEffects.length > 0 && (
                        <div className="portrait-effects">
                            {unit.statusEffects.map((e, i) => {
                                const info = EFFECT_ICONS[e.type];
                                return (
                                    <span key={i} className="portrait-effect-icon" style={{ color: info.color }}>
                                        {info.icon}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="progress-bar-sm portrait-hp">
                    <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, backgroundColor: hpColor }} />
                </div>
                {hasMana && (
                    <div className="progress-bar-sm portrait-mana">
                        <div className="progress-fill progress-fill-mana" style={{ width: `${Math.max(0, manaPct)}%` }} />
                    </div>
                )}
                <div className="portrait-name">{data.name}</div>

                {/* Context menu */}
                {contextMenu && contextMenu.unitId === unit.id && (
                    <div
                        ref={contextMenuRef}
                        className="formation-context-menu glass-panel"
                        style={{ left: 0, bottom: "100%" }}
                    >
                        <button
                            className="formation-ctx-btn"
                            disabled={orderIdx <= 0}
                            onClick={(e) => { e.stopPropagation(); swapFormation(unit.id, -1); }}
                        >
                            Move Left
                        </button>
                        <button
                            className="formation-ctx-btn"
                            disabled={orderIdx >= effectiveOrder.length - 1}
                            onClick={(e) => { e.stopPropagation(); swapFormation(unit.id, 1); }}
                        >
                            Move Right
                        </button>
                    </div>
                )}
            </div>
        );

        elements.push(
            hasUnspentPoints
                ? <Tippy key={unit.id} content={unspentHint} placement="top" delay={[300, 0]}>{portraitDiv}</Tippy>
                : portraitDiv
        );
    });

    // Spacer after last portrait
    if (insertIdx === sortedUnits.length) elements.push(spacer);

    return (
        <div className="party-bar-stack">
            <div
                ref={barRef}
                className="party-bar glass-panel"
                onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragIdRef.current !== null) {
                        setInsertIdx(computeInsertIdxFromX(dragIdRef.current, e.clientX));
                    }
                }}
                onDrop={(e) => { if (!e.dataTransfer.types.includes(PORTRAIT_DRAG_TYPE)) return; e.preventDefault(); executeDrop(); }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsertIdx(null);
                }}
            >
                {elements}
            </div>
            {summonUnits.length > 0 && (
                <div className="party-bar-summons glass-panel">
                    {summonUnits.map(unit => {
                        const data = UNIT_DATA[unit.id];
                        if (!data) return null;
                        const summonInfo = unit.summonType === "vishas_eye_orb"
                            ? {
                                letter: "V",
                                detail: `Burst: +HP nearby (${VISHAS_EYES_ORB_HEAL_RADIUS.toFixed(1)} range)`
                            }
                            : {
                                letter: "A",
                                detail: `Aura: +${ANCESTOR_AURA_DAMAGE_BONUS} dmg (${ANCESTOR_AURA_RANGE.toFixed(1)} range)`
                            };

                        const isSelected = selectedIds.includes(unit.id);
                        const effectiveMaxHp = getEffectiveMaxHp(unit.id, unit);
                        const hpPct = getHpPercentage(unit.hp, effectiveMaxHp);
                        const hpColor = getHpColor(hpPct);

                        const isValidTarget = getIsValidTarget(unit);

                        const chipClass = [
                            "summon-chip",
                            isSelected ? "selected" : "",
                            isValidTarget ? "valid-target" : "",
                            unit.hp <= 0 ? "dead" : "",
                            isAnyTargeting ? "targeting" : ""
                        ].filter(Boolean).join(" ");

                        return (
                            <Tippy
                                key={unit.id}
                                content={
                                    <div className="summon-chip-tooltip">
                                        <div className="summon-chip-tooltip-name">{data.name}</div>
                                        <div className="summon-chip-tooltip-row">HP: {Math.max(0, unit.hp)} / {effectiveMaxHp}</div>
                                        <div className="summon-chip-tooltip-row">{summonInfo.detail}</div>
                                    </div>
                                }
                                placement="top"
                                delay={[120, 0]}
                            >
                                <button
                                    className={chipClass}
                                    onClick={(e) => handlePortraitClick(e, unit)}
                                    type="button"
                                >
                                    <span className="summon-chip-letter">{summonInfo.letter}</span>
                                    <span className="summon-chip-hp">
                                        <span className="summon-chip-hp-fill" style={{ width: `${Math.max(0, hpPct)}%`, backgroundColor: hpColor }} />
                                    </span>
                                </button>
                            </Tippy>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function areNumberArraysEqual(a: number[], b: number[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function areUnitRefsEqual(a: Unit[], b: Unit[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function arePartyBarPropsEqual(prev: PartyBarProps, next: PartyBarProps): boolean {
    return areUnitRefsEqual(prev.units, next.units)
        && areNumberArraysEqual(prev.selectedIds, next.selectedIds)
        && prev.onSelect === next.onSelect
        && prev.targetingMode === next.targetingMode
        && prev.consumableTargetingMode === next.consumableTargetingMode
        && prev.onTargetUnit === next.onTargetUnit
        && prev.hotbarAssignments === next.hotbarAssignments
        && prev.onAssignSkill === next.onAssignSkill
        && prev.onCastSkill === next.onCastSkill
        && prev.skillCooldowns === next.skillCooldowns
        && prev.paused === next.paused
        && areNumberArraysEqual(prev.formationOrder ?? [], next.formationOrder ?? [])
        && prev.onReorderFormation === next.onReorderFormation
        && prev.hideHotbar === next.hideHotbar;
}

export const PartyBar = memo(PartyBarComponent, arePartyBarPropsEqual);
