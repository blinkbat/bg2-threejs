import { useState, useRef, useCallback } from "react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill } from "../core/types";
import { getAllSkills, getAvailableSkills } from "../game/playerUnits";
import { getSkillTextColor } from "../core/constants";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import { useDisplayTime } from "../hooks/useDisplayTime";

/** Drag data type used for skill-to-hotbar and hotbar-to-hotbar transfers */
export const SKILL_DRAG_TYPE = "application/x-skill";
/** Secondary type carrying hotbar source slot index (for rearranging) */
export const HOTBAR_SLOT_DRAG_TYPE = "application/x-hotbar-slot";

interface SkillHotbarProps {
    unit: Unit;
    hotbarAssignments: HotbarAssignments;
    onAssignSkill: (unitId: number, slotIndex: number, skillName: string | null) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
}

// Shared refs so HotbarSlot can communicate with the parent container.
// These are set by the SkillHotbar and read/written by HotbarSlot.
interface HotbarDragContext {
    dropHandled: boolean;
    sourceSlot: number | null;
}

// =============================================================================
// HOTBAR SLOT
// =============================================================================

interface HotbarSlotProps {
    unit: Unit;
    slotIndex: number;
    skill: Skill | null;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    onDrop: (slotIndex: number, skillName: string, sourceSlot: number | null) => void;
    dragCtx: React.RefObject<HotbarDragContext>;
    cooldownPct: number;
    cooldownRemaining: number;
    hasManaForSkill: boolean;
    usesLeft?: number;
    locked?: boolean;
}

function HotbarSlot({
    unit,
    slotIndex,
    skill,
    onCastSkill,
    onDrop,
    dragCtx,
    cooldownPct,
    cooldownRemaining,
    hasManaForSkill,
    usesLeft,
    locked
}: HotbarSlotProps) {
    const isEmpty = !skill;
    const isCantrip = skill?.isCantrip ?? false;
    const noUsesLeft = isCantrip && usesLeft !== undefined && usesLeft <= 0;
    const canClick = skill && !locked && hasManaForSkill && !noUsesLeft && unit.hp > 0;
    const onCooldown = !locked && cooldownPct > 0;

    const [dropHover, setDropHover] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (canClick && onCastSkill && skill) {
            onCastSkill(unit.id, skill);
        }
    };

    const handleDragStart = (e: React.DragEvent) => {
        if (!skill) { e.preventDefault(); return; }
        dragCtx.current.sourceSlot = slotIndex;
        dragCtx.current.dropHandled = false;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(SKILL_DRAG_TYPE, skill.name);
        e.dataTransfer.setData(HOTBAR_SLOT_DRAG_TYPE, String(slotIndex));
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(SKILL_DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropHover(true);
        }
    };

    const handleDragLeave = () => {
        setDropHover(false);
    };

    const handleDropEvent = (e: React.DragEvent) => {
        e.preventDefault();
        setDropHover(false);
        dragCtx.current.dropHandled = true;
        const skillName = e.dataTransfer.getData(SKILL_DRAG_TYPE);
        const sourceSlotStr = e.dataTransfer.getData(HOTBAR_SLOT_DRAG_TYPE);
        const sourceSlot = sourceSlotStr ? parseInt(sourceSlotStr, 10) : null;
        if (skillName) {
            onDrop(slotIndex, skillName, Number.isNaN(sourceSlot) ? null : sourceSlot);
        }
    };

    const skillColor = skill ? getSkillTextColor(skill.type, skill.damageType) : undefined;

    const slotClass = [
        "hotbar-slot",
        isEmpty ? "empty" : "",
        !canClick && !isEmpty ? "disabled" : "",
        onCooldown ? "on-cooldown" : "",
        dropHover ? "drop-hover" : ""
    ].filter(Boolean).join(" ");

    const abbrev = skill ? skill.name.slice(0, 3).toUpperCase() : "";

    return (
        <Tippy
            content={locked && skill ? (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-name" style={{ color: getSkillTextColor(skill.type, skill.damageType) }}>{skill.name}</div>
                    <div className="hotbar-tooltip-hint" style={{ color: "var(--ui-color-accent-warning)" }}>Not yet learned</div>
                    <div className="hotbar-tooltip-hint">Drag skills here to assign</div>
                </div>
            ) : skill ? (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-name" style={{ color: getSkillTextColor(skill.type, skill.damageType) }}>{skill.name}</div>
                    {skill.manaCost > 0 && <div className="hotbar-tooltip-cost">{skill.manaCost} MP</div>}
                    {isCantrip && usesLeft !== undefined && (
                        <div className="hotbar-tooltip-cost">{usesLeft} uses remaining</div>
                    )}
                    <div className="hotbar-tooltip-hint">Press {slotIndex + 1} to use</div>
                    <div className="hotbar-tooltip-hint">Drag to rearrange · drag off to clear</div>
                </div>
            ) : (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-hint">Drag skills here to assign</div>
                    <div className="hotbar-tooltip-hint">Press {slotIndex + 1} to use</div>
                </div>
            )}
            placement="top"
            delay={[100, 0]}
        >
            <div
                className={slotClass}
                onClick={handleClick}
                draggable={!!skill}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDropEvent}
            >
                {onCooldown && (
                    <div
                        className="hotbar-cooldown-overlay"
                        style={{ transform: `scaleY(${Math.max(0, Math.min(1, cooldownPct / 100))})` }}
                    />
                )}
                <span className="hotbar-slot-key">{slotIndex + 1}</span>
                {skill && !onCooldown && (
                    <span className="hotbar-slot-abbrev" style={{ color: skillColor }}>{abbrev}</span>
                )}
                {onCooldown && cooldownRemaining > 0 && (
                    <span className="hotbar-cooldown-text">{cooldownRemaining}</span>
                )}
                {isCantrip && usesLeft !== undefined && (
                    <span className="hotbar-uses-badge">{usesLeft}</span>
                )}
            </div>
        </Tippy>
    );
}

