// =============================================================================
// INPUT HANDLING - Mouse, keyboard, raycasting
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, SelectionBox } from "../core/types";
import { getUnitRadius, isInRange } from "../rendering/range";
import { findPath } from "../ai/pathfinding";
import { UNIT_DATA } from "../game/playerUnits";
import { pauseGameClock, resumeGameClock } from "../core/gameClock";
import { executeSkill, clearTargetingMode, type SkillExecutionContext } from "../combat/skills";
import { getIncapacitatingStatus } from "../combat/combatMath";
import { getFormationPositions } from "../game/formation";
import { sortUnitsByFormationOrder } from "../game/formationOrder";
import { MOVE_SPEED, getSkillTextColor } from "../core/constants";
import { disposeGeometry } from "../rendering/disposal";
import { distanceToPoint } from "../game/geometry";
import { updateUnitsWhere } from "../core/stateUtils";
import { isEnemyUntargetable } from "../gameLoop/enemyBehaviors";

// =============================================================================
// TYPES
// =============================================================================

interface InputRefs {
    cameraOffset: React.MutableRefObject<{ x: number; z: number }>;
    zoomLevel: React.MutableRefObject<number>;
    isDragging: React.MutableRefObject<boolean>;
    keysPressed: React.MutableRefObject<Set<string>>;
    isBoxSel: React.MutableRefObject<boolean>;
    boxStart: React.MutableRefObject<{ x: number; y: number }>;
    boxEnd: React.MutableRefObject<{ x: number; y: number }>;
    lastMouse: React.MutableRefObject<{ x: number; y: number }>;
    moveMarkerRef: React.RefObject<THREE.Mesh | null>;
    rangeIndicatorRef: React.RefObject<THREE.Mesh | null>;
    aoeIndicatorRef: React.RefObject<THREE.Mesh | null>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    cantripCooldownRef: React.MutableRefObject<Record<string, number>>;
    actionQueueRef: React.MutableRefObject<ActionQueue>;
    pendingIntentsRef: React.MutableRefObject<PendingIntentMap>;
    pathsRef: React.MutableRefObject<Record<number, { x: number; z: number }[]>>;
    moveStartRef: React.MutableRefObject<Record<number, { time: number; x: number; z: number }>>;
    pauseStartTimeRef: React.MutableRefObject<number | null>;
}

interface InputState {
    selectedRef: React.RefObject<number[]>;
    unitsStateRef: React.RefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.RefObject<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>;
}

interface InputSetters {
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
    setSelBox: React.Dispatch<React.SetStateAction<SelectionBox | null>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setPaused: React.Dispatch<React.SetStateAction<boolean>>;
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
}

// Per-unit queued action - only ONE action per unit at a time (last one wins)
// Note: attacks are just skills now - no separate "attack" type
type QueuedAction =
    | { type: "skill"; skill: Skill; targetX: number; targetZ: number; targetId?: number; dragLinePositions?: { x: number; z: number }[] }
    | { type: "move"; targetX: number; targetZ: number; direct?: boolean; notBefore?: number; attackMove?: boolean }
    | { type: "consumable"; itemId: string; targetId?: number };

// Map from unitId to their queued action
export type ActionQueue = Record<number, QueuedAction>;

// Pending intent: "walk toward target, then perform action when in range"
export type PendingSkillIntent = {
    type: "skill";
    skill: Skill;
    targetId?: number;
    targetX: number;
    targetZ: number;
};

export type PendingInteractIntent = {
    type: "interact";
    interactable: "door" | "waystone" | "chest" | "secretDoor" | "lootBag";
    targetX: number;
    targetZ: number;
    range: number;
    requireAllPlayers: boolean;
    intentKey: string;  // shared key so we can check if all players share the same intent
    callback: () => void;
};

export type PendingIntent = PendingSkillIntent | PendingInteractIntent;

// Map from unitId to their pending intent
export type PendingIntentMap = Record<number, PendingIntent>;

// =============================================================================
// PAUSE HANDLING
// =============================================================================

export function togglePause(
    refs: Pick<InputRefs, "pauseStartTimeRef" | "actionCooldownRef" | "cantripCooldownRef" | "actionQueueRef" | "moveStartRef">,
    state: Pick<InputState, "pausedRef">,
    setters: Pick<InputSetters, "setPaused" | "setSkillCooldowns">,
    processActionQueue: (defeatedThisFrame: Set<number>) => void
): void {
    const wasPaused = state.pausedRef.current;
    state.pausedRef.current = !state.pausedRef.current;
    setters.setPaused(p => !p);

    if (wasPaused && !state.pausedRef.current) {
        // Unpausing - resume game clock and adjust cooldowns
        resumeGameClock();
        if (refs.pauseStartTimeRef.current !== null) {
            const pausedDuration = Date.now() - refs.pauseStartTimeRef.current;
            adjustTimersForPause(refs.actionCooldownRef, refs.cantripCooldownRef, refs.actionQueueRef, refs.moveStartRef, setters.setSkillCooldowns, pausedDuration);
        }
        refs.pauseStartTimeRef.current = null;
        // Create new defeatedThisFrame for unpause processing (not part of main game loop)
        processActionQueue(new Set<number>());
    } else {
        // Pausing - freeze game clock and record when we paused
        pauseGameClock();
        refs.pauseStartTimeRef.current = Date.now();
    }
}

