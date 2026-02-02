import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.tsx";
import { MapEditor } from "./editor/MapEditor.tsx";
import "./styles.css";
import "tippy.js/dist/tippy.css";

// Use base path from vite config for deployed builds, empty for local dev
const basename = import.meta.env.BASE_URL;

createRoot(document.getElementById("root")!).render(
    <BrowserRouter basename={basename}>
        <Routes>
            <Route path="/" element={<App />} />
            <Route path="/editor" element={<MapEditor />} />
        </Routes>
    </BrowserRouter>,
);
