import type { CharacterStats, SummonType, Unit } from "../core/types";
import { findNearestPassable } from "../ai/pathfinding";
import { findSpawnPositions } from "../game/formation";
import { getCurrentArea, getCurrentAreaId } from "../game/areas";
import { ENEMY_STATS } from "../game/enemyStats";
import { initializeUnitIdCounter } from "../gameLoop";
import { loadFormationOrder } from "../hooks/formationStorage";
import {
    CORE_PLAYER_IDS,
    UNIT_DATA,
    getEffectiveMaxHpForStats,
    getEffectiveMaxManaForStats,
    getStartingPlayerStats,
} from "../game/playerUnits";
import { getForwardVectorForDirection, type CardinalDirection } from "./helpers";

const INITIAL_XP_VALUES = [0, 10, 15, 20, 25, 30];

export interface PersistedPlayer {
    id: number;
    hp: number;
    x?: number;
    z?: number;
    mana?: number;
    level?: number;
    exp?: number;
    stats?: CharacterStats;
    statPoints?: number;
    skillPoints?: number;
    learnedSkills?: string[];
    statusEffects?: Unit["statusEffects"];
    cantripUses?: Record<string, number>;
    summonType?: SummonType;
    summonedBy?: number;
    summonExpireAt?: number;
    summonRemainingDurationMs?: number;
}

interface CreateUnitsForAreaOptions {
    persistedPlayers: PersistedPlayer[] | null;
    spawnPoint: { x: number; z: number } | null;
    spawnDirection?: CardinalDirection;
    initialKilledEnemies: Set<string> | null;
    initialEnemyPositions: Partial<Record<string, { x: number; z: number }>> | null;
    playtestUnlockAllSkills: boolean;
}

function getAncestorSummonPosition(
    spawn: { x: number; z: number },
    forward: { x: number; z: number },
    side: { x: number; z: number },
    index: number
): { x: number; z: number } {
    const rank = Math.floor(index / 2);
    const lane = index % 2 === 0 ? -1 : 1;
    const desiredX = spawn.x - forward.x * (3.3 + rank * 1.2) + side.x * lane * 1.2;
    const desiredZ = spawn.z - forward.z * (3.3 + rank * 1.2) + side.z * lane * 1.2;
    return findNearestPassable(desiredX, desiredZ, 5) ?? { x: spawn.x, z: spawn.z };
}

function getVishasEyeSummonPosition(
    anchor: { x: number; z: number },
    orbIndex: number
): { x: number; z: number } {
    const angle = (Math.PI * 2 * orbIndex) / 3;
    const desiredX = anchor.x + Math.cos(angle) * 1.35;
    const desiredZ = anchor.z + Math.sin(angle) * 1.35;
    return findNearestPassable(desiredX, desiredZ, 4) ?? anchor;
}

