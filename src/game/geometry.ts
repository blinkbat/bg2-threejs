// =============================================================================
// GEOMETRY UTILITIES - Common spatial calculations
// =============================================================================

import { getCurrentArea } from "./areas";

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
    const area = getCurrentArea();
    return x >= 0 && x < area.gridWidth && z >= 0 && z < area.gridHeight;
}

/**
 * Clamp a value to grid bounds (with padding for unit centers).
 */
export function clampToGrid(value: number, padding: number = 0.5, axis: "x" | "z" = "x"): number {
    const area = getCurrentArea();
    const max = axis === "x" ? area.gridWidth : area.gridHeight;
    return Math.max(padding, Math.min(max - padding, value));
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

/**
 * Normalize an angle to the range [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

/**
 * Check if a point (px, pz) is within a cone emanating from (originX, originZ).
 * @param facingAngle - direction the cone is pointing (radians, atan2 convention)
 * @param halfAngle - half-width of the cone in radians
 * @param maxDistance - maximum reach of the cone
 * @param minDistance - minimum distance (to exclude the origin itself), default 0.1
 */
export function isPointInCone(
    px: number, pz: number,
    originX: number, originZ: number,
    facingAngle: number, halfAngle: number, maxDistance: number,
    minDistance: number = 0.1
): boolean {
    const dx = px - originX;
    const dz = pz - originZ;
    const dist = Math.hypot(dx, dz);

    if (dist > maxDistance || dist < minDistance) return false;

    const angleToPoint = Math.atan2(dz, dx);
    const angleDiff = normalizeAngle(angleToPoint - facingAngle);

    return Math.abs(angleDiff) <= halfAngle;
}

/**
 * Check if a point (px, pz) is within a rectangle extending from (originX, originZ).
 * The rectangle starts at the origin and extends in the direction of facingAngle.
 * @param facingAngle - direction the rectangle extends (radians, atan2 convention)
 * @param length - how far the rectangle extends from the origin
 * @param halfWidth - half the width of the rectangle (perpendicular to facing)
 */
export function isPointInRectangle(
    px: number, pz: number,
    originX: number, originZ: number,
    facingAngle: number, length: number, halfWidth: number
): boolean {
    // Translate point relative to origin
    const dx = px - originX;
    const dz = pz - originZ;

    // Project onto rectangle's local axes (forward = facing, right = perpendicular)
    const cosA = Math.cos(facingAngle);
    const sinA = Math.sin(facingAngle);
    const forward = dx * cosA + dz * sinA;
    const lateral = -dx * sinA + dz * cosA;

    return forward >= 0 && forward <= length && Math.abs(lateral) <= halfWidth;
}
