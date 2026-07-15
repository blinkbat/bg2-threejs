import * as THREE from "three";
import { chainMaterialShader } from "./shaderChain";

// =============================================================================
// FOG OF WAR SHADING - World-projected per-pixel darkening (BG2/Diablo style)
//
// Instead of a fog plane floating above the map, every environment material
// samples the shared visibility canvas by its fragment's world XZ position and
// multiplies the final color toward black. Unexplored terrain, walls, trees,
// and props all darken in place with no parallax, and tall objects are
// occluded per-pixel exactly where the fog boundary crosses them.
// =============================================================================

// One fog state for the whole scene; every injected material shares these
// uniform containers, so updating them here updates every environment shader.
const fowUniforms = {
    uFowMap: { value: null as THREE.Texture | null },
    uFowGridInv: { value: new THREE.Vector2(1, 1) },
    uFowEnabled: { value: 0 },
};

/** Point the shared fog uniforms at the current area's visibility texture. */
export function configureFogOfWar(
    texture: THREE.Texture,
    gridWidth: number,
    gridHeight: number,
    enabled: boolean
): void {
    fowUniforms.uFowMap.value = texture;
    fowUniforms.uFowGridInv.value.set(
        1 / Math.max(1, gridWidth),
        1 / Math.max(1, gridHeight)
    );
    fowUniforms.uFowEnabled.value = enabled ? 1 : 0;
}

/** Toggle fog darkening globally (areas without FoW, debug toggle). */
export function setFogOfWarEnabled(enabled: boolean): void {
    fowUniforms.uFowEnabled.value = enabled ? 1 : 0;
}

const FOW_VERTEX_DECL = `
varying vec2 vFowWorldXZ;`;

const FOW_VERTEX_MAIN = `
vec4 fowWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
fowWorldPosition = instanceMatrix * fowWorldPosition;
#endif
fowWorldPosition = modelMatrix * fowWorldPosition;
vFowWorldXZ = fowWorldPosition.xz;`;

const FOW_FRAGMENT_DECL = `
uniform sampler2D uFowMap;
uniform vec2 uFowGridInv;
uniform float uFowEnabled;
varying vec2 vFowWorldXZ;`;

// Applied after lighting/output, before tone mapping: multiplying the outgoing
// color is equivalent to BG2 compositing its fog over the rendered scene.
const FOW_FRAGMENT_MAIN = `
vec2 fowUv = vFowWorldXZ * uFowGridInv;
float fowInside = step( 0.0, fowUv.x ) * step( fowUv.x, 1.0 ) * step( 0.0, fowUv.y ) * step( fowUv.y, 1.0 );
float fowDarkness = texture2D( uFowMap, clamp( fowUv, 0.0, 1.0 ) ).a;
fowDarkness = mix( 1.0, fowDarkness, fowInside );
gl_FragColor.rgb *= 1.0 - fowDarkness * uFowEnabled;`;

/** Inject fog-of-war darkening into a single material. */
export function applyFogOfWarToMaterial(material: THREE.Material): void {
    chainMaterialShader(material, "fow", shader => {
        shader.uniforms.uFowMap = fowUniforms.uFowMap;
        shader.uniforms.uFowGridInv = fowUniforms.uFowGridInv;
        shader.uniforms.uFowEnabled = fowUniforms.uFowEnabled;

        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>${FOW_VERTEX_DECL}`)
            .replace("#include <project_vertex>", `#include <project_vertex>${FOW_VERTEX_MAIN}`);

        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>${FOW_FRAGMENT_DECL}`)
            .replace("#include <tonemapping_fragment>", `${FOW_FRAGMENT_MAIN}
#include <tonemapping_fragment>`);
    });
}

/**
 * Inject fog-of-war darkening into every renderable under `root`.
 * Call after the environment is built and before units/overlays are added.
 */
export function applyFogOfWarToObject(root: THREE.Object3D): void {
    root.traverse((object: THREE.Object3D) => {
        if (object.userData.noFogOfWar === true) return;
        if (
            !(object instanceof THREE.Mesh)
            && !(object instanceof THREE.Line)
            && !(object instanceof THREE.Points)
        ) {
            return;
        }

        const material = object.material;
        if (Array.isArray(material)) {
            for (const mat of material) applyFogOfWarToMaterial(mat);
        } else if (material) {
            applyFogOfWarToMaterial(material);
        }
    });
}