export function createUnitsForArea(options: CreateUnitsForAreaOptions): Unit[] {
    const { persistedPlayers, spawnPoint, spawnDirection, initialKilledEnemies, initialEnemyPositions, playtestUnlockAllSkills } = options;
    const area = getCurrentArea();
    const spawn = spawnPoint ?? area.defaultSpawn;

    // Sort player IDs by formation order so slot 0 (tip) goes to the right unit
    const formationOrder = loadFormationOrder();
    const playerIds = [...CORE_PLAYER_IDS].sort((a, b) => {
        const aIndex = formationOrder.indexOf(a);
        const bIndex = formationOrder.indexOf(b);
        return (aIndex === -1 ? 100 + a : aIndex) - (bIndex === -1 ? 100 + b : bIndex);
    });
    const spawnPositions = findSpawnPositions(spawn.x, spawn.z, playerIds.length, spawnDirection ?? "north");

    const players: Unit[] = playerIds.map((id, index) => {
        const data = UNIT_DATA[id];
        const persisted = persistedPlayers?.find(player => player.id === id);
        const persistedX = persisted?.x;
        const persistedZ = persisted?.z;
        const hasPersistedPosition = persistedX !== undefined && persistedZ !== undefined;
        const pos = hasPersistedPosition
            ? { x: persistedX, z: persistedZ }
            : (spawnPositions[index] ?? { x: spawn.x, z: spawn.z });
        const initialExp = persisted?.exp ?? (INITIAL_XP_VALUES[id] ?? 0);
        const startingStats = persisted?.stats ?? getStartingPlayerStats(id);
        const effectiveMaxHp = getEffectiveMaxHpForStats(id, startingStats);
        const effectiveMaxMana = getEffectiveMaxManaForStats(id, startingStats);
        const learnedSkills = playtestUnlockAllSkills
            ? data.skills.map(skill => skill.name)
            : (persisted?.learnedSkills ?? []);
        const defaultCantripUses = data.skills
            .filter(skill => skill.isCantrip && skill.maxUses)
            .reduce<Record<string, number>>((acc, skill) => ({ ...acc, [skill.name]: skill.maxUses! }), {});
        return {
            id,
            x: pos.x,
            z: pos.z,
            hp: persisted ? Math.max(0, Math.min(persisted.hp, effectiveMaxHp)) : effectiveMaxHp,
            mana: persisted ? Math.max(0, Math.min(persisted.mana ?? 0, effectiveMaxMana)) : effectiveMaxMana,
            level: persisted?.level ?? 1,
            exp: initialExp,
            stats: startingStats,
            statPoints: persisted?.statPoints ?? 0,
            skillPoints: persisted?.skillPoints ?? 1,
            learnedSkills,
            team: "player" as const,
            target: null,
            aiEnabled: true,
            statusEffects: persisted?.statusEffects,
            cantripUses: { ...defaultCantripUses, ...(persisted?.cantripUses ?? {}) },
        };
    });

    const forward = getForwardVectorForDirection(spawnDirection);
    const side = { x: -forward.z, z: forward.x };
    const summonPersisted = (persistedPlayers ?? [])
        .filter(player => player.summonType !== undefined && player.hp > 0)
        .sort((left, right) => left.id - right.id);
    const corePlayerPositionById = new Map<number, { x: number; z: number }>(
        players.map(player => [player.id, { x: player.x, z: player.z }])
    );
    const ancestorCountBySummoner = new Map<number, number>();
    const orbCountBySummoner = new Map<number, number>();
    const summons: Unit[] = [];
    summonPersisted.forEach((persisted) => {
        const data = UNIT_DATA[persisted.id];
        if (!data) return;
        const summonStats = persisted.stats;
        const effectiveMaxHp = getEffectiveMaxHpForStats(persisted.id, summonStats);
        const effectiveMaxMana = getEffectiveMaxManaForStats(persisted.id, summonStats);

        let pos: { x: number; z: number };
        if (persisted.x !== undefined && persisted.z !== undefined) {
            pos = { x: persisted.x, z: persisted.z };
        } else if (persisted.summonType === "ancestor_warrior") {
            const summonerId = persisted.summonedBy ?? -1;
            const summonIndex = ancestorCountBySummoner.get(summonerId) ?? 0;
            ancestorCountBySummoner.set(summonerId, summonIndex + 1);
            pos = getAncestorSummonPosition(spawn, forward, side, summonIndex);
        } else if (persisted.summonType === "vishas_eye_orb") {
            const summonerAnchor = persisted.summonedBy !== undefined
                ? corePlayerPositionById.get(persisted.summonedBy)
                : undefined;
            const anchor = summonerAnchor ?? { x: spawn.x, z: spawn.z };
            const summonerId = persisted.summonedBy ?? -1;
            const orbIndex = orbCountBySummoner.get(summonerId) ?? 0;
            orbCountBySummoner.set(summonerId, orbIndex + 1);
            pos = getVishasEyeSummonPosition(anchor, orbIndex);
        } else {
            pos = { x: spawn.x, z: spawn.z };
        }

        summons.push({
            id: persisted.id,
            x: pos.x,
            z: pos.z,
            hp: Math.max(0, Math.min(persisted.hp, effectiveMaxHp)),
            mana: Math.max(0, Math.min(persisted.mana ?? data.mana ?? 0, effectiveMaxMana)),
            level: persisted.level ?? 1,
            exp: persisted.exp ?? 0,
            stats: summonStats,
            statPoints: persisted.statPoints ?? 0,
            skillPoints: persisted.skillPoints ?? 0,
            learnedSkills: persisted.learnedSkills ?? [],
            team: "player" as const,
            target: null,
            aiEnabled: true,
            statusEffects: persisted.statusEffects,
            cantripUses: persisted.cantripUses,
            summonType: persisted.summonType,
            summonedBy: persisted.summonedBy,
            summonExpireAt: persisted.summonExpireAt,
        });
    });

    const areaId = getCurrentAreaId();
    const killedSet = initialKilledEnemies ?? new Set<string>();
    const enemies: Unit[] = [];
    const invulnerableStatus = {
        type: "invul" as const,
        duration: Number.MAX_SAFE_INTEGER,
        tickInterval: 1000,
        timeSinceTick: 0,
        lastUpdateTime: Date.now(),
        damagePerTick: 0,
        sourceId: -1,
    };
    area.enemySpawns.forEach((spawnDef, spawnIndex) => {
        const enemyKey = `${areaId}-${spawnIndex}`;
        if (killedSet.has(enemyKey)) return;
        const stats = ENEMY_STATS[spawnDef.type];
        const savedEnemyPosition = initialEnemyPositions?.[enemyKey];
        const enemyX = savedEnemyPosition?.x ?? spawnDef.x;
        const enemyZ = savedEnemyPosition?.z ?? spawnDef.z;
        if (spawnDef.type === "innkeeper") {
            enemies.push({
                id: 100 + spawnIndex,
                x: enemyX,
                z: enemyZ,
                hp: stats.maxHp,
                team: "neutral" as const,
                enemyType: spawnDef.type,
                target: null,
                aiEnabled: false,
                statusEffects: [invulnerableStatus],
            });
            return;
        }
        enemies.push({
            id: 100 + spawnIndex,
            x: enemyX,
            z: enemyZ,
            hp: stats.maxHp,
            team: "enemy" as const,
            enemyType: spawnDef.type,
            target: null,
            aiEnabled: true,
            ...(stats.frontShield && { facing: 0 }),
        });
    });

    const allUnits = [...players, ...summons, ...enemies];
    initializeUnitIdCounter(allUnits);
    return allUnits;
}
