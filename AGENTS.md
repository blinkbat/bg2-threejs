# Rules

Adapted from `CLAUDE.md` for Codex usage.

## Environment

- This project runs on Windows. When using bash commands, always use relative paths from the project root. Never use absolute Windows paths (`c:\...`) in bash.
- For file reading/writing, use tools that handle Windows paths correctly.
- `"` not `'`, 4-space indent.
- Prefer `rg` for search and file discovery.
- Search for existing code before writing new code. Reuse imports and established patterns.
- Inspect usages on every change. Do not break contracts.
- Explicit complete types. Avoid `any`, `as`, and `!` unless absolutely unavoidable.
- No placeholders/TODOs, no invented utilities, no runtime checks the type system already guarantees.
- Ask before substantial refactors and offer a clean commit point first.
- Ask clarifying questions only when ambiguity blocks a safe implementation.
- Prefer one-pass execution and practical completion over repeated confirmation loops.
- Optimize for maintainability and correctness from a future-you perspective.
- Unit visual policy: never add new custom per-unit mesh construction in `rendering/scene/units.ts`; for new enemies, use existing sprite config paths or the shared default unit geometry path.
- Hard guardrail: do not introduce special-case unit mesh branches for individual enemy/unit IDs or types unless the user explicitly asks for that exact approach in the current thread.
- Keep `EnemyType` and `ENEMY_STATS` strictly alphabetical when adding enemies.
- If adding new fields to `EnemyStats`, wire them into runtime logic in the same change (or explicitly document why not).
- Resource-cap rule: when clamping/restoring HP/MP at runtime, always use `getEffectiveMaxHp(unit.id, unit)` / `getEffectiveMaxMana(unit.id, unit)` with the live `Unit` snapshot (never raw `UNIT_DATA` max values).
- Basic-attack rule: basic attack damage already receives stat bonuses in the combat/projectile pipeline; avoid pre-baking stat bonuses into execution payloads.
- For rendering changes (`units`, `trees`, `water`, `lights`), always run `npm run build` and include a short verification note.
- Do not add or reintroduce flashy basic-attack visuals unless explicitly requested.

---
# Codebase Cheatsheet

React + Three.js ARPG. State in React (`Unit[]` via `setUnits`), 3D positions on `UnitGroup` objects. Game loop mutates positions directly, batches React updates via `setUnits(prev => ...)`.

## Directory Map

