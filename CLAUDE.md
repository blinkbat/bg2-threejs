# Session Protocol

## Phase 1: Orientation (Always First)
1. Map the directory structure and file organization
2. Identify existing utilities, helpers, and shared logic
3. Locate relevant type definitions and interfaces
4. Assume the Windows command line.
5. BEFORE attempting substantial refactors, ask if the user would like to `git commit` first.

## Phase 2: Implementation Constraints

### Code Reuse (Highest Priority)
- Search for existing implementations before writing new code
- Import and reference existing functions—never rewrite them
- Prefer established libraries over custom implementations
- When making a change, always think hard about what previous code might be affected. Inspect usages and make sure code is both reused correctly and non-contract-breaking.

### Type Safety (Strict)
- All types must be explicit and complete
- No `undefined` defaults or optional properties unless explicitly specified
- Expand existing types when necessary rather than using escape hatches (`any`, `as`, `!`)
- If required values are unknown, ask—do not assume

### Style
- Use `"` for strings, not `'`
- Use 4-space indentation

## Absolutely Do Not
- Duplicate logic that exists elsewhere in the codebase
- Introduce new dependencies when existing ones suffice
- Use type hacks (`any`, `unknown` casts, non-null assertions) to bypass errors
- Assume default/optional values without confirmation
- Invent utilities when they already exist—you didn't look hard enough
- Write "placeholder" or "TODO" implementations
- Guess at architecture patterns—match what's already there
- Add runtime checks for things the type system can assure

---

# Codebase Cheatsheet

