// =============================================================================
// STATUS EFFECT PROCESSING - Poison ticks, buff durations
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, DamageText, StatusEffect, StatusEffectType } from "../core/types";
import { COLORS, BUFF_TICK_INTERVAL, BLIND_DURATION } from "../core/constants";
import { getUnitStats } from "../game/units";
import { getEffectiveMaxHp } from "../game/playerUnits";
import { getUnitRadius, isInRange } from "../rendering/range";
import { applyDamageToUnit, buildDamageContext, handleUnitDefeat, showDamageVisual, spawnDamageNumber } from "../combat/damageEffects";
import { hasStatusEffect, isUnitAlive, rollChance, applyStatusEffect } from "../combat/combatMath";
import { getUnitById } from "../game/unitQuery";

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
 * Tick an effect in-place: decrement duration and reset timeSinceTick.
 * Returns true if the effect expired and should be removed.
 */
function tickEffectInPlace(effect: StatusEffect, now: number): boolean {
    effect.duration -= effect.tickInterval;
    effect.timeSinceTick = 0;
    effect.lastUpdateTime = now;
    return effect.duration <= 0;
}

/**
 * Update timeSinceTick for an effect in-place (between tick intervals).
 */
function updateEffectTimeInPlace(effect: StatusEffect, newTimeSinceTick: number, now: number): void {
    effect.timeSinceTick = newTimeSinceTick;
    effect.lastUpdateTime = now;
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
    // Phase 1: Collect all mutations from the snapshot
    interface UnitMutation {
        hpDelta: number;
        maxHp: number;
        doom: boolean;
        newEffects: StatusEffect[];
    }
    interface PendingBlind {
        effect: StatusEffect;
        targetName: string;
    }
    const mutations = new Map<number, UnitMutation>();
    // Side effects to run after the single setUnits call
    const sideEffects: Array<() => void> = [];
    const pendingBlinds = new Map<number, PendingBlind>();
    // Pre-filter alive enemies once for aura effects (avoids O(n²) re-scan per aura)
    let aliveEnemies: { unit: Unit; group: UnitGroup; radius: number }[] | null = null;
    const auraDamageCtx = buildDamageContext(
        scene,
        damageTexts,
        hitFlashRef,
        unitsRef,
        unitsState,
        setUnits,
        addLog,
        now,
        defeatedThisFrame
    );

    for (const unit of unitsState) {
        if (!isUnitAlive(unit, defeatedThisFrame)) continue;
        if (!unit.statusEffects || unit.statusEffects.length === 0) continue;

        const unitG = unitsRef[unit.id];
        if (!unitG) continue;

        const data = getUnitStats(unit);
        let hpDelta = 0;
        let doom = false;
        // Clone effects for in-place mutation — single pass, no intermediate arrays
        const currentEffects: StatusEffect[] = unit.statusEffects.map(e => ({ ...e }));
        const maxHp = unit.team === "player"
            ? getEffectiveMaxHp(unit.id, unit)
            : data.hp;
        const hasDivineLattice = hasStatusEffect(unit, "divine_lattice");

        for (const effect of currentEffects) {
            const rawDelta = now - effect.lastUpdateTime;
            const delta = Math.min(rawDelta, 100);
            const newTimeSinceTick = effect.timeSinceTick + delta;
            const shouldTick = newTimeSinceTick >= effect.tickInterval;
            const dealsDamage = effect.damagePerTick > 0;

            if (shouldTick) {
                if (effect.type === "vanquishing_light") {
                    tickEffectInPlace(effect, now);

                    const auraRadius = effect.auraRadius ?? 0;
                    const auraDamage = effect.damagePerTick;
                    const auraDamageType = effect.auraDamageType ?? "holy";
                    const blindChance = effect.blindChance ?? 0;
                    const blindDuration = effect.blindDuration ?? BLIND_DURATION;
                    const sourceId = unit.id;
                    const sourceName = data.name;

                    if (auraRadius > 0 && auraDamage > 0) {
                        // Lazily build alive enemies list once per frame
                        if (aliveEnemies === null) {
                            aliveEnemies = [];
                            for (const t of unitsState) {
                                if (t.team !== "enemy" || !isUnitAlive(t, defeatedThisFrame)) continue;
                                const tg = unitsRef[t.id];
                                if (!tg) continue;
                                aliveEnemies.push({ unit: t, group: tg, radius: getUnitRadius(t) });
                            }
                        }

                        for (const enemy of aliveEnemies) {
                            const target = enemy.unit;
                            if (target.id === unit.id) continue;
                            if (defeatedThisFrame.has(target.id)) continue;

                            const targetG = enemy.group;
                            const targetRadius = enemy.radius;
                            if (!isInRange(unitG.position.x, unitG.position.z, targetG.position.x, targetG.position.z, targetRadius, auraRadius)) {
                                continue;
                            }

                            const targetData = getUnitStats(target);
                            const attackerPos = { x: unitG.position.x, z: unitG.position.z };
                            const targetId = target.id;
                            const targetName = targetData.name;

                            sideEffects.push(() => {
                                applyDamageToUnit(auraDamageCtx, targetId, targetG, auraDamage, targetName, {
                                    color: COLORS.dmgHoly,
                                    attackerName: sourceName,
                                    targetUnit: target,
                                    attackerPosition: attackerPos,
                                    damageType: auraDamageType
                                });

                                if (defeatedThisFrame.has(targetId)) return;
                                if (blindChance <= 0 || !rollChance(blindChance)) return;

                                const blindEffect: StatusEffect = {
                                    type: "blind",
                                    duration: blindDuration,
                                    tickInterval: BUFF_TICK_INTERVAL,
                                    timeSinceTick: 0,
                                    lastUpdateTime: now,
                                    damagePerTick: 0,
                                    sourceId
                                };
                                pendingBlinds.set(targetId, { effect: blindEffect, targetName });
                            });
                        }
                    }
                } else if (dealsDamage) {
                    tickEffectInPlace(effect, now);

                    if (!hasDivineLattice) {
                        const dmg = effect.damagePerTick;
                        hpDelta -= dmg;

                        const config = DOT_VISUAL_CONFIG[effect.type];
                        if (config) {
                            const msg = config.messageTemplate(data.name, dmg);
                            const color = config.color;
                            const ux = unitG.position.x, uz = unitG.position.z, uid = unit.id;
                            sideEffects.push(() => showDamageVisual(scene, uid, ux, uz, dmg, color, hitFlashRef, damageTexts, addLog, msg, now));
                        }
                    }
                } else if (effect.type === "regen") {
                    const healPerTick = effect.shieldAmount ?? 0;
                    hpDelta += healPerTick;
                    tickEffectInPlace(effect, now);

                    if (healPerTick > 0) {
                        const ux = unitG.position.x, uz = unitG.position.z;
                        const name = data.name;
                        sideEffects.push(() => {
                            spawnDamageNumber(scene, ux, uz, healPerTick, COLORS.hpHigh, damageTexts, true);
                            addLog(`${name} regenerates ${healPerTick} HP.`, COLORS.hpHigh);
                        });
                    }
                } else if (effect.type === "doom" && effect.duration - effect.tickInterval <= 0 && !hasDivineLattice) {
                    doom = true;
                    tickEffectInPlace(effect, now);
                    const name = data.name;
                    sideEffects.push(() => addLog(`${name} succumbs to Doom!`, COLORS.doomText));
                } else {
                    tickEffectInPlace(effect, now);
                }
            } else {
                updateEffectTimeInPlace(effect, newTimeSinceTick, now);
            }
        }

        // Single filter pass to remove expired effects
        const finalEffects = currentEffects.filter(e => e.duration > 0);
        mutations.set(unit.id, { hpDelta, maxHp, doom, newEffects: finalEffects });
    }

    if (mutations.size === 0) return;

    // Phase 2: Single setUnits call for all units
    setUnits(prev => prev.map(u => {
        const mut = mutations.get(u.id);
        if (!mut) return u;
        if (mut.doom) return { ...u, hp: 0, statusEffects: undefined };
        const newHp = Math.max(0, Math.min(mut.maxHp, u.hp + mut.hpDelta));
        if (newHp <= 0) {
            return { ...u, hp: 0, statusEffects: undefined };
        }
        const effects = mut.newEffects.length > 0 ? mut.newEffects : undefined;
        return { ...u, hp: newHp, statusEffects: effects };
    }));

    // Phase 3: Handle defeats and deferred side effects
    for (const [unitId, mut] of mutations) {
        const unit = getUnitById(unitId);
        if (!unit) continue;
        const predictedHp = mut.doom ? 0 : Math.max(0, unit.hp + mut.hpDelta);
        if (predictedHp <= 0 && unit.hp > 0) {
            const unitG = unitsRef[unitId];
            if (unitG) {
                defeatedThisFrame.add(unitId);
                const data = getUnitStats(unit);
                handleUnitDefeat(unitId, unitG, unitsRef, addLog, data.name);
            }
        }
    }

    for (const fn of sideEffects) fn();

    if (pendingBlinds.size > 0) {
        setUnits(prev => prev.map(u => {
            const pending = pendingBlinds.get(u.id);
            if (!pending || u.hp <= 0 || hasStatusEffect(u, "blind")) return u;
            return { ...u, statusEffects: applyStatusEffect(u.statusEffects, pending.effect) };
        }));

        for (const pending of pendingBlinds.values()) {
            addLog(`${pending.targetName} is blinded!`, COLORS.blindText);
        }
    }
}
