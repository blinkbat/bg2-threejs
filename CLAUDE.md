# Project Agent Guide (Timeless)

This document is intentionally evergreen. It captures stable architecture, invariants, and workflows that should remain true even as implementations move.

## Goals

- Keep changes safe, correct, and maintainable.
- Favor reuse over reinvention.
- Preserve gameplay and rendering contracts unless explicitly asked to change them.

## Environment Defaults

- Platform: Windows.
- In bash-style commands, use repo-relative paths (never absolute `c:\...` paths).
- Use `"` quotes and 4-space indentation in TypeScript/TSX.
- Prefer `rg` for search and file discovery.

## Working Rules

- Search for existing patterns before adding new code.
- Inspect usages before changing types, signatures, or data contracts.
- Prefer explicit complete types.
- Avoid `any`, type assertions, and non-null assertions unless strictly necessary.
- Do not add placeholder/TODO code or speculative utilities.
- Ask before substantial refactors.
- Ask clarifying questions only when ambiguity blocks a safe implementation.

## Hard Guardrails

- Unit visuals:
  - Do not add custom per-unit mesh branches in `src/rendering/scene/units.ts` unless explicitly requested.
  - For new enemies, use existing sprite config paths or the shared default unit geometry path.
- Enemy registries:
  - Keep `EnemyType` and `ENEMY_STATS` strictly alphabetical.
- Enemy stats schema:
  - If adding fields to `EnemyStats`, wire them into runtime behavior in the same change (or document why not).
- Resource caps:
  - HP/MP clamping and restoration must use live-unit effective caps:
  - `getEffectiveMaxHp(unit.id, unit)` and `getEffectiveMaxMana(unit.id, unit)`.
- Basic attacks:
  - Do not pre-bake stat bonuses into basic attack payload damage ranges.
  - Stat bonuses are applied in combat/projectile runtime logic.
- Rendering changes:
  - For changes touching units/trees/water/lights, run `npm run build` and include a short verification note.
- Visual style:
  - Do not add flashy basic-attack visuals unless explicitly requested.

## Stable Entry Points

- App shell and orchestration:
  - `src/App.tsx`
  - `src/app/helpers.ts`
- Scene creation and updates:
  - `src/rendering/scene/index.ts`
  - `src/rendering/scene/updates.ts`
  - `src/rendering/scene/floorUtils.ts`
  - `src/rendering/scene/lightUtils.ts`
  - `src/rendering/scene/units.ts`
- Main loop and input:
  - `src/hooks/useGameLoop.ts`
  - `src/hooks/useThreeScene.ts`
  - `src/hooks/useInputHandlers.ts`
  - `src/input/index.ts`
- Combat and damage pipeline:
  - `src/combat/skills/index.ts`
  - `src/combat/combatMath.ts`
  - `src/combat/damageEffects.ts`
- Data and stats:
  - `src/game/playerUnits.ts`
  - `src/game/enemyStats.ts`
  - `src/game/units.ts`
  - `src/game/statBonuses.ts`
- Map editor:
  - `src/editor/MapEditor.tsx`
  - `src/editor/areaConversion.ts`
  - `src/editor/editorViewUtils.ts`
  - `src/editor/constants.ts`

## Core Architectural Patterns

- React owns canonical game state (`Unit[]`).
- Three.js `UnitGroup` objects hold live visual transforms.
- Game loop mutates scene objects each frame and batches React updates.
- Functional updates are the default for React state writes.
- Module-level runtime stores exist (for example equipment/enemy/movement/fog memory) and must be reset/initialized on area transitions.

## Important Invariants

- Use `isInRange()` from `src/rendering/range.ts` for range checks.
- Use `getGameTime()` for pause-aware visual animation timing.
- Use `Date.now()` for game-logic timestamps (cooldowns, status effects) unless a subsystem requires otherwise.
- Use `updateUnit()` / `updateUnitWith()` helpers from `src/core/stateUtils.ts` for targeted unit updates.
- Use `getNextUnitId()` from `src/core/unitIds.ts` for spawned units.
- Enemy behavior functions follow `try*(ctx): boolean` pattern.
- Skill cooldown keys follow `${unitId}-${skillName}`.

