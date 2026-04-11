// =============================================================================
// SKILL TREES - Branch/tier data for all player classes
// =============================================================================

export type SkillTreeNodeType = "skill" | "passive" | "mastery";

export interface SkillTreeNode {
    id: string;
    name: string;
    description: string;
    tier: 1 | 2 | 3 | 4 | 5;
    type: SkillTreeNodeType;
    skillName?: string;       // References SKILLS key for "skill" nodes
    requires?: string[];      // IDs of prerequisite nodes in this branch
}

export interface SkillTreeBranch {
    name: string;
    color: string;
    nodes: SkillTreeNode[];
}

export interface ClassSkillTree {
    branches: [SkillTreeBranch, SkillTreeBranch, SkillTreeBranch];
}

// =============================================================================
// BARBARIAN
// =============================================================================

const BARBARIAN_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Bulwark",
            color: "#d4a56a",
            nodes: [
                { id: "barb-b1", name: "Highland Defense", description: "Redirect a portion of nearby ally damage to yourself.", tier: 1, type: "skill", skillName: "Highland Defense" },
                { id: "barb-b2", name: "Ironwall", description: "Highland Defense absorbs 25% more damage before expiring.", tier: 2, type: "mastery", requires: ["barb-b1"] },
                { id: "barb-b3", name: "Warcry", description: "A fierce battle cry that buffs nearby allies.", tier: 3, type: "skill", skillName: "Warcry", requires: ["barb-b2"] },
                { id: "barb-b4", name: "Rally Surge", description: "Warcry also refreshes Highland Defense cooldown.", tier: 4, type: "mastery", requires: ["barb-b3"] },
                { id: "barb-b5", name: "Defiance", description: "Rally allies with armor and haste.", tier: 5, type: "skill", skillName: "Defiance", requires: ["barb-b4"] },
            ],
        },
        {
            name: "Reaver",
            color: "#cc3333",
            nodes: [
                { id: "barb-r1", name: "Cleave", description: "Swing in a wide arc, hitting all enemies in front.", tier: 1, type: "skill", skillName: "Cleave" },
                { id: "barb-r2", name: "Bloodlust", description: "Kills with Cleave grant +15% attack speed for 5s.", tier: 2, type: "passive", requires: ["barb-r1"] },
                { id: "barb-r3", name: "Blood Mark", description: "Mark a target — melee hits against it heal the attacker.", tier: 3, type: "skill", skillName: "Blood Mark", requires: ["barb-r2"] },
                { id: "barb-r4", name: "Marked Fury", description: "Blood Mark also increases your crit chance against the target by 10%.", tier: 4, type: "mastery", requires: ["barb-r3"] },
                { id: "barb-r5", name: "Stunning Blow", description: "A heavy strike that stuns the target.", tier: 5, type: "skill", skillName: "Stunning Blow", requires: ["barb-r4"] },
            ],
        },
        {
            name: "Ancestor",
            color: "#8899aa",
            nodes: [
                { id: "barb-a1", name: "Intimidate", description: "Fear nearby enemies, sending them fleeing.", tier: 1, type: "skill", skillName: "Intimidate" },
                { id: "barb-a2", name: "Terror's Edge", description: "Feared enemies take +2 damage from all sources.", tier: 2, type: "passive", requires: ["barb-a1"] },
                { id: "barb-a3", name: "Summon Ancestor", description: "Call forth an ancestral warrior to fight at your side.", tier: 3, type: "skill", skillName: "Summon Ancestral Warrior", requires: ["barb-a2"] },
                { id: "barb-a4", name: "Ancestral Bond", description: "While the ancestor is alive, the barbarian takes 15% less damage.", tier: 4, type: "passive", requires: ["barb-a3"] },
                { id: "barb-a5", name: "Wrath of Ancestors", description: "Ancestral Warrior enters a frenzy, doubling its attack speed and gaining +3 damage for 10s.", tier: 5, type: "skill", requires: ["barb-a4"] },
            ],
        },
    ],
};

// =============================================================================
// PALADIN
// =============================================================================

