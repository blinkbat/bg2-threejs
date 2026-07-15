import * as THREE from "three";
import { chainMaterialShader } from "./shaderChain";

// =============================================================================
// SURFACE SHADERS - World-space procedural surface detail
//
// All patterns key off world coordinates, so they tile seamlessly across
// merged walls and batched floor tiles with zero textures and no UV work.
// Injected pre-lighting (diffuseColor stage) so lights and shadows still
// interact naturally with the detail.
// =============================================================================

const SURFACE_NOISE_GLSL = `
float fableHash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float fableValueNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    float a = fableHash( i );
    float b = fableHash( i + vec2( 1.0, 0.0 ) );
    float c = fableHash( i + vec2( 0.0, 1.0 ) );
    float d = fableHash( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}`;

const SURFACE_VERTEX_DECL = `
varying vec3 vFableWorldPos;
varying float vFableNormalY;`;

const SURFACE_VERTEX_MAIN = `
vec4 fableWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
fableWorldPosition = instanceMatrix * fableWorldPosition;
#endif
fableWorldPosition = modelMatrix * fableWorldPosition;
vFableWorldPos = fableWorldPosition.xyz;
vFableNormalY = normalize( mat3( modelMatrix ) * normal ).y;`;

const SURFACE_FRAGMENT_DECL = `
varying vec3 vFableWorldPos;
varying float vFableNormalY;
${SURFACE_NOISE_GLSL}`;

function formatGlslFloat(value: number): string {
    return value.toFixed(4);
}

/**
 * Subtle two-octave world-space value noise on the diffuse color.
 * Breaks up flat-colored ground without any texture repetition.
 */
export function applyGroundGrainShader(
    material: THREE.Material,
    scale: number,
    amplitude: number
): void {
    const scaleStr = formatGlslFloat(scale);
    const amplitudeStr = formatGlslFloat(amplitude);
    chainMaterialShader(material, `grain:${scaleStr}:${amplitudeStr}`, shader => {
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>${SURFACE_VERTEX_DECL}`)
            .replace("#include <project_vertex>", `#include <project_vertex>${SURFACE_VERTEX_MAIN}`);

        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>${SURFACE_FRAGMENT_DECL}`)
            .replace("#include <map_fragment>", `#include <map_fragment>
{
    float fableGrain = fableValueNoise( vFableWorldPos.xz * ${scaleStr} ) * 0.62
        + fableValueNoise( vFableWorldPos.xz * ${scaleStr} * 2.9 + 17.0 ) * 0.38;
    diffuseColor.rgb *= 1.0 + ( fableGrain - 0.5 ) * ${amplitudeStr};
}`);
    });
}

/**
 * World-space stone masonry for walls: staggered block courses with darkened
 * mortar joints on vertical faces, per-block value variation, surface noise,
 * and a grounding grime gradient near the floor. Works across merged wall
 * boxes of any size because the pattern lives in world coordinates.
 */
export function applyStoneWallShader(material: THREE.Material): void {
    chainMaterialShader(material, "stoneWall", shader => {
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>${SURFACE_VERTEX_DECL}`)
            .replace("#include <project_vertex>", `#include <project_vertex>${SURFACE_VERTEX_MAIN}`);

        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>${SURFACE_FRAGMENT_DECL}`)
            .replace("#include <map_fragment>", `#include <map_fragment>
{
    vec3 fableWp = vFableWorldPos;
    float fableSideFactor = 1.0 - clamp( abs( vFableNormalY ), 0.0, 1.0 );

    // Staggered block courses (world-space; joints follow x+z so both wall
    // orientations get believable vertical seams).
    float fableCourseH = 0.625;
    float fableBlockW = 1.12;
    float fableRow = floor( fableWp.y / fableCourseH );
    float fableRowShift = fableHash( vec2( fableRow, 7.0 ) ) * fableBlockW;
    float fableU = ( fableWp.x + fableWp.z + fableRowShift ) / fableBlockW;
    float fableV = fableWp.y / fableCourseH;
    float fableJointX = smoothstep( 0.0, 0.05, fract( fableU ) ) * smoothstep( 1.0, 0.95, fract( fableU ) );
    float fableJointY = smoothstep( 0.0, 0.07, fract( fableV ) ) * smoothstep( 1.0, 0.93, fract( fableV ) );
    float fableBlockMask = fableJointX * fableJointY;

    float fableBlockTint = fableHash( vec2( floor( fableU ), fableRow ) ) - 0.5;
    float fableStone = mix( 1.0, mix( 0.74, 1.0, fableBlockMask ) * ( 1.0 + fableBlockTint * 0.14 ), fableSideFactor );

    // Weathering noise everywhere (including wall tops).
    float fableWeather = fableValueNoise( fableWp.xz * 2.6 + fableWp.y * 1.7 ) * 0.6
        + fableValueNoise( fableWp.xz * 7.3 + fableWp.y * 4.1 ) * 0.4;
    fableStone *= 1.0 + ( fableWeather - 0.5 ) * 0.13;

    // Tops read as rougher capstone: slightly darker, more mottled.
    fableStone *= mix( 1.0, 0.92 + ( fableWeather - 0.5 ) * 0.1, clamp( vFableNormalY, 0.0, 1.0 ) );

    // Grime gradient grounding the wall into the floor.
    fableStone *= 1.0 - 0.24 * clamp( 1.0 - fableWp.y / 1.15, 0.0, 1.0 );

    diffuseColor.rgb *= fableStone;
}`);
    });
}

/**
 * World-space rock detail: cracks and mineral mottling for boulders.
 */
export function applyRockShader(material: THREE.Material): void {
    chainMaterialShader(material, "rock", shader => {
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>${SURFACE_VERTEX_DECL}`)
            .replace("#include <project_vertex>", `#include <project_vertex>${SURFACE_VERTEX_MAIN}`);

        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>${SURFACE_FRAGMENT_DECL}`)
            .replace("#include <map_fragment>", `#include <map_fragment>
{
    vec3 fableWp = vFableWorldPos;
    float fableMottle = fableValueNoise( fableWp.xz * 4.2 + fableWp.y * 3.4 ) * 0.55
        + fableValueNoise( fableWp.xz * 11.0 + fableWp.y * 8.0 ) * 0.45;
    float fableCrack = smoothstep( 0.46, 0.5, fableMottle ) * smoothstep( 0.54, 0.5, fableMottle );
    diffuseColor.rgb *= ( 1.0 + ( fableMottle - 0.5 ) * 0.2 ) * ( 1.0 - fableCrack * 0.22 );
}`);
    });
}