function adjustTimersForPause(
    actionCooldownRef: React.MutableRefObject<Record<number, number>>,
    cantripCooldownRef: React.MutableRefObject<Record<string, number>>,
    actionQueueRef: React.MutableRefObject<ActionQueue>,
    moveStartRef: React.MutableRefObject<Record<number, { time: number; x: number; z: number }>>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    pausedDuration: number
): void {
    // Adjust ref cooldowns
    Object.keys(actionCooldownRef.current).forEach(key => {
        actionCooldownRef.current[Number(key)] += pausedDuration;
    });
    Object.keys(cantripCooldownRef.current).forEach(key => {
        cantripCooldownRef.current[key] += pausedDuration;
    });
    Object.values(moveStartRef.current).forEach(moveStart => {
        moveStart.time += pausedDuration;
    });
    Object.values(actionQueueRef.current).forEach(action => {
        if (action.type === "move" && action.notBefore !== undefined) {
            action.notBefore += pausedDuration;
        }
    });
    // Adjust React state cooldowns for UI
    setSkillCooldowns(prev => {
        const adjusted: Record<string, { end: number; duration: number }> = {};
        Object.entries(prev).forEach(([key, value]) => {
            adjusted[key] = { end: value.end + pausedDuration, duration: value.duration };
        });
        return adjusted;
    });
}

function getCantripCooldownKey(casterId: number, skill: Skill): string {
    return `${casterId}-${skill.name}`;
}

export function getSkillLockoutEnd(
    skill: Skill,
    casterId: number,
    refs: Pick<InputRefs, "actionCooldownRef" | "cantripCooldownRef">
): number {
    if (skill.isCantrip) {
        return refs.cantripCooldownRef.current[getCantripCooldownKey(casterId, skill)] ?? 0;
    }

    return refs.actionCooldownRef.current[casterId] ?? 0;
}

// =============================================================================
// PATH & MOVEMENT
// =============================================================================

function assignPath(
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    unitId: number,
    targetX: number,
    targetZ: number,
    direct: boolean = false
): void {
    const g = unitsRef[unitId];
    if (!g) return;
    delete g.userData.formationRegroupAttempted;
    g.userData.moveTarget = { x: targetX, z: targetZ };
    if (direct) {
        // Direct movement — skip A*, just walk straight to target
        pathsRef[unitId] = [{ x: targetX, z: targetZ }];
    } else {
        const path = findPath(g.position.x, g.position.z, targetX, targetZ);
        pathsRef[unitId] = path ? path.slice(1) : [];
    }
    if (pathsRef[unitId].length > 0) {
        moveStartRef[unitId] = { time: Date.now(), x: g.position.x, z: g.position.z };
    }
}

function executeMove(
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    targets: { id: number; x: number; z: number }[],
    direct: boolean = false
): void {
    const targetIdSet = new Set(targets.map(t => t.id));
    targets.forEach(t => {
        assignPath(unitsRef, pathsRef, moveStartRef, t.id, t.x, t.z, direct);
        if (unitsRef[t.id]) {
            unitsRef[t.id].userData.attackTarget = null;
            unitsRef[t.id].userData.pendingMove = false;
        }
    });
    updateUnitsWhere(setUnits, u => targetIdSet.has(u.id), { target: null });
}