const PALADIN_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Judgment",
            color: "#f0d866",
            nodes: [
                { id: "pala-j1", name: "Smite", description: "A holy strike that deals bonus damage to undead.", tier: 1, type: "skill", skillName: "Smite" },
                { id: "pala-j2", name: "Zealous Smite", description: "Smite stuns undead and demons for 1s.", tier: 2, type: "mastery", requires: ["pala-j1"] },
                { id: "pala-j3", name: "Holy Strike", description: "A cone of holy energy that damages all in its path.", tier: 3, type: "skill", skillName: "Holy Strike", requires: ["pala-j2"] },
                { id: "pala-j4", name: "Righteous Fervor", description: "Holy Strike kills reduce Smite cooldown by 50%.", tier: 4, type: "mastery", requires: ["pala-j3"] },
                { id: "pala-j5", name: "Vanquishing Light", description: "Surround yourself with a damaging holy aura that blinds enemies.", tier: 5, type: "skill", skillName: "Vanquishing Light", requires: ["pala-j4"] },
            ],
        },
        {
            name: "Aegis",
            color: "#5599cc",
            nodes: [
                { id: "pala-a1", name: "Raise Shield", description: "Double your armor at the cost of slower attacks.", tier: 1, type: "skill", skillName: "Raise Shield" },
                { id: "pala-a2", name: "Shield Mastery", description: "Raise Shield no longer doubles cooldowns.", tier: 2, type: "mastery", requires: ["pala-a1"] },
                { id: "pala-a3", name: "Divine Lattice", description: "Encase a unit in divine crystal, making them immune to all damage.", tier: 3, type: "skill", skillName: "Divine Lattice", requires: ["pala-a2"] },
                { id: "pala-a4", name: "Aegis Pulse", description: "When Raise Shield expires, heal for 20% of damage blocked.", tier: 4, type: "passive", requires: ["pala-a3"] },
                { id: "pala-a5", name: "Unbreakable", description: "While shielded, you cannot be reduced below 1 HP.", tier: 5, type: "passive", requires: ["pala-a4"] },
            ],
        },
        {
            name: "Mercy",
            color: "#66cc66",
            nodes: [
                { id: "pala-m1", name: "Lay on Hands", description: "Heal a single ally.", tier: 1, type: "skill", skillName: "Lay on Hands" },
                { id: "pala-m2", name: "Gentle Touch", description: "Lay on Hands also removes one negative status effect.", tier: 2, type: "mastery", requires: ["pala-m1"] },
                { id: "pala-m3", name: "Sanctuary", description: "Create holy ground that heals allies standing on it.", tier: 3, type: "skill", skillName: "Sanctuary", requires: ["pala-m2"] },
                { id: "pala-m4", name: "Beacon of Hope", description: "Sanctuary also grants +1 armor to allies within it.", tier: 4, type: "mastery", requires: ["pala-m3"] },
                { id: "pala-m5", name: "Blessing of Light", description: "When you heal an ally below 30% HP, grant them 3s of invulnerability.", tier: 5, type: "passive", requires: ["pala-m4"] },
            ],
        },
    ],
};

// =============================================================================
// THIEF
// =============================================================================

