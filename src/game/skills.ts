import type { Skill, SkillKind } from "../core/types";
import {
    THORNS_DURATION,
    THORNS_DAMAGE_MIN,
    THORNS_DAMAGE_MAX,
    VISHAS_EYES_ORB_DURATION,
    VISHAS_EYES_ORB_HEAL_RADIUS,
    VISHAS_EYES_ORB_HEAL_RANGE,
    FIRE_TILE_DURATION,
    FIRE_DAMAGE_PER_TICK,
    FIRE_TICK_INTERVAL,
    BURN_DURATION,
    BURN_DAMAGE_PER_TICK
} from "../core/constants";

// =============================================================================
// PLAYER SKILLS
// =============================================================================

type BaseSkill = Omit<Skill, "kind">;

const PLAYER_SPELL_SKILL_KEYS: ReadonlySet<string> = new Set([
    "ankh",
    "bodySwap",
    "chainLightning",
    "channeling",
    "cleanse",
    "divineLattice",
    "elorasGrasp",
    "energyShield",
    "fireBolt",
    "fireball",
    "glacialWhorl",
    "heal",
    "holyCross",
    "holyStrike",
    "magicWave",
    "massHeal",
    "restoration",
    "sanctuary",
    "summonAncestor",
    "teleportOther",
    "thunder",
    "turnUndead",
    "vanquishingLight",
    "vishasEyes",
    "wallOfFire",
    "wellOfGravity",
]);

function withSkillKinds(skills: Record<string, BaseSkill>): Record<string, Skill> {
    const resolved: Record<string, Skill> = {};
    for (const [key, skill] of Object.entries(skills)) {
        const kind: SkillKind = PLAYER_SPELL_SKILL_KEYS.has(key) ? "spell" : "ability";
        resolved[key] = { ...skill, kind };
    }
    return resolved;
}

