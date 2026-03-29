# Project Agent Guide

## Environment & Style

- Windows, bash syntax, repo-relative paths (never absolute `c:\...` paths).
- Use `"` quotes, 4-space indent, explicit types, and avoid `any` or assertions unless necessary.
- Edit hex colors directly; do not add runtime brighten/darken helpers unless requested.
- No placeholder or TODO code, and no speculative utilities.
- Search for existing patterns before adding new code.
- Inspect usages before changing types, signatures, or data contracts.
- Save compatibility is not required by default; it is okay to break existing saves unless the user explicitly asks to preserve them.
- Ask before substantial refactors; ask only when ambiguity blocks a safe implementation.

## Hard Guardrails

- **Enemy registries:** `EnemyType` union and `ENEMY_STATS` keys stay strictly alphabetical.
- **HP/MP clamping:** use `getEffectiveMaxHp(unit.id, unit)` / `getEffectiveMaxMana(unit.id, unit)` from `src/game/playerUnits.ts`.
- **Equipment changes:** go through `equipItemForCharacter`, `unequipItemForCharacter`, or `moveEquippedItemForCharacter` in `src/game/equipmentState.ts`, then clamp HP/MP.
- **Combat stats:** read from centralized helpers in `src/game/equipmentState.ts`, never raw slot reads.
- **Basic attacks:** do not pre-bake stat bonuses into payloads; apply them at combat or projectile runtime.
- **Unit rendering:** no per-enemy mesh branches in `src/rendering/scene/units.ts`.
- **Rendering changes:** run `npm run build` and include a visual verification note.
- **Visual style:** no flashy visuals unless explicitly requested.

## Architecture

### Data Flow

```text
React state (Unit[]) --setUnits--> src/app/Game.tsx
       |                                  |
  unitsStateRef                    useGameLoop reads ref
       v                                  v
Three.js UnitGroups <-- game loop mutates positions each frame
       |
       v
Renderer (scene/updates.ts) reads UnitGroups for fog/transparency/animations
```

- React owns canonical gameplay state (`Unit[]` via `setUnits`).
- Three.js `UnitGroup` objects hold live visual transforms.
- The game loop mutates scene objects each frame and batches React state writes.
- Functional updates are the default for React state writes.
- Module-level runtime stores (equipment, enemy state, fog memory, movement) reset on area transitions.
- `src/App.tsx` is a thin shell; gameplay orchestration lives in `src/app/Game.tsx`.

## Module Map

### `src/core/` - Shared types, constants, utilities

- `types/units.ts` - `Unit`, `EnemyType`, `EnemyStats`, `CharacterStats`, `StatusEffect`
- `types/combat.ts` - `Skill`, projectile variants, `DamageType`, `CombatLogEntry`
- `types/items.ts` - `Item` variants, `EquipmentSlot`, `CharacterEquipment`, `PartyInventory`
- `types/world.ts` - `UnitGroup`, `SelectionBox`, `FogTexture`, `AcidTile`
- `constants.ts` - numeric constants, colors, timing values
- `stateUtils.ts` - `updateUnit()`, `updateUnitWith()`, `updateUnitsWhere()`, `applySyncedUnitsUpdate()`
- `unitIds.ts` - `getNextUnitId()` for spawned units
- `gameClock.ts` - `getGameTime()`, `pauseGameClock()`, `resumeGameClock()`
- `effectScheduler.ts` - `scheduleEffectAnimation()` for queued visual effects

### `src/game/` - Game data, stats, items, areas

