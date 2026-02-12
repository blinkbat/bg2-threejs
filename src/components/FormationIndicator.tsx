import { UNIT_DATA } from "../game/playerUnits";
import type { Unit } from "../core/types";
import { sortUnitsByFormationOrder } from "../game/formationOrder";

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
}

export function FormationIndicator({ units, formationOrder }: FormationIndicatorProps) {
    const players = sortUnitsByFormationOrder(
        units.filter(u => u.team === "player"),
        formationOrder
    );

    if (players.length <= 1) return null;

    return (
        <div className="formation-indicator glass-panel">
            <div className="formation-label">Formation</div>
            <div className="formation-grid">
                {players.map((unit, slotIndex) => {
                    const pos = SLOT_POSITIONS[slotIndex];
                    if (!pos) return null;
                    const data = UNIT_DATA[unit.id];
                    const dead = unit.hp <= 0;
                    return (
                        <div
                            key={unit.id}
                            className={`formation-slot${dead ? " formation-slot-dead" : ""}`}
                            style={{
                                gridColumn: pos.col + 1,
                                gridRow: pos.row + 1,
                                background: dead ? "#333" : data.color,
                            }}
                            title={data.name}
                        >
                            {data.name[0]}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
