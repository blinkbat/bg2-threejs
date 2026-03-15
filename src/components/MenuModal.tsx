import { useState } from "react";
import {
    Save,
    FolderOpen,
    RotateCcw,
    Keyboard,
    BookOpen,
    Volume2,
    VolumeX,
    HelpCircle,
    X
} from "lucide-react";
import { toggleMute, isMuted } from "../audio";

interface MenuModalProps {
    onClose: () => void;
    onShowControls: () => void;
    onShowHelp: () => void;
    onShowGlossary: () => void;
    onRestart: () => void;
    onSaveClick: () => void;
    onLoadClick: () => void;
}

export function MenuModal({
    onClose,
    onShowControls,
    onShowHelp,
    onShowGlossary,
    onRestart,
    onSaveClick,
    onLoadClick
}: MenuModalProps) {
    const [muted, setMuted] = useState(isMuted());

    const handleToggleMute = () => {
        const newMuted = toggleMute();
        setMuted(newMuted);
    };

    const handleSave = () => {
        onSaveClick();
        onClose();
    };

    const handleLoad = () => {
        onLoadClick();
        onClose();
    };

    const handleControls = () => {
        onShowControls();
        onClose();
    };

    const handleHelp = () => {
        onShowHelp();
        onClose();
    };

    const handleGlossary = () => {
        onShowGlossary();
        onClose();
    };

    const handleRestart = () => {
        if (confirm("Are you sure you want to restart? All unsaved progress will be lost.")) {
            onRestart();
            onClose();
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content menu-modal" onClick={e => e.stopPropagation()}>
                <div className="help-header">
                    <h2 className="help-title">Menu</h2>
                    <div className="close-btn" onClick={onClose}><X size={18} /></div>
                </div>

                {/* Game Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Game</div>
                    <div className="menu-buttons">
                        <button className="menu-btn" onClick={handleSave}>
                            <Save size={18} />
                            <span>Save Game</span>
                        </button>
                        <button className="menu-btn" onClick={handleLoad}>
                            <FolderOpen size={18} />
                            <span>Load Game</span>
                        </button>
                        <button className="menu-btn menu-btn-danger" onClick={handleRestart}>
                            <RotateCcw size={18} />
                            <span>Restart</span>
                        </button>
                    </div>
                </div>

                {/* Info Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Info</div>
                    <div className="menu-buttons">
                        <button className="menu-btn" onClick={handleHelp}>
                            <HelpCircle size={18} />
                            <span>Help</span>
                        </button>
                        <button className="menu-btn" onClick={handleGlossary}>
                            <BookOpen size={18} />
                            <span>Glossary</span>
                        </button>
                    </div>
                </div>

                {/* Settings Section */}
                <div className="menu-section">
                    <div className="menu-section-title">Settings</div>
                    <div className="menu-buttons">
                        <button className={`menu-btn ${muted ? "active" : ""}`} onClick={handleToggleMute}>
                            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            <span>{muted ? "Unmute" : "Mute"}</span>
                        </button>
                        <button className="menu-btn" onClick={handleControls}>
                            <Keyboard size={18} />
                            <span>Controls</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