interface SharedCommandContext {
    selectedIds: number[];
    unitGroups: Record<number, UnitGroup>;
    pathsRef: Record<number, { x: number; z: number }[]>;
    actionQueueRef: ActionQueue;
    pendingIntentsRef: PendingIntentMap;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

function clearUnitCommandState(unitGroup: UnitGroup | undefined): void {
    if (!unitGroup) return;
    unitGroup.userData.attackTarget = null;
    unitGroup.userData.pendingMove = false;
    delete unitGroup.userData.formationRamp;
    delete unitGroup.userData.attackMoveTarget;
    delete unitGroup.userData.moveTarget;
    delete unitGroup.userData.formationRegroupAttempted;
}

/**
 * Stop selected units: clear queued actions, paths, and combat target.
 */
export function stopSelectedUnits(
    ctx: SharedCommandContext,
    clearHoldPosition: boolean = false
): void {
    const { selectedIds, unitGroups, pathsRef, actionQueueRef, pendingIntentsRef, setQueuedActions, setUnits } = ctx;
    if (selectedIds.length === 0) return;

    const selectedSet = new Set(selectedIds);
    for (const unitId of selectedIds) {
        pathsRef[unitId] = [];
        clearUnitCommandState(unitGroups[unitId]);
        delete actionQueueRef[unitId];
        delete pendingIntentsRef[unitId];
    }

    setQueuedActions(prev => prev.filter(q => !selectedSet.has(q.unitId)));
    setUnits(prev => prev.map(unit => {
        if (!selectedSet.has(unit.id)) return unit;
        if (clearHoldPosition) {
            return { ...unit, target: null, holdPosition: false };
        }
        return { ...unit, target: null };
    }));
}

/**
 * Toggle hold position for selected units.
 * Units toggling hold ON are stopped immediately and their queued actions are removed.
 */
export function toggleHoldPositionForSelectedUnits(ctx: SharedCommandContext, units: Unit[]): void {
    const { selectedIds, unitGroups, pathsRef, actionQueueRef, pendingIntentsRef, setQueuedActions, setUnits } = ctx;
    if (selectedIds.length === 0) return;

    const selectedSet = new Set(selectedIds);
    const turningOnSet = new Set<number>();
    for (const unit of units) {
        if (selectedSet.has(unit.id) && !unit.holdPosition) {
            turningOnSet.add(unit.id);
        }
    }

    for (const unitId of turningOnSet) {
        pathsRef[unitId] = [];
        clearUnitCommandState(unitGroups[unitId]);
        delete actionQueueRef[unitId];
        delete pendingIntentsRef[unitId];
    }

    if (turningOnSet.size > 0) {
        setQueuedActions(prev => prev.filter(q => !turningOnSet.has(q.unitId)));
    }

    setUnits(prev => prev.map(unit => {
        if (!selectedSet.has(unit.id)) return unit;
        const turningOn = !unit.holdPosition;
        return {
            ...unit,
            holdPosition: turningOn,
            target: turningOn ? null : unit.target
        };
    }));
}

// =============================================================================
// BOX SELECTION
// =============================================================================

export function getUnitsInBox(
    unitsRef: Record<number, UnitGroup>,
    unitsStateRef: Unit[],
    camera: THREE.OrthographicCamera,
    rendererRect: DOMRect,
    x1: number,
    y1: number,
    x2: number,
    y2: number
): number[] {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const sel: number[] = [];

    // Build O(1) lookup map instead of O(n) .find() per unit
    const unitMap = new Map<number, Unit>();
    for (const u of unitsStateRef) {
        if (u.team === "player" && u.hp > 0) unitMap.set(u.id, u);
    }

    const _projVec = new THREE.Vector3();
    for (const idStr in unitsRef) {
        const numId = Number(idStr);
        if (!unitMap.has(numId)) continue;
        const g = unitsRef[numId];
        _projVec.set(g.position.x, 0.5, g.position.z).project(camera);
        const sx = ((_projVec.x + 1) / 2) * rendererRect.width + rendererRect.left;
        const sy = ((-_projVec.y + 1) / 2) * rendererRect.height + rendererRect.top;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) sel.push(numId);
    }

    return sel;
}

// =============================================================================
// ACTION QUEUE PROCESSING
// =============================================================================

function isSingleTargetSkill(skill: Skill): boolean {
    if (skill.targetType === "enemy" || skill.targetType === "ally" || skill.targetType === "unit") return true;
    return skill.name === "Body Swap" || skill.name === "Divine Lattice";
}

function getQueuedRangeBuffer(skill: Skill): number {
    if (skill.name === "Body Swap") return 0.4;
    if (skill.type === "mana_transfer" && skill.targetType === "ally") return 0.5;
    if (
        skill.targetType === "enemy"
        && (skill.type === "damage" || skill.type === "debuff" || skill.type === "smite")
    ) {
        return 0.5;
    }
    return 0;
}

function isValidLockedTarget(
    skill: Skill,
    casterId: number,
    target: Unit
): boolean {
    if (target.team === "enemy" && target.hp > 0 && isEnemyUntargetable(target.id)) {
        return false;
    }

    if (skill.type === "revive") {
        return target.team === "player" && target.hp <= 0;
    }
    if (skill.targetType === "enemy") {
        return target.team === "enemy" && target.hp > 0;
    }
    if (skill.targetType === "ally") {
        return target.team === "player" && target.hp > 0;
    }
    if (skill.targetType === "unit") {
        if (skill.name === "Body Swap") {
            return target.id !== casterId && target.hp > 0;
        }
        return target.hp > 0;
    }
    if (skill.name === "Body Swap") {
        return target.id !== casterId && target.hp > 0;
    }
    if (skill.name === "Divine Lattice") {
        return target.hp > 0;
    }
    return target.hp > 0;
}

