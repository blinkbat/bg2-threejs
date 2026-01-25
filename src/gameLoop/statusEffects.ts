// =============================================================================
// STATUS EFFECT PROCESSING - Poison ticks, buff durations
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { handleUnitDefeat, showDamageVisual } from "../combat/combat";
import { isUnitAlive } from "../combat/combatMath";

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
            if (effect.type === "poison") {
                // Check if it's time for a tick
                if (now - effect.lastTick >= effect.tickInterval) {
                    // Deal poison damage
                    const dmg = effect.damagePerTick;
                    // Track whether unit was defeated for post-update handling
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        // Calculate newHp from current state to avoid race condition
                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;

                        const updatedEffects = (u.statusEffects || []).map(e => {
                            if (e.type === "poison") {
                                const newDuration = e.duration - effect.tickInterval;
                                return { ...e, duration: newDuration, lastTick: now };
                            }
                            return e;
                        }).filter(e => e.duration > 0);

                        return {
                            ...u,
                            hp: newHp,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));

                    showDamageVisual(scene, unit.id, unitG.position.x, unitG.position.z, dmg, COLORS.poisonText, hitFlashRef, damageTexts, addLog, `${data.name} takes ${dmg} poison damage.`, now);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            } else if (effect.type === "qi_drain") {
                // Qi Drain - self-damage over time from Qi Focus
                if (now - effect.lastTick >= effect.tickInterval) {
                    const dmg = effect.damagePerTick;
                    let wasDefeated = false;

                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        const newHp = Math.max(0, u.hp - dmg);
                        wasDefeated = newHp <= 0;

                        const updatedEffects = (u.statusEffects || []).map(e => {
                            if (e.type === "qi_drain") {
                                const newDuration = e.duration - effect.tickInterval;
                                return { ...e, duration: newDuration, lastTick: now };
                            }
                            return e;
                        }).filter(e => e.duration > 0);

                        return {
                            ...u,
                            hp: newHp,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));

                    showDamageVisual(scene, unit.id, unitG.position.x, unitG.position.z, dmg, "#9b59b6", hitFlashRef, damageTexts, addLog, `${data.name} loses ${dmg} HP from Qi drain.`, now);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            } else if (effect.type === "shielded" || effect.type === "stunned" || effect.type === "cleansed" || effect.type === "pinned" || effect.type === "slowed") {
                // Shielded/stunned/cleansed/pinned/slowed buff - tick down duration at fixed interval (like poison)
                if (now - effect.lastTick >= effect.tickInterval) {
                    setUnits(prev => prev.map(u => {
                        if (u.id !== unit.id) return u;

                        const updatedEffects = (u.statusEffects || []).map(e => {
                            if (e.type === effect.type) {
                                const newDuration = e.duration - e.tickInterval;
                                return { ...e, duration: newDuration, lastTick: now };
                            }
                            return e;
                        }).filter(e => e.duration > 0);

                        return {
                            ...u,
                            statusEffects: updatedEffects.length > 0 ? updatedEffects : undefined
                        };
                    }));
                }
            }
        });
    });
}
