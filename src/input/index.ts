// =============================================================================
// INPUT HANDLING - Mouse, keyboard, raycasting
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, SelectionBox } from "../core/types";
import { getUnitRadius, isInRange } from "../rendering/range";
import { findPath } from "../ai/pathfinding";
import { UNIT_DATA } from "../game/units";
import { soundFns } from "../audio";
import { executeSkill, clearTargetingMode, type SkillExecutionContext } from "../combat/skills";
import { findClosestTargetByTeam } from "../combat/skills/helpers";
import { disposeGeometry } from "../rendering/disposal";
import { distanceToPoint } from "../game/geometry";

// =============================================================================
// TYPES
// =============================================================================

export interface InputRefs {
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
    actionQueueRef: React.MutableRefObject<ActionQueue>;
    pathsRef: React.MutableRefObject<Record<number, { x: number; z: number }[]>>;
    moveStartRef: React.MutableRefObject<Record<number, { time: number; x: number; z: number }>>;
    pauseStartTimeRef: React.MutableRefObject<number | null>;
}

export interface InputState {
    selectedRef: React.RefObject<number[]>;
    unitsStateRef: React.RefObject<Unit[]>;
    pausedRef: React.MutableRefObject<boolean>;
    targetingModeRef: React.RefObject<{ casterId: number; skill: Skill } | null>;
}

export interface InputSetters {
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
    setSelBox: React.Dispatch<React.SetStateAction<SelectionBox | null>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setPaused: React.Dispatch<React.SetStateAction<boolean>>;
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill } | null>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>;
}

// Per-unit queued action - only ONE action per unit at a time (last one wins)
// Note: attacks are just skills now - no separate "attack" type
export type QueuedAction =
    | { type: "skill"; skill: Skill; targetX: number; targetZ: number; targetId?: number }
    | { type: "move"; targetX: number; targetZ: number }
    | { type: "consumable"; itemId: string };

// Map from unitId to their queued action
export type ActionQueue = Record<number, QueuedAction>;

// =============================================================================
// PAUSE HANDLING
// =============================================================================

export function togglePause(
    refs: Pick<InputRefs, "pauseStartTimeRef" | "actionCooldownRef">,
    state: Pick<InputState, "pausedRef">,
    setters: Pick<InputSetters, "setPaused" | "setSkillCooldowns">,
    processActionQueue: (defeatedThisFrame: Set<number>) => void
): void {
    const wasPaused = state.pausedRef.current;
    state.pausedRef.current = !state.pausedRef.current;
    setters.setPaused(p => !p);

    if (wasPaused && !state.pausedRef.current) {
        // Unpausing - adjust cooldowns to account for paused time
        if (refs.pauseStartTimeRef.current !== null) {
            const pausedDuration = Date.now() - refs.pauseStartTimeRef.current;
            adjustCooldownsForPause(refs.actionCooldownRef, setters.setSkillCooldowns, pausedDuration);
        }
        refs.pauseStartTimeRef.current = null;
        // Create new defeatedThisFrame for unpause processing (not part of main game loop)
        processActionQueue(new Set<number>());
    } else {
        // Pausing - record when we paused
        refs.pauseStartTimeRef.current = Date.now();
    }
}