export function processActionQueue(
    actionQueueRef: React.MutableRefObject<ActionQueue>,
    actionCooldownRef: React.MutableRefObject<Record<number, number>>,
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    pausedRef: React.MutableRefObject<boolean>,
    skillCtx: SkillExecutionContext,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>,
    onConsumeItem?: (unitId: number, itemId: string, targetId?: number) => boolean,
    pendingIntentsRef?: React.MutableRefObject<PendingIntentMap>
): void {
    if (pausedRef.current) return;

    const now = Date.now();
    const executedUnits: number[] = [];

    // Process each unit's queued action
    for (const [unitIdStr, action] of Object.entries(actionQueueRef.current)) {
        const unitId = Number(unitIdStr);

        // Skip incapacitated units — don't execute or remove, wait for the effect to wear off
        const unit = skillCtx.unitsStateRef.current.find(u => u.id === unitId);
        if (unit && getIncapacitatingStatus(unit) !== null) continue;

        if (action.type === "skill") {
            const caster = skillCtx.unitsStateRef.current.find(u => u.id === unitId);
            // Remove if caster died or ran out of mana
            if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < action.skill.manaCost) {
                executedUnits.push(unitId);
                continue;
            }
            // Keep in queue if the relevant lockout is still active.
            const cooldownEnd = getSkillLockoutEnd(action.skill, unitId, {
                actionCooldownRef,
                cantripCooldownRef: skillCtx.cantripCooldownRef,
            });
            if (now < cooldownEnd) {
                continue; // Don't remove, will try again next frame
            }

            let executeTargetX = action.targetX;
            let executeTargetZ = action.targetZ;

            // Locked single-target actions should never retarget to a different unit.
            if (action.targetId !== undefined && isSingleTargetSkill(action.skill)) {
                const casterG = unitsRef[unitId];
                const target = skillCtx.unitsStateRef.current.find(u => u.id === action.targetId);

                if (!casterG || !target || !isValidLockedTarget(action.skill, unitId, target)) {
                    executedUnits.push(unitId);
                    continue;
                }

                const targetG = unitsRef[action.targetId];
                const targetX = targetG ? targetG.position.x : target.x;
                const targetZ = targetG ? targetG.position.z : target.z;

                // Revive targets can exist in state without a scene group after area transitions.
                // Other locked single-target skills require a live scene target.
                if (!targetG && action.skill.type !== "revive") {
                    executedUnits.push(unitId);
                    continue;
                }

                const targetRadius = getUnitRadius(target);
                const rangeWithBuffer = action.skill.range + getQueuedRangeBuffer(action.skill);
                if (!isInRange(
                    casterG.position.x,
                    casterG.position.z,
                    targetX,
                    targetZ,
                    targetRadius,
                    rangeWithBuffer
                )) {
                    // Convert to pending intent — walk toward target then cast
                    if (pendingIntentsRef) {
                        pendingIntentsRef.current[unitId] = {
                            type: "skill", skill: action.skill, targetId: action.targetId, targetX, targetZ
                        };
                        assignPath(unitsRef, pathsRef, moveStartRef, unitId, targetX, targetZ);
                    }
                    executedUnits.push(unitId);
                    continue;
                }

                executeTargetX = targetX;
                executeTargetZ = targetZ;
            }

            executeSkill(skillCtx, unitId, action.skill, executeTargetX, executeTargetZ, action.targetId, action.dragLinePositions);
            executedUnits.push(unitId);
        } else if (action.type === "move") {
            // Respect row stagger delay for formation moves
            if (action.notBefore && now < action.notBefore) continue;
            executeMove(unitsRef, pathsRef, moveStartRef, setUnits, [{ id: unitId, x: action.targetX, z: action.targetZ }], action.direct);
            executedUnits.push(unitId);
        } else if (action.type === "consumable") {
            const user = skillCtx.unitsStateRef.current.find(u => u.id === unitId);
            // Remove if user died
            if (!user || user.hp <= 0) {
                executedUnits.push(unitId);
                continue;
            }
            // Keep in queue if on cooldown - will be processed next frame
            const cooldownEnd = actionCooldownRef.current[unitId] || 0;
            if (now < cooldownEnd) {
                continue; // Don't remove, will try again next frame
            }
            // Execute queued consumable once cooldown clears, then always clear queue entry.
            // Validation failures are terminal for that queued action and should not loop forever.
            if (onConsumeItem) {
                onConsumeItem(unitId, action.itemId, action.targetId);
            }
            executedUnits.push(unitId);
        }
    }

    // Remove executed actions from queue
    for (const unitId of executedUnits) {
        delete actionQueueRef.current[unitId];
    }

    // Update UI for executed/removed skills
    if (executedUnits.length > 0) {
        const executedSet = new Set(executedUnits);
        setQueuedActions(prev => prev.filter(q => !executedSet.has(q.unitId)));
    }
}

// =============================================================================
// PENDING INTENT PROCESSING
// =============================================================================

/**
 * Process pending intents each frame. Units with pending intents are walking
 * toward a target; when they arrive in range, the intent is fulfilled and cleared.
 */
