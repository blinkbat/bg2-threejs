import type { Unit, Skill } from "../core/types";
import { UNIT_DATA } from "../game/units";
import { getHpPercentage, getHpColor } from "../combat/combatMath";

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
    targetingMode?: { casterId: number; skill: Skill } | null;
    onTargetUnit?: (targetUnitId: number) => void;
}

export function PartyBar({ units, selectedIds, onSelect, targetingMode, onTargetUnit }: PartyBarProps) {
    return (
        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(180deg, rgba(30,30,46,0.7) 0%, rgba(18,18,26,0.7) 100%)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "2px solid rgba(61,61,92,0.5)", borderRadius: 8, padding: 8, display: "flex", gap: 6 }}>
            {units.filter((u: Unit) => u.team === "player").map((unit: Unit) => {
                const data = UNIT_DATA[unit.id];
                if (!data) return null;
                const isSelected = selectedIds.includes(unit.id);
                const hpPct = getHpPercentage(unit.hp, data.maxHp);
                const hpColor = getHpColor(hpPct);

                // Determine if this unit is a valid target for the current skill
                const isValidTarget = targetingMode && targetingMode.skill.targetType === "ally" && unit.hp > 0;
                const isTargetingAlly = targetingMode?.skill.targetType === "ally";

                const handleClick = (e: React.MouseEvent) => {
                    e.stopPropagation();

                    // If in targeting mode for ally skills, target this unit
                    if (targetingMode && isTargetingAlly && onTargetUnit) {
                        onTargetUnit(unit.id);
                        return;
                    }

                    // Normal selection behavior
                    onSelect(e.shiftKey ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id] : [unit.id]);
                };

                return (
                    <div
                        key={unit.id}
                        onClick={handleClick}
                        style={{
                            width: 64,
                            cursor: isTargetingAlly ? "crosshair" : "pointer",
                            opacity: unit.hp <= 0 ? 0.4 : 1,
                            background: isValidTarget ? "rgba(34,197,94,0.2)" : (isSelected ? "rgba(0,255,0,0.15)" : "transparent"),
                            border: isValidTarget ? "2px solid #22c55e" : (isSelected ? "2px solid #00ff00" : "2px solid #333"),
                            borderRadius: 6,
                            padding: 5,
                            transition: "border-color 0.15s, background 0.15s"
                        }}
                    >
                        <div style={{ width: "100%", height: 52, background: data.color, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: "bold", color: "#fff", textShadow: "1px 1px 2px #000", fontFamily: "serif" }}>{data.name[0]}</div>
                        <div style={{ marginTop: 4, height: 6, background: "#111", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
                        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 2, fontFamily: "monospace" }}>{data.name}</div>
                    </div>
                );
            })}
        </div>
    );
}
