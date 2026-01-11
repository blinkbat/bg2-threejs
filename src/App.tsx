/**
 * BG2-STYLE ISOMETRIC TACTICS
 * - Dungeon: carved rooms/hallways, merged wall meshes for perf
 * - A* pathfinding: 8-dir, diagonal cost 1.41, no corner cutting
 * - Combat: D&D 2e THAC0 vs AC, roll d20 >= (THAC0 - AC) to hit
 * - Movement: constant speed + steering avoidance
 * - Fog of war: per-cell visibility with LOS checks through walls
 */

import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface Unit {
    id: number;
    x: number;
    z: number;
    hp: number;
    team: "player" | "enemy";
    target: number | null;
}

interface UnitData {
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

interface KoboldStats {
    name: string;
    hp: number;
    maxHp: number;
    damage: [number, number];
    thac0: number;
    ac: number;
    color: string;
    aggroRange: number;
}

interface Room {
    x: number;
    z: number;
    w: number;
    h: number;
}

interface CandlePosition {
    x: number;
    z: number;
    dx: number;
    dz: number;
}

interface MergedObstacle {
    x: number;
    z: number;
    w: number;
    h: number;
}

interface PathNode {
    x: number;
    z: number;
    g: number;
    h: number;
    parent: PathNode | null;
}

interface CombatLogEntry {
    text: string;
    color?: string;
}

interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface HpBar {
    bg: THREE.Mesh;
    fill: THREE.Mesh;
    maxHp: number;
}

interface DamageText {
    mesh: THREE.Mesh;
    life: number;
}

interface FogTexture {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
}

interface UnitGroup extends THREE.Group {
    userData: {
        unitId: number;
        targetX: number;
        targetZ: number;
        attackTarget: number | null;
    };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const GRID_SIZE = 40;
const ATTACK_RANGE = 1.8;
const ATTACK_COOLDOWN = 2000;
const MOVE_SPEED = 0.05;
const UNIT_RADIUS = 0.7;
const VISION_RADIUS = 10;

// =============================================================================
// DUNGEON GENERATION - carve rooms/hallways from solid, then merge walls
// =============================================================================

const blocked: boolean[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(true));

const carve = (x1: number, z1: number, x2: number, z2: number): void => {
    for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
            if (x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE) blocked[x][z] = false;
        }
    }
};

// Rooms - big rooms
const rooms = [
    { x: 1, z: 1, w: 10, h: 10 },      // Room A - player spawn (SW)
    { x: 1, z: 25, w: 9, h: 9 },       // Room B - NW
    { x: 28, z: 1, w: 10, h: 10 },     // Room C - SE
    { x: 28, z: 28, w: 11, h: 11 },    // Room D - kobold lair (NE)
    { x: 14, z: 14, w: 12, h: 12 },    // Room E - central great hall
    { x: 14, z: 1, w: 8, h: 8 },       // Room F - S middle
    { x: 1, z: 14, w: 8, h: 8 },       // Room G - W middle
    { x: 30, z: 14, w: 8, h: 8 },      // Room H - E middle
    { x: 14, z: 32, w: 8, h: 7 },      // Room I - N middle
];

rooms.forEach(r => carve(r.x, r.z, r.x + r.w - 1, r.z + r.h - 1));

// Hallways (5-6 wide)
carve(10, 3, 14, 7);      // A to F
carve(21, 3, 28, 7);      // F to C
carve(3, 10, 7, 14);      // A to G
carve(3, 22, 7, 25);      // G to B
carve(8, 16, 14, 20);     // G to E
carve(25, 16, 30, 20);    // E to H
carve(32, 10, 36, 14);    // C to H
carve(32, 22, 36, 28);    // H to D
carve(16, 8, 20, 14);     // F to E
carve(16, 26, 20, 32);    // E to I
carve(8, 27, 14, 31);     // B to I
carve(21, 34, 28, 37);    // I to D

// Wall sconces - find wall cells adjacent to rooms, place sconce facing into room
const candlePositions: CandlePosition[] = [];
rooms.forEach(r => {
    const midX = r.x + Math.floor(r.w / 2);
    const midZ = r.z + Math.floor(r.h / 2);
    
    // South wall (wall cell just south of room)
    const sWallZ = r.z - 1;
    if (sWallZ >= 0 && blocked[midX]?.[sWallZ]) {
        candlePositions.push({ x: midX + 0.5, z: sWallZ + 0.85, dx: 0, dz: 1 });
    }
    // North wall
    const nWallZ = r.z + r.h;
    if (nWallZ < GRID_SIZE && blocked[midX]?.[nWallZ]) {
        candlePositions.push({ x: midX + 0.5, z: nWallZ + 0.15, dx: 0, dz: -1 });
    }
    // West wall
    const wWallX = r.x - 1;
    if (wWallX >= 0 && blocked[wWallX]?.[midZ]) {
        candlePositions.push({ x: wWallX + 0.85, z: midZ + 0.5, dx: 1, dz: 0 });
    }
    // East wall
    const eWallX = r.x + r.w;
    if (eWallX < GRID_SIZE && blocked[eWallX]?.[midZ]) {
        candlePositions.push({ x: eWallX + 0.15, z: midZ + 0.5, dx: -1, dz: 0 });
    }
});

// Merge adjacent blocked cells into larger meshes (reduces draw calls significantly)
const mergedObstacles: MergedObstacle[] = [];
const used = new Set<string>();
for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
        if (!blocked[x][z] || used.has(`${x},${z}`)) continue;
        let w = 1, h = 1;
        while (x + w < GRID_SIZE && blocked[x + w][z] && !used.has(`${x + w},${z}`)) w++;
        outer: while (z + h < GRID_SIZE) {
            for (let dx = 0; dx < w; dx++) {
                if (!blocked[x + dx][z + h] || used.has(`${x + dx},${z + h}`)) break outer;
            }
            h++;
        }
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < h; dz++) {
                used.add(`${x + dx},${z + dz}`);
            }
        }
        mergedObstacles.push({ x, z, w, h });
    }
}