export function processPendingIntents(
    pendingIntentsRef: React.MutableRefObject<PendingIntentMap>,
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    unitsStateRef: React.MutableRefObject<Unit[]>,
    pausedRef: React.MutableRefObject<boolean>,
    skillCtx: SkillExecutionContext,
    refs: Pick<InputRefs, "actionCooldownRef" | "cantripCooldownRef" | "actionQueueRef">,
    setters: Pick<InputSetters, "setTargetingMode" | "setQueuedActions" | "setUnits">,
    addLog: (text: string, color?: string) => void
): void {
    if (pausedRef.current) return;

    const intents = pendingIntentsRef.current;
    const units = unitsStateRef.current;

    for (const [unitIdStr, intent] of Object.entries(intents)) {
        const unitId = Number(unitIdStr);
        const unit = units.find(u => u.id === unitId);
        const unitG = unitsRef[unitId];

        // Clear if unit is dead or missing
        if (!unit || unit.hp <= 0 || !unitG) {
            delete intents[unitId];
            continue;
        }

        if (intent.type === "skill") {
            // Update target position from live scene group (for moving targets)
            let targetX = intent.targetX;
            let targetZ = intent.targetZ;
            let targetRadius = 0;

            if (intent.targetId !== undefined) {
                const target = units.find(u => u.id === intent.targetId);
                const targetG = unitsRef[intent.targetId];

                // Clear if target is dead or invalid
                if (!target || !targetG || target.hp <= 0) {
                    delete intents[unitId];
                    pathsRef[unitId] = [];
                    continue;
                }

                targetX = targetG.position.x;
                targetZ = targetG.position.z;
                targetRadius = getUnitRadius(target);
            }

            // Check if we've arrived in range
            if (isInRange(unitG.position.x, unitG.position.z, targetX, targetZ, targetRadius, intent.skill.range)) {
                delete intents[unitId];
                // Stop movement
                pathsRef[unitId] = [];
                delete unitG.userData.moveTarget;
                // Queue or execute the skill through normal path
                queueOrExecuteSkill(
                    unitId, intent.skill, targetX, targetZ,
                    {
                        actionCooldownRef: refs.actionCooldownRef,
                        cantripCooldownRef: refs.cantripCooldownRef,
                        actionQueueRef: refs.actionQueueRef,
                        rangeIndicatorRef: { current: null },
                        aoeIndicatorRef: { current: null }
                    },
                    { pausedRef },
                    { setTargetingMode: setters.setTargetingMode, setQueuedActions: setters.setQueuedActions },
                    skillCtx, addLog, intent.targetId
                );
                continue;
            }

            // Not in range yet — update path toward target if it moved significantly
            const currentMoveTarget = unitG.userData.moveTarget;
            const distToOldTarget = currentMoveTarget
                ? Math.hypot(targetX - currentMoveTarget.x, targetZ - currentMoveTarget.z)
                : Infinity;
            if (distToOldTarget > 1.5) {
                assignPath(unitsRef, pathsRef, moveStartRef, unitId, targetX, targetZ);
            }
        } else if (intent.type === "interact") {
            const { targetX, targetZ, range, requireAllPlayers, intentKey, callback } = intent;

            // Check if this unit has arrived
            const thisUnitInRange = isInRange(
                targetX, targetZ,
                unitG.position.x, unitG.position.z,
                getUnitRadius(unit), range
            );

            if (requireAllPlayers) {
                // All alive players must share this intent and be in range
                const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0);
                const allArrived = alivePlayers.every(p => {
                    const pG = unitsRef[p.id];
                    if (!pG) return false;
                    return isInRange(targetX, targetZ, pG.position.x, pG.position.z, getUnitRadius(p), range);
                });

                if (allArrived) {
                    // Clear all intents with this key
                    for (const [idStr, pi] of Object.entries(intents)) {
                        if (pi.type === "interact" && pi.intentKey === intentKey) {
                            delete intents[Number(idStr)];
                        }
                    }
                    callback();
                    return; // callback may trigger area transition, stop processing
                }
            } else {
                // Any single player arriving triggers the interaction
                if (thisUnitInRange) {
                    // Clear all intents with this key
                    for (const [idStr, pi] of Object.entries(intents)) {
                        if (pi.type === "interact" && pi.intentKey === intentKey) {
                            delete intents[Number(idStr)];
                        }
                    }
                    callback();
                    return;
                }
            }
        }
    }
}

// =============================================================================
// MOVE COMMAND BUILDING
// =============================================================================

export function buildMoveTargets(
    selectedIds: number[],
    unitsState: Unit[],
    unitsRef: Record<number, UnitGroup>,
    gx: number,
    gz: number,
    formationOrder: number[] = []
): { id: number; x: number; z: number; delay: number }[] {
    const alive = selectedIds
        .map(uid => unitsState.find(u => u.id === uid))
        .filter((u): u is Unit => u !== undefined && u.hp > 0);

    // Fewer than 3 units — move directly, no formation
    if (alive.length < 3) {
        return alive.map(u => ({ id: u.id, x: gx, z: gz, delay: 0 }));
    }

    // Compute party center from live 3D positions
    let cx = 0, cz = 0, count = 0;
    for (const u of alive) {
        const g = unitsRef[u.id];
        if (g) { cx += g.position.x; cz += g.position.z; count++; }
    }
    if (count > 0) { cx /= count; cz /= count; }

    // If click is very close to party center, skip formation (angle is unstable)
    const dx = gx - cx;
    const dz = gz - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) {
        return alive.map(u => ({ id: u.id, x: gx, z: gz, delay: 0 }));
    }

    // Facing angle: from party center toward clicked point
    const facingAngle = Math.atan2(dz, dx);
    const positions = getFormationPositions(gx, gz, facingAngle, alive.length);

    // Slot assignment: preserve formation order deterministically.
    const sorted = sortUnitsByFormationOrder(alive, formationOrder);
    // Distance-based stagger: back-row units with shorter paths delay so the
    // formation arrives together. Front unit (slot 0) is the baseline — never waits.
    const UNITS_PER_SEC = MOVE_SPEED * 40;
    const MAX_STAGGER_MS = 160;
    const entries: { id: number; x: number; z: number; dist: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const pos = positions[i] ?? { x: gx, z: gz };
        const g = unitsRef[sorted[i].id];
        const d = g ? Math.hypot(pos.x - g.position.x, pos.z - g.position.z) : 0;
        entries.push({ id: sorted[i].id, x: pos.x, z: pos.z, dist: d });
    }

    const frontDist = entries[0].dist;
    return entries.map(e => ({
        id: e.id,
        x: e.x,
        z: e.z,
        delay: frontDist > 0
            ? Math.min(MAX_STAGGER_MS, Math.max(0, Math.round((frontDist - e.dist) / UNITS_PER_SEC * 1000)))
            : 0,
    }));
}

