import { useState, useEffect } from "react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill, StatusEffect } from "../core/types";
import { UNIT_DATA, getAllSkills } from "../game/units";
import { getHpPercentage, getHpColor, getMana, hasStatusEffect, getEffectiveArmor } from "../combat/combatMath";
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
    // Use a ref to capture pause time immediately without waiting for state update
    const [pauseTimeState, setPauseTimeState] = useState<number | null>(() => paused ? Date.now() : null);

    useEffect(() => {
        if (paused) {
            setPauseTimeState(Date.now());
            return;
        }
        setPauseTimeState(null);
        const interval = setInterval(() => setTick(t => t + 1), 100);
        return () => clearInterval(interval);
    }, [paused]);

    // When paused, freeze display time. Use current time if pauseTimeState hasn't updated yet.
    const displayTime = paused ? (pauseTimeState ?? Date.now()) : Date.now();
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
                {["status", "skills", "equipment"].map(t => (
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
                {tab === "equipment" && <EquipmentTab items={data.items} />}
            </div>
        </div>
    );
}

function StatusTab({ unit, data, onToggleAI, unitId }: { unit: Unit; data: typeof UNIT_DATA[number]; onToggleAI: (id: number) => void; unitId: number }) {
    const isShielded = hasStatusEffect(unit, "shielded");
    const effectiveArmor = getEffectiveArmor(unit, data.armor);

    return (
        <div style={{ fontSize: 13 }}>
            <div className="stat-grid">
                <div className="card">
                    <span className="text-muted">Accuracy</span>
                    <span className="float-right">{data.accuracy}%</span>
                </div>
                <div className="card">
                    <span className="text-muted">Armor</span>
                    <span className="float-right" style={isShielded ? { color: COLORS.shieldedText } : undefined}>
                        {effectiveArmor}
                        {isShielded && <span style={{ fontSize: 10, marginLeft: 4 }}>(×2)</span>}
                    </span>
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
                                poison: { bg: COLORS.poisonBg, border: COLORS.poison, text: COLORS.poisonText },
                                shielded: { bg: COLORS.shieldedBg, border: COLORS.shielded, text: COLORS.shieldedText },
                                stunned: { bg: COLORS.stunnedBg, border: COLORS.stunned, text: COLORS.stunnedText },
                                cleansed: { bg: COLORS.cleansedBg, border: COLORS.cleansed, text: COLORS.cleansedText }
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

function SkillTooltip({ skill, isShielded }: { skill: Skill; isShielded: boolean }) {
    const isRanged = skill.range > 2;
    const baseCooldown = skill.cooldown / 1000;
    const effectiveCooldown = isShielded ? baseCooldown * 2 : baseCooldown;

    // Build tooltip lines
    const lines: { label: string; value: string; color?: string }[] = [];

    // Damage/heal/effect value
    if (skill.type === "damage") {
        // Magic Missile shows damage per missile and missile count
        if (skill.hitCount) {
            lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]} × ${skill.hitCount}` });
            lines.push({ label: "Missiles", value: `${skill.hitCount} (up to ${skill.hitCount} targets)`, color: "#9966ff" });
        } else {
            lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]}` });
        }
    } else if (skill.type === "heal") {
        lines.push({ label: "Heal", value: `${skill.value[0]}-${skill.value[1]}`, color: COLORS.hpHigh });
    } else if (skill.type === "taunt") {
        lines.push({ label: "Taunt chance", value: `${skill.value[0]}%` });
    } else if (skill.type === "buff") {
        const durationSec = Math.round(skill.value[0] / 1000);
        // Different buff types have different effects
        if (skill.name === "Raise Shield") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.shieldedText });
            lines.push({ label: "Effect", value: "×2 armor, ×2 cooldowns", color: COLORS.shieldedText });
        } else if (skill.name === "Cleanse") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.cleansedText });
            lines.push({ label: "Effect", value: "Removes poison", color: COLORS.poisonText });
            lines.push({ label: "Bonus", value: "Poison immune", color: COLORS.cleansedText });
        } else {
            // Generic buff fallback
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.shieldedText });
        }
    } else if (skill.type === "flurry") {
        lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]} × ${skill.hitCount ?? 5}` });
        lines.push({ label: "Targets", value: `Up to ${skill.hitCount ?? 5} nearby` });
    } else if (skill.type === "debuff") {
        const durationSec = Math.round(skill.value[0] / 1000);
        lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.stunnedText });
        if (skill.stunChance) {
            lines.push({ label: "Stun chance", value: `${skill.stunChance}%`, color: COLORS.stunnedText });
        }
    } else if (skill.type === "trap") {
        const durationSec = Math.round(skill.value[0] / 1000);
        lines.push({ label: "Pin duration", value: `${durationSec}s`, color: "#c0392b" });
    } else if (skill.type === "sanctuary") {
        lines.push({ label: "Heal/tick", value: `${skill.value[0]}`, color: COLORS.hpHigh });
        lines.push({ label: "Effect", value: "Dispels acid", color: "#9acd32" });
    } else if (skill.type === "mana_transfer") {
        lines.push({ label: "Mana given", value: `${skill.value[0]}-${skill.value[1]}`, color: COLORS.mana });
        if (skill.selfDamage) {
            lines.push({ label: "HP cost", value: `${skill.selfDamage[0]}-${skill.selfDamage[1]} over time`, color: COLORS.damageEnemy });
        }
    }

    // Range
    if (skill.range > 0) {
        lines.push({ label: isRanged ? "Range" : "Melee", value: isRanged ? `${skill.range}` : "1.8" });
    }

    // AOE
    if (skill.aoeRadius) {
        lines.push({ label: "AOE radius", value: `${skill.aoeRadius}`, color: "#ff6600" });
        // Fireball damages all units including allies
        if (skill.name === "Fireball") {
            lines.push({ label: "Warning", value: "Friendly fire!", color: "#ff4444" });
        }
    }

    // Poison chance
    if (skill.poisonChance) {
        lines.push({ label: "Poison chance", value: `${skill.poisonChance}%`, color: COLORS.poisonText });
    }

    // Mana cost
    if (skill.manaCost > 0) {
        lines.push({ label: "Mana", value: `${skill.manaCost}`, color: COLORS.mana });
    }

    // Cooldown
    lines.push({
        label: "Cooldown",
        value: isShielded ? `${effectiveCooldown}s (×2)` : `${baseCooldown}s`,
        color: isShielded ? COLORS.shieldedText : undefined
    });

    return (
        <div className="skill-tooltip">
            {skill.description && (
                <div className="skill-tooltip-desc">{skill.description}</div>
            )}
            {lines.map((line, i) => (
                <div key={i} className="skill-tooltip-row">
                    <span className="skill-tooltip-label">{line.label}</span>
                    <span className="skill-tooltip-value" style={line.color ? { color: line.color } : undefined}>
                        {line.value}
                    </span>
                </div>
            ))}
            {skill.flavor && (
                <div className="skill-tooltip-flavor">{skill.flavor}</div>
            )}
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
    const isShielded = hasStatusEffect(unit, "shielded");

    return (
        <div className="flex flex-col gap-8">
            {getAllSkills(unitId).map((skill: Skill, i: number) => {
                const cooldownKey = `${unitId}-${skill.name}`;
                const cooldownData = skillCooldowns[cooldownKey];
                const skillCooldownEnd = cooldownData?.end || 0;
                const cooldownDuration = cooldownData?.duration || skill.cooldown;
                // This skill has an active cooldown animation
                const skillOnCooldown = skillCooldownEnd > displayTime;
                const cooldownRemaining = skillOnCooldown ? Math.ceil((skillCooldownEnd - displayTime) / 1000) : 0;
                const cooldownPct = skillOnCooldown ? ((skillCooldownEnd - displayTime) / cooldownDuration) * 100 : 0;
                const hasManaForSkill = (unit.mana ?? 0) >= skill.manaCost;
                const isQueued = queuedSkills.includes(skill.name);
                const isBasicAttack = skill.name === "Attack";
                const isRanged = skill.range > 2;
                // Can click if has mana and alive (clicking queues the skill)
                const canClick = hasManaForSkill && unit.hp > 0;

                const skillColorClass = skill.type === "damage" ? "skill-damage" :
                    skill.type === "heal" ? "skill-heal" :
                    skill.type === "taunt" ? "skill-taunt" :
                    skill.type === "flurry" ? "skill-flurry" : "skill-buff";
                const skillBorderColor = skill.type === "damage" ? "#ef4444" :
                    skill.type === "heal" ? "#22c55e" :
                    skill.type === "taunt" ? "#c0392b" :
                    skill.type === "flurry" ? "#27ae60" : "#f1c40f";

                const cardClass = `skill-card ${!canClick && !isQueued ? "disabled" : ""} ${isQueued ? "queued" : ""}`;

                return (
                    <Tippy
                        key={i}
                        content={<SkillTooltip skill={skill} isShielded={isShielded} />}
                        placement="left"
                        delay={[200, 0]}
                        arrow={true}
                    >
                        <div
                            className={cardClass}
                            onClick={() => canClick && onCastSkill?.(unitId, skill)}
                            style={{
                                borderColor: isQueued ? undefined : (canClick ? skillBorderColor : "#333")
                            }}
                        >
                            {skillOnCooldown && (
                                <div
                                    className="skill-cooldown-overlay"
                                    style={{
                                        width: `${cooldownPct}%`,
                                        background: isQueued ? "rgba(245, 158, 11, 0.4)" : "rgba(0,0,0,0.5)"
                                    }}
                                />
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
                            {skillOnCooldown && (
                                <div className="skill-cooldown-text" style={isQueued ? { color: "#f59e0b" } : undefined}>
                                    {cooldownRemaining}s{paused && " (paused)"}{isShielded && " (×2)"}
                                </div>
                            )}
                        </div>
                    </Tippy>
                );
            })}
        </div>
    );
}

function EquipmentTab({ items }: { items: string[] }) {
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
