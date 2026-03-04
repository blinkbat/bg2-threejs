export interface HslaColor {
    h: number;
    s: number;
    l: number;
    a: number;
}

export type ThemeColorTokenId =
    | "surface"
    | "surfaceAlt"
    | "surfaceHover"
    | "surfaceActive"
    | "glass"
    | "border"
    | "borderStrong"
    | "borderSoft"
    | "text"
    | "textSecondary"
    | "textMuted"
    | "textDim"
    | "textFaint"
    | "accentPrimary"
    | "accentSuccess"
    | "accentWarning"
    | "accentGold"
    | "accentDanger"
    | "accentArcane"
    | "accentCyan";

export interface ThemeColorToken {
    id: ThemeColorTokenId;
    cssVar: string;
    label: string;
    description: string;
    defaults: HslaColor;
}

export type ThemeColorSettings = Record<ThemeColorTokenId, HslaColor>;

export const UI_THEME_COLOR_TOKENS: readonly ThemeColorToken[] = [
    { id: "surface", cssVar: "--ui-color-surface", label: "Surface", description: "Primary panel backgrounds", defaults: { h: 240, s: 24, l: 14, a: 1 } },
    { id: "surfaceAlt", cssVar: "--ui-color-surface-alt", label: "Surface Alt", description: "Darker panel variants", defaults: { h: 240, s: 24, l: 7, a: 1 } },
    { id: "surfaceHover", cssVar: "--ui-color-surface-hover", label: "Surface Hover", description: "Hover states for slots/cards", defaults: { h: 240, s: 20, l: 19, a: 1 } },
    { id: "surfaceActive", cssVar: "--ui-color-surface-active", label: "Surface Active", description: "Pressed/cooldown states", defaults: { h: 240, s: 21, l: 11, a: 1 } },
    { id: "glass", cssVar: "--ui-color-glass", label: "Glass", description: "HUD and light panel overlays", defaults: { h: 240, s: 25, l: 8, a: 0.7 } },
    { id: "border", cssVar: "--ui-color-border", label: "Border", description: "Core border color", defaults: { h: 0, s: 0, l: 27, a: 1 } },
    { id: "borderStrong", cssVar: "--ui-color-border-strong", label: "Border Strong", description: "Hover/strong border color", defaults: { h: 0, s: 0, l: 33, a: 1 } },
    { id: "borderSoft", cssVar: "--ui-color-border-soft", label: "Border Soft", description: "Subtle translucent borders", defaults: { h: 0, s: 0, l: 100, a: 0.1 } },
    { id: "text", cssVar: "--ui-color-text", label: "Text", description: "Primary text", defaults: { h: 0, s: 0, l: 100, a: 1 } },
    { id: "textSecondary", cssVar: "--ui-color-text-secondary", label: "Text Secondary", description: "General text on dark panels", defaults: { h: 0, s: 0, l: 87, a: 1 } },
    { id: "textMuted", cssVar: "--ui-color-text-muted", label: "Text Muted", description: "Labels and secondary hints", defaults: { h: 0, s: 0, l: 67, a: 1 } },
    { id: "textDim", cssVar: "--ui-color-text-dim", label: "Text Dim", description: "Low-priority captions", defaults: { h: 0, s: 0, l: 53, a: 1 } },
    { id: "textFaint", cssVar: "--ui-color-text-faint", label: "Text Faint", description: "Disabled/subdued text", defaults: { h: 0, s: 0, l: 40, a: 1 } },
    { id: "accentPrimary", cssVar: "--ui-color-accent-primary", label: "Accent Primary", description: "Blue interactive highlights", defaults: { h: 217, s: 91, l: 60, a: 1 } },
    { id: "accentSuccess", cssVar: "--ui-color-accent-success", label: "Accent Success", description: "Green states and readiness", defaults: { h: 142, s: 71, l: 45, a: 1 } },
    { id: "accentWarning", cssVar: "--ui-color-accent-warning", label: "Accent Warning", description: "Amber warnings/queued states", defaults: { h: 38, s: 92, l: 50, a: 1 } },
    { id: "accentGold", cssVar: "--ui-color-accent-gold", label: "Accent Gold", description: "Gold rarity/currency cues", defaults: { h: 48, s: 89, l: 50, a: 1 } },
    { id: "accentDanger", cssVar: "--ui-color-accent-danger", label: "Accent Danger", description: "Damage/critical warnings", defaults: { h: 0, s: 84, l: 60, a: 1 } },
    { id: "accentArcane", cssVar: "--ui-color-accent-arcane", label: "Accent Arcane", description: "Purple arcane/status accents", defaults: { h: 282, s: 44, l: 47, a: 1 } },
    { id: "accentCyan", cssVar: "--ui-color-accent-cyan", label: "Accent Cyan", description: "Mana/cooldown callouts", defaults: { h: 205, s: 100, l: 68, a: 1 } },
];

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

export function createDefaultThemeColorSettings(): ThemeColorSettings {
    return UI_THEME_COLOR_TOKENS.reduce((acc, token) => {
        acc[token.id] = { ...token.defaults };
        return acc;
    }, {} as ThemeColorSettings);
}

export function hslaToCss(value: HslaColor): string {
    const a = Math.round(value.a * 1000) / 1000;
    return `hsla(${Math.round(value.h)}, ${Math.round(value.s)}%, ${Math.round(value.l)}%, ${a})`;
}