// =============================================================================
// TARGET VALIDATION
// =============================================================================

/**
 * Validate that a target is valid for a skill.
 * Returns an error message if invalid, or null if valid.
 */
function validateSkillTarget(
    skill: Skill,
    targetUnit: Unit,
    casterId: number,
    casterName: string
): string | null {
    if (targetUnit.team === "enemy" && targetUnit.hp > 0 && isEnemyUntargetable(targetUnit.id)) {
        return `${casterName}: Target cannot be targeted right now!`;
    }

    // Check target type (ally vs enemy)
    if (skill.targetType === "ally" && targetUnit.team !== "player") {
        return `${casterName}: Must target an ally!`;
    }
    if (skill.targetType === "enemy" && targetUnit.team !== "enemy") {
        return `${casterName}: Must target an enemy!`;
    }
    if (skill.targetType === "unit" && skill.name === "Body Swap" && targetUnit.id === casterId) {
        return `${casterName}: Must target another unit!`;
    }
    // Check if target is alive (revive skills target dead allies)
    if (targetUnit.hp <= 0 && skill.type !== "revive") {
        return `${casterName}: Target is dead!`;
    }
    return null;
}

// =============================================================================
// SKILL QUEUE/EXECUTE HELPER
// =============================================================================

/**
 * Queue a skill for a unit. New actions replace old ones (last action wins).
 * If not paused and not on cooldown, executes immediately instead.
 * Returns true if the skill was queued or executed.
 */
