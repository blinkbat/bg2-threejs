import { useState, useEffect } from "react";
import type { Unit, Skill, StatusEffect } from "../core/types";
import { UNIT_DATA, getAllSkills } from "../game/units";
import { getHpPercentage, getHpColor, getMana } from "../combat/combatMath";
import { COLORS } from "../core/constants";

interface UnitPanelProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
    onToggleAI: (unitId: number) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
    queuedSkills?: string[];
}

export function UnitPanel({ unitId, units, onClose, onToggleAI, onCastSkill, skillCooldowns = {}, paused = false, queuedSkills = [] }: UnitPanelProps) {
    const [, setTick] = useState(0);
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

    const displayTime = paused && pauseTime ? pauseTime : Date.now();
    const [tab, setTab] = useState("status");
    const data = UNIT_DATA[unitId];
    const unit = units.find((u: Unit) => u.id === unitId);
    if (!data || !unit) return null;

    const hpPct = getHpPercentage(unit.hp, data.maxHp);
    const hpColor = getHpColor(hpPct);
    const hasMana = data.maxMana !== undefined && data.maxMana > 0;
    const manaPct = hasMana ? getHpPercentage(getMana(unit), data.maxMana!) : 0;

    const darkenColor = (hex: string, factor: number = 0.4) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
    };
    const headerColor = darkenColor(data.color);

    return (
        <div className="unit-panel glass-panel">
            <div className="unit-panel-header" style={{ background: headerColor, borderBottom: `2px solid ${data.color}` }}>
                <div className="unit-avatar" style={{ color: data.color }}>{data.name[0]}</div>
                <div className="unit-info">
                    <div className="unit-name">{data.name}</div>
                    <div className="unit-class">{data.class}</div>
                </div>
                <div className="close-btn" onClick={onClose}>×</div>
            </div>

            <div className="unit-bars">
                <div className="bar-label">HP: {Math.max(0, unit.hp)} / {data.maxHp}</div>
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, background: hpColor }} />
                </div>
                {hasMana && (
                    <>
                        <div className="bar-label bar-label-mana">Mana: {Math.max(0, unit.mana ?? 0)} / {data.maxMana}</div>
                        <div className="progress-bar">
                            <div className="progress-fill progress-fill-mana" style={{ width: `${Math.max(0, manaPct)}%` }} />
                        </div>
                    </>
                )}
            </div>

            <div className="tab-container">
                {["status", "skills", "items"].map(t => (
                    <div
                        key={t}
                        className={`tab ${tab === t ? "active" : ""}`}
                        onClick={() => setTab(t)}
                    >
                        {t}
                    </div>
                ))}
            </div>

            <div className="unit-content">
                {tab === "status" && <StatusTab unit={unit} data={data} onToggleAI={onToggleAI} unitId={unitId} />}
                {tab === "skills" && (
                    <SkillsTab
                        unitId={unitId}
                        unit={unit}
                        skillCooldowns={skillCooldowns}
                        displayTime={displayTime}
                        paused={paused}
                        queuedSkills={queuedSkills}
                        onCastSkill={onCastSkill}
                    />
                )}
                {tab === "items" && <ItemsTab items={data.items} />}
            </div>
        </div>
    );
}

