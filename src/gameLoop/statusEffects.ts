// =============================================================================
// STATUS EFFECT PROCESSING - Poison ticks, buff durations
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText } from "../core/types";
import { COLORS } from "../core/constants";
import { getUnitStats } from "../game/units";
import { spawnDamageNumber, handleUnitDefeat } from "../combat/combat";

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
        if (unit.hp <= 0 || defeatedThisFrame.has(unit.id)) return;
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

                    hitFlashRef[unit.id] = now;
                    spawnDamageNumber(scene, unitG.position.x, unitG.position.z, dmg, COLORS.poisonText, damageTexts);
                    addLog(`${data.name} takes ${dmg} poison damage.`, COLORS.poisonText);

                    if (wasDefeated) {
                        defeatedThisFrame.add(unit.id);
                        handleUnitDefeat(unit.id, unitG, unitsRef, addLog, data.name);
                    }
                }
            } else if (effect.type === "shielded" || effect.type === "stunned" || effect.type === "cleansed" || effect.type === "pinned") {
                // Shielded/stunned/cleansed/pinned buff - tick down duration at fixed interval (like poison)
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