export function queueOrExecuteSkill(
    casterId: number,
    skill: Skill,
    targetX: number,
    targetZ: number,
    refs: Pick<InputRefs, "actionCooldownRef" | "cantripCooldownRef" | "actionQueueRef" | "rangeIndicatorRef" | "aoeIndicatorRef">,
    state: Pick<InputState, "pausedRef">,
    setters: Pick<InputSetters, "setTargetingMode" | "setQueuedActions">,
    skillCtx: SkillExecutionContext,
    addLog: (text: string, color?: string) => void,
    targetId?: number,
    dragLinePositions?: { x: number; z: number }[]
): boolean {
    const now = Date.now();
    const cooldownEnd = getSkillLockoutEnd(skill, casterId, refs);
    const onCooldown = now < cooldownEnd;

    // Queue when paused OR on cooldown - execute immediately otherwise
    if (state.pausedRef.current || onCooldown) {
        // Per-unit queue: new action replaces any previous action for this unit
        refs.actionQueueRef.current[casterId] = { type: "skill", skill, targetX, targetZ, targetId, dragLinePositions };
        // Update UI state (replace any existing queued action for this unit)
        setters.setQueuedActions(prev => [
            ...prev.filter(q => q.unitId !== casterId),
            { unitId: casterId, skillName: skill.name }
        ]);
        const reason = state.pausedRef.current ? "queued" : "on cooldown";
        addLog(`${UNIT_DATA[casterId].name} prepares ${skill.name}... (${reason})`, getSkillTextColor(skill.type, skill.damageType));
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    executeSkill(skillCtx, casterId, skill, targetX, targetZ, targetId, dragLinePositions);
    clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
    return true;
}

// =============================================================================
// DRAG LINE TILE COMPUTATION
// =============================================================================

/**
 * Compute grid cell positions along a line from start to end, up to maxTiles.
 * Uses Bresenham-like stepping: walks from start toward end, adding each new
 * grid cell encountered (no duplicates).
 */
export function computeDragLineTiles(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    maxTiles: number
): { x: number; z: number }[] {
    const tiles: { x: number; z: number }[] = [];
    const seen = new Set<string>();

    const sx = Math.floor(startX);
    const sz = Math.floor(startZ);
    tiles.push({ x: sx, z: sz });
    seen.add(`${sx},${sz}`);

    if (tiles.length >= maxTiles) return tiles;

    const dx = endX - startX;
    const dz = endZ - startZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return tiles;

    const stepX = dx / dist;
    const stepZ = dz / dist;

    // Walk along the line in small steps, collecting unique grid cells
    const maxDist = Math.min(dist, maxTiles * 1.5); // Limit walk distance
    for (let t = 0.5; t <= maxDist; t += 0.3) {
        const wx = startX + stepX * t;
        const wz = startZ + stepZ * t;
        const gx = Math.floor(wx);
        const gz = Math.floor(wz);
        const key = `${gx},${gz}`;
        if (!seen.has(key)) {
            tiles.push({ x: gx, z: gz });
            seen.add(key);
            if (tiles.length >= maxTiles) break;
        }
    }

    return tiles;
}

// =============================================================================
// SKILL TARGETING CLICK
// =============================================================================

export function handleTargetingClick(
    hit: THREE.Intersection,
    targetingMode: { casterId: number; skill: Skill; displacementTargetId?: number },
    refs: Pick<InputRefs, "actionCooldownRef" | "cantripCooldownRef" | "actionQueueRef" | "pendingIntentsRef" | "rangeIndicatorRef" | "aoeIndicatorRef" | "pathsRef" | "moveStartRef">,
    state: Pick<InputState, "unitsStateRef" | "pausedRef">,
    setters: Pick<InputSetters, "setTargetingMode" | "setQueuedActions">,
    unitsRef: Record<number, UnitGroup>,
    skillCtx: SkillExecutionContext,
    addLog: (text: string, color?: string) => void
): boolean {
    const { casterId, skill } = targetingMode;
    const caster = state.unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef[casterId];

    if (!caster || !casterG || caster.hp <= 0) {
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    // Displacement phase 2: unit already selected, now picking ground destination
    if (skill.type === "displacement" && targetingMode.displacementTargetId !== undefined) {
        if (hit.object.name !== "ground") return false;
        const targetX = hit.point.x;
        const targetZ = hit.point.z;
        const dist = distanceToPoint(casterG.position, targetX, targetZ);
        if (dist > skill.range) {
            addLog(`${UNIT_DATA[casterId].name}: Destination out of range!`, "#888");
            return true;
        }
        return queueOrExecuteSkill(casterId, skill, targetX, targetZ, refs, state, setters, skillCtx, addLog, targetingMode.displacementTargetId);
    }

    // Check if we clicked on a unit
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
        if (obj.userData.unitId !== undefined) {
            const targetId = obj.userData.unitId as number;
            const targetUnit = state.unitsStateRef.current.find(u => u.id === targetId);
            const targetG = unitsRef[targetId];

            if (targetUnit && targetG) {
                // Validate target type and alive status
                const validationError = validateSkillTarget(skill, targetUnit, casterId, UNIT_DATA[casterId].name);
                if (validationError) {
                    addLog(validationError, "#888");
                    return true;
                }

                // Range check using unit's hitbox - if any part is in range, it's valid
                const targetRadius = getUnitRadius(targetUnit);
                if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
                    // Out of range — create pending intent to walk then cast
                    refs.pendingIntentsRef.current[casterId] = {
                        type: "skill", skill, targetId, targetX: targetG.position.x, targetZ: targetG.position.z
                    };
                    assignPath(unitsRef, refs.pathsRef.current, refs.moveStartRef.current, casterId, targetG.position.x, targetG.position.z);
                    clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
                    return true;
                }

                // Displacement phase 1: store target, stay in targeting mode for ground click
                if (skill.type === "displacement") {
                    setters.setTargetingMode({ casterId, skill, displacementTargetId: targetId });
                    addLog(`${UNIT_DATA[casterId].name}: Now choose a destination.`, getSkillTextColor(skill.type, skill.damageType));
                    // Hide range indicator since we're now picking a ground position
                    if (refs.rangeIndicatorRef.current) refs.rangeIndicatorRef.current.visible = false;
                    return true;
                }

                // Use target's center position for the skill, pass target ID for tracking
                return queueOrExecuteSkill(casterId, skill, targetG.position.x, targetG.position.z, refs, state, setters, skillCtx, addLog, targetId);
            }
            return true; // Clicked a dead/invalid unit, consume the click
        }
        obj = obj.parent;
    }

    // Clicked on ground (for AOE skills)
    if (hit.object.name !== "ground") return false;

    // Unit-targeted skills can't target ground
    if (skill.targetType === "ally" || skill.targetType === "enemy" || skill.targetType === "unit") {
        addLog(`${UNIT_DATA[casterId].name}: Must target a unit!`, "#888");
        return true;
    }

    const targetX = hit.point.x;
    const targetZ = hit.point.z;
    const dist = distanceToPoint(casterG.position, targetX, targetZ);

    if (dist > skill.range) {
        // Out of range — create pending intent to walk then cast (ground-targeted)
        refs.pendingIntentsRef.current[casterId] = {
            type: "skill", skill, targetX, targetZ
        };
        assignPath(unitsRef, refs.pathsRef.current, refs.moveStartRef.current, casterId, targetX, targetZ);
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    return queueOrExecuteSkill(casterId, skill, targetX, targetZ, refs, state, setters, skillCtx, addLog);
}

/**
 * Handle targeting a unit directly by ID (e.g., from party bar click)
 * Used when a unit may be occluded and can't be clicked in the 3D scene
 */
export function handleTargetingOnUnit(
    targetUnitId: number,
    targetingMode: { casterId: number; skill: Skill; displacementTargetId?: number },
    refs: Pick<InputRefs, "actionCooldownRef" | "cantripCooldownRef" | "actionQueueRef" | "pendingIntentsRef" | "rangeIndicatorRef" | "aoeIndicatorRef" | "pathsRef" | "moveStartRef">,
    state: Pick<InputState, "unitsStateRef" | "pausedRef">,
    setters: Pick<InputSetters, "setTargetingMode" | "setQueuedActions">,
    unitsRef: Record<number, UnitGroup>,
    skillCtx: SkillExecutionContext,
    addLog: (text: string, color?: string) => void
): boolean {
    const { casterId, skill } = targetingMode;
    const caster = state.unitsStateRef.current.find(u => u.id === casterId);
    const casterG = unitsRef[casterId];
    const targetUnit = state.unitsStateRef.current.find(u => u.id === targetUnitId);

    if (!caster || !casterG || caster.hp <= 0) {
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return false;
    }

    if (!targetUnit) {
        addLog(`${UNIT_DATA[casterId].name}: Invalid target!`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return false;
    }

    // Validate target type and alive status
    const validationError = validateSkillTarget(skill, targetUnit, casterId, UNIT_DATA[casterId].name);
    if (validationError) {
        addLog(validationError, "#888");
        return false;
    }

    // Revive targets may not have an active UnitGroup after area transitions.
    const targetG = unitsRef[targetUnitId];
    const targetX = targetG ? targetG.position.x : targetUnit.x;
    const targetZ = targetG ? targetG.position.z : targetUnit.z;

    // Range check: if any part of target's hitbox is in range, allow targeting
    const targetRadius = getUnitRadius(targetUnit);
    if (!isInRange(casterG.position.x, casterG.position.z, targetX, targetZ, targetRadius, skill.range)) {
        // Out of range — create pending intent to walk then cast
        refs.pendingIntentsRef.current[casterId] = {
            type: "skill", skill, targetId: targetUnitId, targetX, targetZ
        };
        assignPath(unitsRef, refs.pathsRef.current, refs.moveStartRef.current, casterId, targetX, targetZ);
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    return queueOrExecuteSkill(casterId, skill, targetX, targetZ, refs, state, setters, skillCtx, addLog, targetUnitId);
}

// =============================================================================
// TARGETING MODE SETUP
// =============================================================================

/**
 * Set up targeting mode for a skill - shows range indicator and AOE indicator.
 * Consolidates the targeting setup logic to avoid duplication.
 */
export function setupTargetingMode(
    casterId: number,
    skill: Skill,
    casterG: UnitGroup,
    rangeIndicatorRef: React.RefObject<THREE.Mesh | null>,
    aoeIndicatorRef: React.RefObject<THREE.Mesh | null>,
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill; displacementTargetId?: number } | null>>
): void {
    setTargetingMode({ casterId, skill });

    if (rangeIndicatorRef.current) {
        // Only recreate geometry if radius changed
        const currentRadius = rangeIndicatorRef.current.userData.radius;
        if (currentRadius !== skill.range) {
            disposeGeometry(rangeIndicatorRef.current);
            rangeIndicatorRef.current.geometry = new THREE.RingGeometry(0.1, skill.range, 64);
            rangeIndicatorRef.current.userData.radius = skill.range;
        }
        rangeIndicatorRef.current.position.x = casterG.position.x;
        rangeIndicatorRef.current.position.z = casterG.position.z;
        rangeIndicatorRef.current.visible = true;
    }

    if (aoeIndicatorRef.current) {
        if (skill.targetType === "drag_line") {
            // Drag-line skills show preview tiles instead of an AOE indicator
            aoeIndicatorRef.current.visible = false;
        } else if (skill.lineWidth) {
            // Line-shaped AOE: rectangle from caster toward cursor
            disposeGeometry(aoeIndicatorRef.current);
            const rectGeo = new THREE.PlaneGeometry(skill.range, skill.lineWidth);
            rectGeo.translate(skill.range / 2, 0, 0);
            aoeIndicatorRef.current.geometry = rectGeo;
            aoeIndicatorRef.current.userData.isLine = true;
            aoeIndicatorRef.current.userData.casterId = casterId;
            // Clear circular radius cache so switching back to circle forces recreation
            delete aoeIndicatorRef.current.userData.outerRadius;
            delete aoeIndicatorRef.current.userData.innerRadius;
            // Position at caster (mousemove will update rotation)
            aoeIndicatorRef.current.position.x = casterG.position.x;
            aoeIndicatorRef.current.position.z = casterG.position.z;
        } else {
            // Circular AOE indicator
            const targetRadius = skill.aoeRadius || 0.5;
            const innerRadius = skill.aoeRadius ? 0.1 : 0.3;
            const wasLine = aoeIndicatorRef.current.userData.isLine;
            const currentOuter = aoeIndicatorRef.current.userData.outerRadius;
            const currentInner = aoeIndicatorRef.current.userData.innerRadius;
            // Force geometry recreation if switching from line mode, or if radius changed
            if (wasLine || currentOuter !== targetRadius || currentInner !== innerRadius) {
                disposeGeometry(aoeIndicatorRef.current);
                aoeIndicatorRef.current.geometry = new THREE.RingGeometry(innerRadius, targetRadius, 32);
                aoeIndicatorRef.current.userData.outerRadius = targetRadius;
                aoeIndicatorRef.current.userData.innerRadius = innerRadius;
                aoeIndicatorRef.current.rotation.z = 0;
            }
            aoeIndicatorRef.current.userData.isLine = false;
        }
        const indicatorColor = skill.name === "Divine Lattice"
            ? "#ffffff"
            : (skill.type === "heal" ? "#22c55e" : "#ff4400");
        (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).color.set(indicatorColor);
        (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).opacity = 0.4;
        aoeIndicatorRef.current.visible = true;
    }
}

