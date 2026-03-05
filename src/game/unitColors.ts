import type { EnemyType, Unit } from "../core/types";

const DEFAULT_PLAYER_SPRITE_COLOR = "#999999";
const DEFAULT_PLAYER_PORTRAIT_COLOR = "#999999";
const DEFAULT_ENEMY_UNIT_COLOR = "#999999";

const PLAYER_UNIT_SPRITE_COLORS: Record<number, string> = {
    1: "#ce6f5f",
    2: "#d4a017",
    3: "#b275ce",
    4: "#3498db",
    5: "#27ae60",
    6: "#c0c8d0",
    7: "#d7c09a",
    8: "#f6edc2",
    9: "#f6edc2",
    10: "#f6edc2",
};

const PLAYER_UNIT_PORTRAIT_COLORS: Record<number, string> = {
    1: "#ce6f5f",
    2: "#d4a017",
    3: "#b275ce",
    4: "#3498db",
    5: "#27ae60",
    6: "#c0c8d0",
    7: "#d7c09a",
    8: "#f6edc2",
    9: "#f6edc2",
    10: "#f6edc2",
};

const ENEMY_UNIT_COLORS: Record<EnemyType, string> = {
    acid_slug: "#a4f018",
    ancient_construct: "#a07028",
    armored_crab: "#e07aa8",
    baby_kraken: "#a040e8",
    basilisk: "#d7e66a",
    bat: "#b77866",
    bloated_corpse: "#70a830",
    brood_mother: "#a868c0",
    broodling: "#9868b0",
    chittering_crabling: "#f26c52",
    corrupt_druid: "#4f7f46",
    dire_possum: "#886040",
    feral_hound: "#c09868",
    giant_amoeba: "#08d858",
    innkeeper: "#c18a52",
    kobold: "#c18e63",
    kobold_archer: "#a35712",
    kobold_witch_doctor: "#8a64bd",
    kraken_tentacle: "#8830e0",
    magma_imp: "#ff7a3d",
    necromancer: "#420042",
    occultist_dreamwalker: "#5800b0",
    occultist_firebreather: "#c42000",
    occultist_pygmy: "#804000",
    ogre: "#408810",
    skeleton_minion: "#b0a868",
    skeleton_warrior: "#c8c078",
    spine_spitter: "#907028",
    undead_knight: "#5d7fb2",
    wandering_shade: "#6080c8",
};

function getPlayerUnitSpriteColor(unitId: number): string {
    return PLAYER_UNIT_SPRITE_COLORS[unitId] ?? DEFAULT_PLAYER_SPRITE_COLOR;
}

function getPlayerUnitPortraitColor(unitId: number): string {
    return PLAYER_UNIT_PORTRAIT_COLORS[unitId] ?? DEFAULT_PLAYER_PORTRAIT_COLOR;
}

export function getPlayerUnitColor(unitId: number): string {
    return getPlayerUnitPortraitColor(unitId);
}

function getEnemyUnitColor(enemyType: EnemyType | undefined): string {
    if (!enemyType) return DEFAULT_ENEMY_UNIT_COLOR;
    return ENEMY_UNIT_COLORS[enemyType] ?? DEFAULT_ENEMY_UNIT_COLOR;
}

export function getUnitColor(unit: Unit): string {
    if (unit.team === "player") {
        return getPlayerUnitSpriteColor(unit.id);
    }
    return getEnemyUnitColor(unit.enemyType);
}
