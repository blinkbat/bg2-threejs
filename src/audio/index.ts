// =============================================================================
// AUDIO INDEX - Re-exports all sound functions
// =============================================================================

import { isMuted, toggleMute, playTone } from "./core";
import { playFireball, playExplosion, playDeath, playBlock } from "./combat";
import { playScreech, playBroodMotherScreech, playGush, playBark, playSplash, playMetallicSqueal, startFireBreathScratch } from "./creatures";
import { playHeal, playWarcry, playMagicWave, playEnergyShield, playThunder, playHolyStrike, playVines } from "./spells";
import { playDialogBlip, playGulp, playLevelUp, playGameStartFanfare, playSecretDiscovered, playCrunch, playGold, playFootsteps } from "./ui";

// Re-export mute controls
export { isMuted, toggleMute };

// Export all sound functions as a single object
export const soundFns = {
    playMove: () => playTone(800, 0.06, 0.12, "square", undefined, 3000),
    playAttack: () => playTone(440, 0.08, 0.15, "square", 330, 2500),
    playHit: () => playTone(120, 0.15, 0.25, "sawtooth", 40, 800),
    playMiss: () => playTone(200, 0.12, 0.1, "triangle", 400, 2000),
    playFireball,
    playExplosion,
    playHeal,
    playDeath,
    playWarcry,
    playScreech,
    playBroodMotherScreech,
    playMagicWave,
    playGush,
    playGulp,
    playCrunch,
    playLevelUp,
    playGameStartFanfare,
    playSecretDiscovered,
    playEnergyShield,
    playThunder,
    playHolyStrike,
    playBark,
    playVines,
    playSplash,
    playMetallicSqueal,
    startFireBreathScratch,
    playGold,
    playBlock,
    playFootsteps,
    playDialogBlip,
};
