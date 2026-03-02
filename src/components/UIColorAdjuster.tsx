import { useLayoutEffect, useMemo, useState, type FormEvent } from "react";
import {
    UI_THEME_COLOR_TOKENS,
    type ThemeColorSettings,
    type ThemeColorTokenId,
    applyThemeColorSettings,
    buildThemeCssBlock,
    buildThemeJson,
    createDefaultThemeColorSettings,
    hslaToCss,
} from "../ui/themeColors";

type ThemeExportMode = "css" | "json";

const SLIDER_STEP: Record<"h" | "s" | "l" | "a", number> = {
    h: 1,
    s: 1,
    l: 1,
    a: 0.01,
};

function formatChannel(channel: "h" | "s" | "l" | "a", value: number): string {
    if (channel === "a") return value.toFixed(2);
    return `${Math.round(value)}`;
}

export function UIColorAdjuster() {
    const [expanded, setExpanded] = useState(false);
    const [settings, setSettings] = useState<ThemeColorSettings>(() => createDefaultThemeColorSettings());
    const [exportMode, setExportMode] = useState<ThemeExportMode>("css");
    const [copied, setCopied] = useState(false);

    useLayoutEffect(() => {
        applyThemeColorSettings(settings);
    }, [settings]);

    const exportText = useMemo(() => {
        return exportMode === "css"
            ? buildThemeCssBlock(settings)
            : buildThemeJson(settings);
    }, [exportMode, settings]);

    const updateChannel = (tokenId: ThemeColorTokenId, channel: "h" | "s" | "l" | "a", nextValue: number): void => {
        setSettings(prev => ({
            ...prev,
            [tokenId]: {
                ...prev[tokenId],
                [channel]: nextValue,
            },
        }));
    };

    const handleSliderInput = (tokenId: ThemeColorTokenId, channel: "h" | "s" | "l" | "a") => (event: FormEvent<HTMLInputElement>): void => {
        updateChannel(tokenId, channel, parseFloat(event.currentTarget.value));
    };

    const resetDefaults = (): void => {
        const defaults = createDefaultThemeColorSettings();
        setSettings(defaults);
        applyThemeColorSettings(defaults);
    };

    const copyExport = (): void => {
        const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
        if (!clipboard || typeof clipboard.writeText !== "function") return;
        void clipboard.writeText(exportText).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => {
            setCopied(false);
        });
    };

    return (
        <div className="hud-debug-group">
            <div className="hud-debug-group-header">
                <div className="hud-debug-label">UI Color Adjuster</div>
                <button
                    className="btn btn-tiny hud-debug-expand-btn"
                    onClick={() => setExpanded(prev => !prev)}
                >
                    {expanded ? "Hide" : "Show"}
                </button>
            </div>
            {expanded && (
                <div className="hud-theme-adjuster">
                    <div className="hud-theme-grid">
                        {UI_THEME_COLOR_TOKENS.map(token => {
                            const value = settings[token.id];
                            return (
                                <div key={token.id} className="hud-theme-token">
                                    <div className="hud-theme-token-header">
                                        <div
                                            className="hud-theme-swatch"
                                            style={{ background: hslaToCss(value) }}
                                            title={hslaToCss(value)}
                                        />
                                        <div className="hud-theme-token-meta">
                                            <div className="hud-theme-token-label">{token.label}</div>
                                            <div className="hud-theme-token-desc">{token.description}</div>
                                        </div>
                                    </div>
                                    <div className="hud-theme-token-sliders">
                                        {(["h", "s", "l", "a"] as const).map(channel => (
                                            <label key={`${token.id}-${channel}`} className="hud-theme-slider">
                                                <span className="hud-theme-slider-label">
                                                    {channel.toUpperCase()} {formatChannel(channel, value[channel])}
                                                </span>
                                                <input
                                                    type="range"
                                                    min={channel === "h" ? 0 : 0}
                                                    max={channel === "h" ? 360 : channel === "a" ? 1 : 100}
                                                    step={SLIDER_STEP[channel]}
                                                    value={value[channel]}
                                                    onInput={handleSliderInput(token.id, channel)}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="hud-theme-actions">
                        <button className="btn btn-tiny" onClick={resetDefaults}>Reset Defaults</button>
                        <button
                            className={`btn btn-tiny ${exportMode === "css" ? "btn-active" : ""}`}
                            onClick={() => setExportMode("css")}
                        >
                            CSS Export
                        </button>
                        <button
                            className={`btn btn-tiny ${exportMode === "json" ? "btn-active" : ""}`}
                            onClick={() => setExportMode("json")}
                        >
                            JSON Export
                        </button>
                        <button className="btn btn-tiny" onClick={copyExport}>{copied ? "Copied" : "Copy Export"}</button>
                    </div>

                    <textarea className="hud-debug-output hud-theme-export" readOnly value={exportText} />
                </div>
            )}
        </div>
    );
}
