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

                const isTargetingAlly = targetingMode?.skill.targetType === "ally";
                const isTargetingDeadAlly = consumableTargetingMode !== null && consumableTargetingMode !== undefined;
                const isValidTarget = (targetingMode && isTargetingAlly && unit.hp > 0) ||
                    (isTargetingDeadAlly && unit.hp <= 0 && unit.team === "player");

                const handleClick = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    // Consumable targeting: allow clicking dead allies
                    if (isTargetingDeadAlly && unit.hp <= 0 && onTargetUnit) {
                        onTargetUnit(unit.id);
                        return;
                    }
                    // Dead units cannot be selected or targeted for skills
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
                    (isTargetingAlly || isTargetingDeadAlly) ? "targeting" : ""
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
                            <span className="portrait-fkey">F{playerUnits.indexOf(unit) + 1}</span>
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
                    </div>
                );
            })}
        </div>
    );
}