// =============================================================================
// FOG OF WAR - Bresenham LOS, visibility states: 0=unseen, 1=seen, 2=visible
// =============================================================================

function hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    // Bresenham's line - returns false if any blocked cell between start and end
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let x = x0, z = z0;
    
    while (true) {
        if (x === x1 && z === z1) return true;
        if (blocked[x]?.[z] && !(x === x0 && z === z0)) return false;
        const e2 = 2 * err;
        if (e2 > -dz) { err -= dz; x += sx; }
        if (e2 < dx) { err += dx; z += sz; }
    }
}

function updateVisibility(visibility: number[][], playerUnits: Unit[], unitsRef: React.RefObject<Record<number, UnitGroup>>): number[][] {
    // Decay: visible (2) -> seen (1), seen stays seen
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            if (visibility[x][z] === 2) visibility[x][z] = 1;
        }
    }

    // Mark cells visible from each player unit
    playerUnits.forEach((u: Unit) => {
        const g = unitsRef.current[u.id];
        if (!g || u.hp <= 0) return;
        const ux = Math.floor(g.position.x), uz = Math.floor(g.position.z);
        
        for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
            for (let dz = -VISION_RADIUS; dz <= VISION_RADIUS; dz++) {
                const x = ux + dx, z = uz + dz;
                if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
                if (dx * dx + dz * dz > VISION_RADIUS * VISION_RADIUS) continue;
                if (hasLineOfSight(ux, uz, x, z)) visibility[x][z] = 2;
            }
        }
    });
    
    return visibility;
}

// =============================================================================
// A* PATHFINDING
// =============================================================================

function findPath(startX: number, startZ: number, endX: number, endZ: number): { x: number; z: number }[] | null {
    const sx = Math.floor(startX), sz = Math.floor(startZ);
    const ex = Math.floor(endX), ez = Math.floor(endZ);

    if (sx === ex && sz === ez) return [{ x: endX, z: endZ }];
    if (ex < 0 || ex >= GRID_SIZE || ez < 0 || ez >= GRID_SIZE) return null;

    // Target blocked - find nearest unblocked
    if (blocked[ex]?.[ez]) {
        let best: { x: number; z: number } | null = null, bestDist = Infinity;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const nx = ex + dx, nz = ez + dz;
                if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && !blocked[nx][nz]) {
                    const d = Math.hypot(dx, dz);
                    if (d < bestDist) { bestDist = d; best = { x: nx, z: nz }; }
                }
            }
        }
        if (best) return findPath(startX, startZ, best.x + 0.5, best.z + 0.5);
        return null;
    }

    const open: PathNode[] = [{ x: sx, z: sz, g: 0, h: Math.hypot(ex - sx, ez - sz), parent: null }];
    const closed = new Set<string>();
    const key = (x: number, z: number) => `${x},${z}`;

    while (open.length > 0) {
        open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
        const current = open.shift()!;

        if (current.x === ex && current.z === ez) {
            const path: { x: number; z: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                path.unshift({ x: node.x + 0.5, z: node.z + 0.5 });
                node = node.parent;
            }
            path[path.length - 1] = { x: endX, z: endZ };
            return path;
        }

        closed.add(key(current.x, current.z));

        const neighbors = [
            { x: current.x - 1, z: current.z, cost: 1 },
            { x: current.x + 1, z: current.z, cost: 1 },
            { x: current.x, z: current.z - 1, cost: 1 },
            { x: current.x, z: current.z + 1, cost: 1 },
            { x: current.x - 1, z: current.z - 1, cost: 1.41 },
            { x: current.x + 1, z: current.z - 1, cost: 1.41 },
            { x: current.x - 1, z: current.z + 1, cost: 1.41 },
            { x: current.x + 1, z: current.z + 1, cost: 1.41 },
        ];

        for (const n of neighbors) {
            if (n.x < 0 || n.x >= GRID_SIZE || n.z < 0 || n.z >= GRID_SIZE) continue;
            if (blocked[n.x][n.z]) continue;
            if (closed.has(key(n.x, n.z))) continue;
            // Diagonal: block if either adjacent cardinal is blocked (no corner cutting)
            if (n.cost > 1 && (blocked[current.x]?.[n.z] || blocked[n.x]?.[current.z])) continue;

            const g = current.g + n.cost;
            const existing = open.find(o => o.x === n.x && o.z === n.z);
            if (existing) {
                if (g < existing.g) { existing.g = g; existing.parent = current; }
            } else {
                open.push({ x: n.x, z: n.z, g, h: Math.hypot(ex - n.x, ez - n.z), parent: current });
            }
        }
    }
    return null;
}

// =============================================================================
// UNIT DATA - THAC0: lower=better, AC: lower=better
// =============================================================================

