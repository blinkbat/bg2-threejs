import { useState } from "react";
import Tippy from "@tippyjs/react";
import type { Unit, Skill, StatusEffect, DamageType, Item, CharacterStats } from "../core/types";
import { isConsumable, isWeapon, isShield, isArmor, isAccessory } from "../core/types";
import { UNIT_DATA, getAllSkills, getAvailableSkills, getEffectiveUnitData, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel } from "../game/playerUnits";
import { getHpPercentage, getHpColor, getMana, hasStatusEffect, getEffectiveArmor } from "../combat/combatMath";
import { getDexterityCritChance } from "../game/statBonuses";
import { COLORS, getSkillColorClass, getSkillBorderColor } from "../core/constants";
import { getCharacterEquipment, getPartyInventory } from "../game/equipmentState";
import { getItem } from "../game/items";
import { isOffHandDisabled } from "../game/equipment";
import { useDisplayTime } from "../hooks/useDisplayTime";
import monkPortrait from "../assets/monk-portrait.png";
import barbarianPortrait from "../assets/barbarian-portrait.png";
import wizardPortrait from "../assets/wizard-portrait.png";
import paladinPortrait from "../assets/paladin-portrait.png";
import thiefPortrait from "../assets/thief-portrait.png";
import clericPortrait from "../assets/cleric-portrait.png";

const CLASS_PORTRAITS: Record<string, string> = {
    Barbarian: barbarianPortrait,
    Wizard: wizardPortrait,
    Paladin: paladinPortrait,
    Thief: thiefPortrait,
    Cleric: clericPortrait,
    Monk: monkPortrait,
    Ancestor: barbarianPortrait,
};
const getPortrait = (className: string) => CLASS_PORTRAITS[className] ?? monkPortrait;

const PORTRAIT_POS: Record<string, string> = {
    Cleric: "35% bottom",
    Monk: "35% bottom",
    Paladin: "center 80%",
    Thief: "65% bottom",
    Wizard: "65% bottom",
    Ancestor: "center 78%",
};

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
    onLearnSkill?: (unitId: number, skillName: string) => void;
    gold?: number;
}