function setDerivedThemeVars(settings: ThemeColorSettings, root: CSSStyleDeclaration): void {
    const surface = settings.surface;
    const surfaceAlt = settings.surfaceAlt;
    const surfaceHover = settings.surfaceHover;
    const primary = settings.accentPrimary;
    const success = settings.accentSuccess;
    const warning = settings.accentWarning;
    const danger = settings.accentDanger;
    const arcane = settings.accentArcane;
    const borderSoft = settings.borderSoft;
    const border = settings.border;

    root.setProperty("--ui-color-accent-primary-bright", hslaToCss({ ...primary, l: clamp(primary.l + 12, 0, 100) }));
    root.setProperty("--ui-color-accent-primary-soft", hslaToCss({ ...primary, a: 0.2 }));
    root.setProperty("--ui-color-accent-primary-border", hslaToCss({ ...primary, a: 0.4 }));

    root.setProperty("--ui-color-accent-success-bright", hslaToCss({ ...success, l: clamp(success.l + 12, 0, 100) }));
    root.setProperty("--ui-color-accent-success-soft", hslaToCss({ ...success, a: 0.2 }));
    root.setProperty("--ui-color-accent-success-border", hslaToCss({ ...success, a: 0.3 }));

    root.setProperty("--ui-color-accent-warning-soft", hslaToCss({ ...warning, a: 0.1 }));
    root.setProperty("--ui-color-accent-danger-soft", hslaToCss({ ...danger, a: 0.15 }));
    root.setProperty("--ui-color-accent-arcane-soft", hslaToCss({ ...arcane, a: 0.15 }));
    root.setProperty("--ui-color-accent-arcane-border", hslaToCss({ ...arcane, a: 0.3 }));
    root.setProperty("--ui-color-border-soft-strong", hslaToCss({ ...borderSoft, a: clamp(borderSoft.a * 2, 0, 1) }));
    root.setProperty("--ui-color-border-muted", hslaToCss({ ...borderSoft, a: clamp(borderSoft.a * 1.5, 0, 1) }));
    root.setProperty("--ui-color-border-muted-strong", hslaToCss({ ...borderSoft, a: clamp(borderSoft.a * 2.5, 0, 1) }));

    root.setProperty("--ui-color-surface-elevated", hslaToCss({ ...surface, a: 0.8 }));
    root.setProperty("--ui-color-surface-elevated-hover", hslaToCss({ ...surfaceHover, a: 0.9 }));
    root.setProperty("--ui-color-surface-muted", hslaToCss({ ...borderSoft, a: 0.05 }));
    root.setProperty("--ui-color-surface-muted-hover", hslaToCss({ ...borderSoft, a: 0.1 }));
    root.setProperty("--ui-color-surface-muted-active", hslaToCss({ ...borderSoft, a: 0.08 }));
    root.setProperty("--ui-color-panel-glass", hslaToCss(settings.glass));

    root.setProperty("--ui-color-selection-border", hslaToCss(success));
    root.setProperty("--ui-color-selection-fill", hslaToCss({ ...success, a: 0.2 }));

    root.setProperty("--ui-color-tooltip-bg", hslaToCss({ ...surfaceAlt, a: 0.95 }));
    root.setProperty("--ui-color-overlay-soft", hslaToCss({ ...surfaceAlt, l: clamp(surfaceAlt.l - 4, 0, 100), a: 0.3 }));
    root.setProperty("--ui-color-overlay", hslaToCss({ ...surfaceAlt, l: clamp(surfaceAlt.l - 6, 0, 100), a: 0.5 }));
    root.setProperty("--ui-color-overlay-strong", hslaToCss({ ...surfaceAlt, l: clamp(surfaceAlt.l - 8, 0, 100), a: 0.8 }));

    root.setProperty("--ui-color-shadow-soft", hslaToCss({ ...border, l: 0, s: 0, a: 0.35 }));
    root.setProperty("--ui-color-shadow", hslaToCss({ ...border, l: 0, s: 0, a: 0.6 }));
    root.setProperty("--ui-color-shadow-strong", hslaToCss({ ...border, l: 0, s: 0, a: 0.8 }));

    root.setProperty("--ui-border-color", hslaToCss(border));
}

export function applyThemeColorSettings(settings: ThemeColorSettings): void {
    const rootElement = typeof document !== "undefined" ? document.documentElement : null;
    if (!rootElement) return;
    for (const token of UI_THEME_COLOR_TOKENS) {
        rootElement.style.setProperty(token.cssVar, hslaToCss(settings[token.id]));
    }
    setDerivedThemeVars(settings, rootElement.style);
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

export function buildThemeCssBlock(settings: ThemeColorSettings): string {
    const lines = UI_THEME_COLOR_TOKENS.map(token => `    ${token.cssVar}: ${hslaToCss(settings[token.id])};`);
    return `:root {\n${lines.join("\n")}\n}`;
}

export function buildThemeJson(settings: ThemeColorSettings): string {
    const compact = UI_THEME_COLOR_TOKENS.reduce((acc, token) => {
        const value = settings[token.id];
        acc[token.id] = {
            h: Number(formatNumber(value.h)),
            s: Number(formatNumber(value.s)),
            l: Number(formatNumber(value.l)),
            a: Number(formatNumber(value.a)),
        };
        return acc;
    }, {} as Record<ThemeColorTokenId, HslaColor>);
    return JSON.stringify(compact, null, 2);
}
