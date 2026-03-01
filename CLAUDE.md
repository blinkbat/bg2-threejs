# Project Agent Guide

## Environment & Style

- Windows, bash syntax, repo-relative paths (never absolute `c:\...` paths).
- `"` quotes, 4-space indent, explicit types, no `any`/assertions unless necessary.
- Edit hex colors directly; no runtime brighten/darken unless requested.
- No placeholder/TODO code, no speculative utilities.
- Search for existing patterns before adding new code.
- Inspect usages before changing types, signatures, or data contracts.
- Ask before substantial refactors; ask only when ambiguity blocks a safe implementation.

## Hard Guardrails

- **Enemy registries:** `EnemyType` union + `ENEMY_STATS` keys strictly alphabetical.
- **HP/MP clamping:** `getEffectiveMaxHp(unit.id, unit)` / `getEffectiveMaxMana(unit.id, unit)` from `src/game/statBonuses.ts`.
- **Equipment changes:** transactional via `equipItemForCharacter` / `unequipItemForCharacter` / `moveEquippedItemForCharacter` from `src/game/equipmentState.ts`, then clamp HP/MP.
- **Combat stats:** read from `src/game/equipmentState.ts` centralized helpers, never raw slot reads.
- **Basic attacks:** no pre-baked stat bonuses in payload; applied at combat/projectile runtime.
- **Unit rendering:** no per-enemy mesh branches in `src/rendering/scene/units.ts`.
- **Rendering changes:** `npm run build` + visual verification note.
- **Visual style:** no flashy visuals unless explicitly requested.

## Architecture

### Data Flow

```
React state (Unit[]) ──setUnits──> App.tsx
       │                              │
  unitsStateRef                  useGameLoop reads ref
       ▼                              ▼
Three.js UnitGroups  ◄── game loop mutates positions each frame
       │                     batches React state writes via setUnits
       ▼
Renderer (updates.ts) reads UnitGroups for fog/transparency/animations
```

- React owns canonical game state (`Unit[]` via `setUnits`).
- Three.js `UnitGroup` objects hold live visual transforms.
- Game loop mutates scene objects each frame, batches React state writes.
- Functional updates are the default for React state writes.
- Module-level runtime stores (equipment, enemy state, fog memory, movement) reset on area transitions.

## Module Map

### `src/core/` — Shared types, constants, utilities

- `types/units.ts` — `Unit`, `EnemyType`, `EnemyStats`, `CharacterStats`, `StatusEffect`
- `types/combat.ts` — `Skill`, `Projectile` variants, `DamageType`, `CombatLogEntry`
- `types/items.ts` — `Item` variants, `EquipmentSlot`, `CharacterEquipment`, `PartyInventory`
- `types/world.ts` — `UnitGroup`, `SelectionBox`, `FogTexture`, `AcidTile`
- `constants.ts` — All numeric constants, colors, timing values
- `stateUtils.ts` — `updateUnit()`, `updateUnitWith()`, `updateUnitsWhere()`, `applySyncedUnitsUpdate()`
- `unitIds.ts` — `getNextUnitId()` for spawned units
- `gameClock.ts` — `getGameTime()` (pause-aware), `pauseGameClock()`, `resumeGameClock()`
- `effectScheduler.ts` — `scheduleEffectAnimation()` for queued visual effects

### `src/game/` — Game data, stats, items, areas

- `units.ts` — `getUnitStats(unit)` universal stat lookup, `getAttackRange()`
- `enemyStats.ts` — `ENEMY_STATS` registry (alphabetical keys = editor dropdown order)
- `playerUnits.ts` — `UNIT_DATA` player unit definitions
- `skills.ts` — `SKILLS` object with all player skill definitions
- `equipment.ts` — Item slot logic
- `equipmentState.ts` — **Single source of truth** for equipment-derived stats/effects; transaction APIs
- `statBonuses.ts` — Stat-derived bonuses, `getEffectiveMaxHp()`, `getEffectiveMaxMana()`
- `items.ts` — `ITEMS` master registry, `getItem()`, `getItemOrThrow()`
- `unitQuery.ts` — `getUnitById()`, `findNearestUnit()`, `getAliveUnits()` (cached)
- `geometry.ts` — `distance()`, `isWithinGrid()`, `worldToCell()`, `normalizeAngle()`
- `enemyState.ts` — Per-enemy runtime state (kite cooldowns, brood mother screeches)
- `fogMemory.ts` — Persist/load fog visibility between area transitions
- `formation.ts` — `getFormationPositions()` for party spread
- `enemyLoot.ts` — `rollEnemyLoot()` drop tables
- `areas/index.ts` — `AREAS`, `getCurrentArea()`, `getBlocked()`, `isTreeBlocked()`
- `areas/maps/` — Text-format area map files
- `saveLoad/` — Save/load serialization, storage, sanitization

### `src/combat/` — Damage pipeline, skills, math