const UNIT_DATA: Record<number, UnitData> = {
    1: { name: "Keldorn", class: "Paladin", hp: 102, maxHp: 102, damage: [8, 16], thac0: 5, ac: 2, color: "#e63946", skills: ["Lay on Hands", "True Sight", "Dispel Magic"], items: ["Carsomyr +5", "Plate Mail", "Helm of Glory", "Potion x3"] },
    2: { name: "Edwin", class: "Conjurer", hp: 42, maxHp: 42, damage: [4, 8], thac0: 18, ac: 5, color: "#457b9d", skills: ["Fireball", "Magic Missile", "Stoneskin", "Haste"], items: ["Staff of the Magi", "Edwin's Amulet", "Robe of Vecna", "Scroll Case"] },
    3: { name: "Minsc", class: "Ranger", hp: 95, maxHp: 95, damage: [10, 18], thac0: 6, ac: 0, color: "#2a9d8f", skills: ["Berserk", "Charm Animal", "Tracking"], items: ["Lilarcor +3", "Full Plate", "Boo", "Potion x5"] },
    4: { name: "Viconia", class: "Cleric", hp: 72, maxHp: 72, damage: [6, 14], thac0: 10, ac: 1, color: "#e9c46a", skills: ["Heal", "Flame Strike", "Hold Person", "Sanctuary"], items: ["Flail of Ages +3", "Dark Elven Chain", "Shield of Harmony", "Holy Symbol"] },
    5: { name: "Yoshimo", class: "Bounty Hunter", hp: 58, maxHp: 58, damage: [6, 12], thac0: 12, ac: 3, color: "#9b5de5", skills: ["Set Snare", "Detect Traps", "Hide in Shadows", "Backstab"], items: ["Katana +2", "Leather Armor +3", "Trap Kit x10", "Thieves' Tools"] },
};

const KOBOLD_STATS: KoboldStats = { name: "Kobold", hp: 12, maxHp: 12, damage: [1, 4], thac0: 20, ac: 7, color: "#8B4513", aggroRange: 6 };

// =============================================================================
// UI COMPONENTS
// =============================================================================

interface PartyBarProps {
    units: Unit[];
    selectedIds: number[];
    onSelect: React.Dispatch<React.SetStateAction<number[]>>;
}

