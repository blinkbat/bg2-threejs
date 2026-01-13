import type { Unit } from "../types";
import { UNIT_DATA } from "../units";

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
}

export function PartyBar({ units, selectedIds, onSelect }: PartyBarProps) {
    return (
        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(180deg, rgba(30,30,46,0.7) 0%, rgba(18,18,26,0.7) 100%)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "2px solid rgba(61,61,92,0.5)", borderRadius: 8, padding: 8, display: "flex", gap: 6 }}>
            {units.filter((u: Unit) => u.team === "player").map((unit: Unit) => {
                const data = UNIT_DATA[unit.id];
                if (!data) return null;
                const isSelected = selectedIds.includes(unit.id);
                const hpPct = (unit.hp / data.maxHp) * 100;
                const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#eab308" : "#ef4444";
                return (
                    <div key={unit.id} onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id] : [unit.id]); }} style={{ width: 64, cursor: "pointer", opacity: unit.hp <= 0 ? 0.4 : 1, background: isSelected ? "rgba(0,255,0,0.15)" : "transparent", border: isSelected ? "2px solid #00ff00" : "2px solid #333", borderRadius: 6, padding: 5 }}>
                        <div style={{ width: "100%", height: 52, background: data.color, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: "bold", color: "#fff", textShadow: "1px 1px 2px #000", fontFamily: "serif" }}>{data.name[0]}</div>
                        <div style={{ marginTop: 4, height: 6, background: "#111", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
                        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 2, fontFamily: "monospace" }}>{data.name}</div>
                    </div>
                );
            })}
        </div>
    );
}