| Path | Purpose |
|------|---------|
| **Core** | |
| `core/types/` | `Unit`, `EnemyStats`, `Skill`, `StatusEffect`, `Projectile`, etc. Split: `units.ts`, `combat.ts`, `items.ts`, `world.ts` |
| `core/constants.ts` | Magic numbers, durations, `COLORS`, speeds |
| `core/gameClock.ts` | Pause-aware clock for animations: `getGameTime`, `updateGameClock`, `pauseGameClock`, `resumeGameClock` |
| `core/effectScheduler.ts` | Shared pause-aware visual effect ticker (`scheduleEffectAnimation`, `updateEffectAnimations`, `clearEffectAnimations`) |
| `core/stateUtils.ts` | `updateUnit()`, `updateUnitWith()`, `updateUnitsWhere()` — functional React state helpers |
| `core/unitIds.ts` | `getNextUnitId()`, `initializeUnitIdCounter()` — collision-safe ID generation for spawns |
| **Game data** | |
| `game/playerUnits.ts` | `UNIT_DATA`, `getEffectiveUnitData`, `getEffectiveMaxHp`, `getAllSkills`, `getBasicAttackSkill`, `getXpForLevel` |
| `game/enemyStats.ts` | `ENEMY_STATS` keyed by `EnemyType` (alphabetical — editor dropdown derives from key order) |
| `game/units.ts` | `getUnitStats(unit)` (player or enemy), `getAttackRange()` |
| `game/skills.ts` | Player skill definitions (ranges, damage, cooldowns, mana) |
| `game/statBonuses.ts` | Stat formulas: str->dmg, dex->crit, int->magic, faith->heal, vit->hp |
| `game/items.ts` | Item definitions: weapons, shields, armor, accessories, consumables |
| `game/equipment.ts` | Equipment slot logic and stat mods |
| `game/equipmentState.ts` | Module-level equipment/inventory state store (`initializeEquipmentState`, `resetEquipmentState`) |
| `game/enemyState.ts` | Module-level enemy state: kite cooldowns, kiting status tracking |
| `game/geometry.ts` | `distance()`, `distanceBetween()`, `distanceToPoint()`, `clampToGrid()`, `worldToCell()`, `cellToWorld()` |
| `game/formation.ts` | `getFormationPositions()`, `getFormationPositionsForSpawn()` |
| `game/formationOrder.ts` | Formation ordering helpers (`buildEffectiveFormationOrder`, `sortUnitsByFormationOrder`) |
| `game/unitQuery.ts` | `getAliveUnits()`, `findNearestUnit()`, `isPlayerVisible()` |
| `game/fogMemory.ts` | Persistent fog-of-war memory per area (`loadFogVisibility`, `saveFogVisibility`) |
| `game/dungeon.ts` | Backwards-compatible proxy exports for current area grids (`blocked`, `getBlocked`, etc.) |
| `game/saveLoad.ts` | Save/load system: save slots, versioning, persistence |
| `game/areas/` | Area/map defs. `textLoader.ts` parses text maps, `helpers.ts` for blocked/terrain, `maps/` has map files |
| **Combat** | |
| `combat/combatMath.ts` | Hit/damage/crit/armor calc, poison/slow helpers, cooldown math, log builders |
| `combat/damageEffects.ts` | `applyDamageToUnit()` (shields, split, defeat, XP, tentacle), `DamageContext`, projectile/ring creation |
| `combat/barks.ts` | Random voice-line barks on kill/heal/spell events |
| `combat/skills/` | Player skill executors. Router `index.ts`, `damage.ts`, `support.ts`, `utility.ts`, `movement.ts` |
| `combat/skills/helpers.ts` | `findClosestTargetByTeam()`, `consumeSkill()` |
| `combat/skills/types.ts` | `SkillExecutionContext` |
| **Game loop** | |
| `gameLoop/index.ts` | `updateUnitAI()`: targeting -> kiting -> behaviors -> attack -> movement |
| `gameLoop/enemyAttack.ts` | `executeEnemyBasicAttack()` — melee/ranged/fireball (incl. bite) |
| `gameLoop/enemySkills.ts` | `executeEnemySwipe()`, `executeEnemyHeal()` |
| `gameLoop/enemyBehaviors/` | One file per ability, pattern: `try*()` returning boolean |
| `gameLoop/statusEffects.ts` | Per-tick processing: poison, buff expiry, doom, stun |
| `gameLoop/projectiles.ts` | Projectile movement + impact per frame |
| `gameLoop/acidTiles.ts` | Acid tile creation, damage ticks, aura |
| `gameLoop/sanctuaryTiles.ts` | Sanctuary healing ticks |
| `gameLoop/necromancerCurse.ts` | Delayed circular AoE with ground warning (curse telegraph) |
| `gameLoop/constructCharge.ts` | Construct charge attack processing |
| `gameLoop/lootBags.ts` | Loot bag spawning, bounce animation, pickup, cleanup |
| `gameLoop/swingAnimations.ts` | Melee swing indicator visuals |
| `gameLoop/visuals.ts` | Status effect tints, unit visual updates |
| `gameLoop/tileUtils.ts` | Tile-related utility functions |
| **Input / Hooks** | |
| `input/index.ts` | Action queue (`QueuedAction`), pause handling, skill queueing, `processActionQueue()` |
| `hooks/useGameLoop.ts` | Main game loop hook — calls `updateUnitAI`, processes effects/projectiles/glares/curses |
| `hooks/useThreeScene.ts` | Three.js scene setup/teardown, cleanup on area transitions |
| `hooks/useInputHandlers.ts` | Mouse/keyboard input, click-to-move, skill targeting, selection |
| `hooks/hotbarStorage.ts` | Hotbar layout persistence |
| `hooks/localStorage.ts` | Persistent UI state: hotbar assignments, formation order (NOT game save) |
| **AI** | |
| `ai/unitAI.ts` | `runTargetingPhase()`, `runPathFollowingPhase()`, `runMovementPhase()` |
| `ai/pathfinding.ts` | A* on the grid |
| `ai/targeting.ts` | `tryKite()` for ranged enemy retreat |
| `ai/movement.ts` | Stuck detection, jitter prevention, give-up cooldowns, target scan cooldowns |
| **Rendering** | |
| `rendering/range.ts` | `getUnitRadius()`, `isInRange()` — hitbox-aware |
| `rendering/disposal.ts` | `disposeBasicMesh()`, `disposeGeometry()` — Three.js cleanup |
| `rendering/scene/units.ts` | Unit mesh creation per enemy type |
| `rendering/scene/updates.ts` | Scene element updates: chests, camera, water, billboards, LOD, transparency, fog |
| `rendering/scene/types.ts` | `DoorMesh`, `SecretDoorMesh`, `ChestMeshData`, `SceneRefs` |
| **UI / Audio** | |
| `components/` | React UI: `PartyBar`, `UnitPanel`, `SkillHotbar`, `HUD`, `CombatLog`, modals |
| `audio/` | `soundFns.*` object. Modular: `core.ts`, `combat.ts`, `creatures.ts`, `spells.ts`, `ui.ts`, re-exported from `index.ts` |
| `editor/` | Map editor UI. `constants.ts` has `ENEMY_TYPES` from `Object.keys(ENEMY_STATS)` |

## How-To Recipes

### New Enemy
1. `core/types/units.ts` -> `EnemyType` union
2. `game/enemyStats.ts` -> `ENEMY_STATS` entry (alphabetical key order)
3. `rendering/scene/units.ts` -> use existing sprite config and/or shared default unit geometry path (no new custom per-unit mesh branches)
4. If no sprite exists yet, keep the default shared unit geometry path (do not create one-off custom meshes).
5. Place in map or editor. If special behavior, see below.

