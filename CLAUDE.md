# Rules

## Environment

- This project runs on Windows. When using bash commands, always use relative paths from the project root. Never use absolute Windows paths (c:\...) in bash - they don't work in the shell environment. Use `find`, `ls`, `grep`, etc. with relative paths like `./src/...`.
- For file reading/writing, use the dedicated file tools which handle Windows paths natively.
- `"` not `'`, 4-space indent
- Search for existing code before writing new — import, never rewrite
- Inspect usages on every change — reuse correctly, don't break contracts
- Explicit complete types — no `any`, `as`, `!`, no guessed defaults (ask)
- No placeholders/TODOs, no invented utilities, no runtime checks the type system covers
- Ask before substantial refactors — offer `git commit` first

---

# Codebase Cheatsheet

React + Three.js ARPG. State in React (`Unit[]` via `setUnits`), 3D positions on `UnitGroup` objects. Game loop mutates positions directly, batches React updates via `setUnits(prev => ...)`.

## Directory Map

| Path | Purpose |
|------|---------|
| `core/types/` | `Unit`, `EnemyStats`, `Skill`, `StatusEffect`, `Projectile`, etc. |
| `core/constants.ts` | Magic numbers, durations, `COLORS`, speeds |
| `core/gameClock.ts` | Pause-aware clock for animations: `getGameTime`, `updateGameClock`, `pauseGameClock`, `resumeGameClock` |
| `game/playerUnits.ts` | `UNIT_DATA`, `getEffectiveUnitData`, `getEffectiveMaxHp`, `getAllSkills`, `getBasicAttackSkill`, `getXpForLevel` |
| `game/enemyStats.ts` | `ENEMY_STATS` keyed by `EnemyType` (alphabetical — editor dropdown derives from key order) |
| `game/units.ts` | `getUnitStats(unit)` (player or enemy), `getAttackRange()` |
| `game/skills.ts` | Player skill definitions (ranges, damage, cooldowns, mana) |
| `game/statBonuses.ts` | Stat formulas: str->dmg, dex->crit, int->magic, faith->heal, vit->hp |
| `game/equipment.ts` | Equipment definitions and stat mods |
| `combat/combatMath.ts` | Hit/damage/crit/armor calc, poison/slow helpers, cooldown math, log builders |
| `combat/damageEffects.ts` | `applyDamageToUnit()` (shields, split, defeat, XP, tentacle), `DamageContext`, projectile/ring creation |
| `combat/skills/` | Player skill executors. Router `index.ts`, `damage.ts`, `support.ts`, `utility.ts` |
| `combat/skills/helpers.ts` | `findClosestTargetByTeam()`, `consumeSkill()` |
| `combat/skills/types.ts` | `SkillExecutionContext` |
| `gameLoop/index.ts` | `updateUnitAI()`: targeting -> kiting -> behaviors -> attack -> movement |
| `gameLoop/enemyAttack.ts` | `executeEnemyBasicAttack()` — melee/ranged/fireball |
| `gameLoop/enemySkills.ts` | `executeEnemySwipe()`, `executeEnemyHeal()` |
| `gameLoop/enemyBehaviors/` | One file per ability, pattern: `try*()` returning boolean |
| `gameLoop/statusEffects.ts` | Per-tick processing: poison, buff expiry, doom |
| `gameLoop/projectiles.ts` | Projectile movement + impact per frame |
| `gameLoop/acidTiles.ts` | Acid tile creation, damage ticks, aura |
| `gameLoop/sanctuaryTiles.ts` | Sanctuary healing ticks |
| `ai/unitAI.ts` | `runTargetingPhase()`, `runPathFollowingPhase()`, `runMovementPhase()` |
| `ai/pathfinding.ts` | A* on the grid |
| `ai/targeting.ts` | `tryKite()` for ranged enemy retreat |
| `rendering/range.ts` | `getUnitRadius()`, `isInRange()` — hitbox-aware |
| `rendering/scene/` | Three.js mesh creation (units, terrain, decorations) |
| `audio/` | `soundFns.playHit()`, `.playMiss()`, `.playHeal()`, etc. |
| `editor/` | Map editor UI. `constants.ts` has `ENEMY_TYPES` from `Object.keys(ENEMY_STATS)` |
| `game/areas/` | Area/map defs. `textLoader.ts` parses text maps, `maps/` has map files |

## How-To Recipes

### New Enemy
1. `core/types/units.ts` -> `EnemyType` union
2. `game/enemyStats.ts` -> `ENEMY_STATS` entry (alphabetical key order)
3. `rendering/scene/units.ts` -> mesh case
4. Place in map or editor. If special behavior, see below.

### New Enemy Behavior
1. Skill type on `EnemyStats` in `core/types/units.ts` (`mySkill?: EnemyMySkill`)
2. Skill interface in `core/types/combat.ts`
3. `gameLoop/enemyBehaviors/myBehavior.ts` -> `tryMyBehavior(ctx): boolean`
4. Export from `gameLoop/enemyBehaviors/index.ts`
5. Wire in `gameLoop/index.ts` `updateUnitAI()`: `if (!isPlayer && 'mySkill' in data && data.mySkill) { ... }`
6. Set skill on enemy in `ENEMY_STATS`

### New Player Skill
1. Define in `game/skills.ts`, add to unit's skill list
2. Executor: single-target -> `executeTargetedDamageSkill()` in `damage.ts` | AoE -> custom in `damage.ts` | heal/buff -> `support.ts` | taunt/debuff/trap -> `utility.ts`
3. Wire router in `combat/skills/index.ts` matching `skill.type` + `skill.targetType`
4. Helpers: `consumeSkill`, `findClosestTargetByTeam`, `applyDamageToUnit`, `createAnimatedRing`, `createLightningPillar`, `rollHit`, `calculateDamageWithCrit`, `getEffectiveArmor`, `calculateStatBonus`

### New Status Effect
1. `core/types/combat.ts` -> `StatusEffectType` union
2. `core/constants.ts` -> duration, tick interval, colors
3. `gameLoop/statusEffects.ts` -> tick processing
4. `gameLoop/visuals.ts` -> visual tint
5. Optional: `combat/combatMath.ts` -> application helper

### New Projectile Type
1. `core/types/combat.ts` -> `Projectile` union
2. Mesh in `combat/damageEffects.ts` or inline
3. `gameLoop/projectiles.ts` -> case in `updateProjectiles()`

## Key Patterns

- **`getGameTime()`** — visual animations that freeze when paused. Import from `core/gameClock`. Game-logic timestamps (cooldowns, status effects) still use `Date.now()`. Updated per frame in `useGameLoop`, paused/resumed in `togglePause()`.
- **`defeatedThisFrame: Set<number>`** — prevents overkill from multiple damage sources per frame
- **`createHpTracker(units)`** — local HP tracking for multi-hit skills (avoids stale React state)
- **`setUnits(prev => prev.map(...))`** — always functional updates
- **`unitsStateRef.current`** — read-only ref for fresh HP reads mid-frame
- **`SkillExecutionContext`** / **`DamageContext`** — context bags for skill execution / damage pipeline
- **Enemy behaviors**: `try*(ctx): boolean`
- **Cooldown key**: `` `${unitId}-${skillName}` `` via `setSkillCooldown()`
- **Range checks**: always `isInRange()` from `rendering/range.ts` (hitbox-aware)