export function UnitPanel({ unitId, units, onClose, onToggleAI, onCastSkill, skillCooldowns = {}, paused = false, queuedSkills = [], onUseConsumable, consumableCooldownEnd = 0, onIncrementStat, onLearnSkill, gold = 0 }: UnitPanelProps) {
    const displayTime = useDisplayTime(paused, 16);
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

    return (
        <div className="unit-panel glass-panel">
            <div className="unit-panel-header" style={{ backgroundColor: data.color, "--header-bg-image": `url(${getPortrait(data.class)})`, "--header-bg-pos": PORTRAIT_POS[data.class] ?? "center bottom" } as React.CSSProperties}>
                <div className="close-btn header-close" onClick={onClose}>×</div>
                <div className="unit-info header-info">
                    <div className="unit-name">{data.name}</div>
                    {data.name !== data.class && <div className="unit-class">{data.class}</div>}
                </div>
            </div>

            <div className="unit-bars">
                <div className="bar-label">Health: {Math.max(0, unit.hp)} / {effectiveMaxHp}</div>
                <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${Math.max(0, hpPct)}%`, backgroundColor: hpColor }} />
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
                {["status", "skills", "equipment", "inventory"].map(t => {
                    const showDot = (t === "status" && (unit.statPoints ?? 0) > 0)
                        || (t === "skills" && (unit.skillPoints ?? 0) > 0);
                    return (
                        <div
                            key={t}
                            className={`tab ${tab === t ? "active" : ""}`}
                            onClick={() => setTab(t)}
                        >
                            {t}{showDot && <span className="tab-dot" />}
                        </div>
                    );
                })}
            </div>

            <div className="unit-content">
                {tab === "status" && <StatusTab unit={unit} effectiveData={effectiveData} onToggleAI={onToggleAI} unitId={unitId} onIncrementStat={onIncrementStat} displayTime={displayTime} />}
                {tab === "skills" && (
                    <SkillsTab
                        unitId={unitId}
                        unit={unit}
                        skillCooldowns={skillCooldowns}
                        displayTime={displayTime}
                        paused={paused}
                        queuedSkills={queuedSkills}
                        onCastSkill={onCastSkill}
                        onLearnSkill={onLearnSkill}
                    />
                )}
                {tab === "equipment" && <EquipmentTab unitId={unitId} />}
                {tab === "inventory" && (
                    <InventoryTab
                        unit={unit}
                        units={units}
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
        bonuses: [
            { desc: "Hit Chance", rate: "+1% per 2 pts" },
            { desc: "Crit Chance", rate: "+1% per 2 pts" }
        ]
    },
    vitality: {
        label: "VIT",
        name: "Vitality",
        color: "#e67e22",
        bonuses: [{ desc: "Max HP", rate: "+1 per pt" }]
    },
    intelligence: {
        label: "INT",
        name: "Intelligence",
        color: "#9b59b6",
        bonuses: [
            { desc: "Max Mana", rate: "+1 per pt" },
            { desc: "Magic Damage", rate: "+1 per 2 pts" }
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

/** Effect metadata for display */
const EFFECT_INFO: Record<string, { icon: string; color: string; description: string }> = {
    poison: { icon: "☠", color: COLORS.poisonText, description: "Taking damage over time" },
    shielded: { icon: "🛡", color: COLORS.shieldedText, description: "Armor doubled, cooldowns doubled" },
    stunned: { icon: "💫", color: COLORS.stunnedText, description: "Cannot act" },
    cleansed: { icon: "✨", color: COLORS.cleansedText, description: "Immune to poison" },
    defiance: { icon: "⚔", color: COLORS.defianceText, description: "+2 armor, cooldowns halved" },
    pinned: { icon: "📌", color: "#c0392b", description: "Cannot move" },
    slowed: { icon: "🐌", color: "#3498db", description: "Move speed halved, cooldowns +50%" },
    energyShield: { icon: "🔮", color: "#9b59b6", description: "Absorbs damage" },
    qi_drain: { icon: "💔", color: "#e74c3c", description: "Life force draining" },
    doom: { icon: "💀", color: COLORS.doomText, description: "Death in 10s — cure with Restoration" },
    regen: { icon: "💚", color: COLORS.hpHigh, description: "Healing over time" },
    invul: { icon: "✦", color: "#8e44ad", description: "Immune to all damage" },
    sun_stance: { icon: "☀", color: COLORS.sunStanceText, description: "Attacks deal bonus fire damage" },
    thorns: { icon: "✹", color: COLORS.thornsText, description: "Reflects melee damage to attackers" },
    highland_defense: { icon: "⛰", color: COLORS.highlandDefenseText, description: "Redirects nearby ally damage to the barbarian" },
    divine_lattice: { icon: "◈", color: COLORS.divineLatticeText, description: "Impervious to damage; cannot act; ignored by enemies" },
    weakened: { icon: "A", color: COLORS.weakenedText, description: "Attack speed reduced" },
    hamstrung: { icon: "L", color: COLORS.hamstrungText, description: "Move speed reduced" },
    blind: { icon: "B", color: COLORS.blindText, description: "Hit chance heavily reduced" },
    vanquishing_light: { icon: "*", color: COLORS.dmgHoly, description: "Holy aura damages nearby foes and may blind" },
};

/** Renders active status effects as inline icons with tooltips */
function EffectsDisplay({ unit, displayTime }: { unit: Unit; displayTime: number }) {
    if (!unit.statusEffects || unit.statusEffects.length === 0) return null;

    return (
        <div className="effects-inline">
            {unit.statusEffects.map((effect: StatusEffect, i: number) => {
                const remainingSec = Math.ceil(effect.duration / 1000);
                const info = EFFECT_INFO[effect.type] || { icon: "?", color: "#888", description: "Unknown effect" };
                const displayName = effect.type.replace(/_/g, " ");
                const now = displayTime;

                return (
                    <Tippy
                        key={i}
                        content={
                            <div className="effect-tooltip">
                                <div className="effect-tooltip-header" style={{ color: info.color }}>
                                    {info.icon} {displayName}
                                </div>
                                <div className="effect-tooltip-desc">{info.description}</div>
                                <div className="effect-tooltip-time">
                                    {effect.type === "highland_defense" ? "Until exhausted" : `${remainingSec}s remaining`}
                                </div>
                                {effect.type === "energyShield" && effect.shieldAmount !== undefined && (
                                    <div className="effect-tooltip-extra" style={{ color: info.color }}>
                                        {effect.shieldAmount} HP remaining
                                    </div>
                                )}
                                {effect.type === "thorns" && effect.thornsDamage !== undefined && (
                                    <div className="effect-tooltip-extra" style={{ color: info.color }}>
                                        Reflects {effect.thornsDamage} melee damage
                                    </div>
                                )}
                                {effect.type === "highland_defense" && (
                                    <>
                                        <div className="effect-tooltip-extra" style={{ color: info.color }}>
                                            Redirect pool: {Math.max(0, Math.round(effect.interceptRemaining ?? 50))}
                                        </div>
                                        <div className="effect-tooltip-extra" style={{ color: info.color }}>
                                            {now >= (effect.interceptCooldownEnd ?? 0)
                                                ? "Intercept ready"
                                                : `Intercept ready in ${Math.max(1, Math.ceil(((effect.interceptCooldownEnd ?? 0) - now) / 1000))}s`}
                                        </div>
                                    </>
                                )}
                            </div>
                        }
                        placement="top"
                        delay={[100, 0]}
                    >
                        <div
                            className="effect-icon"
                            style={{ color: info.color, borderColor: info.color }}
                        >
                            {info.icon}
                        </div>
                    </Tippy>
                );
            })}
        </div>
    );
}

function StatusTab({ unit, effectiveData, onToggleAI, unitId, onIncrementStat, displayTime }: {
    unit: Unit;
    effectiveData: typeof UNIT_DATA[number];
    onToggleAI: (id: number) => void;
    unitId: number;
    onIncrementStat?: (unitId: number, stat: keyof CharacterStats) => void;
    displayTime: number;
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
            <EffectsDisplay unit={unit} displayTime={displayTime} />

            <div className="level-exp-section">
                <div className="level-badge">Lv {level}</div>
                <div className="exp-bar-container">
                    <div className="exp-bar">
                        <div className="exp-fill" style={{ width: `${xpPct}%` }} />
                    </div>
                    <div className="exp-text">{currentExp} / {xpForNextLevel} Experience</div>
                </div>
            </div>

            <div className="stat-grid">
                <div className="card">
                    <span className="text-muted">Accuracy</span>
                    <span className="float-right">{effectiveData.accuracy}%</span>
                </div>
                <div className="card">
                    <span className="text-muted">Crit</span>
                    <span className="float-right">{getDexterityCritChance(unit)}%</span>
                </div>
                <div className="card">
                    <span className="text-muted">Armor</span>
                    <span className="float-right" style={isShielded ? { color: COLORS.shieldedText } : undefined}>
                        {displayArmor}
                        {isShielded && <span style={{ fontSize: 10, marginLeft: 4 }}>(×2)</span>}
                    </span>
                </div>
                <div className="card">
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

            <div
                className={`toggle-row ${unit.aiEnabled ? "active" : ""}`}
                onClick={() => onToggleAI(unitId)}
            >
                <span style={{ color: unit.aiEnabled ? "#4ade80" : "#888" }}>Auto-Battle</span>
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

function SkillTooltip({ skill, isShielded, cantripUses }: { skill: Skill; isShielded: boolean; cantripUses?: number }) {
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
            lines.push({ label: "Damage", value: `${skill.damageRange![0]}-${skill.damageRange![1]} × ${skill.hitCount}`, color: dmgInfo.color });
            lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
            lines.push({ label: "Missiles", value: `${skill.hitCount} (up to ${skill.hitCount} targets)`, color: "#9966ff" });
        } else {
            lines.push({ label: "Damage", value: `${skill.damageRange![0]}-${skill.damageRange![1]}`, color: dmgInfo.color });
            lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
        }
    } else if (skill.type === "heal") {
        lines.push({ label: "Heal", value: `${skill.healRange![0]}-${skill.healRange![1]}`, color: COLORS.hpHigh });
    } else if (skill.type === "taunt") {
        lines.push({ label: "Taunt chance", value: `${skill.tauntChance}%` });
        lines.push({ label: "Radius", value: `${skill.range}`, color: "#ff6600" });
    } else if (skill.type === "buff") {
        const durationSec = Math.round(skill.duration! / 1000);
        // Different buff types have different effects
        if (skill.name === "Raise Shield") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.shieldedText });
            lines.push({ label: "Effect", value: "×2 armor, ×2 cooldowns", color: COLORS.shieldedText });
        } else if (skill.name === "Divine Lattice") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.divineLatticeText });
            lines.push({ label: "Effect", value: "Impervious to all damage", color: COLORS.divineLatticeText });
            lines.push({ label: "Lockout", value: "Cannot use skills or attack", color: COLORS.divineLatticeText });
            lines.push({ label: "Enemy AI", value: "Ignored while active", color: COLORS.divineLatticeText });
            lines.push({ label: "Target", value: "Any unit", color: COLORS.divineLatticeText });
        } else if (skill.name === "Pangolin Stance") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.thornsText });
            const minThorns = skill.damageRange?.[0] ?? 2;
            const maxThorns = skill.damageRange?.[1] ?? 4;
            lines.push({ label: "Thorns", value: `${minThorns}-${maxThorns} melee reflect`, color: COLORS.thornsText });
        } else if (skill.name === "Highland Defense") {
            lines.push({ label: "Duration", value: "Until 50 absorbed", color: COLORS.highlandDefenseText });
            lines.push({ label: "Effect", value: "Nearby ally damage is redirected", color: COLORS.highlandDefenseText });
            lines.push({ label: "Redirect", value: "50% damage to barbarian", color: COLORS.highlandDefenseText });
            lines.push({ label: "Trigger", value: "Once every 5s", color: COLORS.highlandDefenseText });
            lines.push({ label: "Range", value: "4.5", color: COLORS.highlandDefenseText });
        } else if (skill.name === "Vanquishing Light") {
            lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.dmgHoly });
            lines.push({ label: "Aura radius", value: `${skill.range}`, color: COLORS.dmgHoly });
            lines.push({ label: "Holy/tick", value: `${skill.damagePerTick ?? 0}`, color: COLORS.dmgHoly });
            lines.push({ label: "Blind chance", value: `${skill.blindChance ?? 0}%`, color: COLORS.blindText });
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
        lines.push({ label: "Damage", value: `${skill.damageRange![0]}-${skill.damageRange![1]} × ${skill.hitCount ?? 5}`, color: dmgInfo.color });
        lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
        lines.push({ label: "Targets", value: `Up to ${skill.hitCount ?? 5} nearby` });
        lines.push({ label: "Radius", value: `${skill.range}`, color: "#ff6600" });
    } else if (skill.type === "debuff") {
        const durationSec = Math.round(skill.duration! / 1000);
        lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.stunnedText });
        if (skill.stunChance) {
            lines.push({ label: "Stun chance", value: `${skill.stunChance}%`, color: COLORS.stunnedText });
        }
    } else if (skill.type === "trap") {
        const durationSec = Math.round(skill.duration! / 1000);
        lines.push({ label: "Pin duration", value: `${durationSec}s`, color: "#c0392b" });
    } else if (skill.type === "sanctuary") {
        lines.push({ label: "Heal/tick", value: `${skill.healPerTick}`, color: COLORS.hpHigh });
        lines.push({ label: "Effect", value: "Dispels acid", color: "#9acd32" });
    } else if (skill.type === "mana_transfer") {
        lines.push({ label: "Mana given", value: `${skill.manaRange![0]}-${skill.manaRange![1]}`, color: COLORS.mana });
        if (skill.selfDamage) {
            lines.push({ label: "HP cost", value: `${skill.selfDamage[0]}-${skill.selfDamage[1]} over time`, color: COLORS.damageEnemy });
        }
    } else if (skill.type === "smite") {
        // Instant-hit single-target damage (e.g., Thunder)
        const dmgInfo = getDamageTypeInfo(skill.damageType);
        lines.push({ label: "Damage", value: `${skill.damageRange![0]}-${skill.damageRange![1]}`, color: dmgInfo.color });
        lines.push({ label: "Type", value: dmgInfo.name, color: dmgInfo.color });
        if (skill.name === "Chain Lightning") {
            lines.push({ label: "Chains", value: "3 bounces", color: COLORS.dmgLightning });
            lines.push({ label: "Bounce dmg", value: "Each bounce deals 50% of prior hit", color: COLORS.dmgLightning });
        }
    } else if (skill.type === "aoe_buff") {
        // AOE ally buff (e.g., Defiance)
        const durationSec = Math.round(skill.duration! / 1000);
        const armorBonus = skill.armorBonus;
        lines.push({ label: "Duration", value: `${durationSec}s`, color: COLORS.defianceText });
        lines.push({ label: "Armor bonus", value: `+${armorBonus}`, color: COLORS.defianceText });
        lines.push({ label: "Cooldown buff", value: "×0.5", color: COLORS.defianceText });
        lines.push({ label: "Radius", value: `${skill.range}`, color: "#ff6600" });
    } else if (skill.type === "energy_shield") {
        // Self-buff that absorbs damage
        const durationSec = Math.round(skill.duration! / 1000);
        lines.push({ label: "Shield HP", value: `${skill.shieldAmount}`, color: "#9b59b6" });
        lines.push({ label: "Duration", value: `${durationSec}s`, color: "#9b59b6" });
        lines.push({ label: "Weakness", value: "Chaos ×2 penetration", color: COLORS.dmgChaos });
    } else if (skill.type === "dodge") {
        if (skill.name === "Body Swap") {
            lines.push({ label: "Effect", value: "Swap places with ally or enemy", color: "#8e44ad" });
            lines.push({ label: "Swap range", value: `${skill.range}`, color: "#8e44ad" });
            lines.push({ label: "Target", value: "Any living unit", color: "#8e44ad" });
        } else {
            const durationSec = Math.round(skill.duration! / 1000 * 10) / 10;
            lines.push({ label: "Invul", value: `${durationSec}s`, color: "#8e44ad" });
            lines.push({ label: "Dash range", value: `${skill.range}`, color: "#8e44ad" });
        }
    } else if (skill.type === "summon") {
        lines.push({ label: "Effect", value: "Summons Ancestor warrior", color: "#d7c09a" });
        lines.push({ label: "Limit", value: "1 active summon", color: "#d7c09a" });
    }

    // Range (skip for self-targeted AOE skills that use range as radius, and dodge which shows it inline)
    const skipRange = skill.type === "dodge" || (skill.targetType === "self" && (skill.type === "taunt" || skill.type === "flurry" || skill.type === "aoe_buff"));
    if (skill.range > 0 && !skipRange) {
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
    if (skill.knockbackDistance) {
        lines.push({ label: "Knockback", value: `${skill.knockbackDistance}`, color: "#cfe8dc" });
    }
    if (skill.stunChance && skill.type !== "debuff") {
        lines.push({ label: "Stun chance", value: `${skill.stunChance}%`, color: COLORS.stunnedText });
    }
    if (skill.damagePerTick && skill.type !== "sanctuary") {
        lines.push({ label: "Damage/tick", value: `${skill.damagePerTick}`, color: COLORS.dmgHoly });
    }
    if (skill.tickInterval && skill.tickInterval > 0) {
        const tickSeconds = Math.round((skill.tickInterval / 1000) * 10) / 10;
        lines.push({ label: "Tick", value: `${tickSeconds}s`, color: COLORS.logNeutral });
    }
    if (skill.blindChance) {
        lines.push({ label: "Blind chance", value: `${skill.blindChance}%`, color: COLORS.blindText });
    }
    if (skill.blindDuration) {
        const blindSeconds = Math.round((skill.blindDuration / 1000) * 10) / 10;
        lines.push({ label: "Blind duration", value: `${blindSeconds}s`, color: COLORS.blindText });
    }

    if (skill.critChanceOverride !== undefined) {
        lines.push({ label: "Crit chance", value: `${skill.critChanceOverride}%`, color: COLORS.damageCrit });
    }

    if (skill.onHitEffect) {
        const effectDurationSec = Math.round((skill.onHitEffect.duration / 1000) * 10) / 10;
        if (skill.onHitEffect.type === "stun") {
            lines.push({ label: "On hit", value: `Stun (${skill.onHitEffect.chance}%)`, color: COLORS.stunnedText });
            lines.push({ label: "Stun duration", value: `${effectDurationSec}s`, color: COLORS.stunnedText });
        } else if (skill.onHitEffect.type === "attack_down") {
            lines.push({ label: "On hit", value: `Weaken (${skill.onHitEffect.chance}%)`, color: COLORS.weakenedText });
            lines.push({ label: "Debuff duration", value: `${effectDurationSec}s`, color: COLORS.weakenedText });
        } else if (skill.onHitEffect.type === "move_slow") {
            lines.push({ label: "On hit", value: `Hamstring (${skill.onHitEffect.chance}%)`, color: COLORS.hamstrungText });
            lines.push({ label: "Debuff duration", value: `${effectDurationSec}s`, color: COLORS.hamstrungText });
        }
    }

    // Mana cost
    if (skill.manaCost > 0) {
        lines.push({ label: "Mana", value: `${skill.manaCost}`, color: COLORS.mana });
    }

    // Cooldown (skip for cantrips — they use charges)
    if (!skill.isCantrip) {
        lines.push({
            label: "Cooldown",
            value: isShielded ? `${effectiveCooldown}s (×2)` : `${baseCooldown}s`,
            color: isShielded ? COLORS.shieldedText : undefined
        });
    }

    // Cantrip uses
    if (cantripUses !== undefined) {
        lines.push({ label: "Uses", value: `${cantripUses} remaining`, color: "#8e44ad" });
    }

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

function SkillCard({
    unitId, unit, skill, skillCooldowns, displayTime, paused, isShielded, isQueued, onCastSkill, unlearned, canLearn, onLearn
}: {
    unitId: number;
    unit: Unit;
    skill: Skill;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    displayTime: number;
    paused: boolean;
    isShielded: boolean;
    isQueued: boolean;
    onCastSkill?: (unitId: number, skill: Skill) => void;
    unlearned?: boolean;
    canLearn?: boolean;
    onLearn?: () => void;
}) {
    const cooldownKey = `${unitId}-${skill.name}`;
    const cooldownData = skillCooldowns[cooldownKey];
    const skillCooldownEnd = cooldownData?.end || 0;
    const cooldownDuration = Math.max(1, cooldownData?.duration || skill.cooldown);
    const skillOnCooldown = skillCooldownEnd > displayTime;
    const cooldownRemaining = skillOnCooldown ? Math.ceil((skillCooldownEnd - displayTime) / 1000) : 0;
    const cooldownScale = skillOnCooldown
        ? Math.max(0, Math.min(1, (skillCooldownEnd - displayTime) / cooldownDuration))
        : 0;
    const hasManaForSkill = (unit.mana ?? 0) >= skill.manaCost;
    const isBasicAttack = skill.name === "Attack";
    const isRanged = skill.range > 2;
    const cantripUses = skill.isCantrip ? (unit.cantripUses?.[skill.name] ?? 0) : undefined;
    const noUsesLeft = skill.isCantrip && cantripUses !== undefined && cantripUses <= 0;
    const canCast = !unlearned && hasManaForSkill && !noUsesLeft && unit.hp > 0;

    const skillColorClass = getSkillColorClass(skill.type);
    const skillBorderColor = getSkillBorderColor(skill.type);

    const cardClass = [
        "skill-card",
        !canCast && !isQueued && !unlearned ? "disabled" : "",
        isQueued ? "queued" : "",
        unlearned ? "unlearned" : "",
        unlearned && canLearn ? "can-learn" : ""
    ].filter(Boolean).join(" ");

    return (
        <Tippy
            content={<SkillTooltip skill={skill} isShielded={isShielded} cantripUses={cantripUses} />}
            placement="left"
            delay={[200, 0]}
            arrow={true}
        >
            <div
                className={cardClass}
                onClick={() => {
                    if (unlearned && canLearn && onLearn) onLearn();
                    else if (canCast) onCastSkill?.(unitId, skill);
                }}
                style={{
                    borderColor: unlearned ? undefined : (isQueued ? undefined : (canCast ? skillBorderColor : "#333"))
                }}
            >
                {!unlearned && skillOnCooldown && (
                    <div
                        className="skill-cooldown-overlay"
                        style={{
                            transform: `scaleX(${cooldownScale})`,
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
                    <div className="skill-header-right">
                        {!unlearned && cantripUses !== undefined && (
                            <span className="skill-uses-badge">{cantripUses} uses</span>
                        )}
                        {skill.manaCost > 0 && <span className="mana-cost">{skill.manaCost} MP</span>}
                        {unlearned && (
                            <span className={`skill-learn-tag ${canLearn ? "available" : ""}`}>
                                {canLearn ? "Learn" : "Locked"}
                            </span>
                        )}
                    </div>
                </div>
                {!unlearned && skillOnCooldown && (
                    <div className="skill-cooldown-text" style={isQueued ? { color: "#f59e0b" } : undefined}>
                        {cooldownRemaining}s{paused && " (paused)"}{isShielded && " (×2)"}
                    </div>
                )}
            </div>
        </Tippy>
    );
}

function SkillsTab({
    unitId, unit, skillCooldowns, displayTime, paused, queuedSkills, onCastSkill, onLearnSkill
}: {
    unitId: number;
    unit: Unit;
    skillCooldowns: Record<string, { end: number; duration: number }>;
    displayTime: number;
    paused: boolean;
    queuedSkills: string[];
    onCastSkill?: (unitId: number, skill: Skill) => void;
    onLearnSkill?: (unitId: number, skillName: string) => void;
}) {
    const isShielded = hasStatusEffect(unit, "shielded");
    const learnedSkills = getAllSkills(unitId, unit);
    const learnedSet = new Set((unit.learnedSkills ?? []).map(n => n));
    const availableSkills = getAvailableSkills(unitId);
    const skillPoints = unit.skillPoints ?? 0;

    const cantrips = learnedSkills.filter(s => s.isCantrip);
    const learnedRegular = learnedSkills.filter(s => !s.isCantrip);
    const unlearnedSkills = availableSkills.filter(s => !learnedSet.has(s.name));

    return (
        <div className="flex flex-col gap-8">
            <EffectsDisplay unit={unit} displayTime={displayTime} />

            {cantrips.length > 0 && (
                <>
                    <div className="skills-section-label">Cantrips</div>
                    {cantrips.map((skill: Skill, i: number) => (
                        <SkillCard
                            key={`cantrip-${i}`}
                            unitId={unitId}
                            unit={unit}
                            skill={skill}
                            skillCooldowns={skillCooldowns}
                            displayTime={displayTime}
                            paused={paused}
                            isShielded={isShielded}
                            isQueued={queuedSkills.includes(skill.name)}
                            onCastSkill={onCastSkill}
                        />
                    ))}
                </>
            )}

            {learnedRegular.length > 0 && (
                <>
                    <div className="skills-section-label">Skills</div>
                    {learnedRegular.map((skill: Skill, i: number) => (
                        <SkillCard
                            key={`skill-${i}`}
                            unitId={unitId}
                            unit={unit}
                            skill={skill}
                            skillCooldowns={skillCooldowns}
                            displayTime={displayTime}
                            paused={paused}
                            isShielded={isShielded}
                            isQueued={queuedSkills.includes(skill.name)}
                            onCastSkill={onCastSkill}
                        />
                    ))}
                </>
            )}

            {unlearnedSkills.length > 0 && (
                <>
                    <div className="skills-section-label">
                        <span>Unlearned</span>
                        {skillPoints > 0 && <span className="skill-points-badge">{skillPoints} pts</span>}
                    </div>
                    {unlearnedSkills.map((skill: Skill, i: number) => (
                        <SkillCard
                            key={`unlearned-${i}`}
                            unitId={unitId}
                            unit={unit}
                            skill={skill}
                            skillCooldowns={skillCooldowns}
                            displayTime={displayTime}
                            paused={paused}
                            isShielded={false}
                            isQueued={false}
                            unlearned
                            canLearn={skillPoints > 0}
                            onLearn={() => onLearnSkill?.(unitId, skill.name)}
                        />
                    ))}
                </>
            )}
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
    holy: "#ffffff",
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
    units,
    displayTime,
    consumableCooldownEnd,
    onUseConsumable,
    queuedSkills = [],
    gold = 0,
}: {
    unit: Unit;
    units: Unit[];
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
    const hasDeadAllies = units.some(u => u.team === "player" && u.hp <= 0);

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
                const isRevive = item.effect === "revive";

                // Check if using would be wasteful
                let wouldBeWasted = false;
                if (unitAlive) {
                    if (item.effect === "heal") {
                        const maxHp = getEffectiveMaxHp(unit.id, unit);
                        wouldBeWasted = unit.hp >= maxHp;
                    } else if (item.effect === "mana") {
                        const maxMana = getEffectiveMaxMana(unit.id, unit);
                        wouldBeWasted = (unit.mana ?? 0) >= maxMana;
                    } else if (isRevive) {
                        wouldBeWasted = !hasDeadAllies;
                    }
                }

                // Can click if alive and not wasted (can queue even on cooldown)
                const canClick = unitAlive && !wouldBeWasted;

                const effectColor = item.effect === "heal" ? COLORS.hpHigh : item.effect === "mana" ? COLORS.mana : isRevive ? "#ffd700" : "#9b59b6";
                const effectLabel = item.effect === "heal" ? "HP" : item.effect === "mana" ? "Mana" : isRevive ? "" : "Experience";
                const itemClass = `inventory-item-row ${!canClick && !isQueued ? "disabled" : ""} ${wouldBeWasted ? "wasted" : ""} ${isQueued ? "queued" : ""}`;

                return (
                    <Tippy
                        key={entry.itemId}
                        content={
                            <div className="consumable-tooltip">
                                <div className="consumable-tooltip-desc">{item.description}</div>
                                {isRevive ? (
                                    <div className="consumable-tooltip-row">
                                        <span className="consumable-tooltip-value" style={{ color: effectColor }}>
                                            Revive to {item.value} HP
                                        </span>
                                    </div>
                                ) : (
                                    <div className="consumable-tooltip-row">
                                        <span className="consumable-tooltip-label">Restores</span>
                                        <span className="consumable-tooltip-value" style={{ color: effectColor }}>
                                            {item.value} {effectLabel}
                                        </span>
                                    </div>
                                )}
                                {wouldBeWasted && isRevive && (
                                    <div className="consumable-tooltip-warning">No fallen allies</div>
                                )}
                                {wouldBeWasted && !isRevive && (
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
                                    {isRevive ? "Revive" : `+${item.value} ${effectLabel}`}
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
