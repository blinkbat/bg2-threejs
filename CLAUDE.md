# Session Protocol

## Phase 1: Orientation (Always First)
1. Map the directory structure and file organization
2. Identify existing utilities, helpers, and shared logic
3. Locate relevant type definitions and interfaces

## Phase 2: Implementation Constraints

### Code Reuse (Highest Priority)
- Search for existing implementations before writing new code
- Import and reference existing functions—never rewrite them
- Prefer established libraries over custom implementations

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