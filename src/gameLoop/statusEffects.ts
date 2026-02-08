// =============================================================================
// STATUS EFFECT PROCESSING - Poison ticks, buff durations
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, StatusEffect, StatusEffectType } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats, getEffectiveMaxHp } from "../game/units";
import { handleUnitDefeat, showDamageVisual } from "../combat/damageEffects";
import { isUnitAlive } from "../combat/combatMath";

// =============================================================================
// DOT VISUAL CONFIG (for effects that deal damage)
// =============================================================================

/** Visual config for damage-over-time effects - keyed by effect type */
const DOT_VISUAL_CONFIG: Partial<Record<StatusEffectType, { color: string; messageTemplate: (name: string, dmg: number) => string }>> = {
    poison: { color: COLORS.poisonText, messageTemplate: (name, dmg) => `${name} takes ${dmg} poison damage.` },
    qi_drain: { color: "#9b59b6", messageTemplate: (name, dmg) => `${name} loses ${dmg} HP from Qi drain.` }
};

// =============================================================================
// EFFECT UPDATE HELPERS
// =============================================================================

/**
 * Tick an effect: decrement duration and reset timeSinceTick.
 * Returns the updated statusEffects array with expired effects removed.
 */
function tickEffect(
    effects: StatusEffect[],
    effectType: StatusEffectType,
    now: number,
    tickInterval: number
): StatusEffect[] {
    return effects.map(e => {
        if (e.type === effectType) {
            const newDuration = e.duration - tickInterval;
            return { ...e, duration: newDuration, timeSinceTick: 0, lastUpdateTime: now };
        }
        return { ...e, lastUpdateTime: now };
    }).filter(e => e.duration > 0);
}

/**
 * Update timeSinceTick for an effect without ticking (between tick intervals).
 */
function updateEffectTime(
    effects: StatusEffect[],
    effectType: StatusEffectType,
    newTimeSinceTick: number,
    now: number
): StatusEffect[] {
    return effects.map(e => {
        if (e.type === effectType) {
            return { ...e, timeSinceTick: newTimeSinceTick, lastUpdateTime: now };
        }
        return e;
    });
}

// =============================================================================
// STATUS EFFECT PROCESSING
// =============================================================================

export function processStatusEffects(
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    scene: THREE.Scene,
    damageTexts: DamageText[],
    hitFlashRef: Record<number, number>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    addLog: (text: string, color?: string) => void,
    now: number,
    defeatedThisFrame: Set<number>
): void {
    unitsState.forEach(unit => {
        if (!isUnitAlive(unit, defeatedThisFrame)) return;
        if (!unit.statusEffects || unit.statusEffects.length === 0) return;

        const unitG = unitsRef[unit.id];
        if (!unitG) return;

        const data = getUnitStats(unit);

        unit.statusEffects.forEach(effect => {
            // All effects with duration tick down automatically
            // Calculate delta time for pause-safe accumulation
            // Cap delta to prevent pause/unpause from causing instant multi-ticks
            const rawDelta = now - effect.lastUpdateTime;
            const delta = Math.min(rawDelta, 100); // Max 100ms per frame
            const newTimeSinceTick = effect.timeSinceTick + delta;
            const shouldTick = newTimeSinceTick >= effect.tickInterval;

            // Check if this effect deals damage (DOT effect)
            const dealsDamage = effect.damagePerTick > 0;

            if (shouldTick) {
                if (dealsDamage) {
                    // Damage-over-time effect: deal damage and tick duration
                    const dmg = effect.damagePerTick;
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;
                        const updatedEffects = tickEffect(u.statusEffects || [], effect.type, now, effect.tickInterval);
                        return {
                            ...u,
                            hp: newHp,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));

                    // Show damage visual if we have config for this effect type
                    const config = DOT_VISUAL_CONFIG[effect.type];
                    if (config) {
                        showDamageVisual(scene, unit.id, unitG.position.x, unitG.position.z, dmg, config.color, hitFlashRef, damageTexts, addLog, config.messageTemplate(data.name, dmg), now);
                    }

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                } else if (effect.type === "regen") {
                    // Regen effect: heal per tick (healPerTick stored in shieldAmount)
                    const healPerTick = effect.shieldAmount ?? 0;
                    const maxHp = unit.team === "player"
                        ? getEffectiveMaxHp(unit.id, unit)
                        : data.hp;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        const newHp = Math.min(maxHp, u.hp + healPerTick);
                        const updatedEffects = tickEffect(u.statusEffects || [], effect.type, now, effect.tickInterval);
                        return {
                            ...u,
                            hp: newHp,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));

                    if (healPerTick > 0) {
                        showDamageVisual(scene, unit.id, unitG.position.x, unitG.position.z, healPerTick, COLORS.hpHigh, hitFlashRef, damageTexts, addLog, `${data.name} regenerates ${healPerTick} HP.`, now);
                    }
                } else if (effect.type === "doom" && effect.duration - effect.tickInterval <= 0) {
                    // Doom expiration: kill the unit instantly
                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        return { ...u, hp: 0, statusEffects: undefined };
                    }));
                    defeatedThisFrame.add(unit.id);
                    handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    addLog(`${data.name} succumbs to Doom!`, COLORS.doomText);
                } else {
                    // Pure duration effect: just tick down duration
                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;
                        const updatedEffects = tickEffect(u.statusEffects || [], effect.type, now, effect.tickInterval);
                        return {
                            ...u,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));
                }
            } else {
                // Not time to tick yet - just update accumulated time
                setUnits(prev => prev.map(u => {
                    if (u.id !== unit.id) return u;
                    return { ...u, statusEffects: updateEffectTime(u.statusEffects || [], effect.type, newTimeSinceTick, now) };
                }));
            }
        });
    });
}
