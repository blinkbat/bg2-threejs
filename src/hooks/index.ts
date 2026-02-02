/**
 * Custom React hooks for the game
 *
 * These hooks extract logic from App.tsx for better organization:
 *
 * - useThreeScene: Initializes Three.js scene, camera, renderer, and all visual objects
 * - useGameLoop: Runs the requestAnimationFrame loop for game updates and rendering
 *
 * Note: These hooks are designed to work together but can be integrated incrementally.
 * The App.tsx currently uses a single large useEffect for tight coupling between
 * scene setup, input handlers, and game loop. To use these hooks:
 *
 * 1. Call useThreeScene to initialize the scene (returns sceneState and gameRefs)
 * 2. Set up input handlers in a useEffect gated on sceneState being ready
 * 3. Call useGameLoop with the sceneState and gameRefs
 *
 * The hooks handle their own cleanup via useEffect return functions.
 */

export { useThreeScene, type ThreeSceneState, type GameRefs, type UseThreeSceneOptions, type UseThreeSceneResult } from "./useThreeScene";
export { useGameLoop, type GameLoopSceneState, type GameLoopRefs, type GameLoopStateRefs, type GameLoopCallbacks, type UseGameLoopOptions } from "./useGameLoop";
