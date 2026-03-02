import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.tsx";
import "./styles.css";
import "tippy.js/dist/tippy.css";
import { applyThemeColorSettings, createDefaultThemeColorSettings } from "./ui/themeColors";

const MapEditor = lazy(async () => {
    const mod = await import("./editor/MapEditor.tsx");
    return { default: mod.MapEditor };
});

// Use base path from vite config for deployed builds, empty for local dev
const basename = import.meta.env.BASE_URL;
applyThemeColorSettings(createDefaultThemeColorSettings());

createRoot(document.getElementById("root")!).render(
    <BrowserRouter basename={basename}>
        <Routes>
            <Route path="/" element={<App />} />
            <Route
                path="/editor"
                element={(
                    <Suspense fallback={<div style={{ padding: 24, color: "#d1d5db", background: "#111827", minHeight: "100vh" }}>Loading editor...</div>}>
                        <MapEditor />
                    </Suspense>
                )}
            />
        </Routes>
    </BrowserRouter>,
);
