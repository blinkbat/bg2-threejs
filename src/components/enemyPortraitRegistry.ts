// =============================================================================
// ENEMY PORTRAIT REGISTRY - Sprite URLs by enemy type for UI use (bestiary, etc.)
// =============================================================================

import type { EnemyType } from "../core/types";
import acidSlugSprite from "../assets/acid-slug.png";
import amoebaLgSprite from "../assets/amoeba-lg.png";
import armoredCrabSprite from "../assets/armored_crab.png";
import basiliskYounglingSprite from "../assets/basilisk_youngling.png";
import bloatedCorpseSprite from "../assets/bloated_corpse.png";
import broodMotherSprite from "../assets/brood_mother.png";
import broodlingSprite from "../assets/broodling.png";
import corruptedDruidSprite from "../assets/corrupted_druid.png";
import crablingSprite from "../assets/crabling.png";
import feralHoundSprite from "../assets/feral_hound.png";
import fireImpSprite from "../assets/fire_imp.png";
import koboldArcherSprite from "../assets/kobold_archer.png";
import koboldWarriorSprite from "../assets/kobold_warrior.png";
import koboldWitchDoctorSprite from "../assets/kobold_witch_doctor.png";
import krakenBodySprite from "../assets/kraken-body.png";
import krakenTentacleSprite from "../assets/kraken-tentacle.png";
import monkSprite from "../assets/monk.png";
import necromancerSprite from "../assets/necromancer.png";
import occultistPygmySprite from "../assets/occultist_pygmy.png";
import skeletonWarriorSprite from "../assets/skeleton_warrior.png";
import spineSpitterSprite from "../assets/spine_spitter.png";
import undeadKnightSprite from "../assets/undead_knight.png";
import vampireBatSprite from "../assets/vampire-bat.png";
import wanderingShadeSprite from "../assets/wandering_shade.png";

const ENEMY_PORTRAITS: Partial<Record<EnemyType, string>> = {
    acid_slug: acidSlugSprite,
    ancient_construct: armoredCrabSprite,
    armored_crab: armoredCrabSprite,
    baby_kraken: krakenBodySprite,
    basilisk: basiliskYounglingSprite,
    bat: vampireBatSprite,
    bloated_corpse: bloatedCorpseSprite,
    brood_mother: broodMotherSprite,
    broodling: broodlingSprite,
    chittering_crabling: crablingSprite,
    corrupt_druid: corruptedDruidSprite,
    dire_possum: feralHoundSprite,
    feral_hound: feralHoundSprite,
    giant_amoeba: amoebaLgSprite,
    innkeeper: monkSprite,
    kobold: koboldWarriorSprite,
    kobold_archer: koboldArcherSprite,
    kobold_witch_doctor: koboldWitchDoctorSprite,
    kraken_tentacle: krakenTentacleSprite,
    magma_imp: fireImpSprite,
    necromancer: necromancerSprite,
    occultist_dreamwalker: occultistPygmySprite,
    occultist_firebreather: occultistPygmySprite,
    occultist_pygmy: occultistPygmySprite,
    ogre: undeadKnightSprite,
    skeleton_minion: skeletonWarriorSprite,
    skeleton_warrior: skeletonWarriorSprite,
    spine_spitter: spineSpitterSprite,
    undead_knight: undeadKnightSprite,
    wandering_shade: wanderingShadeSprite,
};

export function getEnemyPortrait(enemyType: EnemyType): string | null {
    return ENEMY_PORTRAITS[enemyType] ?? null;
}
