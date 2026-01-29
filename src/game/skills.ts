import type { Skill } from "../core/types";

// =============================================================================
// PLAYER SKILLS
// =============================================================================

export const SKILLS: Record<string, Skill> = {
    fireball: {
        name: "Fireball",
        description: "Hurl a ball of fire that explodes on impact, damaging all units in the area.",
        flavor: "No foe heard the final incantation, for all that was left were cinders.",
        manaCost: 15,
        cooldown: 5000,
        type: "damage",
        targetType: "aoe",
        range: 10,
        aoeRadius: 2.5,
        value: [8, 14],
        damageType: "fire",
        projectileColor: "#ff4400"
    },
    energyShield: {
        name: "Energy Shield",
        description: "Surround yourself with a protective barrier that absorbs up to 30 damage. Chaos damage penetrates twice as effectively.",
        flavor: "The exile's final lesson: even the void can be worn as armor.",
        manaCost: 12,
        cooldown: 25000,
        type: "energy_shield",
        targetType: "self",
        range: 0,
        value: [30, 20000],  // [shield amount, duration in ms]
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
        value: [8, 12],
        damageType: "holy"
    },
    poisonDagger: {
        name: "Poison Dagger",
        description: "A quick strike with a venomous blade that may poison the target.",
        flavor: "True power does not echo -- it whispers.",
        manaCost: 8,
        cooldown: 6000,
        type: "damage",
        targetType: "enemy",
        range: 1.8,  // melee range
        value: [4, 8],
        damageType: "physical",
        poisonChance: 85  // 85% chance to poison
    },
    warcry: {
        name: "Warcry",
        description: "Let out a mighty shout that forces nearby enemies to attack you.",
        flavor: "When the dust cleared, only Kvel of the North was visible over the slain dead.",
        manaCost: 10,
        cooldown: 12000,
        type: "taunt",
        targetType: "self",  // centered on caster
        range: 6,  // taunt radius
        value: [80, 80],  // 80% chance to taunt each enemy
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
        value: [20000, 20000],  // duration in ms (20 seconds)
        damageType: "physical"
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
        value: [2, 4],  // low damage per hit
        damageType: "physical",
        hitCount: 5
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
        value: [5000, 5000],  // stun duration in ms (5 seconds)
        damageType: "physical",
        stunChance: 75  // 75% chance to stun
    },
    thunder: {
        name: "Thunder",
        description: "Call down a bolt of lightning on a single enemy.",
        flavor: "The sky answers the faithful.",
        manaCost: 12,
        cooldown: 5000,
        type: "smite",
        targetType: "enemy",
        range: 9,
        value: [10, 16],
        damageType: "lightning"
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
        value: [30000, 30000],  // duration in ms (30 seconds)
        damageType: "holy"
    },
    magicWave: {
        name: "Magic Wave",
        description: "Launch 8 arcane missiles that fan out towards a target area.",
        flavor: "\"Running will only make it worse!\" - Archmage Konen",
        manaCost: 20,
        cooldown: 7000,
        type: "damage",
        targetType: "aoe",  // Can target any position like fireball
        range: 10,
        aoeRadius: 3,  // Visual indicator radius
        value: [2, 4],  // damage per missile
        damageType: "chaos",
        hitCount: 8,  // 8 missiles
        projectileColor: "#9966ff"  // Purple arcane color
    },
    caltrops: {
        name: "Caltrops",
        description: "Throw a spiked trap that pins all enemies in a small area for 10 seconds when triggered.",
        flavor: "A single step spells doom for the unwary.",
        manaCost: 15,
        cooldown: 5000,
        type: "trap",
        targetType: "aoe",  // Position-targeted
        range: 8,
        aoeRadius: 2,  // Trigger and effect radius
        value: [10000, 10000],  // Pinned duration in ms (10 seconds)
        damageType: "physical"
    },
    sanctuary: {
        name: "Sanctuary",
        description: "Consecrate the ground, dispelling hazards and creating holy tiles that heal allies over time.",
        flavor: "\"Stand fast, for this ground is sacred now.\" - Paladin Aldric",
        manaCost: 20,
        cooldown: 15000,
        type: "sanctuary",
        targetType: "aoe",
        range: 4,
        aoeRadius: 2.5,  // Radius of effect
        value: [3, 3],  // Heal per tick (uses SANCTUARY_HEAL_PER_TICK from constants)
        damageType: "holy"
    },
    qiFocus: {
        name: "Qi Focus",
        description: "Channel your life force to restore an ally's mana, at the cost of your own vitality.",
        flavor: "\"The body is but a vessel for the spirit's gift.\" - Master Shen",
        manaCost: 0,
        cooldown: 8000,
        type: "mana_transfer",
        targetType: "ally",
        range: 6,
        value: [10, 14],  // Mana to give
        selfDamage: [20, 30],  // HP cost to caster over time
        damageType: "physical"
    }
};
