// =============================================================================
// GEOMETRY UTILITIES - Common spatial calculations
// =============================================================================

import { GRID_SIZE } from "../core/constants";

/** Position with x and z coordinates (compatible with THREE.Vector3, UnitGroup.position) */
export interface Position2D {
    x: number;
    z: number;
}

/**
 * Calculate distance between two points.
 */
export function distance(x1: number, z1: number, x2: number, z2: number): number {
    return Math.hypot(x2 - x1, z2 - z1);
}

/**
 * Calculate distance between two position objects (e.g., UnitGroup.position).
 */
export function distanceBetween(pos1: Position2D, pos2: Position2D): number {
    return Math.hypot(pos2.x - pos1.x, pos2.z - pos1.z);
}

/**
 * Calculate distance from a position to a point.
 */
export function distanceToPoint(pos: Position2D, x: number, z: number): number {
    return Math.hypot(x - pos.x, z - pos.z);
}

/**
 * Check if distance between two points is less than a threshold.
 */
export function isWithinDistance(x1: number, z1: number, x2: number, z2: number, maxDist: number): boolean {
    return distance(x1, z1, x2, z2) < maxDist;
}

/**
 * Check if coordinates are within the grid bounds.
 */
export function isWithinGrid(x: number, z: number): boolean {
    return x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE;
}

/**
 * Clamp a value to grid bounds (with padding for unit centers).
 */
export function clampToGrid(value: number, padding: number = 0.5): number {
    return Math.max(padding, Math.min(GRID_SIZE - padding, value));
}

/**
 * Get cell coordinates from world position.
 */
export function worldToCell(x: number, z: number): { x: number; z: number } {
    return { x: Math.floor(x), z: Math.floor(z) };
}

/**
 * Get world center from cell coordinates.
 */
export function cellToWorld(cellX: number, cellZ: number): { x: number; z: number } {
    return { x: cellX + 0.5, z: cellZ + 0.5 };
}
