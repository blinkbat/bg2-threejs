import { useState, useEffect } from "react";
import type { Unit, Skill } from "../types";
import { UNIT_DATA, getAllSkills } from "../units";

interface UnitPanelProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
    onToggleAI: (unitId: number) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
    queuedSkills?: string[];  // List of skill names queued for this unit
}

export function UnitPanel({ unitId, units, onClose, onToggleAI, onCastSkill, skillCooldowns = {}, paused = false, queuedSkills = [] }: UnitPanelProps) {
    // Force re-render every 100ms to update cooldown display (only when not paused)
    const [, setTick] = useState(0);
    // Track when pause started for frozen time display
    const [pauseTime, setPauseTime] = useState<number | null>(paused ? Date.now() : null);

    useEffect(() => {
        if (paused) {
            setPauseTime(Date.now());
            return;
        }
        setPauseTime(null);
        const interval = setInterval(() => setTick(t => t + 1), 100);
        return () => clearInterval(interval);
    }, [paused]);

    // Use frozen time when paused, current time when not
    const displayTime = paused && pauseTime ? pauseTime : Date.now();

    const [tab, setTab] = useState("stats");
    const data = UNIT_DATA[unitId];
    const unit = units.find((u: Unit) => u.id === unitId);
    if (!data || !unit) return null;
    const hpPct = (unit.hp / data.maxHp) * 100;
    const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#eab308" : "#ef4444";
    const hasMana = data.maxMana !== undefined && data.maxMana > 0;
    const manaPct = hasMana ? ((unit.mana ?? 0) / data.maxMana!) * 100 : 0;

    // Darken unit color for header (mix with black)
    const darkenColor = (hex: string, factor: number = 0.4) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
    };
    const headerColor = darkenColor(data.color);

    return (
        <div style={{ position: "absolute", top: 10, right: 10, width: 240, background: "linear-gradient(180deg, #1e1e2e 0%, #12121a 100%)", border: "2px solid #3d3d5c", borderRadius: 8, fontFamily: "monospace", color: "#ddd", overflow: "hidden" }}>
            <div style={{ background: headerColor, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: `2px solid ${data.color}` }}>
                <div style={{ width: 44, height: 44, background: "rgba(0,0,0,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", fontFamily: "serif", color: data.color }}>{data.name[0]}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: "bold", fontSize: 14 }}>{data.name}</div><div style={{ fontSize: 11, opacity: 0.8 }}>{data.class}</div></div>
                <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, opacity: 0.7 }}>×</div>
            </div>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #333" }}>
                <div style={{ fontSize: 11, marginBottom: 3 }}>HP: {Math.max(0, unit.hp)} / {data.maxHp}</div>
                <div style={{ height: 10, background: "#111", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
                {hasMana && (<>
                    <div style={{ fontSize: 11, marginBottom: 3, marginTop: 6 }}>Mana: {Math.max(0, unit.mana ?? 0)} / {data.maxMana}</div>
                    <div style={{ height: 10, background: "#111", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${Math.max(0, manaPct)}%`, height: "100%", background: "#3b82f6" }} /></div>
                </>)}
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid #333" }}>
                {["stats", "skills", "items"].map(t => (<div key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, textTransform: "uppercase", cursor: "pointer", background: tab === t ? "#2a2a3e" : "transparent", borderBottom: tab === t ? "2px solid #58a6ff" : "2px solid transparent", color: tab === t ? "#fff" : "#888" }}>{t}</div>))}
            </div>
            <div style={{ padding: 12, minHeight: 140 }}>
                {tab === "stats" && (<div style={{ fontSize: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>Accuracy</span> <span style={{ float: "right" }}>{data.accuracy}%</span></div>
                        <div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>Armor</span> <span style={{ float: "right" }}>{data.armor}</span></div>
                        <div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4, gridColumn: "span 2" }}><span style={{ color: "#888" }}>Damage</span> <span style={{ float: "right" }}>{data.damage[0]}-{data.damage[1]}</span></div>
                    </div>
                    <div
                        onClick={() => onToggleAI(unitId)}
                        style={{ marginTop: 10, background: unit.aiEnabled ? "#2d4a2d" : "#1a1a2a", padding: "8px 10px", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: unit.aiEnabled ? "1px solid #4ade80" : "1px solid #333" }}
                    >
                        <span style={{ color: unit.aiEnabled ? "#4ade80" : "#888" }}>Tactics</span>
                        <span style={{ width: 36, height: 18, background: unit.aiEnabled ? "#4ade80" : "#333", borderRadius: 9, position: "relative", transition: "background 0.2s" }}>
                            <span style={{ position: "absolute", top: 2, left: unit.aiEnabled ? 20 : 2, width: 14, height: 14, background: "#fff", borderRadius: 7, transition: "left 0.2s" }} />
                        </span>
                    </div>
                </div>)}
                {tab === "skills" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {getAllSkills(unitId).map((skill: Skill, i: number) => {
                            const cooldownKey = `${unitId}-${skill.name}`;
                            const cooldownData = skillCooldowns[cooldownKey];
                            const cooldownEnd = cooldownData?.end || 0;
                            const cooldownDuration = cooldownData?.duration || skill.cooldown;
                            // Use frozen time when paused so cooldown bar doesn't animate
                            const onCooldown = cooldownEnd > displayTime;
                            const cooldownRemaining = onCooldown ? Math.ceil((cooldownEnd - displayTime) / 1000) : 0;
                            const cooldownPct = onCooldown ? ((cooldownEnd - displayTime) / cooldownDuration) * 100 : 0;
                            const hasManaForSkill = (unit.mana ?? 0) >= skill.manaCost;
                            const isQueued = queuedSkills.includes(skill.name);
                            // Basic attack is display-only (happens via clicking enemies or AI)
                            const isBasicAttack = skill.name === "Attack";
                            // Can click if: not basic attack, has mana, alive, not already queued
                            // When not paused, also check cooldown
                            const canClick = !isBasicAttack && hasManaForSkill && unit.hp > 0 && !isQueued && (paused || !onCooldown);
                            const skillColor = skill.type === "damage" ? "#ef4444" : skill.type === "heal" ? "#22c55e" : "#3b82f6";

                            return (
                                <div
                                    key={i}
                                    onClick={() => canClick && onCastSkill?.(unitId, skill)}
                                    style={{
                                        background: isQueued ? "#2a2a1a" : (canClick ? "#1a1a2a" : "#0d0d15"),
                                        padding: "10px 12px",
                                        borderRadius: 4,
                                        fontSize: 12,
                                        cursor: canClick ? "pointer" : (isBasicAttack ? "default" : "not-allowed"),
                                        opacity: canClick || isQueued || isBasicAttack ? 1 : 0.5,
                                        border: isQueued ? "1px solid #f59e0b" : `1px solid ${canClick ? skillColor : (isBasicAttack ? "#555" : "#333")}`,
                                        position: "relative",
                                        overflow: "hidden"
                                    }}
                                >
                                    {onCooldown && !isQueued && (
                                        <div style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: `${cooldownPct}%`,
                                            height: "100%",
                                            background: "rgba(0,0,0,0.5)",
                                            pointerEvents: "none"
                                        }} />
                                    )}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
                                        <span style={{ color: isQueued ? "#f59e0b" : (isBasicAttack ? "#aaa" : skillColor), fontWeight: "bold" }}>
                                            {skill.name}
                                            {isBasicAttack && <span style={{ marginLeft: 6, fontSize: 9, color: "#666" }}>AUTO</span>}
                                            {isQueued && <span style={{ marginLeft: 6, fontSize: 9, color: "#f59e0b" }}>QUEUED</span>}
                                        </span>
                                        {skill.manaCost > 0 && <span style={{ color: "#3b82f6", fontSize: 10 }}>{skill.manaCost} MP</span>}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#888", marginTop: 4, position: "relative" }}>
                                        {skill.type === "damage" ? `${skill.value[0]}-${skill.value[1]} dmg` : `${skill.value[0]}-${skill.value[1]} heal`}
                                        {skill.aoeRadius && <span style={{ marginLeft: 8, color: "#f59e0b" }}>AOE</span>}
                                        {onCooldown && !isQueued && (
                                            <span style={{ float: "right", color: "#ef4444" }}>
                                                {cooldownRemaining}s{paused && " (paused)"}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {tab === "items" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{data.items.map((s: string, i: number) => <div key={i} style={{ background: "#1a1a2a", padding: "8px 10px", borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, background: i === 0 ? "#f59e0b" : "#555", borderRadius: 2 }} />{s}</div>)}</div>}
            </div>
        </div>
    );
}
