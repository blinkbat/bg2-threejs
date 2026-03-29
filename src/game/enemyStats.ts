import type { EnemyStats, EnemyType, MonsterType, Unit } from "../core/types";
import { DEFAULT_MOVE_SPEED } from "../core/constants";

const AMOEBA_SPLIT_HP_SCALE = 0.7;

// =============================================================================
// ENEMY STATS - Keyed by EnemyType
// =============================================================================

export const ENEMY_STATS: Record<EnemyType, EnemyStats> = {
    acid_slug: {
        name: "Acid Slug",
        monsterType: "beast",
        tier: "enemy",
        hp: 45,
        maxHp: 45,
        damage: [2, 5],
        accuracy: 65,
        armor: 1,
        aggroRange: 7,
        attackCooldown: 2000,
        size: 1.0,
        moveSpeed: 0.4,    // Very slow - keep patrol movement less twitchy
        acidTrail: true,   // Leaves acid on cells it moves through
        acidAura: true,    // Periodically creates acid around itself
        acidAuraCooldown: 3500,  // 3.5 seconds between aura creation
        acidAuraRadius: 1.5,     // 1.5 grid cells around itself
        expReward: 30
    },
    ancient_construct: {
        name: "Ancient Construct",
        monsterType: "construct",
        tier: "boss",
        hp: 300,
        maxHp: 300,
        damage: [10, 16],
        accuracy: 70,
        armor: 3,          // Heavy armor (magic bypasses)
        aggroRange: 12,
        attackCooldown: 2500,
        size: 2.5,         // Large boss
        moveSpeed: 0.6,    // Moderately slow
        aggressiveTargeting: true,  // Immediately retargets to damage sources
        expReward: 250,
        chargeAttack: {
            kind: "ability",
            name: "Cataclysm",
            cooldown: 18000,   // 18 seconds between charges
            chargeTime: 5000,  // 5 seconds to charge
            damage: [25, 40],  // High damage
            crossWidth: 3,     // 3 tiles wide
            crossLength: 6,    // 6 tiles long in each direction
            damageType: "chaos"
        }
    },
    armored_crab: {
        name: "Armored Crab",
        monsterType: "beast",
        tier: "miniboss",
        hp: 95,
        maxHp: 95,
        damage: [7, 12],
        accuracy: 65,
        armor: 4,              // Heavy shell
        aggroRange: 8,
        attackCooldown: 2400,
        size: 1.8,             // Large enemy
        moveSpeed: 0.55,       // Slow scuttling
        expReward: 90,
        baseCrit: 15,          // Medium crit chance
        stunChance: 35,        // Medium chance to stun on hit
        stunDuration: 1800
    },
    baby_kraken: {
        name: "Kraken Nymph",
        monsterType: "beast",
        tier: "boss",
        hp: 150,
        maxHp: 150,
        damage: [8, 14],
        accuracy: 65,
        armor: 2,
        aggroRange: 12,
        attackCooldown: 3000,
        size: 2.5,             // Large
        moveSpeed: 0.2,        // VERY slow
        expReward: 300,
        tentacleSkill: {
            kind: "ability",
            cooldown: 4000,        // Spawn tentacle every 4 seconds
            maxTentacles: 3,       // Up to 3 active tentacles
            spawnRange: 6,         // Tentacles spawn up to 6 tiles away toward targets
            tentacleDuration: 5000, // Tentacles last 5 seconds
            damageToParent: 15     // Killing tentacle deals 15 damage to kraken
        }
    },
    basilisk: {
        name: "Basilisk Youngling",
        monsterType: "beast",
        tier: "miniboss",
        hp: 180,
        maxHp: 180,
        damage: [8, 14],
        accuracy: 70,
        armor: 3,
        aggroRange: 10,
        attackCooldown: 2200,
        moveSpeed: 0.7,
        size: 1.8,
        expReward: 115,
        baseCrit: 5,
        biteChance: 20,
        biteDamage: [14, 22],
        biteCrit: 40,
        glareSkill: {
            kind: "ability",
            name: "Stunning Glare",
            cooldown: 8000,
            range: 7,
            coneAngle: Math.PI / 4,
            coneDistance: 5,
            delay: 1500,
            damage: [6, 12],
            damageType: "chaos",
            stunDuration: 2500
        }
    },
    bat: {
        name: "Vampire Bat",
        monsterType: "beast",
        tier: "enemy",
        hp: 25,
        maxHp: 25,
        damage: [3, 7],
        accuracy: 70,
        armor: 1,
        aggroRange: 10,    // Good vision in the dark
        attackCooldown: 1200,  // Fast attacks
        size: 1,
        moveSpeed: 1.4,    // Fast flyer (140% normal speed)
        flying: true,      // Floats above ground
        lifesteal: 0.5,    // Heals for 50% of damage dealt
        expReward: 20
    },
    bloated_corpse: {
        name: "Bloated Corpse",
        monsterType: "undead",
        tier: "enemy",
        hp: 110,
        maxHp: 110,
        damage: [5, 9],
        accuracy: 55,
        armor: 1,
        aggroRange: 8,
        attackCooldown: 2400,
        size: 1.35,            // Chunky, lumbering body
        moveSpeed: 0.42,       // Slow zombie
        expReward: 58,
        deathAcidPool: {
            radius: 2.2,
            duration: 10000
        }
    },
    brood_mother: {
        name: "Brood Mother",
        monsterType: "beast",
        tier: "miniboss",
        hp: 45,
        maxHp: 45,
        damage: [3, 8],
        accuracy: 55,
        armor: 2,
        aggroRange: 12,  // Good LOS - sees you from far
        attackCooldown: 2500,
        size: 1.8,  // Large
        moveSpeed: 0.5,  // 50% slower than normal - lumbering
        expReward: 36,
        spawnSkill: {
            kind: "ability",
            name: "spawn",
            spawnType: "broodling",
            cooldown: 4000,  // Spawn every 4 seconds when in combat
            maxSpawns: 3,    // Max 3 broodlings at once
            spawnRange: 1.5  // Spawn nearby
        }
    },
    broodling: {
        name: "Broodling",
        monsterType: "beast",
        tier: "enemy",
        hp: 5,
        maxHp: 5,
        damage: [1, 2],  // Low damage
        accuracy: 65,
        armor: 0,
        aggroRange: 4,  // Limited LOS - relies on mother's sight
        attackCooldown: 1000,  // Fast attacks
        size: 0.8,  // Small
        range: 1.0,  // Short melee range - they're small
        poisonChance: 20,  // 20% chance to apply weak poison on hit
        poisonDamage: 1,  // Weak poison
        moveSpeed: 1.8,  // 50% faster than normal
        expReward: 2
    },
    chittering_crabling: {
        name: "Chittering Crabling",
        monsterType: "beast",
        tier: "enemy",
        hp: 24,
        maxHp: 24,
        damage: [3, 5],
        accuracy: 65,
        armor: 2,              // Hard shell
        aggroRange: 6,
        attackCooldown: 1400,  // Fast snipping
        size: 0.7,             // Small
        moveSpeed: 1.2,        // Quick scuttler
        expReward: 12
    },
    corrupt_druid: {
        name: "Corrupt Druid",
        monsterType: "humanoid",
        tier: "miniboss",
        hp: 125,
        maxHp: 125,
        damage: [5, 9],        // Chaos missile damage
        accuracy: 70,
        armor: 0,
        aggroRange: 10,
        attackCooldown: 2200,  // Slower caster attacks
        range: 7,              // Long range
        projectileColor: "#6b1f6b",  // Dark purple chaos
        size: 1.1,
        moveSpeed: 0.8,        // Slower movement
        expReward: 75,
        // Kiting behavior - retreat when players get close (less aggressive)
        kiteTrigger: 3,
        kiteDistance: 2.5,
        kiteCooldown: 5000,
        // Vines skill - immobilizes and damages target
        vinesSkill: {
            kind: "spell",
            cooldown: 12000,   // 12 seconds between casts
            range: 6,          // Cast range
            duration: 5000,    // 5 seconds immobilized
            damage: [4, 8]     // Damage on grab
        }
    },
    dire_possum: {
        name: "Dire Possum",
        monsterType: "beast",
        tier: "enemy",
        hp: 35,
        maxHp: 35,
        damage: [3, 7],
        accuracy: 60,
        armor: 2,
        aggroRange: 7,
        attackCooldown: 2000,
        moveSpeed: 0.9,
        size: 1.1,
        expReward: 24,
        enrage: {
            hpThreshold: 0.5,
            speedMultiplier: 1.5,
            damageMultiplier: 1.4,
        }
    },
    feral_hound: {
        name: "Feral Hound",
        monsterType: "beast",
        tier: "enemy",
        hp: 12,
        maxHp: 12,
        damage: [2, 5],
        accuracy: 65,
        armor: 0,
        aggroRange: 10,
        attackCooldown: 1600,  // Fast attacks
        size: 0.85,
        moveSpeed: 1.4,    // Fast - 140% normal speed
        expReward: 16,
        baseCrit: 20,      // 20% crit chance
        leapSkill: {
            kind: "ability",
            cooldown: 7000,    // Can leap every 7 seconds
            minRange: 3,       // Only leap if target is at least 3 tiles away
            maxRange: 5,       // Maximum leap distance
            damage: [2, 4]     // Bonus damage on landing
        }
    },
    giant_amoeba: {
        name: "Giant Amoeba",
        monsterType: "beast",
        tier: "enemy",
        hp: 35,
        maxHp: 35,
        damage: [3, 6],
        accuracy: 55,
        armor: 0,
        aggroRange: 6,
        attackCooldown: 2200,
        size: 2.0,  // Large - decreases with each split
        moveSpeed: 0.7,  // Slightly slower, it's a blob
        maxSplitCount: 2,
        slowChance: 30,  // 30% chance to slow on hit
        expReward: 5
    },
    innkeeper: {
        name: "Innkeeper",
        monsterType: "humanoid",
        tier: "npc",
        hp: 9999,
        maxHp: 9999,
        damage: [0, 0],
        accuracy: 100,
        armor: 999,
        aggroRange: 0,
        attackCooldown: 999999,
        size: 1.1,
        moveSpeed: 0,
        expReward: 0
    },
    kobold: {
        name: "Kobold",
        monsterType: "humanoid",
        tier: "enemy",
        hp: 12,
        maxHp: 12,
        damage: [1, 5],
        accuracy: 50,
        armor: 0,
        aggroRange: 6,
        attackCooldown: 2000,
        moveSpeed: DEFAULT_MOVE_SPEED,
        expReward: 8
    },
    kobold_archer: {
        name: "Kobold Archer",
        monsterType: "humanoid",
        tier: "enemy",
        hp: 10,
        maxHp: 10,
        damage: [3, 7],
        accuracy: 55,
        armor: 0,
        aggroRange: 8,
        attackCooldown: 2500,
        range: 6,
        projectileColor: "#8B4513",
        poisonChance: 35,  // 35% chance to poison on hit
        moveSpeed: DEFAULT_MOVE_SPEED,
        expReward: 12,
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,      // Start kiting when player within this range
        kiteDistance: 4,     // How far to retreat
        kiteCooldown: 3000   // Can only kite every 3 seconds
    },
    kobold_witch_doctor: {
        name: "Kobold Witch Doctor",
        monsterType: "humanoid",
        tier: "enemy",
        hp: 14,
        maxHp: 14,
        damage: [1, 3],
        accuracy: 50,
        armor: 0,
        aggroRange: 8,
        attackCooldown: 3000,
        range: 5,
        projectileColor: "#9932CC",  // Dark orchid
        moveSpeed: DEFAULT_MOVE_SPEED,
        expReward: 15,
        healSkill: {
            kind: "spell",
            name: "Dark Mending",
            cooldown: 8000,  // 8 seconds
            heal: [6, 12],
            range: 6  // Range to find hurt allies
        },
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,      // Start kiting when player within this range
        kiteDistance: 5,     // How far to retreat
        kiteCooldown: 3500   // Can only kite every 3.5 seconds
    },
    kraken_tentacle: {
        name: "Kraken Tentacle",
        monsterType: "beast",
        tier: "enemy",
        hp: 20,
        maxHp: 20,
        damage: [4, 8],
        accuracy: 70,
        armor: 0,
        aggroRange: 3,         // Short aggro - melee turret
        attackCooldown: 1500,  // Fast attacks
        size: 0.8,
        moveSpeed: 0,          // Stationary - does not move
        expReward: 2
    },
    magma_imp: {
        name: "Magma Imp",
        monsterType: "demon",
        tier: "enemy",
        hp: 25,
        maxHp: 25,
        damage: [6, 10],       // Fireball damage
        accuracy: 75,
        armor: 0,
        aggroRange: 10,
        attackCooldown: 4000,  // Slow attack rate
        range: 8,              // Long range caster
        size: 1.0,             // Medium size
        moveSpeed: 0.5,        // Very slow flyer
        flying: true,          // Floats above ground (ignores lava)
        fireballAttack: true,  // Uses slow fireball that hurts everything
        expReward: 30,
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,        // Start kiting when player within this range
        kiteDistance: 3,       // How far to retreat (shorter due to slow speed)
        kiteCooldown: 4000     // Can only kite every 4 seconds
    },
    necromancer: {
        name: "Necromancer",
        monsterType: "humanoid",
        tier: "miniboss",
        hp: 60,
        maxHp: 60,
        damage: [4, 8],            // Dark bolt damage
        accuracy: 65,
        armor: 0,
        aggroRange: 10,
        attackCooldown: 2500,
        range: 7,                  // Ranged caster
        projectileColor: "#6b1f6b", // Dark purple bolt
        size: 1.3,                 // Tall
        moveSpeed: 0.6,            // Slow movement
        expReward: 65,
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,
        kiteDistance: 3,
        kiteCooldown: 4000,
        // Raise dead - batch spawns skeleton minions, re-raises when all die
        raiseSkill: {
            kind: "spell",
            spawnType: "skeleton_minion",
            cooldown: 8000,        // 8 seconds after all die before re-raising
            spawnCount: 3,         // Raises 3 at once
            spawnRange: 2          // Spawn within 2 tiles
        },
        // Area curse - delayed AoE at player position
        curseSkill: {
            kind: "spell",
            name: "Dark Curse",
            cooldown: 15000,       // 15 seconds between casts
            range: 8,              // Cast range
            radius: 2.5,           // 2.5 tile AoE radius
            delay: 3000,           // 3 second warning before detonation
            damage: [6, 12],
            damageType: "chaos"
        }
    },
    occultist_dreamwalker: {
        name: "Occultist Dreamwalker",
        monsterType: "humanoid",
        tier: "miniboss",
        hp: 55,
        maxHp: 55,
        damage: [3, 6],
        accuracy: 70,
        armor: 0,
        aggroRange: 10,
        attackCooldown: 2500,
        range: 8,
        projectileColor: "#9b59b6",
        size: 1.2,
        moveSpeed: 0.55,
        expReward: 62,
        kiteTrigger: 4,
        kiteDistance: 3,
        kiteCooldown: 4000,
        sleepSkill: {
            kind: "spell",
            name: "Dream Veil",
            cooldown: 12000,
            range: 8,
            radius: 2.5,
            accuracy: 65
        },
        dreamEaterSkill: {
            kind: "spell",
            name: "Dream Eater",
            cooldown: 6000,
            range: 8,
            damage: [20, 30],
            damageType: "chaos"
        }
    },
    occultist_firebreather: {
        name: "Occultist Firebreather",
        monsterType: "humanoid",
        tier: "miniboss",
        hp: 100,
        maxHp: 100,
        damage: [0, 0],
        accuracy: 70,
        armor: 4,
        aggroRange: 8,
        attackCooldown: 1000,
        size: 1.5,
        moveSpeed: 0.35,
        expReward: 72,
        breathSkill: {
            kind: "ability",
            name: "Fire Breath",
            cooldown: 4000,
            range: 4,
            coneAngle: Math.PI / 5,
            coneDistance: 4,
            tickInterval: 500,
            damage: [3, 6],
            damageType: "fire",
            duration: 3000
        }
    },
    occultist_pygmy: {
        name: "Occultist Pygmy",
        monsterType: "humanoid",
        tier: "enemy",
        hp: 15,
        maxHp: 15,
        damage: [2, 4],
        accuracy: 55,
        armor: 0,
        aggroRange: 8,
        attackCooldown: 1200,
        size: 0.6,
        moveSpeed: 1.2,
        expReward: 8
    },
    ogre: {
        name: "Ogre",
        monsterType: "humanoid",
        tier: "miniboss",
        hp: 80,
        maxHp: 80,
        damage: [6, 10],
        accuracy: 60,
        armor: 3,
        aggroRange: 8,
        moveSpeed: 0.4,  // Slow movement
        attackCooldown: 3000,
        size: 2.0,
        expReward: 82,
        skill: {
            kind: "ability",
            name: "Swipe",
            cooldown: 10000,  // 10 seconds
            damage: [9, 16],
            maxTargets: 3,
            range: 2.5,
            damageType: "physical"
        }
    },
    skeleton_minion: {
        name: "Skeletal Offspring",
        monsterType: "undead",
        tier: "enemy",
        hp: 12,
        maxHp: 12,
        damage: [2, 4],
        accuracy: 50,
        armor: 0,
        aggroRange: 6,
        attackCooldown: 1800,
        size: 0.9,                 // Smaller than warrior
        moveSpeed: 1.0,
        expReward: 5               // Low - summoned unit
    },
    skeleton_warrior: {
        name: "Skeleton Warrior",
        monsterType: "undead",
        tier: "enemy",
        hp: 35,
        maxHp: 35,
        damage: [6, 10],
        accuracy: 60,
        armor: 1,
        aggroRange: 7,
        attackCooldown: 2000,
        size: 1.2,
        moveSpeed: 0.9,
        expReward: 20,
        blockChance: 35        // 35% chance to block physical damage
    },
    spine_spitter: {
        name: "Spine Spitter",
        monsterType: "beast",
        tier: "enemy",
        hp: 14,
        maxHp: 14,
        damage: [3, 6],
        accuracy: 60,
        armor: 0,
        aggroRange: 8,
        attackCooldown: 2200,
        range: 6,              // Ranged
        projectileColor: "#5c4a2a",  // Dark spine
        size: 0.9,
        moveSpeed: 0.8,        // Slightly slow
        expReward: 12,
        kiteTrigger: 3,
        kiteDistance: 3,
        kiteCooldown: 3500
    },
    undead_knight: {
        name: "Undead Knight",
        monsterType: "undead",
        tier: "miniboss",
        hp: 160,
        maxHp: 160,
        damage: [12, 22],
        accuracy: 70,
        armor: 3,          // Heavy armor
        aggroRange: 8,
        attackCooldown: 3500,  // Slow heavy swings
        size: 1.6,         // Large
        moveSpeed: 0.35,   // Very slow movement
        frontShield: true, // Blocks all damage from the front
        turnSpeed: 0.15,   // Turns very slowly (15% of normal)
        expReward: 120
    },
    wandering_shade: {
        name: "Wandering Shade",
        monsterType: "undead",
        tier: "enemy",
        hp: 42,
        maxHp: 42,
        damage: [6, 11],
        accuracy: 74,
        armor: 1,
        aggroRange: 11,
        attackCooldown: 1400,
        size: 1.0,
        moveSpeed: 1.7,
        flying: true,
        expReward: 52,
        phaseShiftSkill: {
            kind: "spell",
            name: "Umbral Drift",
            cooldown: 7000,
            invisibleDuration: 1200,
            repositionMinRange: 2.8,
            repositionMaxRange: 5.8
        }
    },
};

const MONSTER_TYPE_LABELS: Record<MonsterType, string> = {
    beast: "Beast",
    construct: "Construct",
    demon: "Demon",
    humanoid: "Humanoid",
    undead: "Undead",
};

export function getMonsterTypeLabel(monsterType: MonsterType): string {
    return MONSTER_TYPE_LABELS[monsterType];
}

export function isEnemyPermanentDeath(unit: Pick<Unit, "enemyType" | "splitCount">): boolean {
    if (unit.enemyType !== "giant_amoeba") {
        return true;
    }

    const maxSplits = ENEMY_STATS.giant_amoeba.maxSplitCount ?? 3;
    return (unit.splitCount ?? 0) >= maxSplits;
}

export function getAmoebaMaxHpForSplitCount(splitCount: number): number {
    const stage = Math.max(0, Math.floor(splitCount));
    const baseMaxHp = ENEMY_STATS.giant_amoeba.maxHp;
    return Math.max(1, Math.floor(baseMaxHp * Math.pow(AMOEBA_SPLIT_HP_SCALE, stage)));
}