const THIEF_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Marksman",
            color: "#d9ad84",
            nodes: [
                { id: "thf-m1", name: "Target Arm", description: "Constrict a target's arms, slowing their attack speed.", tier: 1, type: "skill", skillName: "Target Arm" },
                { id: "thf-m2", name: "Crippling Shots", description: "Targeted shots last 25% longer.", tier: 2, type: "passive", requires: ["thf-m1"] },
                { id: "thf-m3", name: "Target Legs", description: "Hamstring a target, reducing their move speed.", tier: 3, type: "skill", skillName: "Target Legs", requires: ["thf-m2"] },
                { id: "thf-m4", name: "Exploit Weakness", description: "+3 damage against targets with any debuff.", tier: 4, type: "passive", requires: ["thf-m3"] },
                { id: "thf-m5", name: "Target Head", description: "A precision shot with a chance to stun.", tier: 5, type: "skill", skillName: "Target Head", requires: ["thf-m4"] },
            ],
        },
        {
            name: "Trickery",
            color: "#9966cc",
            nodes: [
                { id: "thf-t1", name: "Dodge", description: "Dash forward with a brief moment of invulnerability.", tier: 1, type: "skill", skillName: "Dodge" },
                { id: "thf-t2", name: "Evasive Instinct", description: "After dodging, gain +20% move speed for 3s.", tier: 2, type: "passive", requires: ["thf-t1"] },
                { id: "thf-t3", name: "Caltrops", description: "Scatter caltrops that pin enemies who walk over them.", tier: 3, type: "skill", skillName: "Caltrops", requires: ["thf-t2"] },
                { id: "thf-t4", name: "Trap Synergy", description: "Caltrops also apply poison to pinned targets.", tier: 4, type: "mastery", requires: ["thf-t3"] },
                { id: "thf-t5", name: "Smoke Bomb", description: "Drop a smoke cloud that breaks enemy targeting.", tier: 5, type: "skill", skillName: "Smoke Bomb", requires: ["thf-t4"] },
            ],
        },
        {
            name: "Assassin",
            color: "#33aa55",
            nodes: [
                { id: "thf-a1", name: "Poison Dagger", description: "A quick strike that poisons the target.", tier: 1, type: "skill", skillName: "Poison Dagger" },
                { id: "thf-a2", name: "Virulent Coat", description: "Basic attacks have a 15% chance to poison.", tier: 2, type: "passive", requires: ["thf-a1"] },
                { id: "thf-a3", name: "Backstab", description: "Teleport behind a target and strike for double damage. Must be used from outside melee range.", tier: 3, type: "skill", requires: ["thf-a2"] },
                { id: "thf-a4", name: "Opportunist", description: "Attacks against stunned or pinned targets always crit.", tier: 4, type: "passive", requires: ["thf-a3"] },
                { id: "thf-a5", name: "Garrote", description: "Silence and deal heavy damage over time to an adjacent target. Breaks if you move.", tier: 5, type: "skill", requires: ["thf-a4"] },
            ],
        },
    ],
};

// =============================================================================
// WIZARD
// =============================================================================

const WIZARD_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Pyromancy",
            color: "#ff6622",
            nodes: [
                { id: "wiz-p1", name: "Fire Bolt", description: "A quick bolt of flame that may ignite the target.", tier: 1, type: "skill", skillName: "Fire Bolt" },
                { id: "wiz-p2", name: "Kindling", description: "Burn damage from your spells lasts 50% longer.", tier: 2, type: "passive", requires: ["wiz-p1"] },
                { id: "wiz-p3", name: "Fireball", description: "Hurl an explosive fireball that damages enemies in the blast.", tier: 3, type: "skill", skillName: "Fireball", requires: ["wiz-p2"] },
                { id: "wiz-p4", name: "Conflagration", description: "Fireball leaves burning ground for 4s.", tier: 4, type: "mastery", requires: ["wiz-p3"] },
                { id: "wiz-p5", name: "Wall of Fire", description: "Draw a wall of flame that burns enemies who pass through.", tier: 5, type: "skill", skillName: "Wall of Fire", requires: ["wiz-p4"] },
            ],
        },
        {
            name: "Tempest",
            color: "#5dade2",
            nodes: [
                { id: "wiz-t1", name: "Glacial Whorl", description: "Launch a piercing shard of ice.", tier: 1, type: "skill", skillName: "Glacial Whorl" },
                { id: "wiz-t2", name: "Bitter Cold", description: "Glacial Whorl chills targets for 3s.", tier: 2, type: "mastery", requires: ["wiz-t1"] },
                { id: "wiz-t3", name: "Chain Lightning", description: "Lightning that bounces between enemies.", tier: 3, type: "skill", skillName: "Chain Lightning", requires: ["wiz-t2"] },
                { id: "wiz-t4", name: "Storm Conduit", description: "Chain Lightning bounces deal 75% damage instead of 50%.", tier: 4, type: "mastery", requires: ["wiz-t3"] },
                { id: "wiz-t5", name: "Magic Wave", description: "Unleash a sweeping wave of arcane missiles.", tier: 5, type: "skill", skillName: "Magic Wave", requires: ["wiz-t4"] },
            ],
        },
        {
            name: "Aether",
            color: "#bb86fc",
            nodes: [
                { id: "wiz-a1", name: "Body Swap", description: "Instantly swap positions with any unit.", tier: 1, type: "skill", skillName: "Body Swap" },
                { id: "wiz-a2", name: "Teleport Other", description: "Wrench a creature through space, relocating it to a point of your choosing.", tier: 2, type: "skill", skillName: "Teleport Other", requires: ["wiz-a1"] },
                { id: "wiz-a3", name: "Energy Shield", description: "Surround yourself with an arcane barrier.", tier: 3, type: "skill", skillName: "Energy Shield", requires: ["wiz-a2"] },
                { id: "wiz-a4", name: "Arcane Feedback", description: "When Energy Shield breaks, deal its remaining value as damage to nearby enemies.", tier: 4, type: "mastery", requires: ["wiz-a3"] },
                { id: "wiz-a5", name: "Channeling", description: "Channel arcane energy: nearby allies cast spells faster and cheaper. You can only move.", tier: 5, type: "skill", skillName: "Channeling", requires: ["wiz-a4"] },
            ],
        },
    ],
};

