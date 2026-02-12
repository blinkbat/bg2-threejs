import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Unit, Skill, StatusEffectType } from "../core/types";
import { COLORS } from "../core/constants";
import { UNIT_DATA, getEffectiveMaxHp } from "../game/playerUnits";
import { getHpPercentage, getHpColor } from "../combat/combatMath";
import { SkillHotbar } from "./SkillHotbar";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import { buildEffectiveFormationOrder } from "../game/formationOrder";
import monkPortrait from "../assets/monk-portrait.png";
import barbarianPortrait from "../assets/barbarian-portrait.png";
import wizardPortrait from "../assets/wizard-portrait.png";
import paladinPortrait from "../assets/paladin-portrait.png";
import thiefPortrait from "../assets/thief-portrait.png";
import clericPortrait from "../assets/cleric-portrait.png";

const CLASS_PORTRAITS: Record<string, string> = {
    Barbarian: barbarianPortrait,
    Wizard: wizardPortrait,
    Paladin: paladinPortrait,
    Thief: thiefPortrait,
    Cleric: clericPortrait,
    Monk: monkPortrait,
};
const getPortrait = (className: string) => CLASS_PORTRAITS[className] ?? monkPortrait;

const EFFECT_ICONS: Record<StatusEffectType, { icon: string; color: string }> = {
    poison: { icon: "☠", color: COLORS.poisonText },
    shielded: { icon: "🛡", color: COLORS.shieldedText },
    stunned: { icon: "💫", color: COLORS.stunnedText },
    cleansed: { icon: "✨", color: COLORS.cleansedText },
    defiance: { icon: "⚔", color: COLORS.defianceText },
    pinned: { icon: "📌", color: "#c0392b" },
    slowed: { icon: "🐌", color: "#3498db" },
    energyShield: { icon: "🔮", color: "#9b59b6" },
    qi_drain: { icon: "💔", color: "#e74c3c" },
    doom: { icon: "💀", color: COLORS.doomText },
    regen: { icon: "💚", color: COLORS.hpHigh },
    invul: { icon: "✦", color: "#8e44ad" },
    chilled: { icon: "❄", color: COLORS.chilledText },
    sleep: { icon: "💤", color: COLORS.sleepText },
    sun_stance: { icon: "☀", color: COLORS.sunStanceText },
};

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
    targetingMode?: { casterId: number; skill: Skill } | null;
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
}

export function PartyBar({
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
    onReorderFormation
}: PartyBarProps) {
    const playerUnits = useMemo(() => units.filter((u: Unit) => u.team === "player"), [units]);
    const effectiveOrder = useMemo(() => {
        const playerIds = playerUnits.map(u => u.id);
        return buildEffectiveFormationOrder(playerIds, formationOrder);
    }, [playerUnits, formationOrder]);
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

    // Sort playerUnits by effective formation order for rendering
    const sortedUnits = [...playerUnits].sort((a, b) => effectiveOrder.indexOf(a.id) - effectiveOrder.indexOf(b.id));

    // Dragged unit color for the spacer bar
    const dragColor = draggingId !== null ? (UNIT_DATA[draggingId]?.color ?? "#999") : "#999";

    // Spacer element — a real flex child that receives drag events
    const spacer = (
        <div
            key="drop-spacer"
            className="drop-spacer"
            style={{ "--drop-color": dragColor } as React.CSSProperties}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => { e.preventDefault(); executeDrop(); }}
        />
    );

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

        const isTargetingAlly = targetingMode?.skill.targetType === "ally";
        const isReviveSkill = targetingMode?.skill.type === "revive";
        const isTargetingDeadAlly = consumableTargetingMode !== null && consumableTargetingMode !== undefined;
        const isValidTarget = (targetingMode && isTargetingAlly && (isReviveSkill ? unit.hp <= 0 : unit.hp > 0)) ||
            (isTargetingDeadAlly && unit.hp <= 0 && unit.team === "player");

        const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isTargetingDeadAlly && unit.hp <= 0 && onTargetUnit) {
                onTargetUnit(unit.id);
                return;
            }
            if (targetingMode && isTargetingAlly && isReviveSkill && unit.hp <= 0 && onTargetUnit) {
                onTargetUnit(unit.id);
                return;
            }
            if (unit.hp <= 0) return;
            if (targetingMode && isTargetingAlly && onTargetUnit) {
                onTargetUnit(unit.id);
                return;
            }
            onSelect(e.shiftKey ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id] : [unit.id]);
        };

        const handleContextMenu = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ unitId: unit.id, x: e.clientX, y: e.clientY });
        };

        const orderIdx = effectiveOrder.indexOf(unit.id);
        const isDragSource = draggingId === unit.id;

        const portraitClass = [
            "party-portrait",
            isSelected ? "selected" : "",
            isValidTarget ? "valid-target" : "",
            unit.hp <= 0 ? "dead" : "",
            (isTargetingAlly || isTargetingDeadAlly) ? "targeting" : "",
            isDragSource ? "dragging" : ""
        ].filter(Boolean).join(" ");

        const hasUnspentPoints = (unit.statPoints ?? 0) > 0 || (unit.skillPoints ?? 0) > 0;
        const showHotbar = isSelected && selectedIds.length === 1 && onAssignSkill;

        elements.push(
            <div
                key={unit.id}
                className={portraitClass}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                draggable={unit.hp > 0}
                onDragStart={(e) => {
                    dragIdRef.current = unit.id;
                    setDraggingId(unit.id);
                    e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                    dragIdRef.current = null;
                    setDraggingId(null);
                    setInsertIdx(null);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragIdRef.current !== null && dragIdRef.current !== unit.id) {
                        setInsertIdx(computeInsertIdxFromX(dragIdRef.current, e.clientX));
                    }
                }}
                onDrop={(e) => {
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
                <div className={`portrait-icon${unit.holdPosition ? " hold-active" : ""}`} style={{ background: `${data.color} url(${getPortrait(data.class)}) center / cover` }}>
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
    });

    // Spacer after last portrait
    if (insertIdx === sortedUnits.length) elements.push(spacer);

    return (
        <div
            ref={barRef}
            className="party-bar glass-panel"
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragIdRef.current !== null) {
                    setInsertIdx(computeInsertIdxFromX(dragIdRef.current, e.clientX));
                }
            }}
            onDrop={(e) => { e.preventDefault(); executeDrop(); }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsertIdx(null);
            }}
        >
            {elements}
        </div>
    );
}
