import type { UnitData, EnemyStats, EnemyType, Unit, Skill } from "../core/types";

// =============================================================================
// SKILLS
// =============================================================================

export const SKILLS: Record<string, Skill> = {
    fireball: {
        name: "Fireball",
        manaCost: 15,
        cooldown: 5000,
        type: "damage",
        targetType: "aoe",
        range: 10,
        aoeRadius: 2.5,
        value: [8, 14],
        projectileColor: "#ff4400"
    },
    heal: {
        name: "Heal",
        manaCost: 10,
        cooldown: 4000,
        type: "heal",
        targetType: "ally",
        range: 8,
        value: [8, 12]
    },
    poisonDagger: {
        name: "Poison Dagger",
        manaCost: 8,
        cooldown: 6000,
        type: "damage",
        targetType: "enemy",
        range: 1.8,  // melee range
        value: [4, 8],
        poisonChance: 85  // 85% chance to poison
    },
    warcry: {
        name: "Warcry",
        manaCost: 10,
        cooldown: 12000,
        type: "taunt",
        targetType: "self",  // centered on caster
        range: 6,  // taunt radius
        value: [80, 80]  // 80% chance to taunt each enemy
    }
};

// =============================================================================
// UNIT DATA - Simple party, no complex D&D logic yet
// =============================================================================

export const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Barbarian", class: "Barbarian", hp: 50, maxHp: 50, mana: 25, maxMana: 25, damage: [3, 6], accuracy: 70, armor: 2, color: "#c0392b", skills: [SKILLS.warcry], items: ["Axe"], attackCooldown: 2000 },
    2: { name: "Paladin", class: "Paladin", hp: 45, maxHp: 45, damage: [2, 5], accuracy: 65, armor: 3, color: "#f1c40f", skills: [], items: ["Mace"], attackCooldown: 2500 },
    3: { name: "Thief", class: "Thief", hp: 25, maxHp: 25, mana: 30, maxMana: 30, damage: [2, 4], accuracy: 75, armor: 1, color: "#8e44ad", skills: [SKILLS.poisonDagger], items: ["Bow"], range: 7, projectileColor: "#a0522d", attackCooldown: 1500 },
    4: { name: "Wizard", class: "Wizard", hp: 18, maxHp: 18, mana: 50, maxMana: 50, damage: [3, 5], accuracy: 60, armor: 0, color: "#3498db", skills: [SKILLS.fireball], items: ["Staff"], range: 8, projectileColor: "#ff6600", attackCooldown: 3000 },
    5: { name: "Monk", class: "Monk", hp: 35, maxHp: 35, damage: [2, 5], accuracy: 70, armor: 1, color: "#27ae60", skills: [], items: ["Fists"], attackCooldown: 1800 },
    6: { name: "Cleric", class: "Cleric", hp: 30, maxHp: 30, mana: 40, maxMana: 40, damage: [2, 4], accuracy: 60, armor: 2, color: "#ecf0f1", skills: [SKILLS.heal], items: ["Staff"], range: 6, projectileColor: "#ffffaa", attackCooldown: 2500 },
};

// Enemy stats registry - keyed by EnemyType
export const ENEMY_STATS: Record<EnemyType, EnemyStats> = {
    kobold: {
        name: "Kobold",
        hp: 12,
        maxHp: 12,
        damage: [1, 4],
        accuracy: 50,
        armor: 0,
        color: "#8B4513",
        aggroRange: 6,
        attackCooldown: 2000
    },
    kobold_archer: {
        name: "Kobold Archer",
        hp: 10,
        maxHp: 10,
        damage: [2, 4],
        accuracy: 55,
        armor: 0,
        color: "#6B4423",
        aggroRange: 8,
        attackCooldown: 2500,
        range: 6,
        projectileColor: "#8B4513",
        poisonChance: 35,  // 35% chance to poison on hit
        // Kiting behavior - retreat when players get close
        kiteTrigger: 2.5,    // Start kiting when player within this range
        kiteDistance: 3,     // How far to retreat
        kiteCooldown: 4000   // Can only kite every 4 seconds
    },
    ogre: {
        name: "Ogre",
        hp: 80,
        maxHp: 80,
        damage: [6, 12],
        accuracy: 60,
        armor: 3,
        color: "#556B2F",
        aggroRange: 8,
        attackCooldown: 3000,
        size: 2.0,
        skill: {
            name: "Swipe",
            cooldown: 10000,  // 10 seconds
            damage: [8, 14],
            maxTargets: 3,
            range: 2.5
        }
    }
};

