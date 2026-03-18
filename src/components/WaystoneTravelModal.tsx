import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AreaId } from "../game/areas";
import { ModalShell } from "./ModalShell";

export interface WaystoneDestination {
    key: string;
    areaId: AreaId;
    areaName: string;
    areaFlavor: string;
    waystoneIndex: number;
    x: number;
    z: number;
    direction: "north" | "south" | "east" | "west";
    isCurrent: boolean;
}

interface WaystoneTravelModalProps {
    currentAreaName: string;
    destinations: WaystoneDestination[];
    onTravel: (destination: WaystoneDestination) => void;
    onClose: () => void;
}

function getPreferredDestinationKey(destinations: WaystoneDestination[]): string | null {
    const firstTravelTarget = destinations.find(destination => !destination.isCurrent);
    return firstTravelTarget?.key ?? destinations[0]?.key ?? null;
}

function WaystoneImageSlot() {
    return <div className="waystone-preview-placeholder">image here</div>;
}

export function WaystoneTravelModal({
    currentAreaName,
    destinations,
    onTravel,
    onClose,
}: WaystoneTravelModalProps) {
    const [selectedKey, setSelectedKey] = useState<string | null>(() => getPreferredDestinationKey(destinations));
    const resolvedSelectedKey = useMemo(() => {
        if (selectedKey && destinations.some(destination => destination.key === selectedKey)) {
            return selectedKey;
        }

        return getPreferredDestinationKey(destinations);
    }, [destinations, selectedKey]);

    const selectedDestination = useMemo(() => {
        if (!resolvedSelectedKey) {
            return destinations[0] ?? null;
        }
        return destinations.find(destination => destination.key === resolvedSelectedKey) ?? destinations[0] ?? null;
    }, [destinations, resolvedSelectedKey]);

    const availableDestinations = useMemo(
        () => destinations.filter(destination => !destination.isCurrent),
        [destinations]
    );

    return (
        <ModalShell onClose={onClose} contentClassName="waystone-modal" closeOnEscape>
            <div className="help-header">
                <div>
                    <h2 className="help-title">Waystone Network</h2>
                    <div className="waystone-modal-subtitle">Activated waystones linked to {currentAreaName}.</div>
                </div>
                <div className="close-btn" onClick={onClose}><X size={18} /></div>
            </div>

            <div className="waystone-modal-layout">
                <div className="waystone-destination-list">
                    {destinations.map(destination => {
                        const disabled = destination.isCurrent;
                        return (
                            <button
                                key={destination.key}
                                type="button"
                                className={`waystone-destination-btn${resolvedSelectedKey === destination.key ? " selected" : ""}${disabled ? " current" : ""}`}
                                onClick={() => setSelectedKey(destination.key)}
                            >
                                <div className="waystone-destination-name">{destination.areaName}</div>
                                <div className="waystone-destination-status">
                                    {disabled ? "Current location" : "Activated"}
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="waystone-preview-panel">
                    <div className="waystone-preview-frame">
                        <WaystoneImageSlot />
                    </div>
                    {selectedDestination && (
                        <>
                            <div className="waystone-preview-title">{selectedDestination.areaName}</div>
                            <div className="waystone-preview-flavor">{selectedDestination.areaFlavor}</div>
                        </>
                    )}
                    {availableDestinations.length === 0 && (
                        <div className="waystone-preview-note">No other waystones have been activated yet.</div>
                    )}
                    {selectedDestination && !selectedDestination.isCurrent && (
                        <button
                            type="button"
                            className="waystone-travel-btn"
                            onClick={() => onTravel(selectedDestination)}
                        >
                            Travel
                        </button>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}
