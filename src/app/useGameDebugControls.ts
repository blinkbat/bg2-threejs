import type { Scene } from "three";
import { useCallback, useMemo } from "react";
import { soundFns } from "../audio";
import { createLightningPillar } from "../combat/damageEffects";
import type { CharacterStats, Unit } from "../core/types";
import { AREAS, type AreaId } from "../game/areas";
import {
    getEffectiveMaxHp,
    getEffectiveMaxMana,
    getXpForLevel,
    UNIT_DATA,
} from "../game/playerUnits";
import {
    HP_PER_VITALITY,
    LEVEL_UP_HP,
    LEVEL_UP_MANA,
    LEVEL_UP_SKILL_POINTS,
    LEVEL_UP_STAT_POINTS,
    MP_PER_INTELLIGENCE,
} from "../game/statBonuses";
import type { PersistedPlayer } from "./gameSetup";
import { savePlaytestSettings, type PlaytestSettings } from "../hooks/localStorage";
import {
    DEFAULT_LIGHTING_TUNING,
    type LightingTuningSettings,
} from "./gameShared";
import {
    STAT_BOOST_AMOUNT,
    ZERO_STATS,
} from "./helpers";

interface DebugSceneState {
    scene: Scene | null;
    unitGroups: Record<number, { position: { x: number; z: number } }>;
}

interface UseGameDebugControlsArgs {
    addLog: (text: string, color?: string) => void;
    buildPersistedPlayers: (units: Unit[], preserveAreaTargets: boolean) => PersistedPlayer[];
    currentAreaId: AreaId;
    lightingTuning: LightingTuningSettings;
    onAreaTransition: (
        players: PersistedPlayer[],
        targetArea: AreaId,
        spawn: { x: number; z: number },
        direction?: "north" | "south" | "east" | "west"
    ) => void;
    playtestSettings: PlaytestSettings;
    sceneState: DebugSceneState;
    setLightingTuning: React.Dispatch<React.SetStateAction<LightingTuningSettings>>;
    setPlaytestSettings: React.Dispatch<React.SetStateAction<PlaytestSettings>>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    unitsStateRef: React.MutableRefObject<Unit[]>;
}

interface UseGameDebugControlsResult {
    handleAddXp: (amount: number) => void;
    handleResetLightingTuning: () => void;
    handleStatBoost: () => void;
    handleTogglePlaytestSkipDialogs: () => void;
    handleTogglePlaytestUnlockAllSkills: () => void;
    handleUpdateLightingTuning: (patch: Partial<LightingTuningSettings>) => void;
    handleWarpToArea: (areaId: AreaId) => void;
    lightingTuningOutput: string;
}

