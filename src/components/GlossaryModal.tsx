import type { CharacterStats, StatusEffectType } from "../core/types";
import { ModalShell } from "./ModalShell";

interface GlossaryModalProps {
    onClose: () => void;
}

type GlossaryCategory = "Core System" | "Damage Type" | "Stat" | "Status";

interface GlossaryEntry {
    term: string;
    body: string;
    category: GlossaryCategory;
}

const CORE_GLOSSARY: ReadonlyArray<GlossaryEntry> = [
    {
        term: "Accuracy",
        category: "Core System",
        body: "Accuracy is your base chance to land an attack or other hit-based effect. Dexterity raises player accuracy, while blindness and other penalties can lower the real chance to connect."
    },
    {
        term: "Action Queue",
        category: "Core System",
        body: "Orders given while paused or while a unit is already busy can wait in a queue. Queued actions fire once the unit is able to act again."
    },
    {
        term: "AoE (Area of Effect)",
        category: "Core System",
        body: "An AoE effect hits every valid target inside a radius, line, cone, or other marked zone instead of only one unit."
    },
    {
        term: "Armor",
        category: "Core System",
        body: "Armor reduces incoming physical damage. It does not reduce fire, cold, lightning, chaos, or holy damage unless a specific effect says otherwise."
    },
    {
        term: "Attack-Move",
        category: "Core System",
        body: "Attack-move sends selected units toward a point but lets them stop and engage enemies they notice along the way."
    },
    {
        term: "Auto-Attack",
        category: "Core System",
        body: "Auto-attack lets the party handle combat behavior automatically. You can still pause, retarget, and issue manual orders whenever you need tighter control."
    },
    {
        term: "Basic Attack",
        category: "Core System",
        body: "A basic attack is a unit's default weapon strike. Its speed, range, damage, and damage type come from the unit's current combat stats."
    },
    {
        term: "Buff",
        category: "Core System",
        body: "A buff is a positive timed effect that improves defense, damage, speed, healing, or some other aspect of a unit."
    },
    {
        term: "Cantrip",
        category: "Core System",
        body: "Cantrips are charge-based abilities rather than normal skills. They use limited charges instead of the usual mana-and-cooldown loop, making them ideal for clutch utility."
    },
    {
        term: "Cooldown",
        category: "Core System",
        body: "Cooldown is the waiting time before a unit can use that action again. Some effects speed actions up, while others stretch cooldowns out."
    },
    {
        term: "Critical Hit",
        category: "Core System",
        body: "A critical hit deals bonus damage when an attack or skill roll crits. Dexterity improves player crit chance, and some effects can further raise crit odds."
    },
    {
        term: "Damage Types",
        category: "Core System",
        body: "Damage comes in physical, fire, cold, lightning, chaos, and holy forms. Armor only reduces physical damage, so damage type matters when choosing the right tool."
    },
    {
        term: "Debuff",
        category: "Core System",
        body: "A debuff is a harmful timed effect that hinders, disables, damages, or displaces a target."
    },
    {
        term: "Fog of War",
        category: "Core System",
        body: "Fog of war hides enemies and terrain your party cannot currently see. Exploring reveals the map and helps prevent ambushes."
    },
    {
        term: "Formation",
        category: "Core System",
        body: "Formation keeps the party moving in an ordered wedge instead of piling into one point. Formation order decides who takes the front slot and who trails behind."
    },
    {
        term: "Hold Position",
        category: "Core System",
        body: "Hold Position stops selected units from chasing targets beyond their current spot. They will still attack enemies that come into range."
    },
    {
        term: "Hotbar",
        category: "Core System",
        body: "The hotbar is the five-slot shortcut row for quick ability access. Assigned skills and cantrips can be fired with the number keys when one party member is selected."
    },
    {
        term: "Level",
        category: "Core System",
        body: "Leveling up increases a character's staying power and awards both stat points and skill points to spend on growth."
    },
    {
        term: "Load Game",
        category: "Core System",
        body: "Loading replaces the current run with the selected save file and restores the saved party, area, and progression state."
    },
    {
        term: "Mana",
        category: "Core System",
        body: "Mana is the resource spent on most active abilities. Intelligence increases maximum mana for player characters."
    },
    {
        term: "Pause",
        category: "Core System",
        body: "Pause freezes the action so you can issue commands safely. Orders made while paused can still be queued up for the moment combat resumes."
    },
    {
        term: "Range",
        category: "Core System",
        body: "Range determines how far away a unit can attack, cast, or target. Some abilities also list an area radius on top of their cast range."
    },
    {
        term: "Save Game",
        category: "Core System",
        body: "Saving records your current run so you can continue later. The save includes your party state, area progress, learned growth, and other persistent runtime data."
    },
    {
        term: "Selection",
        category: "Core System",
        body: "Selection decides which units receive your commands. You can click an individual unit, drag a box across the ground, or add and remove units with Shift-click."
    },
    {
        term: "Skill Points",
        category: "Core System",
        body: "Skill points are earned on level up and spent to unlock new class abilities and tools."
    },
    {
        term: "Skills",
        category: "Core System",
        body: "Skills are mana-based active abilities with their own targeting rules and cooldowns. Cantrips are separate charge-based abilities, and together they make up each class's toolkit."
    },
    {
        term: "Stat Points",
        category: "Core System",
        body: "Stat points are permanent upgrades spent on Strength, Dexterity, Vitality, Intelligence, and Faith. Their bonuses apply immediately."
    },
    {
        term: "Status Effects",
        category: "Core System",
        body: "Status effects are timed conditions that change how a unit moves, attacks, survives, or threatens nearby targets. Some are buffs, some are debuffs, and some deal damage over time."
    },
    {
        term: "Summons",
        category: "Core System",
        body: "Summons are temporary allied units called into battle by certain effects. They fight on your side and may add their own attacks or support before expiring."
    }
];