### New Enemy Behavior
1. Skill type on `EnemyStats` in `core/types/units.ts` (`mySkill?: EnemyMySkill`)
2. Skill interface in `core/types/units.ts`
3. Context interface in `gameLoop/enemyBehaviors/types.ts`
4. `gameLoop/enemyBehaviors/myBehavior.ts` -> `tryMyBehavior(ctx): boolean`
5. Export from `gameLoop/enemyBehaviors/index.ts` (types + functions)
6. Wire in `gameLoop/index.ts` `updateUnitAI()`: `if (!isPlayer && 'mySkill' in data && data.mySkill) { ... }`
7. If per-frame processing needed (telegraphs): add `process*()` call in `hooks/useGameLoop.ts`, add `clear*()` in `hooks/useThreeScene.ts`
8. Set skill on enemy in `ENEMY_STATS`

### New Player Skill
1. Define in `game/skills.ts`, add to unit's skill list
2. Executor: single-target -> `executeTargetedDamageSkill()` in `damage.ts` | AoE -> custom in `damage.ts` | heal/buff -> `support.ts` | taunt/debuff/trap -> `utility.ts`
3. Wire router in `combat/skills/index.ts` matching `skill.type` + `skill.targetType`
4. Helpers: `consumeSkill`, `findClosestTargetByTeam`, `applyDamageToUnit`, `createAnimatedRing`, `createLightningPillar`, `rollHit`, `calculateDamageWithCrit`, `getEffectiveArmor`, `calculateStatBonus`

### New Status Effect
1. `core/types/units.ts` -> `StatusEffectType` union
2. `core/constants.ts` -> duration, tick interval, colors
3. `gameLoop/statusEffects.ts` -> tick processing
4. `gameLoop/visuals.ts` -> visual tint
5. Optional: `combat/combatMath.ts` -> application helper

### New Projectile Type
1. `core/types/combat.ts` -> `Projectile` union
2. Mesh in `combat/damageEffects.ts` or inline
3. `gameLoop/projectiles.ts` -> case in `updateProjectiles()`

### New Equipment Item
1. `game/items.ts` -> add to appropriate section (`WEAPONS`, `SHIELDS`, `ARMOR`, `ACCESSORIES`, `CONSUMABLES`)
2. Define stat bonuses in item definition
3. Optionally add to starting equipment in `game/equipment.ts`

### New Area/Map
1. Create `.txt` map file in `game/areas/maps/`
2. Register area in `game/areas/index.ts`
3. Define transitions, decorations, secret doors, chests in area config
4. Reference `game/areas/textLoader.ts` for map tile format, `game/areas/types.ts` for area types

## Key Patterns

- **`getGameTime()`** — visual animations that freeze when paused. Import from `core/gameClock`. Game-logic timestamps (cooldowns, status effects) still use `Date.now()`. Updated per frame in `useGameLoop`, paused/resumed in `togglePause()`.
- **`defeatedThisFrame: Set<number>`** — prevents overkill from multiple damage sources per frame. `applyDamageToUnit` checks this internally.
- **`setUnits(prev => prev.map(...))`** — always functional updates
- **`unitsStateRef.current`** — read-only ref for fresh HP reads mid-frame
- **`SkillExecutionContext`** / **`DamageContext`** — context bags for skill execution / damage pipeline
- **Enemy behaviors**: `try*(ctx): boolean`
- **Cooldown key**: `` `${unitId}-${skillName}` `` via `setSkillCooldown()`
- **Range checks**: always `isInRange()` from `rendering/range.ts` (hitbox-aware)
- **`updateUnit()`/`updateUnitWith()`** — functional React state helpers in `core/stateUtils.ts`. Prefer over raw `setUnits(prev => prev.map(...))` for single-unit updates.
- **Module-level state** — `game/equipmentState.ts`, `game/enemyState.ts`, `ai/movement.ts` store state outside React. Each has `initialize*()` / `reset*()` called from `useThreeScene` on area transitions.
- **Unit ID generation** — `getNextUnitId()` from `core/unitIds.ts`. Use for all spawned units (broodlings, tentacles, split amoebas).
- **HP/MP clamping** — healing/mana restoration must clamp against effective caps from the current `Unit` snapshot (`getEffectiveMaxHp/getEffectiveMaxMana` with `unit` arg).
- **Basic attack payloads** — execution should rely on combat-time stat bonus application; do not double-apply stat bonuses in precomputed `Skill.damageRange`.
- **Arc/Cone rotation**: For flat ground-plane arcs using `RingGeometry` + `rotation.x = -PI/2`, use `rotation.z = -facingAngle` where `facingAngle = atan2(dz, dx)`. Euler XYZ means Rz applies before Rx, so negation maps correctly to XZ plane. The shield mesh is a special case (`rotation.z = facing - PI/2`) due to its thetaStart.
- **Verification scripts** — this repo currently exposes `npm run lint` and `npm run build` (no dedicated `test` script in `package.json`).