- `units.ts` - `getUnitStats(unit)` universal stat lookup, `getAttackRange()`
- `enemyStats.ts` - `ENEMY_STATS` registry (alphabetical keys = editor dropdown order)
- `playerUnits.ts` - `UNIT_DATA`, `getEffectiveMaxHp()`, `getEffectiveMaxMana()`
- `skills.ts` - `SKILLS` object with all player skill definitions
- `equipment.ts` - item slot logic
- `equipmentState.ts` - single source of truth for equipment-derived stats and effects; transaction APIs
- `statBonuses.ts` - stat-derived bonuses and level-up scaling values
- `progression.ts` - level-up constants
- `items.ts` - `ITEMS` master registry, `getItem()`
- `unitQuery.ts` - `getUnitById()`, `findNearestUnit()`, `getAliveUnits()` (cached)
- `geometry.ts` - `distance()`, `isWithinGrid()`, `normalizeAngle()`
- `enemyState.ts` - per-enemy runtime state
- `fogMemory.ts` - persist and load fog visibility between area transitions
- `formation.ts` - `getFormationPositions()` for party spread
- `enemyLoot.ts` - `rollEnemyLoot()` drop tables
- `areas/index.ts` - `AREAS`, `getCurrentArea()`, `getBlocked()`, `isTreeBlocked()`
- `areas/maps/` - text-format area map files
- `saveLoad/` - save/load serialization, storage, sanitization

### `src/combat/` - Damage pipeline, skills, math

- `damageEffects.ts` - `applyDamageToUnit()` single damage pipeline (shields, split, death, XP)
- `combatMath.ts` - damage math, hit checks, defense checks, status helpers
- `skills/index.ts` - `executeSkill()` router and exported skill executors
- `skills/damage.ts` - direct-hit and core offensive skill executors
- `skills/damageArea.ts` - AoE and projectile-heavy offensive skill executors
- `skills/support.ts` | `utility.ts` | `movement.ts` - remaining skill category modules
- `skills/helpers.ts` - shared skill execution helpers
- `barks.ts` - combat bark and dialogue triggers

### `src/gameLoop/` - Per-frame game logic

- `index.ts` - `updateUnitAI()`, re-exports loop subsystems
- `statusEffects.ts` - `processStatusEffects()`
- `visuals.ts` - fog, damage texts, hit flash, shield bubbles
- `projectiles.ts` - projectile flight, impact, AoE
- `swingAnimations.ts` - melee swing visuals
- `enemyBehaviors/` - one file per behavior; `try*(ctx): boolean` pattern
- `enemyBehaviors/index.ts` - barrel exports and shared guards
- `enemyAttack.ts` - `executeEnemyBasicAttack()`
- `enemySkills.ts` - enemy skill execution helpers
- `acidTiles.ts` | `holyTiles.ts` | `sanctuaryTiles.ts` | `fireTiles.ts` | `smokeTiles.ts` - ground effect tile processing
- `fireBreath.ts` | `necromancerCurse.ts` | `constructCharge.ts` - boss mechanic processing
- `lootBags.ts` - loot bag drop and pickup logic
- `tileUtils.ts` - shared tile mesh creation and fade helpers

### `src/ai/` - Pathfinding, movement, targeting

- `pathfinding.ts` - A* `findPath()`, `updateVisibility()`, `isBlocked()`, `clearPathCache()`
- `movement.ts` - `createPathToTarget()`, stuck detection, path recalculation
- `targeting.ts` - `tryKite()` ranged kiting logic
- `unitAI.ts` - targeting, movement, path following, avoidance
- `spatialCache.ts` - `buildUnitSpatialFrame()` for O(1) spatial lookups per frame

### `src/rendering/` - Three.js scene management

- `scene/index.ts` - `createScene()` orchestration for floor, walls, trees, decorations, lights, and scene refs
- `scene/decorations.ts` - decoration-heavy scene builders and grouped column meshes
- `scene/updates.ts` - per-frame mutations such as wall transparency, tree fog visibility, and camera updates
- `scene/units.ts` - `addUnitToScene()`, unit mesh and sprite creation
- `scene/floorUtils.ts` - floor tint and variation logic
- `scene/lightUtils.ts` - light normalization and clustering
- `scene/sceneSetupHelpers.ts` - render-order constants and shadow defaults
- `scene/types.ts` - `SceneRefs`, `DoorMesh`, `ChestMeshData`
- `range.ts` - `isInRange()` for all range checks (hitbox-aware), `getUnitRadius()`
- `disposal.ts` - `disposeBasicMesh()`, `disposeGeometry()`, disposal scheduling

### `src/hooks/` - React hooks connecting systems