const DAMAGE_TYPE_GLOSSARY: ReadonlyArray<GlossaryEntry> = [
    {
        term: "Chaos",
        category: "Damage Type",
        body: "Chaos damage ignores armor like other non-physical damage types. It often appears on arcane effects and can chew through certain defenses unusually well."
    },
    {
        term: "Cold",
        category: "Damage Type",
        body: "Cold damage is elemental damage that bypasses armor. Cold-themed attacks often pair it with chills or movement control."
    },
    {
        term: "Fire",
        category: "Damage Type",
        body: "Fire damage is elemental damage that bypasses armor. Many fire effects also leave hazardous ground or repeated burn ticks behind."
    },
    {
        term: "Holy",
        category: "Damage Type",
        body: "Holy damage bypasses armor and powers many healing, smiting, and anti-undead effects. Faith improves holy damage and healing."
    },
    {
        term: "Lightning",
        category: "Damage Type",
        body: "Lightning damage is elemental damage that bypasses armor. It usually appears on high-impact strikes and burst spells."
    },
    {
        term: "Physical",
        category: "Damage Type",
        body: "Physical damage is the only damage type reduced by armor. Most weapon attacks and martial techniques deal physical damage unless an effect says otherwise."
    }
];

const STAT_GLOSSARY: Record<keyof CharacterStats, GlossaryEntry> = {
    strength: {
        term: "Strength",
        category: "Stat",
        body: "Strength represents raw force. Every 2 points grant +1 physical damage."
    },
    dexterity: {
        term: "Dexterity",
        category: "Stat",
        body: "Dexterity improves precision and timing. Every 2 points grant +1% hit chance and +1% crit chance."
    },
    vitality: {
        term: "Vitality",
        category: "Stat",
        body: "Vitality increases toughness. Every point grants +1 maximum HP."
    },
    intelligence: {
        term: "Intelligence",
        category: "Stat",
        body: "Intelligence fuels spellcraft. Every point grants +1 maximum mana, and every 2 points grant +1 elemental or chaos damage."
    },
    faith: {
        term: "Faith",
        category: "Stat",
        body: "Faith strengthens divine power. Every 2 points grant +1 holy damage and +1 healing power."
    }
};

