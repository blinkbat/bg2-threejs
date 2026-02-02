import type { Unit, Skill } from "../core/types";
import { UNIT_DATA, getEffectiveMaxHp } from "../game/units";
import { getHpPercentage, getHpColor } from "../combat/combatMath";
import { SkillHotbar, type HotbarAssignments } from "./SkillHotbar";

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
    targetingMode?: { casterId: number; skill: Skill } | null;
    onTargetUnit?: (targetUnitId: number) => void;
    // Hotbar props
    hotbarAssignments?: HotbarAssignments;
    onAssignSkill?: (unitId: number, slotIndex: number, skillName: string | null) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
}

export function PartyBar({
    units,
    selectedIds,
    onSelect,
    targetingMode,
    onTargetUnit,
    hotbarAssignments = {},
    onAssignSkill,
    onCastSkill,
    skillCooldowns = {},
    paused = false
}: PartyBarProps) {
    const playerUnits = units.filter((u: Unit) => u.team === "player");

    return (
        <div className="party-bar glass-panel">
            {playerUnits.map((unit: Unit) => {
                const data = UNIT_DATA[unit.id];
                if (!data) return null;
                const isSelected = selectedIds.includes(unit.id);
                const effectiveMaxHp = getEffectiveMaxHp(unit.id, unit);
                const hpPct = getHpPercentage(unit.hp, effectiveMaxHp);
                const hpColor = getHpColor(hpPct);

                const isValidTarget = targetingMode && targetingMode.skill.targetType === "ally" && unit.hp > 0;
                const isTargetingAlly = targetingMode?.skill.targetType === "ally";

                const handleClick = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    // Dead units cannot be selected or targeted
                    if (unit.hp <= 0) return;
                    if (targetingMode && isTargetingAlly && onTargetUnit) {
                        onTargetUnit(unit.id);
                        return;
                    }
                    onSelect(e.shiftKey ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id] : [unit.id]);
                };

                const portraitClass = [
                    "party-portrait",
                    isSelected ? "selected" : "",
                    isValidTarget ? "valid-target" : "",
                    unit.hp <= 0 ? "dead" : "",
                    isTargetingAlly ? "targeting" : ""
                ].filter(Boolean).join(" ");

                const hasUnspentPoints = (unit.statPoints ?? 0) > 0;
                const showHotbar = isSelected && selectedIds.length === 1 && onAssignSkill;

                return (
                    <div key={unit.id} className={portraitClass} onClick={handleClick}>
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
                            {data.name[0]}
                            {hasUnspentPoints && <span className="levelup-badge">+</span>}
                        </div>
                        <div className="progress-bar-sm portrait-hp">
                            <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, background: hpColor }} />
                        </div>
                        <div className="portrait-name">{data.name}</div>
                    </div>
                );
            })}
        </div>
    );
}