export const SKILLS: Record<string, Skill> = withSkillKinds({
    fireBolt: {
        name: "Fire Bolt",
        description: "Loose a quick bolt of flame that may set the target ablaze.",
        flavor: "\"The small fires count too.\" - Archmage Konen",
        manaCost: 6,
        cooldown: 2500,
        type: "damage",
        targetType: "enemy",
        delivery: "ranged",
        range: 10,
        damageRange: [5, 8],
        damageType: "fire",
        projectileColor: "#ff8c42",
        burnChance: 40,
        burnDamagePerTick: BURN_DAMAGE_PER_TICK,
        burnDuration: BURN_DURATION
    },
    fireball: {
        name: "Fireball",
        description: "Hurl a ball of fire that explodes on impact, damaging enemies in the area.",
        flavor: "No foe heard the final incantation, for all that was left were cinders.",
        manaCost: 15,
        cooldown: 5000,
        type: "damage",
        targetType: "aoe",
        range: 10,
        aoeRadius: 2.5,
        damageRange: [8, 14],
        damageType: "fire",
        projectileColor: "#ff4400"
    },
    chainLightning: {
        name: "Chain Lightning",
        description: "Blast an enemy with lightning, then arc to up to 3 additional nearby foes with diminishing power.",
        flavor: "One bolt is a warning. The next three are judgment.",
        manaCost: 20,
        cooldown: 8500,
        type: "smite",
        targetType: "enemy",
        range: 10,
        damageRange: [14, 20],
        damageType: "lightning"
    },
    energyShield: {
        name: "Energy Shield",
        description: "Surround yourself with a protective barrier that absorbs up to 30 damage. Chaos damage penetrates twice as effectively.",
        flavor: "The shimmering veil of a wizard's shield is well-known among the enemies of Tel's Vale.",
        manaCost: 18,
        cooldown: 2500,
        type: "energy_shield",
        targetType: "self",
        range: 0,
        shieldAmount: 30,
        duration: 20000,
        damageType: "chaos"  // Flavor only - the shield itself doesn't deal damage
    },
    heal: {
        name: "Prayer",
        description: "Restore health to an ally.",
        flavor: "Deeper than any salve, purer than any potion.",
        manaCost: 6,
        cooldown: 4000,
        type: "heal",
        targetType: "ally",
        range: 10,
        healRange: [8, 12],
        damageType: "holy"
    },
    poisonDagger: {
        name: "Poison Dagger",
        description: "A quick strike with a venomous blade that may poison the target.",
        flavor: "True power does not echo -- it whispers.",
        manaCost: 4,
        cooldown: 3500,
        type: "damage",
        targetType: "enemy",
        range: 1.8,  // melee range
        damageRange: [4, 8],
        damageType: "physical",
        poisonChance: 85  // 85% chance to poison
    },
    targetHead: {
        name: "Target Head",
        description: "Fire a precise arrow at the head. Critical strikes are far more likely, and the shot may stun.",
        flavor: "One breath, one line, one strike.",
        manaCost: 10,
        cooldown: 5500,
        type: "damage",
        targetType: "enemy",
        delivery: "ranged",
        range: 9,
        damageRange: [6, 10],
        damageType: "physical",
        projectileColor: "#d8b273",
        critChanceOverride: 60,
        onHitEffect: {
            type: "stun",
            chance: 25,
            duration: 2500
        }
    },
    targetArm: {
        name: "Target Arm",
        description: "Shoot for the arm, reducing the target's attack speed for 20 seconds on hit.",
        flavor: "A severed rhythm is as good as a severed blade.",
        manaCost: 8,
        cooldown: 5000,
        type: "damage",
        targetType: "enemy",
        delivery: "ranged",
        range: 9,
        damageRange: [5, 9],
        damageType: "physical",
        projectileColor: "#caa86a",
        onHitEffect: {
            type: "attack_down",
            chance: 100,
            duration: 20000
        }
    },
    targetLegs: {
        name: "Target Legs",
        description: "Shoot low, reducing the target's move speed for 20 seconds on hit.",
        flavor: "No need to kill what can no longer flee.",
        manaCost: 8,
        cooldown: 5000,
        type: "damage",
        targetType: "enemy",
        delivery: "ranged",
        range: 9,
        damageRange: [5, 9],
        damageType: "physical",
        projectileColor: "#b8945c",
        onHitEffect: {
            type: "move_slow",
            chance: 100,
            duration: 20000
        }
    },
    warcry: {
        name: "Warcry",
        description: "Let out a mighty shout that forces nearby enemies to attack you.",
        flavor: "When the dust cleared, only Kvel of the North was visible over the slain dead.",
        manaCost: 10,
        cooldown: 7000,
        type: "taunt",
        targetType: "self",  // centered on caster
        range: 6,  // taunt radius
        tauntChance: 80,  // 80% chance to taunt each enemy
        damageType: "physical"
    },
    defiance: {
        name: "Defiance",
        description: "Rally nearby allies with a fierce battle cry, boosting armor and speeding actions for a time.",
        flavor: "\"Stand with me, and we shall not fall!\" - Kvel of the North",
        manaCost: 15,
        cooldown: 5000,
        type: "aoe_buff",
        targetType: "self",  // centered on caster
        range: 5,  // buff radius
        duration: 10000,
        armorBonus: 3,
        damageType: "physical"
    },
    summonAncestor: {
        name: "Summon Ancestral Warrior",
        description: "Draw upon ancestral blood to call forth an ancient warrior spirit. Recasting replaces the current summon.",
        flavor: "The old blood answers, blade in hand.",
        manaCost: 14,
        cooldown: 8000,
        type: "summon",
        targetType: "self",
        range: 0,
        damageType: "physical"
    },
    highlandDefense: {
        name: "Highland Defense",
        description: "Guard nearby allies. Incoming damage to a nearby friend is redirected to you at half value.",
        flavor: "\"You strike my kin, you strike me.\" - Kvel of the North",
        manaCost: 0,
        cooldown: 500,
        type: "buff",
        targetType: "self",
        range: 0,
        damageType: "physical",
        isCantrip: true,
        maxUses: 1
    },
    bloodMark: {
        name: "Blood Mark",
        description: "Brand an enemy with a crimson sigil. Melee strikes against the marked foe restore health to the attacker.",
        flavor: "\"The old blood remembers its debts.\" - Kvel of the North",
        manaCost: 8,
        cooldown: 6000,
        type: "debuff",
        targetType: "enemy",
        range: 1.8,
        duration: 15000,
        damageType: "physical"
    },
    raiseShield: {
        name: "Raise Shield",
        description: "Adopt a defensive stance, doubling armor but slowing your attacks.",
        flavor: "\"Our fortress is gone, so I will be thy palisade. To me!\" - Torin the Golden",
        manaCost: 5,
        cooldown: 2500,  // Same as Paladin's attackCooldown (5s while shielded)
        type: "buff",
        targetType: "self",
        range: 0,
        duration: 20000,  // duration in ms (20 seconds)
        damageType: "physical"
    },
    divineLattice: {
        name: "Divine Lattice",
        description: "Encase a unit in radiant lattice: impervious to all damage, unable to act, and ignored by enemies.",
        flavor: "\"Step outside the storm. Return when it passes.\"",
        manaCost: 8,
        cooldown: 500,
        type: "buff",
        targetType: "unit",
        range: 8,
        duration: 10000,
        damageType: "holy",
        isCantrip: true,
        maxUses: 2
    },
    flurryOfFists: {
        name: "Flurry of Fists",
        description: "Unleash 5 rapid strikes on nearby enemies.",
        flavor: "The imps never saw it coming -- then they never saw anything again.",
        manaCost: 8,
        cooldown: 4000,
        type: "flurry",
        targetType: "self",  // centered on caster
        range: 2.5,  // melee range for targets
        damageRange: [2, 4],  // low damage per hit
        damageType: "physical",
        hitCount: 5
    },
    forcePush: {
        name: "Force Push",
        description: "Unleash a concussive wave that batters enemies backward and may leave them stunned.",
        flavor: "\"Wind and will are one motion.\" - Master Shen",
        manaCost: 5,
        cooldown: 4500,
        type: "damage",
        targetType: "aoe",
        range: 6.5,
        lineWidth: 2.2,
        damageRange: [5, 8],
        damageType: "physical",
        knockbackDistance: 2.2,
        stunChance: 25,
        duration: 1800
    },
    stunningBlow: {
        name: "Stunning Blow",
        description: "A powerful strike that stuns the target, preventing them from acting for 5 seconds.",
        flavor: "Seems even the senseless can get the sense beaten out of them.",
        manaCost: 12,
        cooldown: 3000,
        type: "debuff",
        targetType: "enemy",
        range: 1.8,  // melee range
        duration: 5000,  // stun duration in ms (5 seconds)
        damageType: "physical",
        stunChance: 75  // 75% chance to stun
    },
    thunder: {
        name: "Heavenly Bolt",
        description: "Call down a bolt of lightning on a single enemy.",
        flavor: "The sky answers the faithful.",
        manaCost: 12,
        cooldown: 5000,
        type: "smite",
        targetType: "enemy",
        range: 9,
        damageRange: [10, 16],
        damageType: "lightning"
    },
    holyCross: {
        name: "Holy Cross",
        description: "Detonate a radiant cross that scorches foes and leaves smiting ground in its wake.",
        flavor: "\"Where this sign is set, darkness kneels.\"",
        manaCost: 16,
        cooldown: 6500,
        type: "damage",
        targetType: "aoe",
        range: 8,
        aoeRadius: 4,
        damageRange: [8, 13],
        damageType: "holy",
        damagePerTick: 3,
        tickInterval: 1000,
        duration: 6000
    },
    vishasEyes: {
        name: "Visha's Eyes",
        description: "Summon three floating holy orbs that fire at foes, then heal nearby allies when they fade or are destroyed.",
        flavor: "\"The saint sees all, and what she sees, she shields.\"",
        manaCost: 0,
        cooldown: 800,
        type: "summon",
        targetType: "self",
        range: 0,
        damageType: "holy",
        duration: VISHAS_EYES_ORB_DURATION,
        aoeRadius: VISHAS_EYES_ORB_HEAL_RADIUS,
        healRange: VISHAS_EYES_ORB_HEAL_RANGE,
        isCantrip: true,
        maxUses: 1
    },
    cleanse: {
        name: "Cleanse",
        description: "Purify an ally, removing poison and granting immunity to poison for 30 seconds.",
        flavor: "Where light touches, no venom may linger.",
        manaCost: 4,
        cooldown: 3000,
        type: "buff",
        targetType: "ally",
        range: 8,
        duration: 30000,  // duration in ms (30 seconds)
        damageType: "holy"
    },
    channeling: {
        name: "Channeling",
        description: "Toggle an arcane conduit. While active, nearby allies cast spells faster and for less mana, but you can only move.",
        flavor: "\"Be still. Let the lattice do its work.\" - Archmage Konen",
        manaCost: 0,
        cooldown: 1500,
        type: "buff",
        targetType: "self",
        range: 5,
        duration: 120000,
        damageType: "physical",
    },
    magicWave: {
        name: "Magic Wave",
        description: "Launch a sweeping front of arcane bolts that rolls forward like a wave.",
        flavor: "\"Running will only make it worse!\" - Archmage Konen",
        manaCost: 20,
        cooldown: 6000,
        type: "damage",
        targetType: "aoe",  // Can target any position like fireball
        range: 10,
        aoeRadius: 3,  // Visual indicator radius
        damageRange: [2, 4],  // damage per missile
        damageType: "chaos",
        hitCount: 6,  // 6 missiles
        projectileColor: "#9966ff"  // Purple arcane color
    },
    bodySwap: {
        name: "Body Swap",
        description: "Instantly exchange positions with a chosen unit, ally or enemy.",
        flavor: "\"Two forms, one locus. Switch.\"",
        manaCost: 6,
        cooldown: 500,
        type: "dodge",
        targetType: "unit",
        range: 9,
        damageType: "chaos",
        isCantrip: true,
        maxUses: 2
    },
    caltrops: {
        name: "Caltrops",
        description: "Throw a spiked trap that pins all enemies in a small area for 10 seconds when triggered, dealing damage.",
        flavor: "A single step spells doom for the unwary.",
        manaCost: 8,
        cooldown: 5000,
        type: "trap",
        targetType: "aoe",  // Position-targeted
        range: 8,
        aoeRadius: 2,  // Trigger and effect radius
        duration: 10000,  // Pinned duration in ms (10 seconds)
        trapDamage: [4, 8],  // Damage when trap triggers
        damageType: "physical"
    },
    sanctuary: {
        name: "Sanctuary",
        description: "Consecrate the ground, dispelling hazards and creating holy tiles that heal allies over time.",
        flavor: "\"Stand fast, for this ground is sacred now.\" - Paladin Aldric",
        manaCost: 20,
        cooldown: 7000,
        type: "sanctuary",
        targetType: "aoe",
        range: 4,
        aoeRadius: 2.5,  // Radius of effect
        healPerTick: 3,  // Heal per tick
        damageType: "holy"
    },
    massHeal: {
        name: "Mass Heal",
        description: "Bathe all nearby allies in restorative light, mending their wounds.",
        flavor: "\"Stand close. The light does not discriminate.\"",
        manaCost: 18,
        cooldown: 8000,
        type: "heal",
        targetType: "self",
        range: 5,
        healRange: [6, 10],
        damageType: "holy",
        aoeRadius: 5
    },
    restoration: {
        name: "Restoration",
        description: "Purge doom, poison, burn, and slowing afflictions from an ally, then heal them for 3 HP per second over 10 seconds.",
        flavor: "\"Even death's shadow retreats before the light.\"",
        manaCost: 14,
        cooldown: 8000,
        type: "restoration",
        targetType: "ally",
        range: 8,
        duration: 10000,   // 10 seconds of regen
        healPerTick: 3,    // 3 HP per tick (1s ticks)
        damageType: "holy"
    },
    ankh: {
        name: "Ankh",
        description: "Revive a fallen ally to 1 HP, placing them next to the caster.",
        flavor: "\"Rise. Your work is not yet done.\"",
        manaCost: 25,
        cooldown: 10000,
        type: "revive",
        targetType: "ally",
        range: 999,
        damageType: "holy"
    },
    qiFocus: {
        name: "Qi Focus",
        description: "Channel your life force to restore an ally's mana, at the cost of your own vitality.",
        flavor: "\"The body is but a vessel for the spirit's gift.\" - Master Shen",
        manaCost: 0,
        cooldown: 4000,
        type: "mana_transfer",
        targetType: "ally",
        range: 6,
        manaRange: [10, 14],  // Mana to give
        selfDamage: [20, 30],  // HP cost to caster over time
        damageType: "physical"
    },
    holyStrike: {
        name: "Holy Strike",
        description: "Summon a blade of radiant light that cuts through enemies in a line.",
        flavor: "The warrior found the darkness itself akin to the flesh of the undead -- both were cleaved easily.",
        manaCost: 12,
        cooldown: 5000,
        type: "damage",
        targetType: "aoe",
        range: 6,
        aoeRadius: 6,
        damageRange: [10, 16],
        damageType: "holy",
        lineWidth: 0.8,
    },
    vanquishingLight: {
        name: "Vanquishing Light",
        description: "Wreathe yourself in holy radiance that repeatedly smites nearby foes and may blind them.",
        flavor: "\"Stand within my light, and see your last dawn.\"",
        manaCost: 12,
        cooldown: 7000,
        type: "buff",
        targetType: "self",
        range: 3.5,
        duration: 8000,
        damageType: "holy",
        damagePerTick: 3,
        tickInterval: 1000,
        blindChance: 35,
        blindDuration: 5000
    },
    sunStance: {
        name: "Sun Stance",
        description: "Channel inner fire, restoring health and wreathing your attacks in flame for 20 seconds.",
        flavor: "Daily prayer to the sun is the backbone of the Eastern tradition.",
        manaCost: 8,
        cooldown: 4000,
        type: "buff",
        targetType: "self",
        range: 0,
        duration: 20000,
        healRange: [4, 6],
        damageType: "fire"
    },
    pangolinStance: {
        name: "Pangolin Stance",
        description: "Assume a coiled defensive stance. Immediately retaliate against melee attackers.",
        flavor: "\"Curl, endure, and let their weapons break upon you.\" - Master Shen",
        manaCost: 0,
        cooldown: 500,
        type: "buff",
        targetType: "self",
        range: 0,
        duration: THORNS_DURATION,
        damageRange: [THORNS_DAMAGE_MIN, THORNS_DAMAGE_MAX],
        damageType: "physical",
        isCantrip: true,
        maxUses: 2
    },
    glacialWhorl: {
        name: "Glacial Whorl",
        description: "Launch a slow-moving shard of ice that pierces through all enemies, chilling those it touches.",
        flavor: "The cold does not kill quickly — it simply never relents.",
        manaCost: 12,
        cooldown: 6000,
        type: "damage",
        targetType: "aoe",
        range: 12,
        damageRange: [5, 9],
        damageType: "cold",
        chillChance: 60,
        projectileColor: "#5dade2"
    },
    wellOfGravity: {
        name: "Well of Gravity",
        description: "Open a gravitational rift that drags enemies inward and stuns them.",
        flavor: "The air screamed first. The soldiers followed.",
        manaCost: 14,
        cooldown: 7000,
        type: "damage",
        targetType: "aoe",
        range: 8,
        aoeRadius: 3,
        damageRange: [4, 8],
        damageType: "chaos",
        pullDistance: 2.5,
        stunChance: 50,
        duration: 2500
    },
    turnUndead: {
        name: "Turn Undead",
        description: "Radiate holy power that terrifies undead, sending them fleeing. Living foes take lesser damage.",
        flavor: "\"Return to your graves. This ground is not yours.\"",
        manaCost: 14,
        cooldown: 8000,
        type: "turn_undead",
        targetType: "self",
        range: 5,
        damageRange: [8, 14],
        damageType: "holy",
        duration: 6000
    },
    elorasGrasp: {
        name: "Elora's Grasp",
        description: "Coils of spectral vines erupt from the earth, lulling nearby enemies into deep slumber.",
        flavor: "\"Sleep now, child. The garden keeps its own.\"",
        manaCost: 14,
        cooldown: 7000,
        type: "debuff",
        targetType: "aoe",
        range: 4,
        aoeRadius: 2,
        damageType: "holy",
        duration: 8000,
        stunChance: 75
    },
    smokeBomb: {
        name: "Smoke Bomb",
        description: "Hurl a smoke bomb that blankets the area in thick haze, blinding enemies caught within.",
        flavor: "\"If they can't see you, they can't hit you. Simple as that.\"",
        manaCost: 10,
        cooldown: 7000,
        type: "smoke",
        targetType: "aoe",
        range: 8,
        aoeRadius: 2.5,
        duration: 8000,
        blindChance: 70,
        blindDuration: 3000,
        damageType: "physical"
    },
    teleportOther: {
        name: "Teleport Other",
        description: "Wrench a creature through space, relocating it to a point of your choosing.",
        flavor: "\"You were there. Now you are here. Argue with the universe if you disagree.\"",
        manaCost: 8,
        cooldown: 8000,
        type: "displacement",
        targetType: "unit",
        range: 8,
        damageType: "chaos",
        isCantrip: true,
        maxUses: 1
    },
    wallOfFire: {
        name: "Wall of Fire",
        description: "Click and drag to draw a line of burning tiles. Enemies standing in the flames take fire damage each second.",
        flavor: "\"The fire remembers where you told it to burn.\"",
        manaCost: 18,
        cooldown: 8000,
        type: "wall_of_fire",
        targetType: "drag_line",
        range: 9,
        damagePerTick: FIRE_DAMAGE_PER_TICK,
        tickInterval: FIRE_TICK_INTERVAL,
        duration: FIRE_TILE_DURATION,
        damageType: "fire",
        maxTiles: 8
    },
    cleave: {
        name: "Cleave",
        description: "Swing in a wide arc, striking all enemies in front of you.",
        flavor: "\"One stroke, many fall.\" - Kvel of the North",
        manaCost: 4,
        cooldown: 3000,
        type: "cleave",
        targetType: "self",
        range: 2.5,
        damageRange: [5, 9],
        damageType: "physical",
        aoeRadius: 2.5,  // Radius of the frontal arc
    },
    intimidate: {
        name: "Intimidate",
        description: "Let out a terrifying bellow that sends nearby enemies fleeing in fear.",
        flavor: "\"RUN.\" - Kvel of the North",
        manaCost: 12,
        cooldown: 7000,
        type: "intimidate",
        targetType: "self",
        range: 5,
        duration: 4000,
        damageType: "physical"
    },
    smite: {
        name: "Smite",
        description: "Strike with holy vengeance. Deals bonus damage to undead and demons.",
        flavor: "\"By the light that binds, I strike thee down.\" - Torin the Golden",
        manaCost: 5,
        cooldown: 3500,
        type: "damage",
        targetType: "enemy",
        delivery: "melee",
        range: 1.8,
        damageRange: [6, 10],
        damageType: "holy"
    },
    layOnHands: {
        name: "Lay on Hands",
        description: "Channel a surge of divine power to mend a single ally's wounds.",
        flavor: "\"Be whole again.\" - Torin the Golden",
        manaCost: 16,
        cooldown: 8000,
        type: "heal",
        targetType: "ally",
        range: 1.8,
        healRange: [18, 26],
        damageType: "holy"
    },
    flyingKick: {
        name: "Flying Kick",
        description: "Leap to a distant enemy, striking them on arrival.",
        flavor: "\"The wind carries me. My fist carries the lesson.\" - Master Shen",
        manaCost: 10,
        cooldown: 6000,
        type: "leap_strike",
        targetType: "enemy",
        range: 7,
        damageRange: [6, 12],
        damageType: "physical"
    },
    fivePointPalm: {
        name: "Five-Point Palm",
        description: "Strike a pressure point, leaving the target constricted for 15 seconds.",
        flavor: "\"Five fingers, five meridians, five seconds to regret everything.\" - Master Shen",
        manaCost: 8,
        cooldown: 5000,
        type: "debuff",
        targetType: "enemy",
        range: 1.8,
        damageRange: [3, 6],
        damageType: "physical",
        duration: 15000
    },
    dimMak: {
        name: "Dim Mak",
        description: "Channel lethal qi into a single devastating touch. High chance to inflict Doom on the target.",
        flavor: "\"One touch. Ten seconds. Eternity.\" - Master Shen",
        manaCost: 0,
        cooldown: 500,
        type: "debuff",
        targetType: "enemy",
        range: 1.8,
        damageRange: [1, 3],
        damageType: "physical",
        duration: 10000,
        isCantrip: true,
        maxUses: 1
    },
    dodge: {
        name: "Dodge",
        description: "Dash to a nearby location, briefly becoming invulnerable.",
        flavor: "\"Catch me if you can.\" - Eliod the Swift",
        manaCost: 5,
        cooldown: 1200,     
        type: "dodge",
        targetType: "aoe", // Ground-targeted
        range: 5,          // Max dash distance
        duration: 1500,    // Invul window in ms
        damageType: "physical",
        isCantrip: true,
        maxUses: 2
    }
});