## Architecture Overview
React + Three.js ARPG. State lives in React (`Unit[]` via `setUnits`), 3D positions live on `UnitGroup` objects in the Three.js scene. The game loop reads both, mutates positions directly, and batches state updates via `setUnits(prev => ...)`.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/core/types/` | All interfaces: `Unit`, `EnemyStats`, `Skill`, `StatusEffect`, `Projectile`, etc. |
| `src/core/constants.ts` | All magic numbers, durations, colors (`COLORS`), speeds |
| `src/core/gameClock.ts` | Pause-aware game clock for animations (`getGameTime`, `updateGameClock`, `pauseGameClock`, `resumeGameClock`) |
| `src/game/playerUnits.ts` | `UNIT_DATA` (player stats by ID), `getEffectiveUnitData`, `getEffectiveMaxHp`, `getAllSkills`, `getBasicAttackSkill`, `getXpForLevel` |
| `src/game/enemyStats.ts` | `ENEMY_STATS` record keyed by `EnemyType` — all enemy stat blocks |
| `src/game/units.ts` | `getUnitStats(unit)` (returns player or enemy stats), `getAttackRange()` |
| `src/game/skills.ts` | Skill definitions per player unit (the actual skill objects with ranges, damage, cooldowns) |
| `src/game/statBonuses.ts` | Stat-to-bonus formulas (str->dmg, dex->crit, int->magic, faith->heal, vit->hp) |
| `src/game/equipment.ts` | Equipment definitions and stat modifications |
| `src/combat/combatMath.ts` | Hit rolls, damage calc, crit, armor, poison/slow application, status helpers, cooldown math, log message builders |
| `src/combat/damageEffects.ts` | `applyDamageToUnit()` (the big one -- handles shields, amoeba split, defeat, XP, tentacle death), `DamageContext`, projectile/ring creation |
| `src/combat/skills/` | Player skill executors. Router in `index.ts`, damage in `damage.ts`, support in `support.ts`, utility in `utility.ts` |
| `src/combat/skills/helpers.ts` | `findClosestTargetByTeam()`, `consumeSkill()` |
| `src/combat/skills/types.ts` | `SkillExecutionContext` -- the context bag for all player skill execution |
| `src/gameLoop/index.ts` | `updateUnitAI()` -- the main per-unit AI tick. Targeting -> kiting -> behaviors -> attack -> movement |
| `src/gameLoop/enemyAttack.ts` | `executeEnemyBasicAttack()` dispatches melee/ranged/fireball |
| `src/gameLoop/enemySkills.ts` | `executeEnemySwipe()`, `executeEnemyHeal()` |
| `src/gameLoop/enemyBehaviors/` | One file per special enemy ability. Pattern: `try*()` functions returning boolean |
| `src/gameLoop/statusEffects.ts` | Per-tick status effect processing (poison ticks, buff expiry, doom countdown) |
| `src/gameLoop/projectiles.ts` | Projectile movement + impact resolution per frame |
| `src/gameLoop/acidTiles.ts` | Acid tile creation, damage ticks, aura logic |
| `src/gameLoop/sanctuaryTiles.ts` | Sanctuary tile healing ticks |
| `src/ai/unitAI.ts` | `runTargetingPhase()`, `runPathFollowingPhase()`, `runMovementPhase()` |
| `src/ai/pathfinding.ts` | A* pathfinding on the grid |
| `src/ai/targeting.ts` | `tryKite()` for ranged enemy retreat |
| `src/rendering/range.ts` | `getUnitRadius()`, `isInRange()` -- hitbox-aware range checks |
| `src/rendering/scene/` | Three.js mesh creation for units, terrain, decorations |
| `src/audio/` | Sound effect functions via `soundFns.*` |
| `src/editor/` | Map editor UI (React). `constants.ts` has `ENEMY_TYPES` from `Object.keys(ENEMY_STATS)` |
| `src/game/areas/` | Area/map definitions. `textLoader.ts` parses text-format maps, `maps/` has map files |

## How To: Add a New Enemy

1. **Type**: `src/core/types/units.ts` -> add to `EnemyType` union
2. **Stats**: `src/game/enemyStats.ts` -> add entry to `ENEMY_STATS` (alphabetical order -- editor dropdown derives from key order)
3. **Mesh**: `src/rendering/scene/units.ts` -> add case in enemy mesh creation
4. **Place it**: add to a map in `src/game/areas/maps/` or place via editor

If the enemy has special behavior, see "Add a New Enemy Behavior" below.

## How To: Add a New Enemy Behavior

1. **Skill type** on `EnemyStats` in `src/core/types/units.ts` (e.g. `mySkill?: EnemyMySkill`)
2. **Skill interface** in `src/core/types/combat.ts` (e.g. `EnemyMySkill { name, cooldown, range, ... }`)
3. **Behavior file**: `src/gameLoop/enemyBehaviors/myBehavior.ts` -- export `tryMyBehavior(ctx): boolean`
4. **Export** from `src/gameLoop/enemyBehaviors/index.ts`
5. **Wire into AI**: `src/gameLoop/index.ts` -> add if-block in `updateUnitAI()` (pattern: `if (!isPlayer && 'mySkill' in data && data.mySkill) { ... }`)
6. **Set skill** on the enemy in `ENEMY_STATS`

## How To: Add a New Player Skill

1. **Define skill** in `src/game/skills.ts` (damage range, cooldown, mana cost, type, targetType)
2. **Add to unit's skill list** in same file
3. **Write executor** in:
   - Single-target damage: use `executeTargetedDamageSkill()` in `src/combat/skills/damage.ts`
   - AoE/multi-hit damage: custom function in `damage.ts`
   - Heal/buff/cleanse: `src/combat/skills/support.ts`
   - Taunt/debuff/trap/sanctuary: `src/combat/skills/utility.ts`
4. **Wire into router**: `src/combat/skills/index.ts` -> add else-if in `executeSkill()` matching `skill.type` + `skill.targetType`
5. **Export** from skill module index

Key helpers: `consumeSkill()`, `findClosestTargetByTeam()`, `applyDamageToUnit()`, `createAnimatedRing()`, `createLightningPillar()`, `rollHit()`, `calculateDamageWithCrit()`, `getEffectiveArmor()`, `calculateStatBonus()`

## How To: Add a New Status Effect

1. **Type**: `src/core/types/combat.ts` -> add to `StatusEffectType` union
2. **Constants**: `src/core/constants.ts` -> duration, tick interval, special values
3. **Colors**: `src/core/constants.ts` -> `COLORS` object (effect, text, bg)
4. **Tick processing**: `src/gameLoop/statusEffects.ts`
5. **Visual tint**: `src/gameLoop/visuals.ts`
6. **Application helper** (optional): `src/combat/combatMath.ts`

## How To: Add a New Projectile Type

1. **Type**: `src/core/types/combat.ts` -> add to `Projectile` union
2. **Mesh creation**: `src/combat/damageEffects.ts` or inline in skill
3. **Movement + impact**: `src/gameLoop/projectiles.ts` -> add case in `updateProjectiles()`

## Key Patterns

- **Game Clock (`getGameTime()`)** -- for visual animations that should freeze when paused. Import from `core/gameClock`. Do NOT use for game-logic timestamps (cooldowns, status effects) which still use `Date.now()`. Updated once per frame in `useGameLoop`, paused/resumed in `togglePause()`.
- **`defeatedThisFrame: Set<number>`** -- prevents overkill from multiple damage sources in one frame
- **`createHpTracker(units)`** -- local HP tracking for multi-hit skills to avoid stale React state
- **`setUnits(prev => prev.map(...))`** -- always use functional updates
- **`unitsStateRef.current`** -- read-only ref to latest state for fresh HP reads mid-frame
- **`SkillExecutionContext`** -- context bag for player skill execution (scene, refs, setters)
- **`DamageContext`** -- smaller context bag for `applyDamageToUnit()`
- **Enemy behavior pattern**: `try*(ctx): boolean` -- returns true if behavior fired
- **Cooldown key**: `` `${unitId}-${skillName}` `` with `setSkillCooldown()` helper
- **Hitbox-aware range**: always use `isInRange(x1, z1, x2, z2, targetRadius, range)` from `rendering/range.ts`
- **Sound effects**: `soundFns.playHit()`, `.playMiss()`, `.playHeal()`, etc. from `src/audio/`