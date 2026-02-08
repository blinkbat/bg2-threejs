import type { EnemyStats, EnemyType } from "../core/types";
import { DEFAULT_MOVE_SPEED } from "../core/constants";

// =============================================================================
// ENEMY STATS - Keyed by EnemyType
// =============================================================================

export const ENEMY_STATS: Record<EnemyType, EnemyStats> = {
    kobold: {
        name: "Kobold",
        hp: 12,
        maxHp: 12,
        damage: [1, 5],
        accuracy: 50,
        armor: 0,
        color: "#8B4513",
        aggroRange: 6,
        attackCooldown: 2000,
        moveSpeed: DEFAULT_MOVE_SPEED,
        expReward: 8
    },
    kobold_archer: {
        name: "Kobold Archer",
        hp: 10,
        maxHp: 10,
        damage: [3, 7],
        accuracy: 55,
        armor: 0,
        color: "#6B4423",
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
        hp: 14,
        maxHp: 14,
        damage: [1, 3],
        accuracy: 50,
        armor: 0,
        color: "#4a0080",  // Purple for magical
        aggroRange: 8,
        attackCooldown: 3000,
        range: 5,
        projectileColor: "#9932CC",  // Dark orchid
        moveSpeed: DEFAULT_MOVE_SPEED,
        expReward: 15,
        healSkill: {
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
    ogre: {
        name: "Ogre",
        hp: 80,
        maxHp: 80,
        damage: [6, 10],
        accuracy: 60,
        armor: 3,
        color: "#556B2F",
        aggroRange: 8,
        moveSpeed: 0.4,  // Slow movement
        attackCooldown: 3000,
        size: 2.0,
        expReward: 75,
        skill: {
            name: "Swipe",
            cooldown: 10000,  // 10 seconds
            damage: [9, 16],
            maxTargets: 3,
            range: 2.5,
            damageType: "physical"
        }
    },
    brood_mother: {
        name: "Brood Mother",
        hp: 45,
        maxHp: 45,
        damage: [3, 8],
        accuracy: 55,
        armor: 2,
        color: "#4a2c2a",  // Dark brownish-red (spider-like)
        aggroRange: 12,  // Good LOS - sees you from far
        attackCooldown: 2500,
        size: 1.5,  // Medium size
        moveSpeed: 0.5,  // 50% slower than normal - lumbering
        expReward: 30,
        spawnSkill: {
            spawnType: "broodling",
            cooldown: 4000,  // Spawn every 4 seconds when in combat
            maxSpawns: 3,    // Max 3 broodlings at once
            spawnRange: 1.5  // Spawn nearby
        }
    },
    broodling: {
        name: "Broodling",
        hp: 5,
        maxHp: 5,
        damage: [1, 2],  // Low damage
        accuracy: 65,
        armor: 0,
        color: "#5c3a38",  // Lighter brown-red
        aggroRange: 4,  // Limited LOS - relies on mother's sight
        attackCooldown: 1000,  // Fast attacks
        size: 0.6,  // Small
        range: 1.0,  // Short melee range - they're small
        poisonChance: 20,  // 20% chance to apply weak poison on hit
        poisonDamage: 1,  // Weak poison
        moveSpeed: 1.8,  // 50% faster than normal
        expReward: 2
    },
    // Beach enemies - starting area, lower stats
    giant_amoeba: {
        name: "Giant Amoeba",
        hp: 25,
        maxHp: 25,
        damage: [3, 6],
        accuracy: 55,
        armor: 0,
        color: "#3cb371",  // Medium sea green - translucent blob
        aggroRange: 6,
        attackCooldown: 2200,
        size: 2.0,  // Large - decreases with each split
        moveSpeed: 0.7,  // Slightly slower, it's a blob
        maxSplitCount: 3,  // Can split up to 3 times (4 generations total)
        slowChance: 30,  // 30% chance to slow on hit
        expReward: 12
    },
    acid_slug: {
        name: "Acid Slug",
        hp: 45,
        maxHp: 45,
        damage: [2, 5],
        accuracy: 65,
        armor: 1,
        color: "#9acd32",  // Yellow-green - acidic
        aggroRange: 7,
        attackCooldown: 2000,
        size: 1.0,
        moveSpeed: 0.5,    // Slow - it's a slug
        acidTrail: true,   // Leaves acid on cells it moves through
        acidAura: true,    // Periodically creates acid around itself
        acidAuraCooldown: 3500,  // 3.5 seconds between aura creation
        acidAuraRadius: 1.5,     // 1.5 grid cells around itself
        expReward: 30
    },
    bat: {
        name: "Vampire Bat",
        hp: 25,
        maxHp: 25,
        damage: [3, 7],
        accuracy: 70,
        armor: 1,
        color: "#2a1a2a",  // Dark purple-black
        aggroRange: 10,    // Good vision in the dark
        attackCooldown: 1200,  // Fast attacks
        size: 1,
        moveSpeed: 1.4,    // Fast flyer (140% normal speed)
        flying: true,      // Floats above ground
        lifesteal: 0.5,    // Heals for 50% of damage dealt
        expReward: 18
    },
    undead_knight: {
        name: "Undead Knight",
        hp: 120,
        maxHp: 120,
        damage: [8, 18],
        accuracy: 65,
        armor: 2,          // Heavy armor
        color: "#2a3a4a",  // Dark steel blue
        aggroRange: 8,
        attackCooldown: 3500,  // Slow heavy swings
        size: 1.6,         // Large
        moveSpeed: 0.35,   // Very slow movement
        frontShield: true, // Blocks all damage from the front
        turnSpeed: 0.15,   // Turns very slowly (15% of normal)
        expReward: 120
    },
    ancient_construct: {
        name: "Ancient Construct",
        hp: 300,
        maxHp: 300,
        damage: [10, 16],
        accuracy: 70,
        armor: 3,          // Heavy armor (magic bypasses)
        color: "#8b7355",  // Bronze/stone color
        aggroRange: 12,
        attackCooldown: 2500,
        size: 2.5,         // Large boss
        moveSpeed: 0.6,    // Moderately slow
        aggressiveTargeting: true,  // Immediately retargets to damage sources
        expReward: 250,
        chargeAttack: {
            name: "Cataclysm",
            cooldown: 18000,   // 18 seconds between charges
            chargeTime: 5000,  // 5 seconds to charge
            damage: [25, 40],  // High damage
            crossWidth: 3,     // 3 tiles wide
            crossLength: 6,    // 6 tiles long in each direction
            damageType: "chaos"
        }
    },
    feral_hound: {
        name: "Feral Hound",
        hp: 12,
        maxHp: 12,
        damage: [2, 5],
        accuracy: 65,
        armor: 0,
        color: "#5c4033",  // Dark brown
        aggroRange: 10,
        attackCooldown: 1600,  // Fast attacks
        size: 0.85,
        moveSpeed: 1.4,    // Fast - 140% normal speed
        expReward: 16,
        baseCrit: 20,      // 20% crit chance
        leapSkill: {
            cooldown: 7000,    // Can leap every 7 seconds
            minRange: 3,       // Only leap if target is at least 3 tiles away
            maxRange: 5,       // Maximum leap distance
            damage: [2, 4]     // Bonus damage on landing
        }
    },
    corrupt_druid: {
        name: "Corrupt Druid",
        hp: 125,
        maxHp: 125,
        damage: [5, 9],        // Chaos missile damage
        accuracy: 70,
        armor: 0,
        color: "#2d4a1c",      // Dark sickly green
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
            cooldown: 12000,   // 12 seconds between casts
            range: 6,          // Cast range
            duration: 5000,    // 5 seconds immobilized
            damage: [4, 8]     // Damage on grab
        }
    },
    skeleton_warrior: {
        name: "Skeleton Warrior",
        hp: 35,
        maxHp: 35,
        damage: [6, 10],
        accuracy: 60,
        armor: 1,
        color: "#c9c9b0",      // Bone/ivory color
        aggroRange: 7,
        attackCooldown: 2000,
        size: 1.2,
        moveSpeed: 0.9,
        expReward: 20,
        blockChance: 35        // 35% chance to block physical damage
    },
    baby_kraken: {
        name: "Kraken Nymph",
        hp: 150,
        maxHp: 150,
        damage: [8, 14],
        accuracy: 65,
        armor: 2,
        color: "#6b3fa0",      // Purple
        aggroRange: 12,
        attackCooldown: 3000,
        size: 2.5,             // Large
        moveSpeed: 0.2,        // VERY slow
        expReward: 300,
        tentacleSkill: {
            cooldown: 4000,        // Spawn tentacle every 4 seconds
            maxTentacles: 3,       // Up to 3 active tentacles
            spawnRange: 6,         // Tentacles spawn up to 6 tiles away toward targets
            tentacleDuration: 5000, // Tentacles last 5 seconds
            damageToParent: 15     // Killing tentacle deals 15 damage to kraken
        }
    },
    kraken_tentacle: {
        name: "Kraken Tentacle",
        hp: 20,
        maxHp: 20,
        damage: [4, 8],
        accuracy: 70,
        armor: 0,
        color: "#8b5fbf",      // Lighter purple
        aggroRange: 3,         // Short aggro - melee turret
        attackCooldown: 1500,  // Fast attacks
        size: 0.8,
        moveSpeed: 0,          // Stationary - does not move
        expReward: 2
    },
    necromancer: {
        name: "Necromancer",
        hp: 60,
        maxHp: 60,
        damage: [4, 8],            // Dark bolt damage
        accuracy: 65,
        armor: 0,
        color: "#2a0a2a",          // Dark purple-black
        aggroRange: 10,
        attackCooldown: 2500,
        range: 7,                  // Ranged caster
        projectileColor: "#6b1f6b", // Dark purple bolt
        size: 1.3,                 // Tall
        moveSpeed: 0.6,            // Slow movement
        expReward: 50,
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,
        kiteDistance: 3,
        kiteCooldown: 4000,
        // Raise dead - batch spawns skeleton minions, re-raises when all die
        raiseSkill: {
            spawnType: "skeleton_minion",
            cooldown: 8000,        // 8 seconds after all die before re-raising
            spawnCount: 3,         // Raises 3 at once
            spawnRange: 2          // Spawn within 2 tiles
        },
        // Area curse - delayed AoE at player position
        curseSkill: {
            name: "Dark Curse",
            cooldown: 15000,       // 15 seconds between casts
            range: 8,              // Cast range
            radius: 2.5,           // 2.5 tile AoE radius
            delay: 3000,           // 3 second warning before detonation
            damage: [6, 12],
            damageType: "chaos"
        }
    },
    skeleton_minion: {
        name: "Skeleton Minion",
        hp: 12,
        maxHp: 12,
        damage: [2, 4],
        accuracy: 50,
        armor: 0,
        color: "#b0b098",          // Pale bone (slightly different from warrior)
        aggroRange: 6,
        attackCooldown: 1800,
        size: 0.9,                 // Smaller than warrior
        moveSpeed: 1.0,
        expReward: 5               // Low - summoned unit
    },
    magma_imp: {
        name: "Magma Imp",
        hp: 25,
        maxHp: 25,
        damage: [6, 10],       // Fireball damage
        accuracy: 75,
        armor: 0,
        color: "#ff4500",      // Orange-red (magma)
        aggroRange: 10,
        attackCooldown: 3000,  // Slow attack rate
        range: 8,              // Long range caster
        size: 1.0,             // Medium size
        moveSpeed: 0.5,        // Very slow flyer
        flying: true,          // Floats above ground (ignores lava)
        fireballAttack: true,  // Uses slow fireball that hurts everything
        expReward: 25,
        // Kiting behavior - retreat when players get close
        kiteTrigger: 4,        // Start kiting when player within this range
        kiteDistance: 3,       // How far to retreat (shorter due to slow speed)
        kiteCooldown: 4000     // Can only kite every 4 seconds
    }
};
