import * as THREE from "three";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface Unit {
    id: number;
    x: number;
    z: number;
    hp: number;
    team: "player" | "enemy";
    target: number | null;
    aiEnabled: boolean;
}

export interface UnitData {
    name: string;
    class: string;
    hp: number;
    maxHp: number;
    damage: [number, number];
    thac0: number;
    ac: number;
    color: string;
    skills: string[];
    items: string[];
}

export interface KoboldStats {
    name: string;
    hp: number;
    maxHp: number;
    damage: [number, number];
    thac0: number;
    ac: number;
    color: string;
    aggroRange: number;
}

export interface Room {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface CandlePosition {
    x: number;
    z: number;
    dx: number;
    dz: number;
}

export interface MergedObstacle {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface PathNode {
    x: number;
    z: number;
    g: number;
    h: number;
    parent: PathNode | null;
}

export interface CombatLogEntry {
    text: string;
    color?: string;
}

export interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface HpBar {
    bg: THREE.Mesh;
    fill: THREE.Mesh;
    maxHp: number;
}

export interface DamageText {
    mesh: THREE.Mesh;
    life: number;
}

export interface FogTexture {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
}

export interface UnitGroup extends THREE.Group {
    userData: {
        unitId: number;
        targetX: number;
        targetZ: number;
        attackTarget: number | null;
    };
}
