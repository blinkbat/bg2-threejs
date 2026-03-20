import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { Color, Mesh, Scene } from "three";
import type { SkillExecutionContext } from "../src/combat/skills/types";
import type {
    AcidTile,
    DamageText,
    FireTile,
    HolyTile,
    Projectile,
    SanctuaryTile,
    SmokeTile,
    SwingAnimation,
    Unit,
    UnitGroup,
} from "../src/core/types";

const globalAny = globalThis as Record<string, unknown>;

export function ensureDocumentMock(): void {
    if (globalAny.document) {
        return;
    }

    globalAny.document = {
        createElement: () => ({
            width: 64,
            height: 32,
            getContext: () => ({
                clearRect() {},
                fillText() {},
                strokeText() {},
                measureText: () => ({ width: 0 }),
                font: "",
                fillStyle: "",
                textAlign: "",
                textBaseline: "",
                lineWidth: 0,
                strokeStyle: "",
            }),
        }),
    };
}

export function createRef<T>(current: T): RefObject<T> {
    return { current };
}

export function createMutableRef<T>(current: T): MutableRefObject<T> {
    return { current };
}

export function createLiveStateDispatch<T>(ref: MutableRefObject<T>): Dispatch<SetStateAction<T>> {
    return ((update: SetStateAction<T>) => {
        ref.current = typeof update === "function"
            ? (update as (previous: T) => T)(ref.current)
            : update;
        return ref.current;
    }) as Dispatch<SetStateAction<T>>;
}

export function makeUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        id: 1,
        x: 5,
        z: 5,
        hp: 30,
        mana: 20,
        team: "player",
        target: null,
        aiEnabled: true,
        ...overrides,
    };
}

type UnitGroupOverrides = Partial<Omit<UnitGroup, "position">> & {
    position?: { x: number; y: number; z: number };
};

export function makeUnitGroup(overrides: UnitGroupOverrides = {}): UnitGroup {
    const {
        position: positionOverride,
        scale: scaleOverride,
        ...restOverrides
    } = overrides;
    const position = {
        x: positionOverride?.x ?? 5,
        y: positionOverride?.y ?? 0,
        z: positionOverride?.z ?? 5,
        set(x: number, y: number, z: number): void {
            this.x = x;
            this.y = y;
            this.z = z;
        },
    };

    const scale = {
        x: typeof scaleOverride === "object" && "x" in scaleOverride ? scaleOverride.x : 1,
        y: typeof scaleOverride === "object" && "y" in scaleOverride ? scaleOverride.y : 1,
        z: typeof scaleOverride === "object" && "z" in scaleOverride ? scaleOverride.z : 1,
        set(x: number, y: number, z: number): void {
            this.x = x;
            this.y = y;
            this.z = z;
        },
    };

    return {
        position,
        rotation: overrides.rotation ?? { x: 0, y: 0, z: 0 },
        scale,
        visible: overrides.visible ?? true,
        userData: overrides.userData ?? {},
        add: overrides.add ?? (() => undefined),
        remove: overrides.remove ?? (() => undefined),
        traverse: overrides.traverse ?? (() => undefined),
        ...restOverrides,
    } as unknown as UnitGroup;
}

export function makeScene(): Scene {
    return {
        add() {},
        remove() {},
    } as unknown as Scene;
}

interface SkillContextOptions {
    units: Unit[];
    unitsRef?: Record<number, UnitGroup>;
    scene?: Scene;
    addLog?: (text: string, color?: string) => void;
    sanctuaryTiles?: Map<string, SanctuaryTile>;
    acidTiles?: Map<string, AcidTile>;
    holyTiles?: Map<string, HolyTile>;
    smokeTiles?: Map<string, SmokeTile>;
    fireTiles?: Map<string, FireTile>;
}

export interface StatefulSkillContext {
    ctx: SkillExecutionContext;
    unitsStateRef: MutableRefObject<Unit[]>;
    unitsRef: MutableRefObject<Record<number, UnitGroup>>;
    projectilesRef: MutableRefObject<Projectile[]>;
    hitFlashRef: MutableRefObject<Record<number, number>>;
    damageTexts: MutableRefObject<DamageText[]>;
    swingAnimationsRef: MutableRefObject<SwingAnimation[]>;
    setUnits: Dispatch<SetStateAction<Unit[]>>;
}

export function createSkillContext(options: SkillContextOptions): StatefulSkillContext {
    const unitsStateRef = createMutableRef(options.units);
    const unitsRef = createMutableRef(options.unitsRef ?? {});
    const actionCooldownRef = createMutableRef<Record<number, number>>({});
    const projectilesRef = createMutableRef<Projectile[]>([]);
    const hitFlashRef = createMutableRef<Record<number, number>>({});
    const damageTexts = createMutableRef<DamageText[]>([]);
    const unitMeshRef = createRef<Record<number, Mesh>>({});
    const unitOriginalColorRef = createRef<Record<number, Color>>({});
    const swingAnimationsRef = createMutableRef<SwingAnimation[]>([]);
    const setUnits = createLiveStateDispatch(unitsStateRef);
    const setSkillCooldowns = ((): Dispatch<SetStateAction<Record<string, { end: number; duration: number }>>> => {
        const skillCooldownsRef = createMutableRef<Record<string, { end: number; duration: number }>>({});
        return createLiveStateDispatch(skillCooldownsRef);
    })();

    const ctx: SkillExecutionContext = {
        scene: options.scene ?? makeScene(),
        unitsStateRef,
        unitsRef,
        actionCooldownRef,
        projectilesRef,
        hitFlashRef,
        damageTexts,
        unitMeshRef,
        unitOriginalColorRef,
        swingAnimationsRef,
        setUnits,
        setSkillCooldowns,
        addLog: options.addLog ?? (() => undefined),
        defeatedThisFrame: new Set<number>(),
    };

    if (options.sanctuaryTiles) {
        ctx.sanctuaryTilesRef = createMutableRef(options.sanctuaryTiles);
    }
    if (options.acidTiles) {
        ctx.acidTilesRef = createMutableRef(options.acidTiles);
    }
    if (options.holyTiles) {
        ctx.holyTilesRef = createMutableRef(options.holyTiles);
    }
    if (options.smokeTiles) {
        ctx.smokeTilesRef = createMutableRef(options.smokeTiles);
    }
    if (options.fireTiles) {
        ctx.fireTilesRef = createMutableRef(options.fireTiles);
    }

    return {
        ctx,
        unitsStateRef,
        unitsRef,
        projectilesRef,
        hitFlashRef,
        damageTexts,
        swingAnimationsRef,
        setUnits,
    };
}
