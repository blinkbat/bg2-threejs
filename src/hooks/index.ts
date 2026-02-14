/**
 * Custom React hooks for the game
 *
 * These hooks extract logic from App.tsx for better organization:
 *
 * - useThreeScene: Initializes Three.js scene, camera, renderer, and all visual objects
 * - useGameLoop: Runs the requestAnimationFrame loop for game updates and rendering
 * - useInputHandlers: Handles all mouse, keyboard, and wheel input events
 *
 * Usage:
 * 1. Call useThreeScene to initialize the scene (returns sceneState, gameRefs, isInitialized)
 * 2. Call useInputHandlers with sceneRefs when scene is initialized
 * 3. Call useGameLoop with sceneState and gameRefs when scene is initialized
 *
 * The hooks handle their own cleanup via useEffect return functions.
 */

export {
    useThreeScene,
    type ThreeSceneState,
    type GameRefs,
    type UseThreeSceneOptions,
    type UseThreeSceneResult
} from "./useThreeScene";

export {
    useGameLoop,
    type InitializedSceneState,
    type GameLoopStateRefs,
    type GameLoopCallbacks,
    type UseGameLoopOptions,
    type PerfFrameSample
} from "./useGameLoop";

export {
    useInputHandlers,
    type InputSceneRefs,
    type InputGameRefs,
    type InputStateRefs,
    type InputMutableRefs,
    type InputSetters,
    type InputCallbacks,
    type UseInputHandlersOptions
} from "./useInputHandlers";
export { useDisplayTime } from "./useDisplayTime";