// =============================================================================
// MONK
// =============================================================================

const MONK_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Stances",
            color: "#ff6b35",
            nodes: [
                { id: "mnk-s1", name: "Pangolin Stance", description: "Adopt a thorny stance that reflects melee damage.", tier: 1, type: "skill", skillName: "Pangolin Stance" },
                { id: "mnk-s2", name: "Iron Scales", description: "Pangolin Stance also grants +1 armor.", tier: 2, type: "mastery", requires: ["mnk-s1"] },
                { id: "mnk-s3", name: "Sun Stance", description: "Enter a fiery stance that adds fire damage to attacks.", tier: 3, type: "skill", skillName: "Sun Stance", requires: ["mnk-s2"] },
                { id: "mnk-s4", name: "Stance Flow", description: "Entering a stance refreshes the other stance's cooldown.", tier: 4, type: "passive", requires: ["mnk-s3"] },
                { id: "mnk-s5", name: "Qi Focus", description: "Meditate to restore mana over time.", tier: 5, type: "skill", skillName: "Qi Focus", requires: ["mnk-s4"] },
            ],
        },
        {
            name: "Open Hand",
            color: "#e6c44d",
            nodes: [
                { id: "mnk-o1", name: "Flurry of Fists", description: "Strike multiple nearby enemies in rapid succession.", tier: 1, type: "skill", skillName: "Flurry of Fists" },
                { id: "mnk-o2", name: "Rapid Strikes", description: "Flurry hits one additional target.", tier: 2, type: "mastery", requires: ["mnk-o1"] },
                { id: "mnk-o3", name: "Five-Point Palm", description: "Strike a pressure point, constricting the target.", tier: 3, type: "skill", skillName: "Five-Point Palm", requires: ["mnk-o2"] },
                { id: "mnk-o4", name: "Pressure Points", description: "Constricted targets also take +2 damage from your attacks.", tier: 4, type: "passive", requires: ["mnk-o3"] },
                { id: "mnk-o5", name: "Dim Mak", description: "Touch of death. Chance to doom a non-boss enemy.", tier: 5, type: "skill", skillName: "Dim Mak", requires: ["mnk-o4"] },
            ],
        },
        {
            name: "Force",
            color: "#66ccaa",
            nodes: [
                { id: "mnk-f1", name: "Force Push", description: "Send a wave that knocks enemies back.", tier: 1, type: "skill", skillName: "Force Push" },
                { id: "mnk-f2", name: "Concussive Force", description: "Force Push stun chance increased by 15%.", tier: 2, type: "mastery", requires: ["mnk-f1"] },
                { id: "mnk-f3", name: "Flying Kick", description: "Leap to an enemy with a powerful kick.", tier: 3, type: "skill", skillName: "Flying Kick", requires: ["mnk-f2"] },
                { id: "mnk-f4", name: "Momentum", description: "Flying Kick resets your basic attack cooldown.", tier: 4, type: "passive", requires: ["mnk-f3"] },
                { id: "mnk-f5", name: "Well of Gravity", description: "Create a vortex that pulls and stuns enemies.", tier: 5, type: "skill", skillName: "Well of Gravity", requires: ["mnk-f4"] },
            ],
        },
    ],
};