- `damageEffects.ts` — `applyDamageToUnit()` **single damage pipeline** (shields, split, death, XP)
- `combatMath.ts` — `rollHit()`, `rollDamage()`, `rollCrit()`, `isBlockedByFrontShield()`
- `skills/index.ts` — `executeSkill()` router + all `execute*Skill()` implementations
- `skills/damage.ts` | `support.ts` | `utility.ts` | `movement.ts` — Skill category modules
- `skills/helpers.ts` — Shared skill execution helpers
- `barks.ts` — Combat bark/dialogue triggers

### `src/gameLoop/` — Per-frame game logic

- `index.ts` — `updateUnitAI()`, re-exports all subsystems
- `statusEffects.ts` — `processStatusEffects()` (tick poison, regen, auras)
- `visuals.ts` — `updateFogOfWar()`, `updateDamageTexts()`, `updateHitFlash()`, shield bubbles
- `projectiles.ts` — `updateProjectiles()` flight, impact, AoE
- `swingAnimations.ts` — Melee swing visual sequences
- `enemyBehaviors/` — One file per behavior; `try*(ctx): boolean` pattern
- `enemyBehaviors/index.ts` — Barrel export for all behaviors + guards (`isEnemyUntargetable`, etc.)
- `acidTiles.ts` | `holyTiles.ts` | `sanctuaryTiles.ts` — Ground effect tile processing
- `fireBreath.ts` | `necromancerCurse.ts` | `constructCharge.ts` — Boss mechanic processing
- `lootBags.ts` — Loot bag drop/pickup logic
- `tileUtils.ts` — Shared tile mesh creation/fade helpers

### `src/ai/` — Pathfinding, movement, targeting

- `pathfinding.ts` — A* `findPath()`, `updateVisibility()`, `hasLineOfSight()`, `isBlocked()`
- `movement.ts` — `createPathToTarget()`, stuck detection, path recalculation
- `targeting.ts` — `tryKite()` ranged kiting logic
- `unitAI.ts` — `runTargetingPhase()`, `runMovementPhase()`, `runPathFollowingPhase()`, avoidance

### `src/rendering/` — Three.js scene management

- `scene/index.ts` — `createScene()` builds all meshes (floor, walls, trees, decorations, lights)
- `scene/updates.ts` — Per-frame mutations: `updateWallTransparency()`, `updateTreeFogVisibility()`, `updateCamera()`
- `scene/units.ts` — `addUnitToScene()`, unit mesh/sprite creation
- `scene/floorUtils.ts` — Floor tint/variation logic
- `scene/lightUtils.ts` — Light normalization, clustering
- `scene/sceneSetupHelpers.ts` — Render order constants, shadow defaults
- `scene/types.ts` — `SceneRefs`, `DoorMesh`, `ChestMeshData`
- `range.ts` — `isInRange()` **required for all range checks** (hitbox-aware), `getUnitRadius()`
- `disposal.ts` — `createBasicMesh()`, `createTexturedMesh()`, disposal scheduling

### `src/hooks/` — React hooks connecting systems

