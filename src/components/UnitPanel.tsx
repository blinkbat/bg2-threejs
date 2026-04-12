import Tippy from "@tippyjs/react";
import type { Unit, StatusEffect, CharacterStats } from "../core/types";
import { UNIT_DATA, getEffectiveUnitData, getEffectiveMaxHp, getEffectiveMaxMana, getXpForLevel } from "../game/playerUnits";
import { getPlayerUnitColor } from "../game/unitColors";
import { getHpPercentage, getHpColor, getMana, hasStatusEffect, getEffectiveArmor } from "../combat/combatMath";
import { getTotalCritChance } from "../combat/combatMath";
import { COLORS } from "../core/constants";
import { useDisplayTime } from "../hooks/useDisplayTime";
import { getPortrait } from "./portraitRegistry";

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
    paused?: boolean;
    onOpenEquipment?: (unitId: number) => void;
    onOpenSkillTree?: (unitId: number) => void;
    onOpenItems?: (unitId: number) => void;
    equipmentModalOpen?: boolean;
    skillTreeModalOpen?: boolean;
    itemsModalOpen?: boolean;
    onIncrementStat?: (unitId: number, stat: keyof CharacterStats) => void;
}

export function UnitPanel({
    unitId,
    units,
    onClose,
    onToggleAI,
    paused = false,
    onOpenEquipment,
    onOpenSkillTree,
    onOpenItems,
    equipmentModalOpen = false,
    skillTreeModalOpen = false,
    itemsModalOpen = false,
    onIncrementStat,
}: UnitPanelProps) {
    const displayTime = useDisplayTime(paused, 50);
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
            <div className="unit-panel-header" style={{ backgroundColor: getPlayerUnitColor(unitId), "--header-bg-image": `url(${getPortrait(data.class)})`, "--header-bg-pos": PORTRAIT_POS[data.class] ?? "center bottom" } as React.CSSProperties}>
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

            <div className="panel-toggle-bar">
                <Tippy content="Click or press K to open" placement="top" delay={[400, 0]}>
                    <button
                        type="button"
                        className={`panel-toggle-btn ${skillTreeModalOpen ? "active" : ""}`}
                        onClick={() => onOpenSkillTree?.(unitId)}
                    >
                        skills{(unit.skillPoints ?? 0) > 0 && <span className="tab-dot" />}
                    </button>
                </Tippy>
                <Tippy content="Click or press E to open" placement="top" delay={[400, 0]}>
                    <button
                        type="button"
                        className={`panel-toggle-btn ${equipmentModalOpen ? "active" : ""}`}
                        onClick={() => onOpenEquipment?.(unitId)}
                    >
                        equipment
                    </button>
                </Tippy>
                <Tippy content="Click or press I to open" placement="top" delay={[400, 0]}>
                    <button
                        type="button"
                        className={`panel-toggle-btn ${itemsModalOpen ? "active" : ""}`}
                        onClick={() => onOpenItems?.(unitId)}
                    >
                        items
                    </button>
                </Tippy>
            </div>

            <div className="unit-content">
                <StatusTab unit={unit} effectiveData={effectiveData} onToggleAI={onToggleAI} unitId={unitId} onIncrementStat={onIncrementStat} displayTime={displayTime} />
            </div>
        </div>
    );
}

const STAT_INFO: Record<keyof CharacterStats, { label: string; name: string; color: string; bonuses: { desc: string; rate: string }[] }> = {
    strength: {
        label: "STR",
        name: "Strength",
        color: "var(--ui-color-accent-danger)",
        bonuses: [{ desc: "Physical Damage", rate: "+1 per 2 pts" }]
    },
    dexterity: {
        label: "DEX",
        name: "Dexterity",
        color: "var(--ui-color-accent-success)",
        bonuses: [
            { desc: "Hit Chance", rate: "+1% per 2 pts" },
            { desc: "Crit Chance", rate: "+1% per 2 pts" }
        ]
    },
    vitality: {
        label: "VIT",
        name: "Vitality",
        color: "var(--ui-color-accent-warning)",
        bonuses: [{ desc: "Max HP", rate: "+1 per pt" }]
    },
    intelligence: {
        label: "INT",
        name: "Intelligence",
        color: "var(--ui-color-accent-arcane)",
        bonuses: [
            { desc: "Max Mana", rate: "+1 per pt" },
            { desc: "Magic Damage", rate: "+1 per 2 pts" }
        ]
    },
    faith: {
        label: "FAI",
        name: "Faith",
        color: "var(--ui-color-accent-gold)",
        bonuses: [
            { desc: "Holy Damage", rate: "+1 per 2 pts" },
            { desc: "Healing Power", rate: "+1 per 2 pts" }
        ]
    }
};

