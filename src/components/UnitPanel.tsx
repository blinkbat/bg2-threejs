import { useState } from "react";
import type { Unit } from "../types";
import { UNIT_DATA } from "../units";

interface UnitPanelProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
}

export function UnitPanel({ unitId, units, onClose }: UnitPanelProps) {
    const [tab, setTab] = useState("stats");
    const data = UNIT_DATA[unitId];
    const unit = units.find((u: Unit) => u.id === unitId);
    if (!data || !unit) return null;
    const hpPct = (unit.hp / data.maxHp) * 100;
    const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#eab308" : "#ef4444";
    return (
        <div style={{ position: "absolute", top: 10, right: 10, width: 240, background: "linear-gradient(180deg, #1e1e2e 0%, #12121a 100%)", border: "2px solid #3d3d5c", borderRadius: 8, fontFamily: "monospace", color: "#ddd", overflow: "hidden" }}>
            <div style={{ background: data.color, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 44, height: 44, background: "rgba(0,0,0,0.3)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", fontFamily: "serif" }}>{data.name[0]}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: "bold", fontSize: 14 }}>{data.name}</div><div style={{ fontSize: 11, opacity: 0.8 }}>{data.class}</div></div>
                <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, opacity: 0.7 }}>×</div>
            </div>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #333" }}>
                <div style={{ fontSize: 11, marginBottom: 3 }}>HP: {Math.max(0, unit.hp)} / {data.maxHp}</div>
                <div style={{ height: 10, background: "#111", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid #333" }}>
                {["stats", "skills", "items"].map(t => (<div key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, textTransform: "uppercase", cursor: "pointer", background: tab === t ? "#2a2a3e" : "transparent", borderBottom: tab === t ? "2px solid #58a6ff" : "2px solid transparent", color: tab === t ? "#fff" : "#888" }}>{t}</div>))}
            </div>
            <div style={{ padding: 12, minHeight: 140 }}>
                {tab === "stats" && (<div style={{ fontSize: 12 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>THAC0</span> <span style={{ float: "right" }}>{data.thac0}</span></div><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>AC</span> <span style={{ float: "right" }}>{data.ac}</span></div><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4, gridColumn: "span 2" }}><span style={{ color: "#888" }}>Damage</span> <span style={{ float: "right" }}>{data.damage[0]}-{data.damage[1]}</span></div></div></div>)}
                {tab === "skills" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{data.skills.map((s: string, i: number) => <div key={i} style={{ background: "#1a1a2a", padding: "8px 10px", borderRadius: 4, fontSize: 12 }}>{s}</div>)}</div>}
                {tab === "items" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{data.items.map((s: string, i: number) => <div key={i} style={{ background: "#1a1a2a", padding: "8px 10px", borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, background: i === 0 ? "#f59e0b" : "#555", borderRadius: 2 }} />{s}</div>)}</div>}
            </div>
        </div>
    );
}
