import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Tippy from "@tippyjs/react";
import type { Unit, Skill } from "../core/types";
import { getAllSkills } from "../game/playerUnits";
import { getSkillColorClass } from "../core/constants";
import type { HotbarAssignments } from "../hooks/hotbarStorage";

// Re-export for backwards compatibility
export type { HotbarAssignments } from "../hooks/hotbarStorage";
export { loadHotbarAssignments, saveHotbarAssignments } from "../hooks/hotbarStorage";

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
    const skills = getAllSkills(unit.id);

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
                        return (
                            <div
                                key={skill.name}
                                className={`skill-selector-item ${isSelected ? "selected" : ""}`}
                                onClick={() => { onSelect(skill.name); onClose(); }}
                            >
                                <span className={`skill-selector-name ${skillColorClass}`}>{skill.name}</span>
                                {skill.manaCost > 0 && <span className="skill-selector-cost">{skill.manaCost} MP</span>}
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
}

function HotbarSlot({
    unit,
    slotIndex,
    skill,
    onRightClick,
    onCastSkill,
    cooldownPct,
    cooldownRemaining,
    hasManaForSkill
}: HotbarSlotProps) {
    const isEmpty = !skill;
    const canClick = skill && hasManaForSkill && unit.hp > 0;
    const onCooldown = cooldownPct > 0;

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
            content={skill ? (
                <div className="hotbar-tooltip">
                    <div className="hotbar-tooltip-name">{skill.name}</div>
                    {skill.manaCost > 0 && <div className="hotbar-tooltip-cost">{skill.manaCost} MP</div>}
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
                        style={{ height: `${cooldownPct}%` }}
                    />
                )}
                <span className="hotbar-slot-key">{slotIndex + 1}</span>
                {skill && (
                    <span className={`hotbar-slot-abbrev ${skillColorClass}`}>{abbrev}</span>
                )}
                {onCooldown && cooldownRemaining > 0 && (
                    <span className="hotbar-cooldown-text">{cooldownRemaining}</span>
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
    const [, setTick] = useState(0);

    // Re-render for cooldown updates
    useEffect(() => {
        if (paused) return;
        const interval = setInterval(() => setTick(t => t + 1), 100);
        return () => clearInterval(interval);
    }, [paused]);

    const displayTime = Date.now();
    const allSkills = getAllSkills(unit.id);

    // Get slot assignments for this unit (default to 5 empty slots)
    const slots = hotbarAssignments[unit.id] || [null, null, null, null, null];

    return (
        <div className="skill-hotbar" onClick={e => e.stopPropagation()}>
            {slots.map((skillName, index) => {
                const skill = skillName ? allSkills.find(s => s.name === skillName) || null : null;

                // Cooldown calculation
                const cooldownKey = skill ? `${unit.id}-${skill.name}` : "";
                const cooldownData = skillCooldowns[cooldownKey];
                const skillCooldownEnd = cooldownData?.end || 0;
                const cooldownDuration = cooldownData?.duration || skill?.cooldown || 1000;
                const onCooldown = skillCooldownEnd > displayTime;
                const cooldownRemaining = onCooldown ? Math.ceil((skillCooldownEnd - displayTime) / 1000) : 0;
                const cooldownPct = onCooldown ? ((skillCooldownEnd - displayTime) / cooldownDuration) * 100 : 0;
                const hasManaForSkill = skill ? (unit.mana ?? 0) >= skill.manaCost : false;

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

