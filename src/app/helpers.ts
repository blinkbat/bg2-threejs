import type { CharacterStats, UnitGroup } from "../core/types";
import type { PerfFrameSample } from "../hooks";

export type CardinalDirection = "north" | "south" | "east" | "west";

export const ZERO_STATS: CharacterStats = {
    strength: 0,
    dexterity: 0,
    vitality: 0,
    intelligence: 0,
    faith: 0
};

export const STAT_BOOST_AMOUNT = 10;
export const PERF_LOG_FLUSH_INTERVAL_MS = 3000;
export const PERF_LOG_BUFFER_LIMIT = 2000;
export const PERF_LOG_ENDPOINT = "/__perf-log";

export function preloadPortraits(portraitUrls: string[]): Promise<void> {
    return Promise.all(
        portraitUrls.map(src => new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Don't block on failure
            img.src = src;
        }))
    ).then(() => {});
}

export function syncHoveredDoorRef<T extends { hoveredDoor: string | null }>(
    refs: React.MutableRefObject<T>,
    hoveredDoorTarget: string | null
): void {
    refs.current.hoveredDoor = hoveredDoorTarget;
}

export function reviveUnitVisual(
    unitGroups: Record<number, UnitGroup>,
    targetId: number,
    reviveX: number,
    reviveZ: number
): void {
    const reviveGroup = unitGroups[targetId];
    if (!reviveGroup) return;
    reviveGroup.visible = true;
    reviveGroup.position.set(reviveX, reviveGroup.userData.flyHeight, reviveZ);
    reviveGroup.userData.targetX = reviveX;
    reviveGroup.userData.targetZ = reviveZ;
}

export function getForwardVectorForDirection(direction?: CardinalDirection): { x: number; z: number } {
    switch (direction ?? "south") {
        case "north": return { x: 0, z: 1 };
        case "south": return { x: 0, z: -1 };
        case "east": return { x: 1, z: 0 };
        case "west": return { x: -1, z: 0 };
        default: return { x: 0, z: -1 };
    }
}

export function formatPerfLogLine(sample: PerfFrameSample): string {
    const ts = new Date(sample.timestamp).toISOString();
    const heap = sample.jsHeapMb !== null ? sample.jsHeapMb.toFixed(1) : "na";
    const programs = sample.programs !== null ? String(sample.programs) : "na";
    const mode = sample.belowThreshold ? "trigger" : "capture";
    return [
        ts,
        `mode=${mode}`,
        `fps=${sample.fps.toFixed(1)}`,
        `frame=${sample.frameMs.toFixed(2)}ms`,
        `paused=${sample.paused ? 1 : 0}`,
        `units=${sample.units}`,
        `aliveP=${sample.playersAlive}`,
        `aliveE=${sample.enemiesAlive}`,
        `proj=${sample.projectiles}`,
        `dmgTxt=${sample.damageTexts}`,
        `acid=${sample.acidTiles}`,
        `sanct=${sample.sanctuaryTiles}`,
        `lights=${sample.lightsVisible}/${sample.lightsTotal}`,
        `draw=${sample.drawCalls}`,
        `tris=${sample.triangles}`,
        `geo=${sample.geometries}`,
        `tex=${sample.textures}`,
        `prog=${programs}`,
        `heapMb=${heap}`,
        `t_cache=${sample.cacheMs.toFixed(2)}`,
        `t_visual=${sample.visualMs.toFixed(2)}`,
        `t_combat=${sample.combatMs.toFixed(2)}`,
        `t_proj=${sample.projectilesMs.toFixed(2)}`,
        `t_status=${sample.statusMs.toFixed(2)}`,
        `t_fog=${sample.fogMs.toFixed(2)}`,
        `t_ai=${sample.aiMs.toFixed(2)}`,
        `t_unitAi=${sample.unitAiMs.toFixed(2)}`,
        `t_wall=${sample.wallMs.toFixed(2)}`,
        `t_lod=${sample.lightLodMs.toFixed(2)}`,
        `t_render=${sample.renderMs.toFixed(2)}`
    ].join(" ");
}
