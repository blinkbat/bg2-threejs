import type { UnitData, EnemyStats, Unit } from "../core/types";
import { DEFAULT_SPAWN_POINT } from "./areas";

// Re-export from split modules for backwards compatibility
export { SKILLS } from "./skills";
export { UNIT_DATA, getBasicAttackSkill, getAllSkills, getEffectiveUnitData, getEffectiveMaxHp, getEffectiveMaxMana, getEffectiveArmor as getPlayerEffectiveArmor, getXpForLevel, XP_REQUIREMENTS } from "./playerUnits";
export { ENEMY_STATS } from "./enemyStats";

// Import for local use
import { UNIT_DATA, getEffectiveUnitData, getEffectiveMaxHp } from "./playerUnits";
import { ENEMY_STATS } from "./enemyStats";

// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Default melee attack range (used when unit has no range specified) */
export const DEFAULT_MELEE_RANGE = 1.8;

/**
 * Get stats for any unit (player or enemy).
 * For player units, returns effective stats with equipment and stat bonuses applied.
 */
export function getUnitStats(unit: Unit): UnitData | EnemyStats {
    if (unit.team === "player") {
        // Return effective stats including equipment and character stat bonuses
        return getEffectiveUnitData(unit.id, unit);
    }
    // Safely handle missing enemyType - fallback to kobold stats
    if (!unit.enemyType) return ENEMY_STATS.kobold;
    return ENEMY_STATS[unit.enemyType];
}

/** Get the attack range for any unit (player or enemy) */
export function getAttackRange(unit: Unit): number {
    const stats = getUnitStats(unit);
    return stats.range ?? DEFAULT_MELEE_RANGE;
}

// =============================================================================
// SPAWN LOCATIONS
// =============================================================================

// Kobold spawn locations across the dungeon (updated for larger rooms)
const koboldSpawns = [
    // Room D - kobold lair (NE corner, x:36-47, z:36-47) - 4 kobolds
    { x: 40.5, z: 40.5 }, { x: 43.5, z: 40.5 }, { x: 40.5, z: 43.5 }, { x: 43.5, z: 43.5 },
    // Room E - central great hall (x:16-31, z:16-31) - 3 kobolds
    { x: 20.5, z: 20.5 }, { x: 27.5, z: 20.5 }, { x: 27.5, z: 27.5 },
    // Room B - NW (x:1-12, z:36-47) - 2 kobolds
    { x: 5.5, z: 40.5 }, { x: 8.5, z: 40.5 },
    // Room C - SE (x:36-47, z:1-12) - 3 kobolds
    { x: 40.5, z: 5.5 }, { x: 43.5, z: 5.5 }, { x: 42.5, z: 8.5 },
    // Room F - S middle (x:18-27, z:1-10) - 2 kobolds
    { x: 22.5, z: 5.5 }, { x: 24.5, z: 5.5 },
    // Room G - W middle (x:1-10, z:18-27) - 1 kobold (archer added separately)
    { x: 5.5, z: 22.5 },
    // Room H - E middle (x:38-47, z:18-27) - 1 kobold (archer added separately)
    { x: 43.5, z: 22.5 },
    // Room I - N middle (x:18-27, z:38-47) - 2 kobolds
    { x: 22.5, z: 43.5 }, { x: 24.5, z: 43.5 },
];

// Kobold Archer spawns - in the side rooms (updated for larger rooms)
const koboldArcherSpawns = [
    // Room G - W middle
    { x: 5.5, z: 25.5 },
    // Room H - E middle
    { x: 43.5, z: 25.5 },
    // Room B - NW (one archer in back)
    { x: 5.5, z: 44.5 },
    // Room C - SE (one archer in back)
    { x: 44.5, z: 8.5 },
];

// Kobold Witch Doctor spawns - support units that heal allies
const witchDoctorSpawns = [
    // Room E - central (near ogre)
    { x: 24.5, z: 28.5 },
    // Room B - NW (supporting kobolds)
    { x: 8.5, z: 43.5 },
    // Room C - SE (supporting kobolds)
    { x: 43.5, z: 8.5 },
];

// Ogre spawn - center of the map (great hall, now 16x16 at x:16-31, z:16-31)
const ogreSpawn = { x: 24.5, z: 24.5 };

// =============================================================================
// INITIAL UNIT CREATION
// =============================================================================

/** Create initial units for the default dungeon map */
export function createInitialUnits(): Unit[] {
    return [
        // Player units (starting at spawn point - water's edge on coast)
        ...Object.keys(UNIT_DATA).map((id, i) => {
            const unitId = Number(id);
            const data = UNIT_DATA[unitId];
            return {
                id: unitId,
                x: DEFAULT_SPAWN_POINT.x + (i % 3) * 2,
                z: DEFAULT_SPAWN_POINT.z + Math.floor(i / 3) * 2,
                hp: getEffectiveMaxHp(unitId),  // Use effective max HP (includes equipment bonuses)
                mana: data.mana,
                team: "player" as const,
                target: null,
                aiEnabled: true
            };
        }),
        // Kobolds
        ...koboldSpawns.map((spawn, i) => ({
            id: 100 + i,
            x: spawn.x,
            z: spawn.z,
            hp: ENEMY_STATS.kobold.maxHp,
            team: "enemy" as const,
            enemyType: "kobold" as const,
            target: null,
            aiEnabled: true
        })),
        // Kobold Archers
        ...koboldArcherSpawns.map((spawn, i) => ({
            id: 150 + i,
            x: spawn.x,
            z: spawn.z,
            hp: ENEMY_STATS.kobold_archer.maxHp,
            team: "enemy" as const,
            enemyType: "kobold_archer" as const,
            target: null,
            aiEnabled: true
        })),
        // Kobold Witch Doctors
        ...witchDoctorSpawns.map((spawn, i) => ({
            id: 170 + i,
            x: spawn.x,
            z: spawn.z,
            hp: ENEMY_STATS.kobold_witch_doctor.maxHp,
            team: "enemy" as const,
            enemyType: "kobold_witch_doctor" as const,
            target: null,
            aiEnabled: true
        })),
        // Ogre
        {
            id: 200,
            x: ogreSpawn.x,
            z: ogreSpawn.z,
            hp: ENEMY_STATS.ogre.maxHp,
            team: "enemy" as const,
            enemyType: "ogre" as const,
            target: null,
            aiEnabled: true
        },
    ];
}