export function useGameDebugControls({
    addLog,
    buildPersistedPlayers,
    currentAreaId,
    lightingTuning,
    onAreaTransition,
    playtestSettings,
    sceneState,
    setLightingTuning,
    setPlaytestSettings,
    setUnits,
    unitsStateRef,
}: UseGameDebugControlsArgs): UseGameDebugControlsResult {
    const handleWarpToArea = useCallback((areaId: AreaId) => {
        const persistedState = buildPersistedPlayers(unitsStateRef.current, false);
        onAreaTransition(persistedState, areaId, AREAS[areaId].defaultSpawn);
    }, [buildPersistedPlayers, onAreaTransition, unitsStateRef]);

    const handleAddXp = useCallback((amount: number) => {
        const scene = sceneState.scene;
        if (!scene) return;

        const currentUnits = unitsStateRef.current;
        const leveledUpIds: number[] = [];
        for (const unit of currentUnits) {
            if (unit.team !== "player" || unit.hp <= 0) continue;

            const newExp = (unit.exp ?? 0) + amount;
            if (newExp >= getXpForLevel((unit.level ?? 1) + 1)) {
                leveledUpIds.push(unit.id);
            }
        }

        setUnits(prev => prev.map(unit => {
            if (unit.team !== "player" || unit.hp <= 0) {
                return unit;
            }

            const newExp = (unit.exp ?? 0) + amount;
            const currentLevel = unit.level ?? 1;
            if (newExp < getXpForLevel(currentLevel + 1)) {
                return { ...unit, exp: newExp };
            }

            const maxHp = getEffectiveMaxHp(unit.id, unit);
            const maxMana = getEffectiveMaxMana(unit.id, unit);
            return {
                ...unit,
                exp: newExp,
                level: currentLevel + 1,
                statPoints: (unit.statPoints ?? 0) + LEVEL_UP_STAT_POINTS,
                skillPoints: (unit.skillPoints ?? 0) + LEVEL_UP_SKILL_POINTS,
                hp: Math.min(unit.hp + LEVEL_UP_HP, maxHp),
                mana: Math.min((unit.mana ?? 0) + LEVEL_UP_MANA, maxMana),
                stats: unit.stats ?? { strength: 0, dexterity: 0, vitality: 0, intelligence: 0, faith: 0 },
            };
        }));

        addLog(`Debug: Party gained ${amount} Experience!`, "#9b59b6");
        if (leveledUpIds.length === 0) {
            return;
        }

        const names = leveledUpIds.map(id => UNIT_DATA[id]?.name ?? "Unknown").join(", ");
        addLog(`${names} leveled up! +${LEVEL_UP_STAT_POINTS} stat points available.`, "#ffd700");
        soundFns.playLevelUp();

        for (const unitId of leveledUpIds) {
            const unitGroup = sceneState.unitGroups[unitId];
            if (!unitGroup) continue;

            createLightningPillar(scene, unitGroup.position.x, unitGroup.position.z, {
                color: "#ffd700",
                duration: 600,
                radius: 0.3,
                height: 10,
            });
        }
    }, [addLog, sceneState, setUnits, unitsStateRef]);

    const handleStatBoost = useCallback(() => {
        setUnits(prev => prev.map(unit => {
            if (unit.team !== "player") {
                return unit;
            }

            const currentStats = unit.stats ?? ZERO_STATS;
            const boostedStats: CharacterStats = {
                strength: currentStats.strength + STAT_BOOST_AMOUNT,
                dexterity: currentStats.dexterity + STAT_BOOST_AMOUNT,
                vitality: currentStats.vitality + STAT_BOOST_AMOUNT,
                intelligence: currentStats.intelligence + STAT_BOOST_AMOUNT,
                faith: currentStats.faith + STAT_BOOST_AMOUNT,
            };

            const updatedUnit: Unit = { ...unit, stats: boostedStats };
            if (unit.hp <= 0) {
                return updatedUnit;
            }

            const nextHpCap = getEffectiveMaxHp(unit.id, updatedUnit);
            const nextManaCap = getEffectiveMaxMana(unit.id, updatedUnit);
            const nextMana = unit.mana === undefined
                ? undefined
                : Math.min(unit.mana + STAT_BOOST_AMOUNT * MP_PER_INTELLIGENCE, nextManaCap);

            return {
                ...updatedUnit,
                hp: Math.min(unit.hp + STAT_BOOST_AMOUNT * HP_PER_VITALITY, nextHpCap),
                mana: nextMana,
            };
        }));

        addLog(`Debug: Stat Boost applied (+${STAT_BOOST_AMOUNT} to all stats).`, "#9b59b6");
    }, [addLog, setUnits]);

    const unlockAllPlayerSkills = useCallback(() => {
        setUnits(prev => prev.map(unit => {
            if (unit.team !== "player") {
                return unit;
            }

            const data = UNIT_DATA[unit.id];
            if (!data) {
                return unit;
            }

            const unlockedSkillNames = data.skills.map(skill => skill.name);
            const currentSkills = unit.learnedSkills ?? [];
            const alreadyUnlocked = unlockedSkillNames.length === currentSkills.length
                && unlockedSkillNames.every(name => currentSkills.includes(name));
            if (alreadyUnlocked) {
                return unit;
            }

            return { ...unit, learnedSkills: unlockedSkillNames };
        }));
    }, [setUnits]);

    const updatePlaytestSettings = useCallback((patch: Partial<PlaytestSettings>) => {
        setPlaytestSettings(prev => {
            const next = { ...prev, ...patch };
            savePlaytestSettings(next);
            return next;
        });
    }, [setPlaytestSettings]);

    const handleTogglePlaytestUnlockAllSkills = useCallback(() => {
        const nextValue = !playtestSettings.unlockAllSkills;
        updatePlaytestSettings({ unlockAllSkills: nextValue });
        if (nextValue) {
            unlockAllPlayerSkills();
        }

        addLog(
            `Debug: Playtest option "Unlock Skills" ${nextValue ? "enabled" : "disabled"}.`,
            nextValue ? "#9b59b6" : "#888"
        );
    }, [addLog, playtestSettings.unlockAllSkills, unlockAllPlayerSkills, updatePlaytestSettings]);

    const handleTogglePlaytestSkipDialogs = useCallback(() => {
        const nextValue = !playtestSettings.skipDialogs;
        updatePlaytestSettings({ skipDialogs: nextValue });
        addLog(
            `Debug: Playtest option "Skip Dialogs" ${nextValue ? "enabled" : "disabled"}.`,
            nextValue ? "#9b59b6" : "#888"
        );
    }, [addLog, playtestSettings.skipDialogs, updatePlaytestSettings]);

    const handleUpdateLightingTuning = useCallback((patch: Partial<LightingTuningSettings>) => {
        setLightingTuning(prev => ({ ...prev, ...patch }));
    }, [setLightingTuning]);

    const handleResetLightingTuning = useCallback(() => {
        setLightingTuning({ ...DEFAULT_LIGHTING_TUNING });
    }, [setLightingTuning]);

    const lightingTuningOutput = useMemo(() => {
        const payload = {
            areaId: currentAreaId,
            ...lightingTuning,
        };
        const compact = [
            `area=${payload.areaId}`,
            `shadows=${payload.shadowsEnabled ? 1 : 0}`,
            `exp=${payload.exposureScale.toFixed(2)}`,
            `amb=${payload.ambientScale.toFixed(2)}`,
            `hemi=${payload.hemisphereScale.toFixed(2)}`,
            `dir=${payload.directionalScale.toFixed(2)}`,
            `srad=${payload.shadowRadius.toFixed(2)}`,
            `sbias=${payload.shadowBias.toFixed(5)}`,
            `snbias=${payload.shadowNormalBias.toFixed(3)}`,
            `sprE=${payload.spriteEmissiveScale.toFixed(2)}`,
            `sprR=${payload.spriteRoughness.toFixed(2)}`,
            `sprM=${payload.spriteMetalness.toFixed(2)}`,
        ].join(" ");
        return `${JSON.stringify(payload, null, 2)}\n\n${compact}`;
    }, [currentAreaId, lightingTuning]);

    return {
        handleAddXp,
        handleResetLightingTuning,
        handleStatBoost,
        handleTogglePlaytestSkipDialogs,
        handleTogglePlaytestUnlockAllSkills,
        handleUpdateLightingTuning,
        handleWarpToArea,
        lightingTuningOutput,
    };
}
