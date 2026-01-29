import { useState, useEffect } from "react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill, StatusEffect, DamageType, Item, CharacterStats } from "../core/types";
import { isConsumable, isWeapon, isShield, isArmor, isAccessory } from "../core/types";
import { UNIT_DATA, getAllSkills, getEffectiveUnitData, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel } from "../game/units";
import { getHpPercentage, getHpColor, getMana, hasStatusEffect, getEffectiveArmor } from "../combat/combatMath";
import { COLORS } from "../core/constants";
import { getCharacterEquipment, getPartyInventory } from "../game/equipmentState";
import { getItem } from "../game/items";
import { isOffHandDisabled } from "../game/equipment";

interface UnitPanelProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
    onToggleAI: (unitId: number) => void;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    skillCooldowns?: Record<string, { end: number; duration: number }>;
    paused?: boolean;
    queuedSkills?: string[];
    onUseConsumable?: (itemId: string, targetUnitId: number) => void;
    consumableCooldownEnd?: number;
    onIncrementStat?: (unitId: number, stat: keyof CharacterStats) => void;
    gold?: number;
}

export function UnitPanel({ unitId, units, onClose, onToggleAI, onCastSkill, skillCooldowns = {}, paused = false, queuedSkills = [], onUseConsumable, consumableCooldownEnd = 0, onIncrementStat, gold = 0 }: UnitPanelProps) {
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

    const effectiveData = getEffectiveUnitData(unitId, unit);
    const effectiveMaxHp = getEffectiveMaxHp(unitId, unit);
    const effectiveMaxMana = getEffectiveMaxMana(unitId, unit);
    const hpPct = getHpPercentage(unit.hp, effectiveMaxHp);
    const hpColor = getHpColor(hpPct);
    const hasMana = effectiveMaxMana > 0;
    const manaPct = hasMana ? getHpPercentage(getMana(unit), effectiveMaxMana) : 0;

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
                <div className="bar-label">HP: {Math.max(0, unit.hp)} / {effectiveMaxHp}</div>
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, background: hpColor }} />
                </div>
                {hasMana && (
                    <>
                        <div className="bar-label bar-label-mana">Mana: {Math.max(0, unit.mana ?? 0)} / {effectiveMaxMana}</div>
                        <div className="progress-bar">
                            <div className="progress-fill progress-fill-mana" style={{ width: `${Math.max(0, manaPct)}%` }} />
                        </div>
                    </>
                )}
            </div>

            <div className="tab-container">
                {["status", "skills", "equipment", "inventory"].map(t => (
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
                {tab === "status" && <StatusTab unit={unit} effectiveData={effectiveData} onToggleAI={onToggleAI} unitId={unitId} onIncrementStat={onIncrementStat} />}
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
                {tab === "equipment" && <EquipmentTab unitId={unitId} />}
                {tab === "inventory" && (
                    <InventoryTab
                        unit={unit}
                        displayTime={displayTime}
                        consumableCooldownEnd={consumableCooldownEnd}
                        onUseConsumable={onUseConsumable}
                        queuedSkills={queuedSkills}
                        gold={gold}
                    />
                )}
            </div>
        </div>
    );
}

const STAT_INFO: Record<keyof CharacterStats, { label: string; name: string; color: string; bonuses: { desc: string; rate: string }[] }> = {
    strength: {
        label: "STR",
        name: "Strength",
        color: "#e74c3c",
        bonuses: [{ desc: "Physical Damage", rate: "+1 per 2 pts" }]
    },
    dexterity: {
        label: "DEX",
        name: "Dexterity",
        color: "#2ecc71",
        bonuses: [{ desc: "Hit Chance", rate: "+1% per 2 pts" }]
    },
    vitality: {
        label: "VIT",
        name: "Vitality",
        color: "#e67e22",
        bonuses: [{ desc: "Max HP", rate: "+2 per pt" }]
    },
    intelligence: {
        label: "INT",
        name: "Intelligence",
        color: "#9b59b6",
        bonuses: [
            { desc: "Max Mana", rate: "+1 per pt" },
            { desc: "Magic Damage", rate: "+1 per 3 pts" }
        ]
    },
    faith: {
        label: "FAI",
        name: "Faith",
        color: "#f1c40f",
        bonuses: [
            { desc: "Holy Damage", rate: "+1 per 2 pts" },
            { desc: "Healing Power", rate: "+1 per 2 pts" }
        ]
    }
};

function StatusTab({ unit, effectiveData, onToggleAI, unitId, onIncrementStat }: {
    unit: Unit;
    effectiveData: typeof UNIT_DATA[number];
    onToggleAI: (id: number) => void;
    unitId: number;
    onIncrementStat?: (unitId: number, stat: keyof CharacterStats) => void;
}) {
    const isShielded = hasStatusEffect(unit, "shielded");
    // Base armor from equipment, doubled if shielded
    const baseArmor = effectiveData.armor;
    const displayArmor = getEffectiveArmor(unit, baseArmor);

    // Level and XP
    const level = unit.level ?? 1;
    const currentExp = unit.exp ?? 0;
    const xpForCurrentLevel = getXpForLevel(level);
    const xpForNextLevel = getXpForLevel(level + 1);
    const xpIntoLevel = currentExp - xpForCurrentLevel;
    const xpNeeded = xpForNextLevel - xpForCurrentLevel;
    const xpPct = xpNeeded > 0 ? Math.min(100, (xpIntoLevel / xpNeeded) * 100) : 100;

    // Stat points
    const statPoints = unit.statPoints ?? 0;
    const stats = unit.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 };

    return (
        <div style={{ fontSize: 13 }}>
            <div className="level-exp-section">
                <div className="level-badge">Lv {level}</div>
                <div className="exp-bar-container">
                    <div className="exp-bar">
                        <div className="exp-fill" style={{ width: `${xpPct}%` }} />
                    </div>
                    <div className="exp-text">{currentExp} / {xpForNextLevel} XP</div>
                </div>
            </div>

            <div className="stat-grid">
                <div className="card">
                    <span className="text-muted">Accuracy</span>
                    <span className="float-right">{effectiveData.accuracy}%</span>
                </div>
                <div className="card">
                    <span className="text-muted">Armor</span>
                    <span className="float-right" style={isShielded ? { color: COLORS.shieldedText } : undefined}>
                        {displayArmor}
                        {isShielded && <span style={{ fontSize: 10, marginLeft: 4 }}>(×2)</span>}
                    </span>
                </div>
                <div className="card span-2">
                    <span className="text-muted">Damage</span>
                    <span className="float-right">{effectiveData.damage[0]}-{effectiveData.damage[1]}</span>
                </div>
            </div>

            <div className="stats-section">
                <div className="stats-header">
                    <span className="stats-label">Stats</span>
                    {statPoints > 0 && (
                        <span className="stat-points-badge">{statPoints} pts</span>
                    )}
                </div>
                <div className="stat-allocation-grid">
                    {(Object.keys(STAT_INFO) as Array<keyof CharacterStats>).map(statKey => {
                        const info = STAT_INFO[statKey];
                        const value = stats[statKey];
                        const canIncrement = statPoints > 0 && onIncrementStat;
                        return (
                            <Tippy
                                key={statKey}
                                content={
                                    <div className="stat-tooltip">
                                        <div className="stat-tooltip-header" style={{ color: info.color }}>{info.name}</div>
                                        <div className="stat-tooltip-bonuses">
                                            {info.bonuses.map((bonus, i) => (
                                                <div key={i} className="stat-tooltip-row">
                                                    <span className="stat-tooltip-label">{bonus.desc}</span>
                                                    <span className="stat-tooltip-rate">{bonus.rate}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                }
                                placement="right"
                                delay={[150, 0]}
                            >
                                <div className={`stat-row ${canIncrement ? "has-points" : ""}`}>
                                    <span className="stat-name" style={{ color: info.color }}>{info.label}</span>
                                    <span className="stat-value">{value}</span>
                                    {canIncrement && (
                                        <button
                                            className="stat-increment-btn"
                                            onClick={() => onIncrementStat(unitId, statKey)}
                                        >+</button>
                                    )}
                                </div>
                            </Tippy>
                        );
                    })}
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

/** Get color and display name for a damage type */
function getDamageTypeInfo(type: DamageType | undefined): { color: string; name: string } {
    switch (type) {
        case "fire": return { color: COLORS.dmgFire, name: "Fire" };
        case "cold": return { color: COLORS.dmgCold, name: "Cold" };
        case "lightning": return { color: COLORS.dmgLightning, name: "Lightning" };
        case "chaos": return { color: COLORS.dmgChaos, name: "Chaos" };
        case "holy": return { color: COLORS.dmgHoly, name: "Holy" };
        case "physical":
        default: return { color: COLORS.dmgPhysical, name: "Physical" };
    }
}

function SkillTooltip({ skill, isShielded }: { skill: Skill; isShielded: boolean }) {
    const isRanged = skill.range > 2;
    const baseCooldown = skill.cooldown / 1000;
    const effectiveCooldown = isShielded ? baseCooldown * 2 : baseCooldown;

    // Build tooltip lines
    const lines: { label: string; value: string; color?: string }[] = [];

    // Damage/heal/effect value
    if (skill.type === "damage") {
        const dmgInfo = getDamageTypeInfo(skill.damageType);
        // Magic Missile shows damage per missile and missile count
        if (skill.hitCount) {
            lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]} × ${skill.hitCount}`, color: dmgInfo.color });
            lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
            lines.push({ label: "Missiles", value: `${skill.hitCount} (up to ${skill.hitCount} targets)`, color: "#9966ff" });
        } else {
            lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]}`, color: dmgInfo.color });
            lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
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
        const dmgInfo = getDamageTypeInfo(skill.damageType);
        lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]} × ${skill.hitCount ?? 5}`, color: dmgInfo.color });
        lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
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
    } else if (skill.type === "smite") {
        // Instant-hit single-target damage (e.g., Thunder)
        const dmgInfo = getDamageTypeInfo(skill.damageType);
        lines.push({ label: "Damage", value: `${skill.value[0]}-${skill.value[1]}`, color: dmgInfo.color });
        lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
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

const SLOT_LABELS: Record<string, string> = {
    armor: "Armor",
    leftHand: "Main Hand",
    rightHand: "Off Hand",
    accessory1: "Accessory",
    accessory2: "Accessory",
};

const DAMAGE_TYPE_COLORS: Record<string, string> = {
    physical: "#aaa",
    holy: "#ffffaa",
    chaos: "#ff6600",
    fire: "#ff4444",
    poison: "#44ff44",
};

function EquipmentTooltip({ item }: { item: Item }) {
    return (
        <div className="equipment-tooltip">
            <div className="equipment-tooltip-desc">{item.description}</div>
            {isWeapon(item) && (
                <div className="equipment-tooltip-stats">
                    <div className="equipment-tooltip-row">
                        <span className="equipment-tooltip-label">Damage</span>
                        <span className="equipment-tooltip-value">{item.damage[0]}-{item.damage[1]}</span>
                    </div>
                    <div className="equipment-tooltip-row">
                        <span className="equipment-tooltip-label">Type</span>
                        <span className="equipment-tooltip-value" style={{ color: DAMAGE_TYPE_COLORS[item.damageType] || "#aaa" }}>
                            {item.damageType}
                        </span>
                    </div>
                    <div className="equipment-tooltip-row">
                        <span className="equipment-tooltip-label">Grip</span>
                        <span className="equipment-tooltip-value">{item.grip === "twoHand" ? "Two-Handed" : "One-Handed"}</span>
                    </div>
                    {item.range && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">Range</span>
                            <span className="equipment-tooltip-value">{item.range}</span>
                        </div>
                    )}
                </div>
            )}
            {isShield(item) && (
                <div className="equipment-tooltip-stats">
                    <div className="equipment-tooltip-row">
                        <span className="equipment-tooltip-label">Armor</span>
                        <span className="equipment-tooltip-value" style={{ color: "#8bf" }}>+{item.armor}</span>
                    </div>
                </div>
            )}
            {isArmor(item) && (
                <div className="equipment-tooltip-stats">
                    <div className="equipment-tooltip-row">
                        <span className="equipment-tooltip-label">Armor</span>
                        <span className="equipment-tooltip-value" style={{ color: "#8bf" }}>+{item.armor}</span>
                    </div>
                </div>
            )}
            {isAccessory(item) && (
                <div className="equipment-tooltip-stats">
                    {item.bonusMaxHp && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">Max HP</span>
                            <span className="equipment-tooltip-value" style={{ color: COLORS.hpHigh }}>+{item.bonusMaxHp}</span>
                        </div>
                    )}
                    {item.bonusMagicDamage && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">Magic Damage</span>
                            <span className="equipment-tooltip-value" style={{ color: "#ff6600" }}>+{item.bonusMagicDamage}</span>
                        </div>
                    )}
                    {item.bonusArmor && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">Armor</span>
                            <span className="equipment-tooltip-value" style={{ color: "#8bf" }}>+{item.bonusArmor}</span>
                        </div>
                    )}
                    {item.hpRegen && item.hpRegenInterval && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">HP Regen</span>
                            <span className="equipment-tooltip-value" style={{ color: COLORS.hpHigh }}>
                                +{item.hpRegen} / {item.hpRegenInterval / 1000}s
                            </span>
                        </div>
                    )}
                    {item.aggroReduction && (
                        <div className="equipment-tooltip-row">
                            <span className="equipment-tooltip-label">Aggro</span>
                            <span className="equipment-tooltip-value" style={{ color: "#aaf" }}>
                                -{Math.round(item.aggroReduction * 100)}%
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function EquipmentTab({ unitId }: { unitId: number }) {
    const equipment = getCharacterEquipment(unitId);
    const offHandDisabled = isOffHandDisabled(equipment);

    const slots: Array<{ key: string; label: string; itemId: string | null; disabled?: boolean }> = [
        { key: "armor", label: SLOT_LABELS.armor, itemId: equipment.armor },
        { key: "leftHand", label: SLOT_LABELS.leftHand, itemId: equipment.leftHand },
        { key: "rightHand", label: SLOT_LABELS.rightHand, itemId: equipment.rightHand, disabled: offHandDisabled },
        { key: "accessory1", label: SLOT_LABELS.accessory1, itemId: equipment.accessory1 },
        { key: "accessory2", label: SLOT_LABELS.accessory2, itemId: equipment.accessory2 },
    ];

    return (
        <div className="flex flex-col gap-8">
            {slots.map(({ key, label, itemId, disabled }) => {
                const item = itemId ? getItem(itemId) : null;
                const isEmpty = !item;
                const slotClass = disabled ? "equipment-slot disabled" : isEmpty ? "equipment-slot empty" : "equipment-slot";

                const slotContent = (
                    <div key={key} className={slotClass}>
                        <span className="equipment-slot-label">{label}</span>
                        <span className="equipment-slot-item">
                            {disabled ? "(2H weapon)" : item ? item.name : "Empty"}
                        </span>
                    </div>
                );

                // Wrap in tooltip if item exists
                if (item) {
                    return (
                        <Tippy
                            key={key}
                            content={<EquipmentTooltip item={item} />}
                            placement="left"
                            delay={[200, 0]}
                        >
                            {slotContent}
                        </Tippy>
                    );
                }

                return slotContent;
            })}
        </div>
    );
}

function InventoryTab({
    unit,
    displayTime,
    consumableCooldownEnd,
    onUseConsumable,
    queuedSkills = [],
    gold = 0,
}: {
    unit: Unit;
    displayTime: number;
    consumableCooldownEnd: number;
    onUseConsumable?: (itemId: string, targetUnitId: number) => void;
    queuedSkills?: string[];
    gold?: number;
}) {
    const inventory = getPartyInventory();
    const consumables = inventory.items
        .map(entry => ({ entry, item: getItem(entry.itemId) }))
        .filter(({ item }) => item && isConsumable(item));

    const onCooldown = consumableCooldownEnd > displayTime;
    const cooldownRemaining = onCooldown ? Math.ceil((consumableCooldownEnd - displayTime) / 1000) : 0;

    if (consumables.length === 0 && gold === 0) {
        return <div className="text-muted" style={{ fontSize: 13 }}>No items</div>;
    }

    return (
        <div className="flex flex-col gap-8">
            {gold > 0 && (
                <div className="inventory-item-row disabled" style={{ cursor: "default" }}>
                    <div className="inventory-item-header">
                        <span className="inventory-item-name">Pouch of Gold</span>
                    </div>
                    <div className="inventory-item-stats">
                        <span className="inventory-item-effect" style={{ color: "#f1c40f" }}>
                            {gold} gold
                        </span>
                    </div>
                </div>
            )}
            {consumables.map(({ entry, item }) => {
                if (!item || !isConsumable(item)) return null;

                const unitAlive = unit.hp > 0;
                const isQueued = queuedSkills.includes(item.name);

                // Check if using would be wasteful
                let wouldBeWasted = false;
                if (unitAlive) {
                    if (item.effect === "heal") {
                        const maxHp = getEffectiveMaxHp(unit.id, unit);
                        wouldBeWasted = unit.hp >= maxHp;
                    } else if (item.effect === "mana") {
                        const maxMana = getEffectiveMaxMana(unit.id, unit);
                        wouldBeWasted = (unit.mana ?? 0) >= maxMana;
                    }
                    // exp is never wasted
                }

                // Can click if alive and not wasted (can queue even on cooldown)
                const canClick = unitAlive && !wouldBeWasted;

                const effectColor = item.effect === "heal" ? COLORS.hpHigh : item.effect === "mana" ? COLORS.mana : "#9b59b6";
                const effectLabel = item.effect === "heal" ? "HP" : item.effect === "mana" ? "Mana" : "XP";
                const itemClass = `inventory-item-row ${!canClick && !isQueued ? "disabled" : ""} ${wouldBeWasted ? "wasted" : ""} ${isQueued ? "queued" : ""}`;

                return (
                    <Tippy
                        key={entry.itemId}
                        content={
                            <div className="consumable-tooltip">
                                <div className="consumable-tooltip-desc">{item.description}</div>
                                <div className="consumable-tooltip-row">
                                    <span className="consumable-tooltip-label">Restores</span>
                                    <span className="consumable-tooltip-value" style={{ color: effectColor }}>
                                        {item.value} {effectLabel}
                                    </span>
                                </div>
                                {wouldBeWasted && (
                                    <div className="consumable-tooltip-warning">Already at full {effectLabel}</div>
                                )}
                            </div>
                        }
                        placement="left"
                        delay={[200, 0]}
                    >
                        <div
                            className={itemClass}
                            onClick={() => {
                                if (canClick) {
                                    onUseConsumable?.(entry.itemId, unit.id);
                                }
                            }}
                        >
                            <div className="inventory-item-header">
                                <span className="inventory-item-name">{item.name}</span>
                                {isQueued && <span className="skill-tag skill-tag-queued">QUEUED</span>}
                            </div>
                            {onCooldown && !isQueued && (
                                <div className="inventory-item-cooldown">{cooldownRemaining}s</div>
                            )}
                            {isQueued && onCooldown && (
                                <div className="inventory-item-cooldown queued">{cooldownRemaining}s</div>
                            )}
                            <div className="inventory-item-stats">
                                <span className="inventory-item-effect" style={{ color: effectColor }}>
                                    +{item.value} {effectLabel}
                                </span>
                                <span className="inventory-item-qty">×{entry.quantity}</span>
                            </div>
                        </div>
                    </Tippy>
                );
            })}
        </div>
    );
}