function PartyBar({ units, selectedIds, onSelect }: PartyBarProps) {
    return (
        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(180deg, #1e1e2e 0%, #12121a 100%)", border: "2px solid #3d3d5c", borderRadius: 8, padding: 8, display: "flex", gap: 6 }}>
            {units.filter((u: Unit) => u.team === "player").map((unit: Unit) => {
                const data = UNIT_DATA[unit.id];
                if (!data) return null;
                const isSelected = selectedIds.includes(unit.id);
                const hpPct = (unit.hp / data.maxHp) * 100;
                const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#eab308" : "#ef4444";
                return (
                    <div key={unit.id} onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey ? (prev: number[]) => prev.includes(unit.id) ? prev.filter((i: number) => i !== unit.id) : [...prev, unit.id] : [unit.id]); }} style={{ width: 56, cursor: "pointer", opacity: unit.hp <= 0 ? 0.4 : 1, background: isSelected ? "rgba(0,255,0,0.15)" : "transparent", border: isSelected ? "2px solid #00ff00" : "2px solid #333", borderRadius: 6, padding: 4 }}>
                        <div style={{ width: "100%", height: 56, background: data.color, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", color: "#fff", textShadow: "1px 1px 2px #000", fontFamily: "serif" }}>{data.name[0]}</div>
                        <div style={{ marginTop: 4, height: 6, background: "#111", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
                        <div style={{ fontSize: 9, color: "#aaa", textAlign: "center", marginTop: 2, fontFamily: "monospace" }}>{data.name}</div>
                    </div>
                );
            })}
        </div>
    );
}

interface UnitPanelProps {
    unitId: number;
    units: Unit[];
    onClose: () => void;
}

function UnitPanel({ unitId, units, onClose }: UnitPanelProps) {
    const [tab, setTab] = useState("stats");
    const data = UNIT_DATA[unitId];
    const unit = units.find((u: Unit) => u.id === unitId);
    if (!data || !unit) return null;
    const hpPct = (unit.hp / data.maxHp) * 100;
    const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#eab308" : "#ef4444";
    return (
        <div style={{ position: "absolute", top: 10, right: 10, width: 240, background: "linear-gradient(180deg, #1e1e2e 0%, #12121a 100%)", border: "2px solid #3d3d5c", borderRadius: 8, fontFamily: "monospace", color: "#ddd", overflow: "hidden" }}>
            <div style={{ background: data.color, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 44, height: 44, background: "rgba(0,0,0,0.3)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", fontFamily: "serif" }}>{data.name[0]}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: "bold", fontSize: 14 }}>{data.name}</div><div style={{ fontSize: 11, opacity: 0.8 }}>{data.class}</div></div>
                <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, opacity: 0.7 }}>×</div>
            </div>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #333" }}>
                <div style={{ fontSize: 11, marginBottom: 3 }}>HP: {Math.max(0, unit.hp)} / {data.maxHp}</div>
                <div style={{ height: 10, background: "#111", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${Math.max(0, hpPct)}%`, height: "100%", background: hpColor }} /></div>
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid #333" }}>
                {["stats", "skills", "items"].map(t => (<div key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, textTransform: "uppercase", cursor: "pointer", background: tab === t ? "#2a2a3e" : "transparent", borderBottom: tab === t ? "2px solid #58a6ff" : "2px solid transparent", color: tab === t ? "#fff" : "#888" }}>{t}</div>))}
            </div>
            <div style={{ padding: 12, minHeight: 140 }}>
                {tab === "stats" && (<div style={{ fontSize: 12 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>THAC0</span> <span style={{ float: "right" }}>{data.thac0}</span></div><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4 }}><span style={{ color: "#888" }}>AC</span> <span style={{ float: "right" }}>{data.ac}</span></div><div style={{ background: "#1a1a2a", padding: "6px 8px", borderRadius: 4, gridColumn: "span 2" }}><span style={{ color: "#888" }}>Damage</span> <span style={{ float: "right" }}>{data.damage[0]}-{data.damage[1]}</span></div></div></div>)}
                {tab === "skills" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{data.skills.map((s: string, i: number) => <div key={i} style={{ background: "#1a1a2a", padding: "8px 10px", borderRadius: 4, fontSize: 12 }}>{s}</div>)}</div>}
                {tab === "items" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{data.items.map((s: string, i: number) => <div key={i} style={{ background: "#1a1a2a", padding: "8px 10px", borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, background: i === 0 ? "#f59e0b" : "#555", borderRadius: 2 }} />{s}</div>)}</div>}
            </div>
        </div>
    );
}

interface CombatLogProps {
    log: CombatLogEntry[];
}

function CombatLog({ log }: CombatLogProps) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
    return (
        <div ref={ref} style={{ position: "absolute", bottom: 100, left: 10, width: 280, maxHeight: 150, background: "rgba(0,0,0,0.8)", border: "1px solid #333", borderRadius: 4, padding: 8, fontFamily: "monospace", fontSize: 11, color: "#ccc", overflowY: "auto" }}>
            {log.slice(-20).map((entry: CombatLogEntry, i: number) => (<div key={i} style={{ marginBottom: 4, color: entry.color || "#ccc" }}>{entry.text}</div>))}
        </div>
    );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const unitsRef = useRef<Record<number, UnitGroup>>({});
    const selectRingsRef = useRef<Record<number, THREE.Mesh>>({});
    const hpBarsRef = useRef<Record<number, HpBar>>({});
    const moveMarkerRef = useRef<THREE.Mesh | null>(null);
    const pathsRef = useRef<Record<number, { x: number; z: number }[]>>({});
    const fogTextureRef = useRef<FogTexture | null>(null);
    const fogMeshRef = useRef<THREE.Mesh | null>(null);
    const visibilityRef = useRef<number[][]>(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));

    const cameraOffset = useRef({ x: 6, z: 6 });
    const zoomLevel = useRef(10);
    const isDragging = useRef(false);
    const keysPressed = useRef<Set<string>>(new Set());
    const isBoxSel = useRef(false);
    const boxStart = useRef({ x: 0, y: 0 });
    const boxEnd = useRef({ x: 0, y: 0 });
    const lastMouse = useRef({ x: 0, y: 0 });
    const lastAttack = useRef<Record<number, number>>({});
    const damageTexts = useRef<DamageText[]>([]);

    const [units, setUnits] = useState<Unit[]>([
        ...Object.keys(UNIT_DATA).map((id, i) => ({ id: Number(id), x: 4.5 + (i % 3) * 2, z: 4.5 + Math.floor(i / 3) * 2, hp: UNIT_DATA[Number(id)].hp, team: "player" as const, target: null })),
        ...[1,2,3,4,5,6,7,8,9,10,11,12].map((_, i) => ({ id: 100 + i, x: 30.5 + (i % 4) * 2, z: 30.5 + Math.floor(i / 4) * 2, hp: KOBOLD_STATS.maxHp, team: "enemy" as const, target: null })),
    ]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [selBox, setSelBox] = useState<SelectionBox | null>(null);
    const [showPanel, setShowPanel] = useState(false);
    const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([{ text: "Combat begins!", color: "#f59e0b" }]);
    const [paused, setPaused] = useState(false);

    const selectedRef = useRef(selectedIds);
    const unitsStateRef = useRef(units);
    const pausedRef = useRef(paused);

    useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
    useEffect(() => { unitsStateRef.current = units; }, [units]);
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    const addLog = (text: string, color?: string) => setCombatLog(prev => [...prev.slice(-50), { text, color }]);
    const rollDamage = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const rollD20 = () => Math.floor(Math.random() * 20) + 1;

    useEffect(() => {
        if (!containerRef.current) return;
        
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#0d1117");
        sceneRef.current = scene;

        const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
        const camera = new THREE.OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        scene.add(new THREE.AmbientLight(0xffffff, 0.08));
        const dir = new THREE.DirectionalLight(0xffffff, 0.15);
        dir.position.set(10, 20, 10);
        scene.add(dir);

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), new THREE.MeshStandardMaterial({ color: "#12121a" }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
        ground.name = "ground";
        scene.add(ground);

        const roomFloors = [
            { x: 1, z: 1, w: 10, h: 10, color: "#1a2a1a" },
            { x: 1, z: 25, w: 9, h: 9, color: "#1a1a2a" },
            { x: 28, z: 1, w: 10, h: 10, color: "#2a1a1a" },
            { x: 28, z: 28, w: 11, h: 11, color: "#2a1a2a" },
            { x: 14, z: 14, w: 12, h: 12, color: "#1a2020" },
            { x: 14, z: 1, w: 8, h: 8, color: "#20201a" },
            { x: 1, z: 14, w: 8, h: 8, color: "#1a201a" },
            { x: 30, z: 14, w: 8, h: 8, color: "#201a20" },
            { x: 14, z: 32, w: 8, h: 7, color: "#1a1a20" },
        ];
        roomFloors.forEach(r => {
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), new THREE.MeshStandardMaterial({ color: r.color }));
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(r.x + r.w / 2, 0.01, r.z + r.h / 2);
            floor.name = "ground";
            scene.add(floor);
        });

        // Wall sconces with point lights
        candlePositions.forEach((pos) => {
            // Iron bracket flush on wall face
            const bracketMat = new THREE.MeshStandardMaterial({ color: "#3a2a1a" });
            const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.1), bracketMat);
            bracket.position.set(pos.x, 1.8, pos.z);
            scene.add(bracket);
            
            // Horizontal arm holding candle
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), bracketMat);
            arm.position.set(pos.x + pos.dx * 0.15, 1.7, pos.z + pos.dz * 0.15);
            scene.add(arm);
            
            // Candle
            const candleMat = new THREE.MeshStandardMaterial({ color: "#e8d4a8", emissive: "#4a3a10", emissiveIntensity: 0.2 });
            const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 8), candleMat);
            candle.position.set(pos.x + pos.dx * 0.3, 1.85, pos.z + pos.dz * 0.3);
            scene.add(candle);
            
            // Flame
            const flameMat = new THREE.MeshBasicMaterial({ color: "#ff9922" });
            const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), flameMat);
            flame.position.set(pos.x + pos.dx * 0.3, 2.02, pos.z + pos.dz * 0.3);
            flame.scale.y = 1.8;
            scene.add(flame);
            
            // Point light
            const light = new THREE.PointLight("#ff8833", 2.5, 14, 1.5);
            light.position.set(pos.x + pos.dx * 1.5, 2.2, pos.z + pos.dz * 1.5);
            scene.add(light);
        });

        mergedObstacles.forEach((o, i) => {
            const shade = 0x2d3748 + (i % 3) * 0x050505;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 2.5, o.h), new THREE.MeshStandardMaterial({ color: shade }));
            mesh.position.set(o.x + o.w / 2, 1.25, o.z + o.h / 2);
            mesh.name = "obstacle";
            scene.add(mesh);
        });

        const gridMat = new THREE.LineBasicMaterial({ color: "#333" });
        for (let i = 0; i <= GRID_SIZE; i++) {
            scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, i), new THREE.Vector3(GRID_SIZE, 0.01, i)]), gridMat));
            scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.01, 0), new THREE.Vector3(i, 0.01, GRID_SIZE)]), gridMat));
        }

        // Fog of war texture - canvas updated each frame
        const fogCanvas = document.createElement("canvas");
        fogCanvas.width = GRID_SIZE;
        fogCanvas.height = GRID_SIZE;
        const fogCtx = fogCanvas.getContext("2d")!;
        fogCtx.fillStyle = "#000";
        fogCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
        const fogTexture = new THREE.CanvasTexture(fogCanvas);
        fogTexture.magFilter = THREE.NearestFilter;
        fogTexture.minFilter = THREE.NearestFilter;
        fogTextureRef.current = { canvas: fogCanvas, ctx: fogCtx, texture: fogTexture };
        
        const fogMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
            new THREE.MeshBasicMaterial({ map: fogTexture, transparent: true })
        );
        fogMesh.rotation.x = -Math.PI / 2;
        fogMesh.position.set(GRID_SIZE / 2, 2.6, GRID_SIZE / 2);
        scene.add(fogMesh);
        fogMeshRef.current = fogMesh;

        const marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 4), new THREE.MeshBasicMaterial({ color: "#ffff00", side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
        marker.rotation.x = -Math.PI / 2;
        marker.visible = false;
        scene.add(marker);
        moveMarkerRef.current = marker;

        units.forEach(unit => {
            const isPlayer = unit.team === "player";
            const data = isPlayer ? UNIT_DATA[unit.id] : KOBOLD_STATS;
            const group = new THREE.Group();

            const base = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), new THREE.MeshBasicMaterial({ color: isPlayer ? "#444" : "#660000", side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
            base.rotation.x = -Math.PI / 2;
            base.position.y = 0.02;
            group.add(base);

            const boxH = isPlayer ? 1 : 0.6;
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, boxH, 0.6), new THREE.MeshStandardMaterial({ color: data.color }));
            box.position.y = boxH / 2;
            box.userData.unitId = unit.id;
            group.add(box);

            const sel = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.55, 32), new THREE.MeshBasicMaterial({ color: "#00ff00", side: THREE.DoubleSide }));
            sel.rotation.x = -Math.PI / 2;
            sel.position.y = 0.03;
            sel.visible = false;
            group.add(sel);
            selectRingsRef.current[unit.id] = sel;

            const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.1), new THREE.MeshBasicMaterial({ color: "#111" }));
            hpBg.position.set(0, boxH + 0.3, 0);
            group.add(hpBg);
            const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.08), new THREE.MeshBasicMaterial({ color: isPlayer ? "#22c55e" : "#ef4444" }));
            hpFill.position.set(0, boxH + 0.3, 0.01);
            group.add(hpFill);
            hpBarsRef.current[unit.id] = { bg: hpBg, fill: hpFill, maxHp: data.maxHp };

            group.position.set(unit.x, 0, unit.z);
            group.userData = { unitId: unit.id, targetX: unit.x, targetZ: unit.z, attackTarget: null };
            scene.add(group);
            unitsRef.current[unit.id] = group as UnitGroup;
            pathsRef.current[unit.id] = [];
        });

        const updateCamera = () => {
            const d = 20;
            camera.position.set(cameraOffset.current.x + d, d, cameraOffset.current.z + d);
            camera.lookAt(cameraOffset.current.x, 0, cameraOffset.current.z);
        };
        updateCamera();

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const getUnitsInBox = (x1: number, y1: number, x2: number, y2: number): number[] => {
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            const rect = renderer.domElement.getBoundingClientRect();
            const sel: number[] = [];
            Object.entries(unitsRef.current).forEach(([id, g]) => {
                const u = unitsStateRef.current.find(u => u.id === Number(id));
                if (!u || u.team !== "player" || u.hp <= 0) return;
                const p = new THREE.Vector3(g.position.x, 0.5, g.position.z).project(camera);
                const sx = ((p.x + 1) / 2) * rect.width + rect.left;
                const sy = ((-p.y + 1) / 2) * rect.height + rect.top;
                if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) sel.push(Number(id));
            });
            return sel;
        };

        const assignPath = (unitId: number, targetX: number, targetZ: number) => {
            const g = unitsRef.current[unitId];
            if (!g) return;
            const path = findPath(g.position.x, g.position.z, targetX, targetZ);
            pathsRef.current[unitId] = path ? path.slice(1) : [];
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 2) { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }
            else if (e.button === 0) {
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                let hitUnit = false;
                for (const h of raycaster.intersectObjects(scene.children, true)) {
                    let o: THREE.Object3D | null = h.object;
                    while (o) { if (o.userData.unitId !== undefined) { hitUnit = true; break; } o = o.parent; }
                    if (hitUnit) break;
                }
                if (!hitUnit) { isBoxSel.current = true; boxStart.current = { x: e.clientX, y: e.clientY }; boxEnd.current = { x: e.clientX, y: e.clientY }; }
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (isDragging.current) {
                const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
                cameraOffset.current.x -= (dx + dy) * 0.03;
                cameraOffset.current.z -= (dy - dx) * 0.03;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z));
                lastMouse.current = { x: e.clientX, y: e.clientY };
                updateCamera();
            } else if (isBoxSel.current) {
                boxEnd.current = { x: e.clientX, y: e.clientY };
                const rect = renderer.domElement.getBoundingClientRect();
                setSelBox({ left: Math.min(boxStart.current.x, boxEnd.current.x) - rect.left, top: Math.min(boxStart.current.y, boxEnd.current.y) - rect.top, width: Math.abs(boxEnd.current.x - boxStart.current.x), height: Math.abs(boxEnd.current.y - boxStart.current.y) });
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (isBoxSel.current) {
                const dx = Math.abs(boxEnd.current.x - boxStart.current.x), dy = Math.abs(boxEnd.current.y - boxStart.current.y);
                if (dx > 5 || dy > 5) {
                    const inBox = getUnitsInBox(boxStart.current.x, boxStart.current.y, boxEnd.current.x, boxEnd.current.y);
                    setSelectedIds(e.shiftKey ? prev => [...new Set([...prev, ...inBox])] : inBox);
                } else {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    for (const h of raycaster.intersectObjects(scene.children, true)) {
                        if (h.object.name === "obstacle") continue;
                        if (h.object.name === "ground" && selectedRef.current.length > 0) {
                            const gx = Math.floor(h.point.x) + 0.5, gz = Math.floor(h.point.z) + 0.5;
                            if (blocked[Math.floor(gx)]?.[Math.floor(gz)]) break;
                            if (moveMarkerRef.current) {
                                moveMarkerRef.current.position.set(gx, 0.05, gz);
                                moveMarkerRef.current.visible = true;
                                setTimeout(() => { if (moveMarkerRef.current) moveMarkerRef.current.visible = false; }, 500);
                            }
                            let idx = 0;
                            selectedRef.current.forEach(uid => {
                                const u = unitsStateRef.current.find(u => u.id === uid);
                                if (u && u.hp > 0) {
                                    const ox = (idx % 3 - 1) * 1.2, oz = Math.floor(idx / 3) * 1.2;
                                    idx++;
                                    const tx = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gx + ox));
                                    const tz = Math.max(0.5, Math.min(GRID_SIZE - 0.5, gz + oz));
                                    assignPath(uid, tx, tz);
                                    if (unitsRef.current[uid]) unitsRef.current[uid].userData.attackTarget = null;
                                }
                            });
                            setUnits(prev => prev.map(u => selectedRef.current.includes(u.id) ? { ...u, target: null } : u));
                            break;
                        }
                    }
                }
                isBoxSel.current = false;
                setSelBox(null);
            }
            isDragging.current = false;
        };

        const onClick = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            for (const h of raycaster.intersectObjects(scene.children, true)) {
                let o: THREE.Object3D | null = h.object;
                while (o) {
                    if (o.userData.unitId !== undefined) {
                        const id = o.userData.unitId as number;
                        const clickedUnit = unitsStateRef.current.find(u => u.id === id);
                        if (clickedUnit && clickedUnit.team === "enemy" && clickedUnit.hp > 0 && selectedRef.current.length > 0) {
                            selectedRef.current.forEach(uid => {
                                if (unitsRef.current[uid]) unitsRef.current[uid].userData.attackTarget = id;
                                pathsRef.current[uid] = [];
                            });
                            setUnits(prev => prev.map(u => selectedRef.current.includes(u.id) ? { ...u, target: id } : u));
                            return;
                        } else if (clickedUnit && clickedUnit.team === "player") {
                            setSelectedIds(e.shiftKey ? prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id] : [id]);
                            return;
                        }
                    }
                    o = o.parent;
                }
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space") { e.preventDefault(); pausedRef.current = !pausedRef.current; setPaused(p => !p); }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
                keysPressed.current.add(e.code);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            keysPressed.current.delete(e.code);
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            zoomLevel.current = Math.max(5, Math.min(30, zoomLevel.current + e.deltaY * 0.01));
            const aspect = containerRef.current!.clientWidth / containerRef.current!.clientHeight;
            camera.left = -zoomLevel.current * aspect; camera.right = zoomLevel.current * aspect;
            camera.top = zoomLevel.current; camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
        };

        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("mousedown", onMouseDown);
        renderer.domElement.addEventListener("mousemove", onMouseMove);
        renderer.domElement.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
        renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        let animId: number;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            const now = Date.now();

            // Keyboard panning (screen-space: up/down/left/right on screen, not world axes)
            const panSpeed = 0.4;
            let screenX = 0, screenY = 0;
            if (keysPressed.current.has("ArrowUp") || keysPressed.current.has("KeyW")) screenY -= 1;
            if (keysPressed.current.has("ArrowDown") || keysPressed.current.has("KeyS")) screenY += 1;
            if (keysPressed.current.has("ArrowLeft") || keysPressed.current.has("KeyA")) screenX -= 1;
            if (keysPressed.current.has("ArrowRight") || keysPressed.current.has("KeyD")) screenX += 1;
            if (screenX !== 0 || screenY !== 0) {
                const len = Math.hypot(screenX, screenY);
                const normX = screenX / len, normY = screenY / len;
                // Convert screen direction to world: isometric camera is rotated 45 degrees
                // Screen right = world (+x, -z), Screen down = world (+x, +z)
                const worldX = (normX + normY) * panSpeed;
                const worldZ = (-normX + normY) * panSpeed;
                cameraOffset.current.x = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.x + worldX));
                cameraOffset.current.z = Math.max(0, Math.min(GRID_SIZE, cameraOffset.current.z + worldZ));
                updateCamera();
            }

            // Billboard HP bars
            Object.entries(hpBarsRef.current).forEach(([id, bars]) => {
                const g = unitsRef.current[Number(id)];
                if (g && bars.bg && bars.fill) { bars.bg.quaternion.copy(camera.quaternion); bars.fill.quaternion.copy(camera.quaternion); }
            });

            // Floating damage text
            damageTexts.current = damageTexts.current.filter(dt => {
                dt.mesh.position.y += 0.02;
                dt.life -= 16;
                (dt.mesh.material as THREE.MeshBasicMaterial).opacity = dt.life / 1000;
                if (dt.life <= 0) { scene.remove(dt.mesh); return false; }
                dt.mesh.quaternion.copy(camera.quaternion);
                return true;
            });

            const currentUnits = unitsStateRef.current;

            // Update fog of war
            const playerUnits = currentUnits.filter(u => u.team === "player" && u.hp > 0);
            updateVisibility(visibilityRef.current, playerUnits, unitsRef);

            if (!fogTextureRef.current) return;
            const { ctx, texture } = fogTextureRef.current;
            ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let z = 0; z < GRID_SIZE; z++) {
                    const vis = visibilityRef.current[x][z];
                    if (vis === 2) continue;
                    ctx.fillStyle = vis === 1 ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.95)";
                    ctx.fillRect(x, z, 1, 1);
                }
            }
            texture.needsUpdate = true;

            // Hide enemies in fog
            currentUnits.filter(u => u.team === "enemy").forEach(u => {
                const g = unitsRef.current[u.id];
                if (!g) return;
                const cx = Math.floor(g.position.x), cz = Math.floor(g.position.z);
                const vis = visibilityRef.current[cx]?.[cz] ?? 0;
                g.visible = u.hp > 0 && vis === 2;
            });

            if (!pausedRef.current) {
                const allGroups = Object.entries(unitsRef.current);

                currentUnits.forEach(unit => {
                    const g = unitsRef.current[unit.id];
                    if (!g || unit.hp <= 0) return;

                    const isPlayer = unit.team === "player";
                    const data = isPlayer ? UNIT_DATA[unit.id] : KOBOLD_STATS;

                    // Enemy AI
                    if (!isPlayer && !g.userData.attackTarget) {
                        let nearest = null, nearestDist = KOBOLD_STATS.aggroRange;
                        currentUnits.filter(u => u.team === "player" && u.hp > 0).forEach(p => {
                            const pg = unitsRef.current[p.id];
                            if (pg) {
                                const d = Math.hypot(g.position.x - pg.position.x, g.position.z - pg.position.z);
                                if (d < nearestDist) { nearestDist = d; nearest = p.id; }
                            }
                        });
                        if (nearest) g.userData.attackTarget = nearest;
                    }

                    let targetX = g.position.x, targetZ = g.position.z;

                    if (g.userData.attackTarget) {
                        const targetG = unitsRef.current[g.userData.attackTarget];
                        const targetU = currentUnits.find(u => u.id === g.userData.attackTarget);
                        if (targetG && targetU && targetU.hp > 0) {
                            targetX = targetG.position.x;
                            targetZ = targetG.position.z;
                            const dist = Math.hypot(targetX - g.position.x, targetZ - g.position.z);
                            if (dist <= ATTACK_RANGE) {
                                if (!lastAttack.current[unit.id] || now - lastAttack.current[unit.id] > ATTACK_COOLDOWN) {
                                    lastAttack.current[unit.id] = now;
                                    const targetData = targetU.team === "player" ? UNIT_DATA[targetU.id] : KOBOLD_STATS;
                                    const roll = rollD20();
                                    const hitNeeded = data.thac0 - targetData.ac;
                                    if (roll >= hitNeeded || roll === 20) {
                                        const dmg = rollDamage(data.damage[0], data.damage[1]);
                                        setUnits(prev => prev.map(u => u.id === targetU.id ? { ...u, hp: u.hp - dmg } : u));
                                        addLog(`${data.name} hits ${targetData.name} for ${dmg} damage! (${roll})`, isPlayer ? "#4ade80" : "#f87171");
                                        const dmgCanvas = document.createElement("canvas");
                                        dmgCanvas.width = 64; dmgCanvas.height = 32;
                                        const dctx = dmgCanvas.getContext("2d")!;
                                        dctx.font = "bold 24px monospace";
                                        dctx.fillStyle = isPlayer ? "#4ade80" : "#f87171";
                                        dctx.textAlign = "center";
                                        dctx.fillText(`-${dmg}`, 32, 24);
                                        const tex = new THREE.CanvasTexture(dmgCanvas);
                                        const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
                                        sprite.position.set(targetG.position.x, 1.5, targetG.position.z);
                                        scene.add(sprite);
                                        damageTexts.current.push({ mesh: sprite, life: 1000 });
                                        const newHp = Math.max(0, targetU.hp - dmg);
                                        const hpBar = hpBarsRef.current[targetU.id];
                                        if (hpBar) {
                                            const pct = newHp / hpBar.maxHp;
                                            hpBar.fill.scale.x = Math.max(0.01, pct);
                                            hpBar.fill.position.x = -0.39 * (1 - pct);
                                            (hpBar.fill.material as THREE.MeshBasicMaterial).color.setHex(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xeab308 : 0xef4444);
                                        }
                                        if (newHp <= 0) {
                                            addLog(`${targetData.name} is defeated!`, "#f59e0b");
                                            targetG.visible = false;
                                            Object.values(unitsRef.current).forEach((ug: UnitGroup) => { if (ug.userData.attackTarget === targetU.id) ug.userData.attackTarget = null; });
                                        }
                                    } else {
                                        addLog(`${data.name} misses ${targetData.name}. (${roll})`, "#888");
                                    }
                                }
                                return;
                            } else {
                                if (!pathsRef.current[unit.id]?.length || Math.random() < 0.02) {
                                    const path = findPath(g.position.x, g.position.z, targetX, targetZ);
                                    pathsRef.current[unit.id] = path ? path.slice(1) : [];
                                }
                            }
                        } else {
                            g.userData.attackTarget = null;
                        }
                    }

                    const path = pathsRef.current[unit.id];
                    if (path && path.length > 0) {
                        targetX = path[0].x;
                        targetZ = path[0].z;
                        if (Math.hypot(targetX - g.position.x, targetZ - g.position.z) < 0.3) path.shift();
                    }

                    const dx = targetX - g.position.x;
                    const dz = targetZ - g.position.z;
                    const distToTarget = Math.hypot(dx, dz);
                    
                    if (distToTarget > 0.1) {
                        let desiredX = dx / distToTarget, desiredZ = dz / distToTarget;
                        let avoidX = 0, avoidZ = 0;

                        allGroups.forEach(([otherId, otherG]) => {
                            if (String(unit.id) === otherId) return;
                            const otherU = currentUnits.find(u => u.id === Number(otherId));
                            if (!otherU || otherU.hp <= 0) return;
                            const ox = otherG.position.x - g.position.x, oz = otherG.position.z - g.position.z;
                            const oDist = Math.hypot(ox, oz);
                            if (oDist < UNIT_RADIUS * 4 && oDist > 0.01) {
                                const dot = (ox * desiredX + oz * desiredZ) / oDist;
                                if (dot > 0) {
                                    const cross = desiredX * oz - desiredZ * ox;
                                    const perpX = cross > 0 ? -desiredZ : desiredZ;
                                    const perpZ = cross > 0 ? desiredX : -desiredX;
                                    const strength = (UNIT_RADIUS * 4 - oDist) / (UNIT_RADIUS * 4);
                                    avoidX += perpX * strength * 2;
                                    avoidZ += perpZ * strength * 2;
                                }
                                if (oDist < UNIT_RADIUS * 2.2) {
                                    const sepStrength = (UNIT_RADIUS * 2.2 - oDist) / (UNIT_RADIUS * 2);
                                    avoidX -= (ox / oDist) * sepStrength * 3;
                                    avoidZ -= (oz / oDist) * sepStrength * 3;
                                }
                            }
                        });

                        let moveX = desiredX + avoidX, moveZ = desiredZ + avoidZ;
                        const moveMag = Math.hypot(moveX, moveZ);
                        if (moveMag > 0.01) {
                            moveX = (moveX / moveMag) * MOVE_SPEED;
                            moveZ = (moveZ / moveMag) * MOVE_SPEED;
                            const newX = g.position.x + moveX, newZ = g.position.z + moveZ;
                            const cellX = Math.floor(newX), cellZ = Math.floor(newZ);
                            if (!blocked[cellX]?.[cellZ]) {
                                g.position.x = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newX));
                                g.position.z = Math.max(0.5, Math.min(GRID_SIZE - 0.5, newZ));
                            }
                        }
                    }
                });
            }

            if (moveMarkerRef.current?.visible) moveMarkerRef.current.rotation.z += 0.05;
            renderer.render(scene, camera);
        };
        animate();

        const onResize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight, a = w / h;
            camera.left = -zoomLevel.current * a; camera.right = zoomLevel.current * a;
            camera.top = zoomLevel.current; camera.bottom = -zoomLevel.current;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener("resize", onResize);

        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            renderer.domElement.removeEventListener("wheel", onWheel);
            renderer.dispose();
            containerRef.current?.removeChild(renderer.domElement);
        };
    }, []);

    useEffect(() => {
        Object.entries(selectRingsRef.current).forEach(([id, ring]) => { ring.visible = selectedIds.includes(Number(id)); });
        setShowPanel(selectedIds.length === 1 && units.find(u => u.id === selectedIds[0])?.team === "player");
    }, [selectedIds, units]);

    const aliveEnemies = units.filter(u => u.team === "enemy" && u.hp > 0).length;
    const alivePlayers = units.filter(u => u.team === "player" && u.hp > 0).length;

    return (
        <div style={{ width: "100%", height: "100vh", position: "relative" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
            {selBox && <div style={{ position: "absolute", left: selBox.left, top: selBox.top, width: selBox.width, height: selBox.height, border: "1px solid #00ff00", backgroundColor: "rgba(0,255,0,0.1)", pointerEvents: "none" }} />}
            <div style={{ position: "absolute", top: 10, left: 10, fontFamily: "monospace", fontSize: 11, color: "#888", background: "rgba(0,0,0,0.6)", padding: "8px 12px", borderRadius: 4 }}>
                <div>Click enemy to attack • Spacebar to pause</div>
                <div>Drag to box-select • Right-drag/Arrows to pan • Scroll to zoom</div>
                <div style={{ marginTop: 6, color: aliveEnemies === 0 ? "#4ade80" : alivePlayers === 0 ? "#f87171" : "#fff" }}>
                    {aliveEnemies === 0 ? "Victory!" : alivePlayers === 0 ? "Defeat!" : `Kobolds: ${aliveEnemies}`}
                </div>
                <button onClick={() => setPaused(p => !p)} style={{ marginTop: 6, padding: "4px 10px", background: paused ? "#854d0e" : "#21262d", border: "1px solid #333", color: "#fff", borderRadius: 4, cursor: "pointer" }}>
                    {paused ? "▶ Resume" : "⏸ Pause"}
                </button>
            </div>
            <CombatLog log={combatLog} />
            <PartyBar units={units} selectedIds={selectedIds} onSelect={setSelectedIds} />
            {showPanel && selectedIds.length === 1 && <UnitPanel unitId={selectedIds[0]} units={units} onClose={() => setShowPanel(false)} />}
        </div>
    );
}