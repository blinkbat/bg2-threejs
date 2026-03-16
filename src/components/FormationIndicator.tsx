import { memo, useState, useRef, useCallback } from "react";
import { UNIT_DATA } from "../game/playerUnits";
import { getPlayerUnitColor } from "../game/unitColors";
import type { Unit } from "../core/types";
import { sortUnitsByFormationOrder, buildEffectiveFormationOrder } from "../game/formationOrder";
import { isCorePlayerId } from "../game/playerUnits";

/**
 * Wedge formation layout — maps slot index to grid position.
 * Row 0: 1 slot (tip), Row 1: 2 slots, Row 2: 3 slots.
 *
 *        [0]
 *      [1] [2]
 *    [3] [4] [5]
 */
const SLOT_POSITIONS: { col: number; row: number }[] = [
    { col: 2, row: 0 },  // tip
    { col: 1, row: 1 },  // second left
    { col: 3, row: 1 },  // second right
    { col: 0, row: 2 },  // back left
    { col: 2, row: 2 },  // back center
    { col: 4, row: 2 },  // back right
];

interface FormationIndicatorProps {
    units: Unit[];
    formationOrder: number[];
    onReorderFormation?: (newOrder: number[]) => void;
}

function FormationIndicatorComponent({ units, formationOrder, onReorderFormation }: FormationIndicatorProps) {
    const players = sortUnitsByFormationOrder(
        units.filter(u => u.team === "player" && isCorePlayerId(u.id)),
        formationOrder
    );

    if (players.length <= 1) return null;

    const effectiveOrder = buildEffectiveFormationOrder(
        players.map(u => u.id),
        formationOrder
    );

    const [dragId, setDragId] = useState<number | null>(null);
    const [dropTargetId, setDropTargetId] = useState<number | null>(null);
    const dragIdRef = useRef<number | null>(null);

    const handleDrop = useCallback((targetUnitId: number) => {
        const sourceId = dragIdRef.current;
        dragIdRef.current = null;
        setDragId(null);
        setDropTargetId(null);
        if (sourceId === null || sourceId === targetUnitId || !onReorderFormation) return;

        const newOrder = [...effectiveOrder];
        const srcIdx = newOrder.indexOf(sourceId);
        const tgtIdx = newOrder.indexOf(targetUnitId);
        if (srcIdx === -1 || tgtIdx === -1) return;
        [newOrder[srcIdx], newOrder[tgtIdx]] = [newOrder[tgtIdx], newOrder[srcIdx]];
        onReorderFormation(newOrder);
    }, [effectiveOrder, onReorderFormation]);

    const canDrag = !!onReorderFormation;

    return (
        <div className="formation-indicator glass-panel">
            <div className="formation-label">Formation</div>
            <div className="formation-grid">
                {players.map((unit, slotIndex) => {
                    const pos = SLOT_POSITIONS[slotIndex];
                    if (!pos) return null;
                    const data = UNIT_DATA[unit.id];
                    const dead = unit.hp <= 0;
                    const isDragSource = dragId === unit.id;
                    const isDropTarget = dropTargetId === unit.id && dragId !== null && dragId !== unit.id;
                    return (
                        <div
                            key={unit.id}
                            className={`formation-slot${dead ? " formation-slot-dead" : ""}${isDragSource ? " formation-slot-dragging" : ""}${isDropTarget ? " formation-slot-drop-target" : ""}`}
                            style={{
                                gridColumn: pos.col + 1,
                                gridRow: pos.row + 1,
                                background: dead ? "var(--ui-color-border)" : getPlayerUnitColor(unit.id),
                                cursor: canDrag && !dead ? "grab" : undefined,
                            }}
                            title={data.name}
                            draggable={canDrag && !dead}
                            onDragStart={(e) => {
                                dragIdRef.current = unit.id;
                                setDragId(unit.id);
                                e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                                dragIdRef.current = null;
                                setDragId(null);
                                setDropTargetId(null);
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                if (dragIdRef.current !== null && dragIdRef.current !== unit.id) {
                                    setDropTargetId(unit.id);
                                }
                            }}
                            onDragLeave={() => {
                                setDropTargetId(prev => prev === unit.id ? null : prev);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                handleDrop(unit.id);
                            }}
                        >
                            {data.name[0]}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function areFormationPropsEqual(prev: FormationIndicatorProps, next: FormationIndicatorProps): boolean {
    if (prev.units.length !== next.units.length) return false;
    for (let i = 0; i < prev.units.length; i++) {
        if (prev.units[i] !== next.units[i]) return false;
    }

    if (prev.formationOrder.length !== next.formationOrder.length) return false;
    for (let i = 0; i < prev.formationOrder.length; i++) {
        if (prev.formationOrder[i] !== next.formationOrder[i]) return false;
    }

    if (prev.onReorderFormation !== next.onReorderFormation) return false;

    return true;
}

export const FormationIndicator = memo(FormationIndicatorComponent, areFormationPropsEqual);
