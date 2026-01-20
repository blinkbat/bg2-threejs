// =============================================================================
// BARKS - Random character voice lines for combat events
// =============================================================================

// Bark phrases for different situations
const KILL_BARKS = [
    "And stay down!",
    "That's one less to worry about.",
    "You should've stayed in bed.",
    "Too slow!",
    "Is that the best you've got?",
    "Pathetic.",
];

const HEAL_BARKS = [
    "I owe you one.",
    "Much better, thanks!",
    "Bless you!",
    "That's the stuff.",
    "Ahh, sweet relief.",
    "Just what I needed.",
];

const SPELL_BARKS = [
    "Take this!",
    "This oughta hurt 'em!"
];

// Configuration
const BARK_CHANCE = 1.0;           // 100% chance to bark (for testing)
const BARK_THROTTLE_MS = 5000;     // 5 second cooldown between barks (per category)

// Track last bark time per category (separate throttles)
let lastKillBarkTime = 0;
let lastHealBarkTime = 0;
let lastSpellBarkTime = 0;

/** Pick a random element from an array */
function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Check if enough time has passed since last bark of this type */
function canBark(lastTime: number, now: number): boolean {
    return now - lastTime >= BARK_THROTTLE_MS;
}

/** Roll for bark chance */
function shouldBark(): boolean {
    return Math.random() < BARK_CHANCE;
}

/**
 * Try to trigger a kill bark
 * @param unitName Name of the unit who got the kill
 * @param addLog Function to add to combat log
 * @returns true if bark was triggered
 */
export function tryKillBark(
    unitName: string,
    addLog: (text: string, color?: string) => void
): boolean {
    const now = Date.now();
    if (!canBark(lastKillBarkTime, now) || !shouldBark()) return false;

    lastKillBarkTime = now;
    const bark = pickRandom(KILL_BARKS);
    addLog(`${unitName}: "${bark}"`, "#f5d742");
    return true;
}

/**
 * Try to trigger a heal bark (from the healed unit)
 * @param unitName Name of the unit who received the heal
 * @param addLog Function to add to combat log
 * @returns true if bark was triggered
 */
export function tryHealBark(
    unitName: string,
    addLog: (text: string, color?: string) => void
): boolean {
    const now = Date.now();
    if (!canBark(lastHealBarkTime, now) || !shouldBark()) return false;

    lastHealBarkTime = now;
    const bark = pickRandom(HEAL_BARKS);
    addLog(`${unitName}: "${bark}"`, "#f5d742");
    return true;
}

/**
 * Try to trigger a spell bark (from the caster)
 * @param unitName Name of the unit casting the spell
 * @param addLog Function to add to combat log
 * @returns true if bark was triggered
 */
export function trySpellBark(
    unitName: string,
    addLog: (text: string, color?: string) => void
): boolean {
    const now = Date.now();
    if (!canBark(lastSpellBarkTime, now) || !shouldBark()) return false;

    lastSpellBarkTime = now;
    const bark = pickRandom(SPELL_BARKS);
    addLog(`${unitName}: "${bark}"`, "#f5d742");
    return true;
}

/**
 * Reset bark state (call on game restart)
 */
export function resetBarks(): void {
    lastKillBarkTime = 0;
    lastHealBarkTime = 0;
    lastSpellBarkTime = 0;
}