## Rendering Notes

- Keep floor/tint/variation logic in `src/rendering/scene/floorUtils.ts`.
- Keep light normalization and clustering logic in `src/rendering/scene/lightUtils.ts`.
- Keep scene assembly and object ownership in `src/rendering/scene/index.ts`.
- Keep frame-to-frame scene mutations in `src/rendering/scene/updates.ts`.
- Flat ground-plane arc/circle meshes (`RingGeometry` with `rotation.x = -PI/2`): use `rotation.z = -facingAngle` where `facingAngle = atan2(dz, dx)`.

## Editor Notes

- `src/editor/MapEditor.tsx` should remain focused on UI interactions and state orchestration.
- Area/grid conversions and sanitization belong in `src/editor/areaConversion.ts`.
- Canvas drawing colors/storage helpers belong in `src/editor/editorViewUtils.ts`.
- Editor enemy types are derived from `Object.keys(ENEMY_STATS)` in `src/editor/constants.ts`; alphabetical ordering matters.

## Extension Playbooks

### Add a New Enemy

1. Add new `EnemyType` in `src/core/types/units.ts` (alphabetical).
2. Add `ENEMY_STATS` entry in `src/game/enemyStats.ts` (alphabetical).
3. Reuse existing sprite/default geometry path in `src/rendering/scene/units.ts`.
4. Place in map/editor and validate behavior in-game.

### Add a New Enemy Behavior

1. Add optional behavior config on `EnemyStats` type.
2. Add behavior interfaces in `src/core/types/units.ts` and behavior context types.
3. Implement `tryMyBehavior(ctx): boolean` in `src/gameLoop/enemyBehaviors/`.
4. Export via `src/gameLoop/enemyBehaviors/index.ts`.
5. Wire execution from `src/gameLoop/index.ts`.
6. If it has per-frame processing/telegraphs, wire process and clear lifecycle in loop/scene hooks.

### Add a New Player Skill

1. Define skill in `src/game/skills.ts` and add to class/unit lists.
2. Implement execution in appropriate combat skill module (`damage`, `support`, `utility`, `movement`).
3. Route in `src/combat/skills/index.ts` by `skill.type` and target semantics.
4. Reuse damage/status helper pipeline functions.

### Add a New Status Effect

1. Add type in `src/core/types/units.ts`.
2. Add constants/colors/durations in `src/core/constants.ts`.
3. Process effect in `src/gameLoop/statusEffects.ts`.
4. Add visuals in `src/gameLoop/visuals.ts`.

### Add a New Projectile Type

1. Extend projectile type(s) in `src/core/types/combat.ts`.
2. Add creation logic in damage/skill executor path.
3. Handle runtime update/impact in `src/gameLoop/projectiles.ts`.

### Add a New Area/Map

1. Add map text file under `src/game/areas/maps/`.
2. Register area in `src/game/areas/index.ts`.
3. Define transitions/decorations/chests/secret doors in area data.
4. Validate blocked/terrain semantics through area helpers.

## Verification Defaults

- Fast checks:
  - `npm run lint`
  - `npm run build`
- Full local gate:
  - `npm run test`
- For rendering-affecting changes, always include a concise visual verification note.

## Change Checklist

Before finalizing:

1. Contracts preserved (types, call sites, serialized data).
2. Invariants preserved (ordering, caps, IDs, range checks, behavior patterns).
3. Module ownership respected (scene vs updates vs helpers, editor UI vs conversion helpers).
4. Verification commands completed and results noted.

## Anti-Patterns to Avoid

- Re-implementing existing helpers instead of importing them.
- Silent behavior changes while doing structural refactors.
- Introducing per-enemy visual special cases in core unit rendering.
- Clamping HP/MP to static base values instead of effective runtime caps.
- Adding one-off fixes that bypass shared pipelines.

## Maintenance Rule for This Document

- Prefer stable concepts over volatile specifics.
- Update this guide when architectural ownership or invariants change.
- Avoid adding temporary migration notes, dates, or recency language.


