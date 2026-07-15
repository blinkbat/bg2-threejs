import * as THREE from "three";

// =============================================================================
// SHADER CHAIN - Compose multiple onBeforeCompile injections on one material
// =============================================================================

export type ShaderInjector = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

interface ShaderChainState {
    baseKey: string;
    keys: string[];
}

function getChainState(material: THREE.Material): ShaderChainState {
    const userData = material.userData as { shaderChain?: ShaderChainState };
    const existing = userData.shaderChain;
    if (existing) return existing;

    const state: ShaderChainState = {
        baseKey: material.onBeforeCompile ? material.onBeforeCompile.toString() : "",
        keys: [],
    };
    userData.shaderChain = state;
    // Program cache keys must reflect every injected stage; the default key only
    // reads onBeforeCompile.toString(), which collapses to the wrapper source once
    // we chain and would wrongly share programs between differently-injected materials.
    material.customProgramCacheKey = () => `${state.baseKey}|${state.keys.join("|")}`;
    return state;
}

/**
 * Append a shader injection stage to a material, preserving any existing
 * onBeforeCompile hook (e.g. rounded floor tiles) and keeping program cache
 * keys unique per combination of stages.
 */
export function chainMaterialShader(
    material: THREE.Material,
    cacheKey: string,
    injector: ShaderInjector
): void {
    const state = getChainState(material);
    if (state.keys.includes(cacheKey)) return;
    state.keys.push(cacheKey);

    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        if (previous) previous.call(material, shader, renderer);
        injector(shader);
    };
    material.needsUpdate = true;
}