// Helper to get stats for any unit
export function getUnitStats(unit: Unit): UnitData | EnemyStats {
    if (unit.team === "player") {
        return UNIT_DATA[unit.id];
    }
    return ENEMY_STATS[unit.enemyType!];
}

// Ogre spawn - center of the map (great hall)
const ogreSpawn = { x: 25.5, z: 25.5 };

// Kobold spawn locations across the dungeon (updated for 50x50 map)
const koboldSpawns = [
    // Room D - kobold lair (NE corner, x:38-47, z:38-47) - 4 kobolds
    { x: 41.5, z: 41.5 }, { x: 43.5, z: 41.5 }, { x: 41.5, z: 43.5 }, { x: 43.5, z: 43.5 },
    // Room E - central great hall (x:19-30, z:19-30) - 3 kobolds
    { x: 23.5, z: 23.5 }, { x: 27.5, z: 23.5 }, { x: 27.5, z: 27.5 },
    // Room B - NW (x:1-10, z:38-47) - 2 kobolds
    { x: 4.5, z: 41.5 }, { x: 6.5, z: 41.5 },
    // Room C - SE (x:38-47, z:1-10) - 3 kobolds
    { x: 41.5, z: 4.5 }, { x: 43.5, z: 4.5 }, { x: 42.5, z: 6.5 },
    // Room F - S middle (x:19-26, z:1-8) - 2 kobolds
    { x: 22.5, z: 4.5 }, { x: 24.5, z: 4.5 },
    // Room G - W middle (x:1-8, z:19-26) - 1 kobold (archer added separately)
    { x: 4.5, z: 22.5 },
    // Room H - E middle (x:40-47, z:19-26) - 1 kobold (archer added separately)
    { x: 43.5, z: 22.5 },
    // Room I - N middle (x:19-26, z:40-47) - 2 kobolds
    { x: 22.5, z: 43.5 }, { x: 24.5, z: 43.5 },
];

// Kobold Archer spawns - in the side rooms (updated for 50x50 map)
const koboldArcherSpawns = [
    // Room G - W middle
    { x: 4.5, z: 24.5 },
    // Room H - E middle
    { x: 43.5, z: 24.5 },
    // Room B - NW (one archer in back)
    { x: 4.5, z: 44.5 },
    // Room C - SE (one archer in back)
    { x: 44.5, z: 6.5 },
];

// Helper to create initial units
export function createInitialUnits(): Unit[] {
    return [
        // Player units
        ...Object.keys(UNIT_DATA).map((id, i) => {
            const data = UNIT_DATA[Number(id)];
            return {
                id: Number(id),
                x: 4.5 + (i % 3) * 2,
                z: 4.5 + Math.floor(i / 3) * 2,
                hp: data.hp,
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

// Generate a "basic attack" pseudo-skill for display in UI
export function getBasicAttackSkill(unitId: number): Skill {
    const data = UNIT_DATA[unitId];
    return {
        name: "Attack",
        manaCost: 0,
        cooldown: data.attackCooldown,
        type: "damage",
        targetType: "enemy",
        range: data.range ?? 1.8,
        value: data.damage,
    };
}

// Get all skills for a unit (basic attack + special skills)
export function getAllSkills(unitId: number): Skill[] {
    const data = UNIT_DATA[unitId];
    return [getBasicAttackSkill(unitId), ...data.skills];
}