- `useThreeScene.ts` - Three.js renderer and scene lifecycle
- `useGameLoop.ts` - main loop orchestration
- `useInputHandlers.ts` - mouse and keyboard event wiring
- `hotbarStorage.ts` | `formationStorage.ts` | `localStorage.ts` - persistence helpers
- `useDisplayTime.ts` - display time utilities
- `index.ts` - hook re-exports and public types

### `src/input/` - Input processing

- `index.ts` - click handling, box selection, camera movement, keyboard dispatch

### `src/components/` - React UI components

- `HUD.tsx`, `CommandBar.tsx`, `CombatLog.tsx`, `PartyBar.tsx`, `SkillHotbar.tsx`
- `UnitPanel.tsx`, `EquipmentModal.tsx`, `SaveLoadModal.tsx`, `DialogModal.tsx`
- `FormationIndicator.tsx`, `HelpModal.tsx`, `MenuModal.tsx`, `JukeboxModal.tsx`
- `LootPickupModal.tsx`, `ControlsModal.tsx`, `GlossaryModal.tsx`, `WaystoneTravelModal.tsx`
- `ModalShell.tsx`, `UIColorAdjuster.tsx`
- `portraitRegistry.ts` - `getPortrait()` unit portrait lookups

### `src/dialog/` - Dialog and conversation system

- `types.ts` - `DialogNode`, `DialogDefinition`, `DialogState`
- `registry.ts` - `getDialogDefinitionById()`, definition lookups
- `triggerRuntime.ts` - dialog trigger condition evaluation
- `speakers.ts` - speaker identity data
- `areaDialogs.ts` - area-specific dialog definitions
- `data/` - dialog content data files

### `src/audio/` - Sound effects

- `index.ts` - `soundFns` registry, `isMuted()`, `toggleMute()`
- `core.ts` - shared audio context and utilities
- `combat.ts` | `spells.ts` | `creatures.ts` | `ui.ts` - category-specific sound generators
- `noise.ts` - noise and ambient sound generation

### `src/editor/` - Map editor

- `MapEditor.tsx` - editor state orchestration, canvas interaction, history, and persistence wiring
- `MapEditorView.tsx` - editor render tree, panels, and modal composition
- `mapEditorAreaBuilder.ts` - editor state to `AreaData` serialization
- `mapEditorAreaState.ts` - `AreaData` to editor state transforms and new-area bootstrap
- `mapEditorShared.ts` - editor snapshots, area ID normalization, shared helper logic
- `areaConversion.ts` - area/grid conversion and sanitization
- `editorViewUtils.ts` - canvas drawing, color, and storage helpers
- `constants.ts` - editor constants; enemy types come from `Object.keys(ENEMY_STATS)` and order matters
- `components/` | `panels/` | `popups/` - editor sub-components

### `src/app/` - App and gameplay shell

- `../App.tsx` - top-level route shell and mode switching
- `Game.tsx` - main game container and state orchestration
- `GameRenderLayer.tsx` - large gameplay UI render layer
- `gameShared.ts` - shared game props, save-state types, dialog timing constants, lighting defaults
- `useGameDebugControls.ts` - debug and playtest actions
- `helpers.ts` - shared app helpers such as `ZERO_STATS`, portrait preload, and dialog helpers
- `gameSetup.ts` - `createUnitsForArea()`, persisted player state bootstrap

## Key API Quick Reference

| Need | Use | Location |
|------|-----|----------|
| Range check | `isInRange(ax, az, tx, tz, targetRadius, range)` | `rendering/range.ts` |
| Unit stats | `getUnitStats(unit)` | `game/units.ts` |
| Apply damage | `applyDamageToUnit(...)` | `combat/damageEffects.ts` |
| Update one unit | `updateUnit(setUnits, id, partial)` | `core/stateUtils.ts` |
| Update unit (computed) | `updateUnitWith(setUnits, id, fn)` | `core/stateUtils.ts` |
| Pause-aware time | `getGameTime()` | `core/gameClock.ts` |
| Logic timestamps | `Date.now()` | built-in |
| Next unit ID | `getNextUnitId()` | `core/unitIds.ts` |
| HP/MP caps | `getEffectiveMaxHp(id, unit)` | `game/playerUnits.ts` |
| Equipment transaction | `equipItemForCharacter(...)` | `game/equipmentState.ts` |
| Current area | `getCurrentArea()` | `game/areas/index.ts` |
| Find path | `findPath(...)` | `ai/pathfinding.ts` |
| Distance | `distance(x1, z1, x2, z2)` | `game/geometry.ts` |
| Execute skill | `executeSkill(...)` | `combat/skills/index.ts` |
| Item lookup | `getItem(id)` | `game/items.ts` |
| Unit by ID (cached) | `getUnitById(id)` | `game/unitQuery.ts` |

