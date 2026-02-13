import { useEffect, useRef } from "react";
import { X, Volume2 } from "lucide-react";
import { soundFns } from "../audio";

interface JukeboxModalProps {
    onClose: () => void;
}

type SoundKey = keyof typeof soundFns;

interface SoundMeta {
    name: string;
    category: string;
    previewMs?: number;
}

const SOUND_METADATA: Partial<Record<SoundKey, SoundMeta>> = {
    playAttack: { name: "Attack", category: "Combat" },
    playHit: { name: "Hit", category: "Combat" },
    playMiss: { name: "Miss", category: "Combat" },
    playBlock: { name: "Block", category: "Combat" },
    playDeath: { name: "Death", category: "Combat" },
    playFireball: { name: "Fireball", category: "Skills" },
    playExplosion: { name: "Explosion", category: "Skills" },
    playHeal: { name: "Heal", category: "Skills" },
    playWarcry: { name: "Warcry", category: "Skills" },
    playThunder: { name: "Thunder", category: "Skills" },
    playHolyStrike: { name: "Holy Strike", category: "Skills" },
    playMagicWave: { name: "Magic Wave", category: "Skills" },
    playEnergyShield: { name: "Energy Shield", category: "Skills" },
    playVines: { name: "Vines", category: "Skills" },
    playScreech: { name: "Screech", category: "Creatures" },
    playBroodMotherScreech: { name: "Brood Mother Screech", category: "Creatures" },
    playBark: { name: "Bark", category: "Creatures" },
    playSplash: { name: "Splash", category: "Creatures" },
    playGush: { name: "Gush (Split)", category: "Creatures" },
    playMetallicSqueal: { name: "Metallic Squeal", category: "Creatures" },
    startFireBreathScratch: { name: "Fire Breath Scratch (Loop)", category: "Creatures", previewMs: 1400 },
    playMove: { name: "Move", category: "UI" },
    playGold: { name: "Gold", category: "UI" },
    playLevelUp: { name: "Level Up", category: "UI" },
    playSecretDiscovered: { name: "Secret Discovered", category: "UI" },
    playFootsteps: { name: "Footsteps", category: "UI" },
    playGulp: { name: "Gulp", category: "Items" },
    playCrunch: { name: "Crunch", category: "Items" },
};

function formatSoundName(key: SoundKey): string {
    return key
        .replace(/^(play|start)/, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim();
}

const SOUND_LIST: { name: string; key: SoundKey; category: string; previewMs?: number }[] = (Object.keys(soundFns) as SoundKey[])
    .map(key => {
        const meta = SOUND_METADATA[key];
        return {
            key,
            name: meta?.name ?? formatSoundName(key),
            category: meta?.category ?? "Misc",
            previewMs: meta?.previewMs,
        };
    })
    .sort((a, b) => {
        if (a.category === b.category) return a.name.localeCompare(b.name);
        return a.category.localeCompare(b.category);
    });

// Group sounds by category
const CATEGORIES = [...new Set(SOUND_LIST.map(s => s.category))];

export function JukeboxModal({ onClose }: JukeboxModalProps) {
    const activeLoopStopRef = useRef<(() => void) | null>(null);
    const loopStopTimerRef = useRef<number | null>(null);

    const stopLoopPreview = () => {
        if (loopStopTimerRef.current !== null) {
            window.clearTimeout(loopStopTimerRef.current);
            loopStopTimerRef.current = null;
        }
        if (activeLoopStopRef.current) {
            activeLoopStopRef.current();
            activeLoopStopRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            stopLoopPreview();
        };
    }, []);

    const playSound = (key: SoundKey) => {
        stopLoopPreview();
        const result = soundFns[key]();
        if (typeof result === "function") {
            activeLoopStopRef.current = result;
            const previewMs = SOUND_LIST.find(sound => sound.key === key)?.previewMs ?? 1200;
            loopStopTimerRef.current = window.setTimeout(() => {
                if (activeLoopStopRef.current) {
                    activeLoopStopRef.current();
                    activeLoopStopRef.current = null;
                }
                loopStopTimerRef.current = null;
            }, previewMs);
        }
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