// =============================================================================
// CLERIC
// =============================================================================

const CLERIC_TREE: ClassSkillTree = {
    branches: [
        {
            name: "Mercy",
            color: "#66cc66",
            nodes: [
                { id: "clr-m1", name: "Prayer", description: "Heal a single ally with divine light.", tier: 1, type: "skill", skillName: "Prayer" },
                { id: "clr-m2", name: "Ankh", description: "Revive a fallen ally to 1 HP, placing them next to the caster.", tier: 2, type: "skill", skillName: "Ankh", requires: ["clr-m1"] },
                { id: "clr-m3", name: "Restoration", description: "Cleanse debuffs and heal an ally over time.", tier: 3, type: "skill", skillName: "Restoration", requires: ["clr-m2"] },
                { id: "clr-m4", name: "Renewing Light", description: "Restoration also restores 5 mana over its duration.", tier: 4, type: "mastery", requires: ["clr-m3"] },
                { id: "clr-m5", name: "Mass Heal", description: "Heal all nearby allies at once.", tier: 5, type: "skill", skillName: "Mass Heal", requires: ["clr-m4"] },
            ],
        },
        {
            name: "Purity",
            color: "#aaddff",
            nodes: [
                { id: "clr-p1", name: "Cleanse", description: "Remove poison and grant poison immunity.", tier: 1, type: "skill", skillName: "Cleanse" },
                { id: "clr-p2", name: "Hallowed Ground", description: "Cleansed allies also gain +1 armor for the duration.", tier: 2, type: "mastery", requires: ["clr-p1"] },
                { id: "clr-p3", name: "Visha's Eyes", description: "Summon holy orbs that heal allies on death.", tier: 3, type: "skill", skillName: "Visha's Eyes", requires: ["clr-p2"] },
                { id: "clr-p4", name: "Watchful Orbs", description: "Visha's Eyes orbs last 25% longer.", tier: 4, type: "mastery", requires: ["clr-p3"] },
                { id: "clr-p5", name: "Elora's Grasp", description: "Entangle enemies in an area with vines.", tier: 5, type: "skill", skillName: "Elora's Grasp", requires: ["clr-p4"] },
            ],
        },
        {
            name: "Judgment",
            color: "#f0d866",
            nodes: [
                { id: "clr-j1", name: "Heavenly Bolt", description: "Call down a bolt of lightning on a target.", tier: 1, type: "skill", skillName: "Heavenly Bolt" },
                { id: "clr-j2", name: "Divine Wrath", description: "Heavenly Bolt deals +2 damage to undead.", tier: 2, type: "mastery", requires: ["clr-j1"] },
                { id: "clr-j3", name: "Turn Undead", description: "Fear all nearby undead enemies.", tier: 3, type: "skill", skillName: "Turn Undead", requires: ["clr-j2"] },
                { id: "clr-j4", name: "Sacred Fire", description: "Turned undead take burn damage while fleeing.", tier: 4, type: "passive", requires: ["clr-j3"] },
                { id: "clr-j5", name: "Holy Cross", description: "Detonate a cross-shaped area of holy power.", tier: 5, type: "skill", skillName: "Holy Cross", requires: ["clr-j4"] },
            ],
        },
    ],
};

// =============================================================================
// REGISTRY
// =============================================================================

const CLASS_SKILL_TREES: Record<string, ClassSkillTree> = {
    Barbarian: BARBARIAN_TREE,
    Paladin: PALADIN_TREE,
    Thief: THIEF_TREE,
    Wizard: WIZARD_TREE,
    Monk: MONK_TREE,
    Cleric: CLERIC_TREE,
};

export function getClassSkillTree(className: string): ClassSkillTree | undefined {
    return CLASS_SKILL_TREES[className];
}