## Invariants

- Use `isInRange()` for all range checks.
- Use `getGameTime()` for animations and `Date.now()` for cooldown and status timestamps.
- Use `updateUnit()` or `updateUnitWith()` for skill-level state writes; use `applySyncedUnitsUpdate()` for game loop logic that needs ref sync.
- Enemy behaviors follow `try*(ctx): boolean`, and cooldown keys use `${unitId}-${skillName}`.
- Flat ground-plane arcs (`RingGeometry` + `rotation.x = -PI / 2`) use `rotation.z = -facingAngle`, where `facingAngle = atan2(dz, dx)`.
- Keep ref mutation out of render paths; mutate refs in handlers, effects, or other non-render code.

## Extension Playbooks

### Add a New Enemy

1. Add the `EnemyType` entry in `src/core/types/units.ts` in alphabetical order.
2. Add the `ENEMY_STATS` entry in `src/game/enemyStats.ts` in alphabetical order.
3. Reuse existing sprite or geometry patterns in `src/rendering/scene/units.ts`.
4. Place it in a map or editor flow and validate in game.

### Add a New Enemy Behavior

1. Add optional config to the `EnemyStats` type.
2. Add any needed interfaces in `src/core/types/units.ts`.
3. Implement `tryMyBehavior(ctx): boolean` in `src/gameLoop/enemyBehaviors/`.
4. Export it from `src/gameLoop/enemyBehaviors/index.ts`.
5. Wire it from `src/gameLoop/index.ts`.
6. Add per-frame processing or telegraphs in loop or scene hooks if needed.

### Add a New Player Skill

1. Define it in `src/game/skills.ts` and add it to the correct unit or class lists.
2. Implement it in the appropriate `src/combat/skills/` module.
3. Route it in `src/combat/skills/index.ts`.
4. Reuse shared damage and status helpers instead of creating a parallel pipeline.

### Add a New Status Effect

1. Add the type in `src/core/types/units.ts`.
2. Add constants and colors in `src/core/constants.ts`.
3. Process it in `src/gameLoop/statusEffects.ts`.
4. Add visuals in `src/gameLoop/visuals.ts` if needed.
5. Update save sanitization in `src/game/saveLoad/sanitize.ts`.

### Add a New Projectile Type

1. Extend projectile types in `src/core/types/combat.ts`.
2. Create it in the relevant damage or skill executor path.
3. Update flight and impact handling in `src/gameLoop/projectiles.ts`.

### Add a New Area or Map

1. Add the map text file in `src/game/areas/maps/`.
2. Register it in `src/game/areas/index.ts`.
3. Define transitions, decorations, chests, and secret doors.
4. Validate blocked tiles and terrain semantics.

## Verification

- Fast: `npm run lint` + `npm run build`
- Full: `npm run test` (`lint` + `build` + `test:unit`)
- Unit only: `npm run test:unit`
- Coverage: `npm run test:coverage`
- Rendering or editor changes: build plus a visual verification note

## Change Checklist

1. Contracts are preserved (types, call sites, serialized data).
2. Invariants are preserved (ordering, caps, IDs, range checks, behavior patterns).
3. Module ownership is respected (scene vs updates, editor state vs view vs serialization).
4. Equipment effects flow through centralized helpers only.
5. Verification passed.

## Anti-Patterns

- Re-implementing existing helpers instead of importing them.
- Silent behavior changes during structural refactors.
- Per-enemy visual cases in core unit rendering.
- Clamping to static base caps instead of effective runtime caps.
- Bypassing shared pipelines with one-off fixes.
- Writing refs during render.
