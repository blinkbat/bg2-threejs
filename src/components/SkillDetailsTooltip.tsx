import type { Skill, Unit } from "../core/types";
import { getDamageTypeColor, getSkillTextColor } from "../core/constants";
import { resolveSkillDisplay, type ResolvedRange } from "../game/statDisplay";

interface SkillDetailsTooltipProps {
    skill: Skill;
    unit?: Unit;
    /** Extra status lines rendered after stats (e.g. "On cooldown", "Not yet learned"). */
    footer?: React.ReactNode;
    /** Hotkey / action hint rendered at the very bottom. */
    hint?: React.ReactNode;
}

function formatRange(range: [number, number]): string {
    return range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`;
}

function BaseRow({ range }: { range: ResolvedRange }) {
    if (range.bonus === 0) return null;
    return (
        <div className="skill-tooltip-row" style={{ opacity: 0.55, color: "var(--ui-color-text-dim)" }}>
            <span className="skill-tooltip-label"></span>
            <span className="skill-tooltip-value">(base {formatRange(range.base)})</span>
        </div>
    );
}

export function SkillDetailsTooltip({ skill, unit, footer, hint }: SkillDetailsTooltipProps) {
    const display = resolveSkillDisplay(unit, skill);
    const nameColor = getSkillTextColor(skill.type, skill.damageType);
    const kindLabel = skill.isCantrip
        ? `${skill.kind === "spell" ? "Spell" : "Ability"} Cantrip`
        : skill.kind === "spell" ? "Spell" : "Ability";
    const dmgColor = getDamageTypeColor(skill.damageType);
    const dmgTypeLabel = skill.damageType[0].toUpperCase() + skill.damageType.slice(1);

    return (
        <div className="skill-tooltip">
            <div className="skill-tooltip-row">
                <span className="skill-tooltip-label">{kindLabel}</span>
                <span className="skill-tooltip-value" style={{ color: nameColor }}>{skill.name}</span>
            </div>
            {skill.description && (
                <div className="skill-tooltip-desc">{skill.description}</div>
            )}
            {display.damage && (
                <>
                    <div className="skill-tooltip-row">
                        <span className="skill-tooltip-label">Damage</span>
                        <span className="skill-tooltip-value" style={{ color: dmgColor }}>
                            {formatRange(display.damage.effective)} {dmgTypeLabel}
                        </span>
                    </div>
                    <BaseRow range={display.damage} />
                </>
            )}
            {display.heal && (
                <>
                    <div className="skill-tooltip-row">
                        <span className="skill-tooltip-label">Heal</span>
                        <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-success)" }}>
                            {formatRange(display.heal.effective)}
                        </span>
                    </div>
                    <BaseRow range={display.heal} />
                </>
            )}
            {skill.shieldAmount !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Shield</span>
                    <span className="skill-tooltip-value">{skill.shieldAmount} HP</span>
                </div>
            )}
            {display.manaCost > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Mana</span>
                    <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-primary-bright)" }}>{display.manaCost}</span>
                </div>
            )}
            {display.damage && display.hitChance !== null && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Hit</span>
                    <span className="skill-tooltip-value">{display.hitChance}%</span>
                </div>
            )}
            {display.damage && display.critChance !== null && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Crit</span>
                    <span className="skill-tooltip-value">{display.critChance}%</span>
                </div>
            )}
            <div className="skill-tooltip-row">
                <span className="skill-tooltip-label">Cooldown</span>
                <span className="skill-tooltip-value">{(display.cooldownMs / 1000).toFixed(1)}s</span>
            </div>
            {skill.range > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Range</span>
                    <span className="skill-tooltip-value">{skill.range}</span>
                </div>
            )}
            {skill.aoeRadius !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">AoE Radius</span>
                    <span className="skill-tooltip-value">{skill.aoeRadius}</span>
                </div>
            )}
            {skill.duration !== undefined && skill.duration > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Duration</span>
                    <span className="skill-tooltip-value">{(skill.duration / 1000).toFixed(0)}s</span>
                </div>
            )}
            {skill.hitCount !== undefined && skill.hitCount > 1 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Hits</span>
                    <span className="skill-tooltip-value">{skill.hitCount}</span>
                </div>
            )}
            {skill.burnChance !== undefined && skill.burnChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Burn chance</span>
                    <span className="skill-tooltip-value" style={{ color: getDamageTypeColor("fire") }}>{skill.burnChance}%</span>
                </div>
            )}
            {skill.poisonChance !== undefined && skill.poisonChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Poison chance</span>
                    <span className="skill-tooltip-value" style={{ color: "var(--ui-color-accent-success)" }}>{skill.poisonChance}%</span>
                </div>
            )}
            {skill.stunChance !== undefined && skill.stunChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Stun chance</span>
                    <span className="skill-tooltip-value">{skill.stunChance}%</span>
                </div>
            )}
            {skill.chillChance !== undefined && skill.chillChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Chill chance</span>
                    <span className="skill-tooltip-value" style={{ color: getDamageTypeColor("cold") }}>{skill.chillChance}%</span>
                </div>
            )}
            {skill.blindChance !== undefined && skill.blindChance > 0 && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Blind chance</span>
                    <span className="skill-tooltip-value">{skill.blindChance}%</span>
                </div>
            )}
            {skill.knockbackDistance !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Knockback</span>
                    <span className="skill-tooltip-value">{skill.knockbackDistance}</span>
                </div>
            )}
            {skill.isCantrip && skill.maxUses !== undefined && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Cantrip uses</span>
                    <span className="skill-tooltip-value">{skill.maxUses}</span>
                </div>
            )}
            {skill.targetType === "ally" && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Target</span>
                    <span className="skill-tooltip-value">Ally</span>
                </div>
            )}
            {skill.targetType === "self" && (
                <div className="skill-tooltip-row">
                    <span className="skill-tooltip-label">Target</span>
                    <span className="skill-tooltip-value">Self</span>
                </div>
            )}
            {footer}
            {skill.flavor && (
                <div className="skill-tooltip-flavor">{skill.flavor}</div>
            )}
            {hint}
        </div>
    );
}