- `useThreeScene.ts` — Three.js renderer/scene lifecycle
- `useGameLoop.ts` — Main loop orchestration (calls all gameLoop/* subsystems)
- `useInputHandlers.ts` — Mouse/keyboard event wiring
- `hpBarOverlayStore.ts` — HP bar overlay publish/subscribe store
- `index.ts` — Re-exports all hooks with public types

### `src/input/` — Input processing

- `index.ts` — Click handling, box selection, camera movement, keyboard dispatch

### `src/components/` — React UI components

- `HUD.tsx`, `CommandBar.tsx`, `CombatLog.tsx`, `PartyBar.tsx`, `SkillHotbar.tsx`
- `UnitPanel.tsx`, `EquipmentModal.tsx`, `SaveLoadModal.tsx`, `DialogModal.tsx`
- `FormationIndicator.tsx`, `HpBarsOverlay.tsx`, `HelpModal.tsx`, `MenuModal.tsx`, `JukeboxModal.tsx`
- `portraitRegistry.ts` — `getPortrait()` unit portrait lookups

### `src/dialog/` — Dialog/conversation system

- `types.ts` — `DialogNode`, `DialogDefinition`, `DialogState`
- `registry.ts` — `getDialogDefinitionById()`, definition lookups
- `triggerRuntime.ts` — Dialog trigger condition evaluation
- `speakers.ts` — Speaker identity data
- `data/` — Dialog content data files

### `src/audio/` — Sound effects

- `index.ts` — `soundFns` master registry, `isMuted()`/`toggleMute()`
- `combat.ts` | `spells.ts` | `creatures.ts` | `ui.ts` — Category-specific sound generators

### `src/editor/` — Map editor

- `MapEditor.tsx` — Editor UI + state orchestration
- `areaConversion.ts` — Area/grid conversion and sanitization
- `editorViewUtils.ts` — Canvas drawing, color/storage helpers
- `constants.ts` — Editor constants; enemy types from `Object.keys(ENEMY_STATS)` (order matters)
- `components/` | `panels/` | `popups/` — Editor sub-components

### `src/app/` — App bootstrap

- `helpers.ts` — `ZERO_STATS`, `reviveUnitVisual()`, formation direction helpers
- `gameSetup.ts` — `createUnitsForArea()`, persisted player state

## Key API Quick-Reference

| Need | Use | Location |
|------|-----|----------|
| Range check | `isInRange(a, b, range)` | `rendering/range.ts` |
| Unit stats | `getUnitStats(unit)` | `game/units.ts` |
| Apply damage | `applyDamageToUnit(...)` | `combat/damageEffects.ts` |
| Update one unit | `updateUnit(setUnits, id, partial)` | `core/stateUtils.ts` |
| Update unit (computed) | `updateUnitWith(setUnits, id, fn)` | `core/stateUtils.ts` |
| Pause-aware time | `getGameTime()` | `core/gameClock.ts` |
| Logic timestamps | `Date.now()` | built-in |
| Next unit ID | `getNextUnitId()` | `core/unitIds.ts` |
| HP/MP caps | `getEffectiveMaxHp(id, unit)` | `game/statBonuses.ts` |
| Equipment transaction | `equipItemForCharacter(...)` | `game/equipmentState.ts` |
| Current area | `getCurrentArea()` | `game/areas/index.ts` |
| Find path | `findPath(...)` | `ai/pathfinding.ts` |
| Distance | `distance(x1,z1,x2,z2)` | `game/geometry.ts` |
| Execute skill | `executeSkill(...)` | `combat/skills/index.ts` |
| Item lookup | `getItem(id)` | `game/items.ts` |
| Unit by ID (cached) | `getUnitById(id)` | `game/unitQuery.ts` |

## Invariants

- `isInRange()` for **all** range checks (hitbox-aware).
- `getGameTime()` for animations; `Date.now()` for cooldowns/status timestamps.
- `updateUnit()`/`updateUnitWith()` for targeted unit state writes.
- Enemy behaviors: `try*(ctx): boolean`; cooldown keys: `${unitId}-${skillName}`.
- Flat ground-plane arcs (`RingGeometry` + `rotation.x = -PI/2`): `rotation.z = -facingAngle` where `facingAngle = atan2(dz, dx)`.

## Extension Playbooks

### Add a New Enemy

1. `EnemyType` in `src/core/types/units.ts` (alphabetical).
2. `ENEMY_STATS` in `src/game/enemyStats.ts` (alphabetical).
3. Reuse existing sprite/geometry in `src/rendering/scene/units.ts`.
4. Place in map/editor; validate in-game.

### Add a New Enemy Behavior

1. Add optional config on `EnemyStats` type.
2. Add interfaces in `src/core/types/units.ts`.
3. Implement `tryMyBehavior(ctx): boolean` in `src/gameLoop/enemyBehaviors/`.
4. Export via `src/gameLoop/enemyBehaviors/index.ts`.
5. Wire from `src/gameLoop/index.ts`.
6. Wire per-frame processing/telegraphs in loop/scene hooks if needed.

### Add a New Player Skill

1. Define in `src/game/skills.ts`, add to class/unit lists.
2. Implement in `combat/skills/` module (damage/support/utility/movement).
3. Route in `src/combat/skills/index.ts`.
4. Reuse damage/status pipeline helpers.

### Add a New Status Effect

1. Type in `src/core/types/units.ts`.
2. Constants/colors in `src/core/constants.ts`.
3. Process in `src/gameLoop/statusEffects.ts`.
4. Visuals in `src/gameLoop/visuals.ts`.

### Add a New Projectile Type

1. Extend types in `src/core/types/combat.ts`.
2. Create in damage/skill executor path.
3. Update/impact in `src/gameLoop/projectiles.ts`.

### Add a New Area/Map

1. Map text file in `src/game/areas/maps/`.
2. Register in `src/game/areas/index.ts`.
3. Define transitions/decorations/chests/secret doors.
4. Validate blocked/terrain semantics.

## Verification

- Fast: `npm run lint` + `npm run build`
- Full: `npm run test`
- Rendering changes: build + visual verification note.

## Change Checklist

1. Contracts preserved (types, call sites, serialized data).
2. Invariants preserved (ordering, caps, IDs, range checks, behavior patterns).
3. Module ownership respected (scene vs updates, editor UI vs conversion).
4. Equipment effects flow through centralized helpers only.
5. Verification passed.

## Anti-Patterns

- Re-implementing existing helpers instead of importing.
- Silent behavior changes during structural refactors.
- Per-enemy visual cases in core unit rendering.
- Clamping to static base caps instead of effective runtime caps.
- Bypassing shared pipelines with one-off fixes.