function StatusTab({ unit, data, onToggleAI, unitId }: { unit: Unit; data: typeof UNIT_DATA[number]; onToggleAI: (id: number) => void; unitId: number }) {
    return (
        <div style={{ fontSize: 13 }}>
            <div className="stat-grid">
                <div className="card">
                    <span className="text-muted">Accuracy</span>
                    <span className="float-right">{data.accuracy}%</span>
                </div>
                <div className="card">
                    <span className="text-muted">Armor</span>
                    <span className="float-right">{data.armor}</span>
                </div>
                <div className="card span-2">
                    <span className="text-muted">Damage</span>
                    <span className="float-right">{data.damage[0]}-{data.damage[1]}</span>
                </div>
            </div>

            {unit.statusEffects && unit.statusEffects.length > 0 && (
                <div className="effects-section">
                    <div className="effects-label">Effects</div>
                    <div className="flex flex-col gap-6">
                        {unit.statusEffects.map((effect: StatusEffect, i: number) => {
                            const remainingSec = Math.ceil(effect.duration / 1000);
                            const effectColorMap: Record<string, { bg: string; border: string; text: string }> = {
                                poison: { bg: COLORS.poisonBg, border: COLORS.poison, text: COLORS.poisonText }
                            };
                            const colors = effectColorMap[effect.type] || { bg: "#1a1a2a", border: "#444", text: COLORS.logNeutral };
                            return (
                                <div
                                    key={i}
                                    className="effect-card"
                                    style={{ background: colors.bg, borderColor: colors.border }}
                                >
                                    <span className="capitalize" style={{ color: colors.text }}>{effect.type}</span>
                                    <span className="effect-duration">{remainingSec}s</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div
                className={`toggle-row ${unit.aiEnabled ? "active" : ""}`}
                onClick={() => onToggleAI(unitId)}
            >
                <span style={{ color: unit.aiEnabled ? "#4ade80" : "#888" }}>Auto Battle</span>
                <span className={`toggle-track ${unit.aiEnabled ? "active" : ""}`}>
                    <span className={`toggle-thumb ${unit.aiEnabled ? "active" : ""}`} />
                </span>
            </div>
        </div>
    );
}

function SkillsTab({
    unitId, unit, skillCooldowns, displayTime, paused, queuedSkills, onCastSkill
}: {
    unitId: number;
    unit: Unit;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    displayTime: number;
    paused: boolean;
    queuedSkills: string[];
    onCastSkill?: (unitId: number, skill: Skill) => void;
}) {
    return (
        <div className="flex flex-col gap-8">
            {getAllSkills(unitId).map((skill: Skill, i: number) => {
                const cooldownKey = `${unitId}-${skill.name}`;
                const cooldownData = skillCooldowns[cooldownKey];
                const cooldownEnd = cooldownData?.end || 0;
                const cooldownDuration = cooldownData?.duration || skill.cooldown;
                const onCooldown = cooldownEnd > displayTime;
                const cooldownRemaining = onCooldown ? Math.ceil((cooldownEnd - displayTime) / 1000) : 0;
                const cooldownPct = onCooldown ? ((cooldownEnd - displayTime) / cooldownDuration) * 100 : 0;
                const hasManaForSkill = (unit.mana ?? 0) >= skill.manaCost;
                const isQueued = queuedSkills.includes(skill.name);
                const isBasicAttack = skill.name === "Attack";
                const isRanged = skill.range > 2;
                const canClick = hasManaForSkill && unit.hp > 0;

                const skillColorClass = skill.type === "damage" ? "skill-damage" :
                    skill.type === "heal" ? "skill-heal" :
                    skill.type === "taunt" ? "skill-taunt" : "skill-buff";
                const skillBorderColor = skill.type === "damage" ? "#ef4444" :
                    skill.type === "heal" ? "#22c55e" :
                    skill.type === "taunt" ? "#c0392b" : "#3b82f6";

                const cardClass = `skill-card ${!canClick && !isQueued ? "disabled" : ""} ${isQueued ? "queued" : ""}`;

                return (
                    <div
                        key={i}
                        className={cardClass}
                        onClick={() => canClick && onCastSkill?.(unitId, skill)}
                        style={{
                            borderColor: isQueued ? undefined : (canClick ? skillBorderColor : "#333"),
                            opacity: canClick || isQueued ? 1 : 0.5
                        }}
                    >
                        {onCooldown && !isQueued && (
                            <div className="skill-cooldown-overlay" style={{ width: `${cooldownPct}%` }} />
                        )}
                        <div className="skill-header">
                            <span className={`bold ${isQueued ? "skill-queued-color" : skillColorClass}`}>
                                {skill.name}
                                {isBasicAttack && isRanged && <span className="skill-tag">RANGED</span>}
                                {isBasicAttack && !isRanged && <span className="skill-tag">MELEE</span>}
                                {isQueued && <span className="skill-tag skill-tag-queued">QUEUED</span>}
                            </span>
                            {skill.manaCost > 0 && <span className="mana-cost">{skill.manaCost} MP</span>}
                        </div>
                        <div className="skill-details">
                            {skill.type === "taunt" ? `${skill.value[0]}% taunt chance` :
                             skill.type === "damage" ? `${skill.value[0]}-${skill.value[1]} dmg` :
                             `${skill.value[0]}-${skill.value[1]} heal`}
                            {isRanged && <span className="skill-tag-range">range {skill.range}</span>}
                            {skill.poisonChance && <span className="skill-tag-poison" style={{ color: COLORS.poisonText }}>{skill.poisonChance}% poison</span>}
                            {skill.aoeRadius && <span className="skill-tag-aoe">AOE r{skill.aoeRadius}</span>}
                            {onCooldown && !isQueued && (
                                <span className="cooldown-text">
                                    {cooldownRemaining}s{paused && " (paused)"}
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ItemsTab({ items }: { items: string[] }) {
    return (
        <div className="flex flex-col gap-8">
            {items.map((s: string, i: number) => (
                <div key={i} className="card-item">
                    <span className={`item-dot ${i === 0 ? "equipped" : ""}`} />
                    {s}
                </div>
            ))}
        </div>
    );
}