export function adjustCooldownsForPause(
    actionCooldownRef: React.MutableRefObject<Record<number, number>>,
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>,
    pausedDuration: number
): void {
    // Adjust ref cooldowns
    Object.keys(actionCooldownRef.current).forEach(key => {
        actionCooldownRef.current[Number(key)] += pausedDuration;
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

// =============================================================================
// PATH & MOVEMENT
// =============================================================================

export function assignPath(
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    unitId: number,
    targetX: number,
    targetZ: number
): void {
    const g = unitsRef[unitId];
    if (!g) return;
    const path = findPath(g.position.x, g.position.z, targetX, targetZ);
    pathsRef[unitId] = path ? path.slice(1) : [];
    if (path && path.length > 0) {
        moveStartRef[unitId] = { time: Date.now(), x: g.position.x, z: g.position.z };
    }
}

export function executeMove(
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    targets: { id: number; x: number; z: number }[]
): void {
    targets.forEach(t => {
        assignPath(unitsRef, pathsRef, moveStartRef, t.id, t.x, t.z);
        if (unitsRef[t.id]) unitsRef[t.id].userData.attackTarget = null;
    });
    setUnits(prev => prev.map(u => targets.some(t => t.id === u.id) ? { ...u, target: null } : u));
}

export function executeAttack(
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    unitIds: number[],
    targetId: number
): void {
    unitIds.forEach(uid => {
        if (unitsRef[uid]) unitsRef[uid].userData.attackTarget = targetId;
        pathsRef[uid] = [];
    });
    setUnits(prev => prev.map(u => unitIds.includes(u.id) ? { ...u, target: targetId } : u));
    soundFns.playAttack();
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

    Object.entries(unitsRef).forEach(([id, g]) => {
        const u = unitsStateRef.find(u => u.id === Number(id));
        if (!u || u.team !== "player" || u.hp <= 0) return;
        const p = new THREE.Vector3(g.position.x, 0.5, g.position.z).project(camera);
        const sx = ((p.x + 1) / 2) * rendererRect.width + rendererRect.left;
        const sy = ((-p.y + 1) / 2) * rendererRect.height + rendererRect.top;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) sel.push(Number(id));
    });

    return sel;
}

// =============================================================================
// ACTION QUEUE PROCESSING
// =============================================================================

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
    onConsumeItem?: (unitId: number, itemId: string) => boolean
): void {
    if (pausedRef.current) return;

    const now = Date.now();
    const executedUnits: number[] = [];

    // Process each unit's queued action
    for (const [unitIdStr, action] of Object.entries(actionQueueRef.current)) {
        const unitId = Number(unitIdStr);

        if (action.type === "skill") {
            const caster = skillCtx.unitsStateRef.current.find(u => u.id === unitId);
            // Remove if caster died or ran out of mana
            if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < action.skill.manaCost) {
                executedUnits.push(unitId);
                continue;
            }
            // Keep in queue if on cooldown - will be processed next frame
            const cooldownEnd = actionCooldownRef.current[unitId] || 0;
            if (now < cooldownEnd) {
                continue; // Don't remove, will try again next frame
            }
            // For enemy-targeted skills, validate target still exists before executing
            // This prevents "No enemy at that location" spam when target dies between queue and execute
            if (action.skill.targetType === "enemy") {
                const hasTarget = findClosestTargetByTeam(
                    skillCtx.unitsStateRef.current,
                    skillCtx.unitsRef.current,
                    "enemy",
                    action.targetX,
                    action.targetZ
                );
                if (!hasTarget) {
                    // Target died - silently discard and let unit re-acquire target
                    executedUnits.push(unitId);
                    continue;
                }
            }
            executeSkill(skillCtx, unitId, action.skill, action.targetX, action.targetZ, action.targetId);
            executedUnits.push(unitId);
        } else if (action.type === "move") {
            // Move can execute immediately
            executeMove(unitsRef, pathsRef, moveStartRef, setUnits, [{ id: unitId, x: action.targetX, z: action.targetZ }]);
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
            // Execute consumable via callback
            if (onConsumeItem) {
                const success = onConsumeItem(unitId, action.itemId);
                if (success) {
                    executedUnits.push(unitId);
                }
            } else {
                executedUnits.push(unitId); // Remove if no handler
            }
        }
    }

    // Remove executed actions from queue
    for (const unitId of executedUnits) {
        delete actionQueueRef.current[unitId];
    }

    // Update UI for executed/removed skills
    if (executedUnits.length > 0) {
        setQueuedActions(prev => prev.filter(q => !executedUnits.includes(q.unitId)));
    }
}

// =============================================================================
// MOVE COMMAND BUILDING
// =============================================================================

export function buildMoveTargets(
    selectedIds: number[],
    unitsState: Unit[],
    gx: number,
    gz: number
): { id: number; x: number; z: number }[] {
    // All selected alive units move to the clicked point
    return selectedIds
        .map(uid => unitsState.find(u => u.id === uid))
        .filter((u): u is Unit => u !== undefined && u.hp > 0)
        .map(u => ({ id: u.id, x: gx, z: gz }));
}

// =============================================================================
// TARGET VALIDATION
// =============================================================================

/**
 * Validate that a target is valid for a skill.
 * Returns an error message if invalid, or null if valid.
 */
