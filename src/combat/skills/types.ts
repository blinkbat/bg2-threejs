// =============================================================================
// SKILL EXECUTION CONTEXT - Shared types for skill execution
// =============================================================================

import * as THREE from "three";
import type { Unit, UnitGroup, Projectile, SanctuaryTile, AcidTile, HolyTile, SmokeTile, SwingAnimation } from "../../core/types";

export interface SkillExecutionContext {
    scene: THREE.Scene;
    unitsStateRef: React.RefObject<Unit[]>;
    unitsRef: React.RefObject<Record<number, UnitGroup>>;
    actionCooldownRef: React.MutableRefObject<Record<number, number>>;
    projectilesRef: React.MutableRefObject<Projectile[]>;
    hitFlashRef: React.MutableRefObject<Record<number, number>>;
    damageTexts: React.MutableRefObject<{ mesh: THREE.Mesh; life: number }[]>;
    unitMeshRef: React.RefObject<Record<number, THREE.Mesh>>;
    unitOriginalColorRef: React.RefObject<Record<number, THREE.Color>>;
    swingAnimationsRef: React.MutableRefObject<SwingAnimation[]>;
    setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
    setSkillCooldowns: React.Dispatch<React.SetStateAction<Record<string, { end: number; duration: number }>>>;
    addLog: (text: string, color?: string) => void;
    defeatedThisFrame: Set<number>;  // Shared set to track units defeated this frame
    // Optional tile refs for skills that interact with ground tiles
    sanctuaryTilesRef?: React.MutableRefObject<Map<string, SanctuaryTile>>;
    acidTilesRef?: React.MutableRefObject<Map<string, AcidTile>>;
    holyTilesRef?: React.MutableRefObject<Map<string, HolyTile>>;
    smokeTilesRef?: React.MutableRefObject<Map<string, SmokeTile>>;
}