const STATUS_GLOSSARY: Record<StatusEffectType, GlossaryEntry> = {
    blind: {
        term: "Blind",
        category: "Status",
        body: "Blind heavily reduces hit chance. Blinded units can still act, but they are much more likely to miss."
    },
    blood_marked: {
        term: "Blood Marked",
        category: "Status",
        body: "Blood Marked enemies heal attackers when they are struck by melee hits. It turns focused melee pressure into sustain for your front line."
    },
    burn: {
        term: "Burn",
        category: "Status",
        body: "Burn deals heavy fire damage over a short duration. It ends sooner than poison, but each tick hits harder."
    },
    cleansed: {
        term: "Cleansed",
        category: "Status",
        body: "Cleansed prevents poison from sticking for the duration. It is a protective immunity effect rather than a damage buff."
    },
    chilled: {
        term: "Chilled",
        category: "Status",
        body: "Chilled cuts move speed and doubles cooldown penalties, making the target both slower and less responsive than a normal slow."
    },
    defiance: {
        term: "Defiance",
        category: "Status",
        body: "Defiance hardens and hastens the target. It adds bonus armor and shortens cooldowns while the rally lasts."
    },
    divine_lattice: {
        term: "Divine Lattice",
        category: "Status",
        body: "Divine Lattice makes the unit impervious to damage, unable to act, and ignored by enemies until the effect ends."
    },
    doom: {
        term: "Doom",
        category: "Status",
        body: "Doom is a delayed death mark. If it is not removed in time, the afflicted unit dies when the timer expires."
    },
    energy_shield: {
        term: "Energy Shield",
        category: "Status",
        body: "Energy Shield absorbs incoming damage with a separate shield pool before HP is lost. It is a barrier effect, not extra armor."
    },
    enraged: {
        term: "Enraged",
        category: "Status",
        body: "Enraged units move faster and hit harder. It is usually a danger sign on enemies rather than a party buff."
    },
    feared: {
        term: "Feared",
        category: "Status",
        body: "Feared units try to flee from the source of terror instead of fighting normally."
    },
    hamstrung: {
        term: "Hamstrung",
        category: "Status",
        body: "Hamstrung reduces move speed, making it harder for the target to chase, kite, or escape."
    },
    highland_defense: {
        term: "Highland Defense",
        category: "Status",
        body: "Highland Defense lets the protected warrior intercept part of the damage aimed at nearby allies, turning one durable frontliner into a bodyguard."
    },
    invul: {
        term: "Invulnerability",
        category: "Status",
        body: "Invulnerability blocks all incoming damage for the duration. It does not automatically grant free actions or repositioning on its own."
    },
    pinned: {
        term: "Pinned",
        category: "Status",
        body: "Pinned units cannot move. They may still attack or cast if something is already in range and they are otherwise able to act."
    },
    poison: {
        term: "Poison",
        category: "Status",
        body: "Poison deals damage over time until it expires or is removed. Cleansed targets are immune to it while their immunity lasts."
    },
    qi_drain: {
        term: "Qi Drain",
        category: "Status",
        body: "Qi Drain is a self-draining life cost that bleeds HP over time. It appears when power is being paid for with vitality instead of mana."
    },
    regen: {
        term: "Regeneration",
        category: "Status",
        body: "Regeneration heals the target repeatedly over time instead of all at once."
    },
    shielded: {
        term: "Shielded",
        category: "Status",
        body: "Shielded doubles armor but also slows action tempo by stretching cooldowns. It is a durable stance rather than a true damage shield."
    },
    silenced: {
        term: "Silenced",
        category: "Status",
        body: "Silenced units can still move, attack, and use abilities, but they cannot use spell skills."
    },
    sleep: {
        term: "Sleep",
        category: "Status",
        body: "Sleeping units cannot act. The effect ends early if they take damage."
    },
    slowed: {
        term: "Slowed",
        category: "Status",
        body: "Slowed cuts move speed and lengthens cooldowns, making the target less mobile and slower to respond."
    },
    stunned: {
        term: "Stunned",
        category: "Status",
        body: "Stunned units cannot move, attack, or cast until the stun ends."
    },
    sun_stance: {
        term: "Sun Stance",
        category: "Status",
        body: "Sun Stance empowers the user with fiery offense for the duration and supports the stance's healing-and-flame theme."
    },
    thorns: {
        term: "Thorns",
        category: "Status",
        body: "Thorns reflects melee damage back at attackers when they strike the protected unit up close."
    },
    vanquishing_light: {
        term: "Vanquishing Light",
        category: "Status",
        body: "Vanquishing Light surrounds the caster with a holy aura that repeatedly damages nearby enemies and may blind them."
    },
    constricted: {
        term: "Constricted",
        category: "Status",
        body: "Constricted lengthens attack and skill cooldowns, leaving the target less effective in sustained combat."
    }
};

function compareGlossaryEntries(left: GlossaryEntry, right: GlossaryEntry): number {
    return left.term.localeCompare(right.term, undefined, { sensitivity: "base" });
}

export const GLOSSARY_ENTRIES: ReadonlyArray<GlossaryEntry> = [
    ...CORE_GLOSSARY,
    ...DAMAGE_TYPE_GLOSSARY,
    ...Object.values(STAT_GLOSSARY),
    ...Object.values(STATUS_GLOSSARY)
].sort(compareGlossaryEntries);

export function GlossaryModal({ onClose }: GlossaryModalProps) {
    return (
        <ModalShell onClose={onClose} contentClassName="help-modal glossary-modal" closeOnEscape>
                <div className="help-header">
                    <h2 className="help-title">Glossary</h2>
                    <div className="close-btn" onClick={onClose}>&times;</div>
                </div>

                <div className="help-copy-layout glossary-layout">
                    <p className="help-copy-text glossary-intro">
                        Core terms, damage types, statuses, and stats are listed alphabetically by term.
                    </p>

                    {GLOSSARY_ENTRIES.map(entry => (
                        <div key={entry.term} className="help-section help-copy-section glossary-section">
                            <div className="glossary-entry-header">
                                <h3 className="glossary-term">{entry.term}</h3>
                                <span className="glossary-category">{entry.category}</span>
                            </div>
                            <p className="help-copy-text">{entry.body}</p>
                        </div>
                    ))}
                </div>

                <div className="help-footer">
                    <button className="btn btn-primary mono help-confirm-btn" onClick={onClose}>
                        Got It
                    </button>
                </div>
        </ModalShell>
    );
}