export function validateSkillTarget(
    skill: Skill,
    targetUnit: Unit,
    casterName: string
): string | null {
    // Check target type (ally vs enemy)
    if (skill.targetType === "ally" && targetUnit.team !== "player") {
        return `${casterName}: Must target an ally!`;
    }
    if (skill.targetType === "enemy" && targetUnit.team !== "enemy") {
        return `${casterName}: Must target an enemy!`;
    }
    // Check if target is alive
    if (targetUnit.hp <= 0) {
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
    refs: Pick<InputRefs, "actionCooldownRef" | "actionQueueRef" | "rangeIndicatorRef" | "aoeIndicatorRef">,
    state: Pick<InputState, "pausedRef">,
    setters: Pick<InputSetters, "setTargetingMode" | "setQueuedActions">,
    skillCtx: SkillExecutionContext,
    addLog: (text: string, color?: string) => void,
    targetId?: number
): boolean {
    // Check cooldown
    const now = Date.now();
    const cooldownEnd = refs.actionCooldownRef.current[casterId] || 0;
    const onCooldown = now < cooldownEnd;

    // Queue when paused OR on cooldown - execute immediately otherwise
    if (state.pausedRef.current || onCooldown) {
        // Per-unit queue: new action replaces any previous action for this unit
        refs.actionQueueRef.current[casterId] = { type: "skill", skill, targetX, targetZ, targetId };
        // Update UI state (replace any existing queued action for this unit)
        setters.setQueuedActions(prev => [
            ...prev.filter(q => q.unitId !== casterId),
            { unitId: casterId, skillName: skill.name }
        ]);
        const reason = state.pausedRef.current ? "queued" : "on cooldown";
        addLog(`${UNIT_DATA[casterId].name} prepares ${skill.name}... (${reason})`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    executeSkill(skillCtx, casterId, skill, targetX, targetZ, targetId);
    clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
    return true;
}

// =============================================================================
// SKILL TARGETING CLICK
// =============================================================================

export function handleTargetingClick(
    hit: THREE.Intersection,
    targetingMode: { casterId: number; skill: Skill },
    refs: Pick<InputRefs, "actionCooldownRef" | "actionQueueRef" | "rangeIndicatorRef" | "aoeIndicatorRef">,
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

    // Check if we clicked on a unit
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
        if (obj.userData.unitId !== undefined) {
            const targetId = obj.userData.unitId as number;
            const targetUnit = state.unitsStateRef.current.find(u => u.id === targetId);
            const targetG = unitsRef[targetId];

            if (targetUnit && targetG) {
                // Validate target type and alive status
                const validationError = validateSkillTarget(skill, targetUnit, UNIT_DATA[casterId].name);
                if (validationError) {
                    addLog(validationError, "#888");
                    return true;
                }

                // Range check using unit's hitbox - if any part is in range, it's valid
                const targetRadius = getUnitRadius(targetUnit);
                if (!isInRange(casterG.position.x, casterG.position.z, targetG.position.x, targetG.position.z, targetRadius, skill.range)) {
                    addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
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

    const targetX = hit.point.x;
    const targetZ = hit.point.z;
    const dist = distanceToPoint(casterG.position, targetX, targetZ);

    if (dist > skill.range) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
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
    targetingMode: { casterId: number; skill: Skill },
    refs: Pick<InputRefs, "actionCooldownRef" | "actionQueueRef" | "rangeIndicatorRef" | "aoeIndicatorRef">,
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
    const targetG = unitsRef[targetUnitId];

    if (!caster || !casterG || caster.hp <= 0) {
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return false;
    }

    if (!targetUnit || !targetG) {
        addLog(`${UNIT_DATA[casterId].name}: Invalid target!`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return false;
    }

    // Validate target type and alive status
    const validationError = validateSkillTarget(skill, targetUnit, UNIT_DATA[casterId].name);
    if (validationError) {
        addLog(validationError, "#888");
        return false;
    }

    // Use target unit's position
    const targetX = targetG.position.x;
    const targetZ = targetG.position.z;

    // Range check: if any part of target's hitbox is in range, allow targeting
    const targetRadius = getUnitRadius(targetUnit);
    if (!isInRange(casterG.position.x, casterG.position.z, targetX, targetZ, targetRadius, skill.range)) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    return queueOrExecuteSkill(casterId, skill, targetX, targetZ, refs, state, setters, skillCtx, addLog);
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
    setTargetingMode: React.Dispatch<React.SetStateAction<{ casterId: number; skill: Skill } | null>>
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
        const targetRadius = skill.aoeRadius || 0.5;
        const innerRadius = skill.aoeRadius ? 0.1 : 0.3;
        const currentOuter = aoeIndicatorRef.current.userData.outerRadius;
        const currentInner = aoeIndicatorRef.current.userData.innerRadius;
        // Only recreate geometry if radius changed
        if (currentOuter !== targetRadius || currentInner !== innerRadius) {
            disposeGeometry(aoeIndicatorRef.current);
            aoeIndicatorRef.current.geometry = new THREE.RingGeometry(innerRadius, targetRadius, 32);
            aoeIndicatorRef.current.userData.outerRadius = targetRadius;
            aoeIndicatorRef.current.userData.innerRadius = innerRadius;
        }
        (aoeIndicatorRef.current.material as THREE.MeshBasicMaterial).color.set(skill.type === "heal" ? "#22c55e" : "#ff4400");
        aoeIndicatorRef.current.visible = true;
    }
}