// =============================================================================
// MAIN HOTBAR COMPONENT
// =============================================================================

export function SkillHotbar({
    unit,
    hotbarAssignments,
    onAssignSkill,
    onCastSkill,
    skillCooldowns = {},
    paused = false
}: SkillHotbarProps) {
    const displayTime = useDisplayTime(paused, 50);
    const allSkills = getAllSkills(unit.id, unit);
    const availableSkills = getAvailableSkills(unit.id);

    const slots = hotbarAssignments[unit.id] || [null, null, null, null, null];
    const slotsRef = useRef(slots);
    slotsRef.current = slots;

    const dragCtx = useRef<HotbarDragContext>({ dropHandled: false, sourceSlot: null });

    const handleSlotDrop = useCallback((targetSlot: number, skillName: string, sourceSlot: number | null) => {
        if (sourceSlot !== null && sourceSlot !== targetSlot) {
            const targetSkill = slotsRef.current[targetSlot];
            onAssignSkill(unit.id, targetSlot, skillName);
            onAssignSkill(unit.id, sourceSlot, targetSkill);
        } else if (sourceSlot === null) {
            onAssignSkill(unit.id, targetSlot, skillName);
        }
    }, [unit.id, onAssignSkill]);

    const handleDragEnd = useCallback(() => {
        // If a hotbar slot was dragged and not dropped on another slot, clear it
        if (!dragCtx.current.dropHandled && dragCtx.current.sourceSlot !== null) {
            onAssignSkill(unit.id, dragCtx.current.sourceSlot, null);
        }
        dragCtx.current.sourceSlot = null;
        dragCtx.current.dropHandled = false;
    }, [unit.id, onAssignSkill]);

    return (
        <div
            className="skill-hotbar"
            onClick={e => e.stopPropagation()}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes(SKILL_DRAG_TYPE)) {
                    e.preventDefault();
                }
            }}
        >
            {slots.map((skillName, index) => {
                const learnedSkill = skillName ? allSkills.find(s => s.name === skillName) || null : null;
                const lockedSkill = !learnedSkill && skillName ? availableSkills.find(s => s.name === skillName) || null : null;
                const skill = learnedSkill || lockedSkill;
                const isLocked = !!lockedSkill;

                const cooldownKey = skill ? `${unit.id}-${skill.name}` : "";
                const cooldownData = skillCooldowns[cooldownKey];
                const skillCooldownEnd = cooldownData?.end || 0;
                const cooldownDuration = Math.max(1, cooldownData?.duration || skill?.cooldown || 1000);
                const onCooldown = skillCooldownEnd > displayTime;
                const cooldownRemaining = onCooldown ? Math.ceil((skillCooldownEnd - displayTime) / 1000) : 0;
                const cooldownPct = onCooldown ? ((skillCooldownEnd - displayTime) / cooldownDuration) * 100 : 0;
                const hasManaForSkill = skill && !isLocked ? (unit.mana ?? 0) >= skill.manaCost : false;
                const usesLeft = skill?.isCantrip ? (unit.cantripUses?.[skill.name] ?? 0) : undefined;

                return (
                    <HotbarSlot
                        key={index}
                        unit={unit}
                        slotIndex={index}
                        skill={skill}
                        onCastSkill={onCastSkill}
                        onDrop={handleSlotDrop}
                        dragCtx={dragCtx}
                        cooldownPct={cooldownPct}
                        cooldownRemaining={cooldownRemaining}
                        hasManaForSkill={hasManaForSkill}
                        usesLeft={usesLeft}
                        locked={isLocked}
                    />
                );
            })}
        </div>
    );
}
