import { X, Volume2 } from "lucide-react";
import { soundFns } from "../audio/sound";

interface JukeboxModalProps {
    onClose: () => void;
}

// Sound definitions with display names and categories
const SOUND_LIST: { name: string; key: keyof typeof soundFns; category: string }[] = [
    // Combat
    { name: "Attack", key: "playAttack", category: "Combat" },
    { name: "Hit", key: "playHit", category: "Combat" },
    { name: "Miss", key: "playMiss", category: "Combat" },
    { name: "Block", key: "playBlock", category: "Combat" },
    { name: "Death", key: "playDeath", category: "Combat" },
    // Skills
    { name: "Fireball", key: "playFireball", category: "Skills" },
    { name: "Explosion", key: "playExplosion", category: "Skills" },
    { name: "Heal", key: "playHeal", category: "Skills" },
    { name: "Warcry", key: "playWarcry", category: "Skills" },
    { name: "Thunder", key: "playThunder", category: "Skills" },
    { name: "Magic Wave", key: "playMagicWave", category: "Skills" },
    { name: "Energy Shield", key: "playEnergyShield", category: "Skills" },
    { name: "Vines", key: "playVines", category: "Skills" },
    // Creatures
    { name: "Screech", key: "playScreech", category: "Creatures" },
    { name: "Brood Mother", key: "playBroodMotherScreech", category: "Creatures" },
    { name: "Bark", key: "playBark", category: "Creatures" },
    { name: "Splash", key: "playSplash", category: "Creatures" },
    { name: "Gush (Split)", key: "playGush", category: "Creatures" },
    // UI / Misc
    { name: "Move", key: "playMove", category: "UI" },
    { name: "Gold", key: "playGold", category: "UI" },
    { name: "Level Up", key: "playLevelUp", category: "UI" },
    { name: "Secret", key: "playSecretDiscovered", category: "UI" },
    // Consumables
    { name: "Gulp", key: "playGulp", category: "Items" },
    { name: "Crunch", key: "playCrunch", category: "Items" },
];

// Group sounds by category
const CATEGORIES = [...new Set(SOUND_LIST.map(s => s.category))];

export function JukeboxModal({ onClose }: JukeboxModalProps) {
    const playSound = (key: keyof typeof soundFns) => {
        soundFns[key]();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content jukebox-modal" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Jukebox</h2>
                    <div className="close-btn" onClick={onClose}><X size={18} /></div>
                </div>

                <div className="jukebox-content">
                    {CATEGORIES.map(category => (
                        <div key={category} className="jukebox-category">
                            <div className="jukebox-category-title">{category}</div>
                            <div className="jukebox-buttons">
                                {SOUND_LIST.filter(s => s.category === category).map(sound => (
                                    <button
                                        key={sound.key}
                                        className="jukebox-btn"
                                        onClick={() => playSound(sound.key)}
                                    >
                                        <Volume2 size={14} />
                                        <span>{sound.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
