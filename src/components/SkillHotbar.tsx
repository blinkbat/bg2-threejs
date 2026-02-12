import { useState } from "react";
import { createPortal } from "react-dom";
import Tippy from "@tippyjs/react";
import type { Unit, Skill } from "../core/types";
import { getAllSkills, getAvailableSkills } from "../game/playerUnits";
import { getSkillColorClass, getSkillBorderColor } from "../core/constants";
import type { HotbarAssignments } from "../hooks/hotbarStorage";
import { useDisplayTime } from "../hooks/useDisplayTime";

interface SkillHotbarProps {
    unit: Unit;
    hotbarAssignments: HotbarAssignments;
    onAssignSkill: (unitId: number, slotIndex: number, skillName: string | null) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
}

// =============================================================================
// SKILL SELECTOR POPUP
// =============================================================================

interface SkillSelectorProps {
    unit: Unit;
    slotIndex: number;
    currentSkill: string | null;
    onSelect: (skillName: string | null) => void;
    onClose: () => void;
}

function SkillSelector({ unit, slotIndex, currentSkill, onSelect, onClose }: SkillSelectorProps) {
    const skills = getAllSkills(unit.id, unit);

    return createPortal(
        <div className="skill-selector-backdrop" onClick={onClose}>
            <div className="skill-selector-popup" onClick={e => e.stopPropagation()}>
                <div className="skill-selector-header">
                    Assign Skill to Slot {slotIndex + 1}
                </div>
                <div className="skill-selector-list">
                    {/* Clear option */}
                    <div
                        className={`skill-selector-item ${!currentSkill ? "selected" : ""}`}
                        onClick={() => { onSelect(null); onClose(); }}
                    >
                        <span className="skill-selector-name text-muted">(Empty)</span>
                    </div>
                    {skills.map(skill => {
                        const isSelected = currentSkill === skill.name;
                        const skillColorClass = getSkillColorClass(skill.type);
                        const borderColor = getSkillBorderColor(skill.type);
                        const cantripUses = skill.isCantrip ? (unit.cantripUses?.[skill.name] ?? 0) : undefined;
                        return (
                            <div
                                key={skill.name}
                                className={`skill-selector-item ${isSelected ? "selected" : ""}`}
                                style={{ borderColor: isSelected ? borderColor : undefined }}
                                onClick={() => { onSelect(skill.name); onClose(); }}
                            >
                                <div className="skill-selector-info">
                                    <span className={`skill-selector-name ${skillColorClass}`}>{skill.name}</span>
                                    {skill.isCantrip && (
                                        <span className="skill-selector-tag">CANTRIP</span>
                                    )}
                                </div>
                                <div className="skill-selector-meta">
                                    {cantripUses !== undefined && (
                                        <span className="skill-selector-uses">{cantripUses} uses</span>
                                    )}
                                    {skill.manaCost > 0 && <span className="skill-selector-cost">{skill.manaCost} MP</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>,
        document.body
    );
}

// =============================================================================
// HOTBAR SLOT
// =============================================================================

interface HotbarSlotProps {
    unit: Unit;
    slotIndex: number;
    skill: Skill | null;
    onRightClick: () => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
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
    onRightClick,
    onCastSkill,
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

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onRightClick();
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (canClick && onCastSkill && skill) {
            onCastSkill(unit.id, skill);
        }
    };

    const skillColorClass = getSkillColorClass(skill?.type);

    const slotClass = [
        "hotbar-slot",
        isEmpty ? "empty" : "",
        !canClick && !isEmpty ? "disabled" : "",
        onCooldown ? "on-cooldown" : ""
    ].filter(Boolean).join(" ");

    // Skill abbreviation (first 3 chars or icon)
    const abbrev = skill ? skill.name.slice(0, 3).toUpperCase() : "";

    return (
        <Tippy
            content={locked && skill ? (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-name">{skill.name}</div>
                    <div className="hotbar-tooltip-hint" style={{ color: "#f59e0b" }}>Not yet learned</div>
                    <div className="hotbar-tooltip-hint">Right-click to change</div>
                </div>
            ) : skill ? (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-name">{skill.name}</div>
                    {skill.manaCost > 0 && <div className="hotbar-tooltip-cost">{skill.manaCost} MP</div>}
                    {isCantrip && usesLeft !== undefined && (
                        <div className="hotbar-tooltip-cost">{usesLeft} uses remaining</div>
                    )}
                    <div className="hotbar-tooltip-hint">Right-click to change</div>
                    <div className="hotbar-tooltip-hint">Press {slotIndex + 1} to use</div>
                </div>
            ) : (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-hint">Right-click to assign skill</div>
                    <div className="hotbar-tooltip-hint">Press {slotIndex + 1} to use</div>
                </div>
            )}
            placement="top"
            delay={[100, 0]}
        >
            <div
                className={slotClass}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
            >
                {onCooldown && (
                    <div
                        className="hotbar-cooldown-overlay"
                        style={{ transform: `scaleY(${Math.max(0, Math.min(1, cooldownPct / 100))})` }}
                    />
                )}
                <span className="hotbar-slot-key">{slotIndex + 1}</span>
                {skill && (
                    <span className={`hotbar-slot-abbrev ${skillColorClass}`}>{abbrev}</span>
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
    const [selectorOpen, setSelectorOpen] = useState<number | null>(null);
    const displayTime = useDisplayTime(paused, 16);
    const allSkills = getAllSkills(unit.id, unit);
    const availableSkills = getAvailableSkills(unit.id);

    // Get slot assignments for this unit (default to 5 empty slots)
    const slots = hotbarAssignments[unit.id] || [null, null, null, null, null];

    return (
        <div className="skill-hotbar" onClick={e => e.stopPropagation()}>
            {slots.map((skillName, index) => {
                const learnedSkill = skillName ? allSkills.find(s => s.name === skillName) || null : null;
                // If not learned, check if it exists as an available (unlearned) skill
                const lockedSkill = !learnedSkill && skillName ? availableSkills.find(s => s.name === skillName) || null : null;
                const skill = learnedSkill || lockedSkill;
                const isLocked = !!lockedSkill;

                // Cooldown calculation
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
                        onRightClick={() => setSelectorOpen(index)}
                        onCastSkill={onCastSkill}
                        cooldownPct={cooldownPct}
                        cooldownRemaining={cooldownRemaining}
                        hasManaForSkill={hasManaForSkill}
                        usesLeft={usesLeft}
                        locked={isLocked}
                    />
                );
            })}

            {selectorOpen !== null && (
                <SkillSelector
                    unit={unit}
                    slotIndex={selectorOpen}
                    currentSkill={slots[selectorOpen]}
                    onSelect={(skillName) => onAssignSkill(unit.id, selectorOpen, skillName)}
                    onClose={() => setSelectorOpen(null)}
                />
            )}
        </div>
    );
}

