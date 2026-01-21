// =============================================================================
// GAME LOOP MODULE - Re-exports from split modules
// =============================================================================

// Visual effects
export { updateDamageTexts, updateHitFlash, updatePoisonVisuals, updateFogOfWar, resetFogCache } from "./visuals";

// Status effects
export { processStatusEffects } from "./statusEffects";

// Projectiles
export { updateProjectiles } from "./projectiles";

// Swing animations
export { spawnSwingIndicator, updateSwingAnimations } from "./swingAnimations";

// Enemy skills
export { executeEnemySwipe, executeEnemyHeal } from "./enemySkills";
