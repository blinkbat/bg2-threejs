import type { Unit, Skill } from "../core/types";
import { UNIT_DATA, getEffectiveMaxHp } from "../game/units";
import { getHpPercentage, getHpColor } from "../combat/combatMath";

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
    targetingMode?: { casterId: number; skill: Skill } | null;
    onTargetUnit?: (targetUnitId: number) => void;
}

export function PartyBar({ units, selectedIds, onSelect, targetingMode, onTargetUnit }: PartyBarProps) {
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

                return (
                    <div key={unit.id} className={portraitClass} onClick={handleClick}>
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
