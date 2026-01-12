interface HelpModalProps {
    onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "linear-gradient(180deg, #1e1e2e 0%, #12121a 100%)",
                    border: "2px solid #3d3d5c",
                    borderRadius: 8,
                    padding: 24,
                    maxWidth: 480,
                    fontFamily: "monospace",
                    color: "#ddd"
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: "#fff" }}>Controls</h2>
                    <div onClick={onClose} style={{ cursor: "pointer", fontSize: 20, opacity: 0.7 }}>×</div>
                </div>

                <Section title="Camera">
                    <Item keys="WASD / Arrow Keys" desc="Pan camera" />
                    <Item keys="Right-click drag" desc="Pan camera" />
                    <Item keys="Scroll wheel" desc="Zoom in/out" />
                </Section>

                <Section title="Selection & Movement">
                    <Item keys="Left-click" desc="Select unit" />
                    <Item keys="Shift + click" desc="Add to selection" />
                    <Item keys="Click-drag" desc="Box select units" />
                    <Item keys="Left-click ground" desc="Move selected units" />
                    <Item keys="Left-click enemy" desc="Attack with selected units" />
                </Section>

                <Section title="Combat & Skills">
                    <Item keys="Space" desc="Pause / Unpause" />
                    <Item keys="Click skill in panel" desc="Enter targeting mode" />
                    <Item keys="Left-click to cast" desc="Cast at target location" />
                    <Item keys="Escape / Right-click" desc="Cancel targeting" />
                </Section>

                <div style={{ marginTop: 16, padding: 12, background: "#1a1a2a", borderRadius: 4, fontSize: 12 }}>
                    <div style={{ color: "#f59e0b", marginBottom: 8, fontWeight: "bold" }}>Tips</div>
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6, color: "#aaa" }}>
                        <li>Pause to queue actions - they execute on unpause</li>
                        <li>Skills share a cooldown with basic attacks</li>
                        <li>Toggle <span style={{ color: "#4ade80" }}>Tactics</span> to enable/disable auto-attack</li>
                        <li>Fireball has friendly fire - aim carefully!</li>
                    </ul>
                </div>

                <div style={{ marginTop: 16, textAlign: "center" }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: "#3b82f6",
                            border: "none",
                            borderRadius: 4,
                            padding: "8px 24px",
                            color: "#fff",
                            fontFamily: "monospace",
                            fontSize: 12,
                            cursor: "pointer"
                        }}
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase" }}>{title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
        </div>
    );
}

function Item({ keys, desc }: { keys: string; desc: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
            <span style={{ background: "#2a2a3e", padding: "4px 8px", borderRadius: 4, color: "#fff", minWidth: 140 }}>{keys}</span>
            <span style={{ color: "#aaa" }}>{desc}</span>
        </div>
    );
}
