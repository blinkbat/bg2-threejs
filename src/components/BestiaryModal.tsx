import { useMemo, type CSSProperties } from "react";
import type { EnemyType } from "../core/types";
import { ENEMY_STATS, getMonsterTypeLabel } from "../game/enemyStats";
import { loadKnownEnemies } from "../hooks/bestiaryStorage";
import { getEnemySpriteTintHex } from "../rendering/scene/units";
import { getEnemyPortrait } from "./enemyPortraitRegistry";
import { ModalShell } from "./ModalShell";

interface BestiaryModalProps {
    onClose: () => void;
}

interface BestiaryEntry {
    enemyType: EnemyType;
    name: string;
    typeLabel: string;
    portrait: string | null;
    tintHex: string | null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
    };
}

function buildPortraitBackground(tintHex: string | null): string {
    const rgb = tintHex ? hexToRgb(tintHex) : null;
    if (!rgb) return "var(--ui-color-surface)";
    const luma = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    const darkenFactor = 0.34;
    const desaturateMix = 0.4;
    const gray = luma;
    const mixed = {
        r: rgb.r * (1 - desaturateMix) + gray * desaturateMix,
        g: rgb.g * (1 - desaturateMix) + gray * desaturateMix,
        b: rgb.b * (1 - desaturateMix) + gray * desaturateMix,
    };
    const r = Math.round(mixed.r * darkenFactor);
    const g = Math.round(mixed.g * darkenFactor);
    const b = Math.round(mixed.b * darkenFactor);
    return `rgb(${r}, ${g}, ${b})`;
}

function buildEntries(known: ReadonlySet<EnemyType>): BestiaryEntry[] {
    const entries: BestiaryEntry[] = [];
    for (const enemyType of known) {
        const stats = ENEMY_STATS[enemyType];
        if (!stats || stats.tier === "npc") continue;
        entries.push({
            enemyType,
            name: stats.name,
            typeLabel: getMonsterTypeLabel(stats.monsterType),
            portrait: getEnemyPortrait(enemyType),
            tintHex: getEnemySpriteTintHex(enemyType),
        });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return entries;
}

export function BestiaryModal({ onClose }: BestiaryModalProps) {
    const entries = useMemo(() => buildEntries(loadKnownEnemies()), []);

    return (
        <ModalShell onClose={onClose} contentClassName="help-modal bestiary-modal" closeOnEscape>
            <div className="help-header">
                <h2 className="help-title">Bestiary</h2>
                <div className="close-btn" onClick={onClose}>&times;</div>
            </div>

            <div className="help-copy-layout bestiary-layout">
                <p className="help-copy-text bestiary-intro">
                    Foes you have defeated. New entries appear here as you encounter and slay them.
                </p>

                {entries.length === 0 ? (
                    <p className="help-copy-text bestiary-empty">No foes recorded yet.</p>
                ) : (
                    <div className="bestiary-grid">
                        {entries.map(entry => {
                            const portraitStyle: CSSProperties = {
                                background: buildPortraitBackground(entry.tintHex),
                            };
                            if (entry.portrait && entry.tintHex) {
                                (portraitStyle as Record<string, string>)["--bestiary-sprite"] = `url(${entry.portrait})`;
                                (portraitStyle as Record<string, string>)["--bestiary-tint"] = entry.tintHex;
                            }
                            return (
                                <div key={entry.enemyType} className="bestiary-card">
                                    <div className="bestiary-portrait" style={portraitStyle}>
                                        {entry.portrait ? (
                                            <>
                                                {entry.tintHex && <div className="bestiary-portrait-tint-bg" aria-hidden />}
                                                <img src={entry.portrait} alt={entry.name} />
                                            </>
                                        ) : (
                                            <div className="bestiary-portrait-missing">?</div>
                                        )}
                                    </div>
                                    <div className="bestiary-card-body">
                                        <div className="bestiary-name">{entry.name}</div>
                                        <div className="bestiary-type">{entry.typeLabel}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="help-footer">
                <button className="btn btn-primary mono help-confirm-btn" onClick={onClose}>
                    Got It
                </button>
            </div>
        </ModalShell>
    );
}
