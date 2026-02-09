import { useState, useRef, useEffect, useCallback } from "react";
import type { Unit, Skill, StatusEffectType } from "../core/types";
import { COLORS } from "../core/constants";
import { UNIT_DATA, getEffectiveMaxHp } from "../game/playerUnits";
import { getHpPercentage, getHpColor } from "../combat/combatMath";
import { SkillHotbar, type HotbarAssignments } from "./SkillHotbar";

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

/** Build a complete formation order array from current players + saved order. */
function getEffectiveOrder(playerIds: number[], formationOrder: number[]): number[] {
    // Start with saved order, filtered to living IDs
    const ordered = formationOrder.filter(id => playerIds.includes(id));
    // Append any IDs not in the saved order (new units, fallback)
    for (const id of playerIds) {
        if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
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
    const playerUnits = units.filter((u: Unit) => u.team === "player");
    const playerIds = playerUnits.map(u => u.id);
    const effectiveOrder = getEffectiveOrder(playerIds, formationOrder);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ unitId: number; x: number; y: number } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    // Drag state
    const dragIdRef = useRef<number | null>(null);
    const [dragOverId, setDragOverId] = useState<number | null>(null);

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
        const idx = effectiveOrder.indexOf(unitId);
        const targetIdx = idx + direction;
        if (idx === -1 || targetIdx < 0 || targetIdx >= effectiveOrder.length) return;
        const newOrder = [...effectiveOrder];
        [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
        onReorderFormation?.(newOrder);
        setContextMenu(null);
    }, [effectiveOrder, onReorderFormation]);

    // Sort playerUnits by effective formation order for rendering
    const sortedUnits = [...playerUnits].sort((a, b) => effectiveOrder.indexOf(a.id) - effectiveOrder.indexOf(b.id));

    return (
        <div className="party-bar glass-panel">
            {sortedUnits.map((unit: Unit, renderIndex: number) => {
                const data = UNIT_DATA[unit.id];
                if (!data) return null;
                const isSelected = selectedIds.includes(unit.id);
                const effectiveMaxHp = getEffectiveMaxHp(unit.id, unit);
                const hpPct = getHpPercentage(unit.hp, effectiveMaxHp);
                const hpColor = getHpColor(hpPct);

                const isTargetingAlly = targetingMode?.skill.targetType === "ally";
                const isTargetingDeadAlly = consumableTargetingMode !== null && consumableTargetingMode !== undefined;
                const isValidTarget = (targetingMode && isTargetingAlly && unit.hp > 0) ||
                    (isTargetingDeadAlly && unit.hp <= 0 && unit.team === "player");

                const handleClick = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (isTargetingDeadAlly && unit.hp <= 0 && onTargetUnit) {
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

                const portraitClass = [
                    "party-portrait",
                    isSelected ? "selected" : "",
                    isValidTarget ? "valid-target" : "",
                    unit.hp <= 0 ? "dead" : "",
                    (isTargetingAlly || isTargetingDeadAlly) ? "targeting" : "",
                    dragOverId === unit.id ? "drag-over" : ""
                ].filter(Boolean).join(" ");

                const hasUnspentPoints = (unit.statPoints ?? 0) > 0;
                const showHotbar = isSelected && selectedIds.length === 1 && onAssignSkill;

                return (
                    <div
                        key={unit.id}
                        className={portraitClass}
                        onClick={handleClick}
                        onContextMenu={handleContextMenu}
                        draggable
                        onDragStart={(e) => {
                            dragIdRef.current = unit.id;
                            e.dataTransfer.effectAllowed = "move";
                            // Make the portrait semi-transparent while dragging
                            requestAnimationFrame(() => {
                                (e.target as HTMLElement).classList.add("dragging");
                            });
                        }}
                        onDragEnd={(e) => {
                            (e.target as HTMLElement).classList.remove("dragging");
                            dragIdRef.current = null;
                            setDragOverId(null);
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (dragIdRef.current !== null && dragIdRef.current !== unit.id) {
                                setDragOverId(unit.id);
                            }
                        }}
                        onDragLeave={() => {
                            if (dragOverId === unit.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragOverId(null);
                            const fromId = dragIdRef.current;
                            if (fromId === null || fromId === unit.id) return;
                            const fromIdx = effectiveOrder.indexOf(fromId);
                            const toIdx = effectiveOrder.indexOf(unit.id);
                            if (fromIdx === -1 || toIdx === -1) return;
                            const newOrder = [...effectiveOrder];
                            [newOrder[fromIdx], newOrder[toIdx]] = [newOrder[toIdx], newOrder[fromIdx]];
                            onReorderFormation?.(newOrder);
                            dragIdRef.current = null;
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
                        <div className="portrait-icon" style={{ background: data.color }}>
                            <span className="portrait-fkey">F{renderIndex + 1}</span>
                            {data.name[0]}
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
                            <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, background: hpColor }} />
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
            })}
        </div>
    );
}
