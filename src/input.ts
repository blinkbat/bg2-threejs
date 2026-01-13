// =============================================================================
// INPUT HANDLING - Mouse, keyboard, raycasting
// =============================================================================

import * as THREE from "three";
import type { Unit, Skill, UnitGroup, SelectionBox } from "./types";
import { GRID_SIZE, FORMATION_SPACING } from "./constants";
import { getUnitRadius, isInRange } from "./range";
import { findPath } from "./pathfinding";
import { UNIT_DATA } from "./units";
import { soundFns } from "./sound";
import { executeSkill, clearTargetingMode, type SkillExecutionContext } from "./skills";

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
    actionQueueRef: React.MutableRefObject<QueuedAction[]>;
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

export type QueuedAction =
    | { type: "skill"; casterId: number; skill: Skill; targetX: number; targetZ: number }
    | { type: "move"; unitIds: number[]; targets: { id: number; x: number; z: number }[] }
    | { type: "attack"; unitIds: number[]; targetId: number };

// =============================================================================
// PAUSE HANDLING
// =============================================================================

export function togglePause(
    refs: Pick<InputRefs, "pauseStartTimeRef" | "actionCooldownRef">,
    state: Pick<InputState, "pausedRef">,
    setters: Pick<InputSetters, "setPaused" | "setSkillCooldowns">,
    processActionQueue: () => void
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
        processActionQueue();
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
    actionQueueRef: React.MutableRefObject<QueuedAction[]>,
    actionCooldownRef: React.MutableRefObject<Record<number, number>>,
    unitsRef: Record<number, UnitGroup>,
    pathsRef: Record<number, { x: number; z: number }[]>,
    moveStartRef: Record<number, { time: number; x: number; z: number }>,
    pausedRef: React.MutableRefObject<boolean>,
    skillCtx: SkillExecutionContext,
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>,
    setQueuedActions: React.Dispatch<React.SetStateAction<{ unitId: number; skillName: string }[]>>
): void {
    if (pausedRef.current) return;

    const now = Date.now();
    const remaining: QueuedAction[] = [];
    const executedSkills: { unitId: number; skillName: string }[] = [];

    for (const action of actionQueueRef.current) {
        if (action.type === "skill") {
            const caster = skillCtx.unitsStateRef.current.find(u => u.id === action.casterId);
            // Remove if caster died or ran out of mana
            if (!caster || caster.hp <= 0 || (caster.mana ?? 0) < action.skill.manaCost) {
                executedSkills.push({ unitId: action.casterId, skillName: action.skill.name });
                continue;
            }
            // Keep in queue if on cooldown - will be processed next frame
            const cooldownEnd = actionCooldownRef.current[action.casterId] || 0;
            if (now < cooldownEnd) {
                remaining.push(action);
                continue;
            }
            executeSkill(skillCtx, action.casterId, action.skill, action.targetX, action.targetZ);
            executedSkills.push({ unitId: action.casterId, skillName: action.skill.name });
        } else if (action.type === "attack") {
            executeAttack(unitsRef, pathsRef, setUnits, action.unitIds, action.targetId);
        } else if (action.type === "move") {
            executeMove(unitsRef, pathsRef, moveStartRef, setUnits, action.targets);
        }
    }

    // Keep unprocessed actions
    actionQueueRef.current = remaining;

    // Update UI for executed/removed skills
    if (executedSkills.length > 0) {
        setQueuedActions(prev => prev.filter(q =>
            !executedSkills.some(e => e.unitId === q.unitId && e.skillName === q.skillName)
        ));
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
    const moveTargets: { id: number; x: number; z: number }[] = [];
    let idx = 0;

    selectedIds.forEach(uid => {
        const u = unitsState.find(u => u.id === uid);
        if (u && u.hp > 0) {
            const ox = (idx % 3 - 1) * FORMATION_SPACING;
            const oz = Math.floor(idx / 3) * FORMATION_SPACING;
            idx++;
            const tx = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gx + ox));
            const tz = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gz + oz));
            moveTargets.push({ id: uid, x: tx, z: tz });
        }
    });

    return moveTargets;
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

    if (hit.object.name !== "ground") return false;

    const targetX = hit.point.x;
    const targetZ = hit.point.z;
    const dist = Math.hypot(targetX - casterG.position.x, targetZ - casterG.position.z);

    if (dist > skill.range) {
        addLog(`${UNIT_DATA[casterId].name}: Target out of range!`, "#888");
        return true;
    }

    // Queue when paused - execute immediately otherwise
    if (state.pausedRef.current) {
        const alreadyQueued = refs.actionQueueRef.current.some(
            a => a.type === "skill" && a.casterId === casterId && a.skill.name === skill.name
        );
        if (alreadyQueued) {
            addLog(`${UNIT_DATA[casterId].name}: ${skill.name} already queued!`, "#888");
            clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
            return true;
        }
        refs.actionQueueRef.current.push({ type: "skill", casterId, skill, targetX, targetZ });
        setters.setQueuedActions(prev => [...prev, { unitId: casterId, skillName: skill.name }]);
        addLog(`${UNIT_DATA[casterId].name} prepares ${skill.name}... (queued)`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    // Check cooldown only when executing immediately (not paused)
    const now = Date.now();
    const cooldownEnd = refs.actionCooldownRef.current[casterId] || 0;
    if (now < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - now) / 1000);
        addLog(`${UNIT_DATA[casterId].name}: On cooldown (${remaining}s)`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    executeSkill(skillCtx, casterId, skill, targetX, targetZ);
    clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
    return true;
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

    // Validate target type matches skill requirements
    if (skill.targetType === "ally" && targetUnit.team !== "player") {
        addLog(`${UNIT_DATA[casterId].name}: Must target an ally!`, "#888");
        return false;
    }
    if (skill.targetType === "enemy" && targetUnit.team !== "enemy") {
        addLog(`${UNIT_DATA[casterId].name}: Must target an enemy!`, "#888");
        return false;
    }

    // Check if target is alive (for heals, allow targeting alive allies; for damage, target must be alive)
    if (targetUnit.hp <= 0) {
        addLog(`${UNIT_DATA[casterId].name}: Target is dead!`, "#888");
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

    // Queue when paused - execute immediately otherwise
    if (state.pausedRef.current) {
        const alreadyQueued = refs.actionQueueRef.current.some(
            a => a.type === "skill" && a.casterId === casterId && a.skill.name === skill.name
        );
        if (alreadyQueued) {
            addLog(`${UNIT_DATA[casterId].name}: ${skill.name} already queued!`, "#888");
            clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
            return true;
        }
        refs.actionQueueRef.current.push({ type: "skill", casterId, skill, targetX, targetZ });
        setters.setQueuedActions(prev => [...prev, { unitId: casterId, skillName: skill.name }]);
        addLog(`${UNIT_DATA[casterId].name} prepares ${skill.name}... (queued)`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    // Check cooldown only when executing immediately (not paused)
    const now = Date.now();
    const cooldownEnd = refs.actionCooldownRef.current[casterId] || 0;
    if (now < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - now) / 1000);
        addLog(`${UNIT_DATA[casterId].name}: On cooldown (${remaining}s)`, "#888");
        clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
        return true;
    }

    executeSkill(skillCtx, casterId, skill, targetX, targetZ);
    clearTargetingMode(setters.setTargetingMode, refs.rangeIndicatorRef, refs.aoeIndicatorRef);
    return true;
}