/** Effect metadata for display */
const EFFECT_INFO: Record<string, { icon: string; color: string; description: string }> = {
    burn: { icon: "F", color: COLORS.burnText, description: "Taking heavy fire damage over time" },
    poison: { icon: "☠", color: COLORS.poisonText, description: "Taking damage over time" },
    shielded: { icon: "🛡", color: COLORS.shieldedText, description: "Armor doubled, cooldowns doubled" },
    stunned: { icon: "💫", color: COLORS.stunnedText, description: "Cannot act" },
    cleansed: { icon: "✨", color: COLORS.cleansedText, description: "Immune to poison" },
    defiance: { icon: "⚔", color: COLORS.defianceText, description: "+2 armor, cooldowns halved" },
    pinned: { icon: "📌", color: "var(--ui-color-accent-danger)", description: "Cannot move" },
    slowed: { icon: "🐌", color: "var(--ui-color-accent-primary)", description: "Move speed halved, cooldowns +50%" },
    energy_shield: { icon: "🔮", color: "var(--ui-color-accent-arcane)", description: "Absorbs damage" },
    qi_drain: { icon: "💔", color: "var(--ui-color-accent-danger)", description: "Life force draining" },
    doom: { icon: "💀", color: COLORS.doomText, description: "Death in 10s — cure with Restoration" },
    regen: { icon: "💚", color: COLORS.hpHigh, description: "Healing over time" },
    invul: { icon: "✦", color: "var(--ui-color-accent-arcane)", description: "Immune to all damage" },
    silenced: { icon: "S", color: COLORS.silencedText, description: "Cannot use spell skills" },
    sun_stance: { icon: "☀", color: COLORS.sunStanceText, description: "Attacks deal bonus fire damage" },
    thorns: { icon: "✹", color: COLORS.thornsText, description: "Reflects melee damage to attackers" },
    highland_defense: { icon: "⛰", color: COLORS.highlandDefenseText, description: "Redirects nearby ally damage to the barbarian" },
    divine_lattice: { icon: "◈", color: COLORS.divineLatticeText, description: "Impervious to damage; cannot act; ignored by enemies" },
    constricted: { icon: "C", color: COLORS.constrictedText, description: "Attack and skill cooldowns lengthened" },
    hamstrung: { icon: "L", color: COLORS.hamstrungText, description: "Move speed reduced" },
    blind: { icon: "B", color: COLORS.blindText, description: "Hit chance heavily reduced" },
    vanquishing_light: { icon: "⊕", color: COLORS.dmgHoly, description: "Holy aura damages nearby foes and may blind" },
    sleep: { icon: "💤", color: COLORS.sleepText, description: "Cannot act — wakes on damage" },
    chilled: { icon: "❄", color: COLORS.chilledText, description: "Move speed halved, cooldowns doubled" },
    enraged: { icon: "💢", color: COLORS.enragedText, description: "Increased speed and damage" },
    feared: { icon: "😱", color: COLORS.fearedText, description: "Fleeing in terror" },
    blood_marked: { icon: "🩸", color: COLORS.bloodMarkedText, description: "Melee hits against this target heal the attacker" },
    channeling: { icon: "◎", color: COLORS.channelingText, description: "Channeling arcane energy — nearby allies cast faster" },
    channeled: { icon: "◉", color: COLORS.channeledText, description: "Benefiting from arcane channeling" },
};

/** Renders active status effects as inline icons with tooltips */
function EffectsDisplay({ unit, displayTime }: { unit: Unit; displayTime: number }) {
    if (!unit.statusEffects || unit.statusEffects.length === 0) return null;

    return (
        <div className="effects-inline">
            {unit.statusEffects.map((effect: StatusEffect, i: number) => {
                const remainingSec = Math.ceil(effect.duration / 1000);
                const info = EFFECT_INFO[effect.type] || { icon: "?", color: "var(--ui-color-text-dim)", description: "Unknown effect" };
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
                                {effect.type === "energy_shield" && effect.shieldAmount !== undefined && (
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
                <div className="level-badge">Level {level}</div>
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
                    <span className="float-right">{getTotalCritChance(unit)}%</span>
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
                                placement="bottom"
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
                <span style={{ color: unit.aiEnabled ? "var(--ui-color-accent-success-bright)" : "var(--ui-color-text-dim)" }}>Auto-Attack</span>
                <span className={`toggle-track ${unit.aiEnabled ? "active" : ""}`}>
                    <span className={`toggle-thumb ${unit.aiEnabled ? "active" : ""}`} />
                </span>
            </div>
        </div>
    );
}



