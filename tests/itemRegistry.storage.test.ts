import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    ITEM_REGISTRY_STORAGE_KEY,
    clearStoredItemRegistry,
    getAllItemDefinitions,
    getItem,
    loadItemRegistryFromStorage,
    replaceItemRegistry,
    resetItemRegistryToDefaults,
} from "../src/game/items";

class LocalStorageMock {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.has(key) ? (this.values.get(key) ?? null) : null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    clear(): void {
        this.values.clear();
    }
}

const localStorageMock = new LocalStorageMock();

beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
        value: localStorageMock,
        configurable: true,
        writable: true,
    });
});

beforeEach(() => {
    localStorageMock.clear();
    resetItemRegistryToDefaults();
});

describe("item registry storage", () => {
    it("persists successful registry replacements to localStorage", () => {
        const next = getAllItemDefinitions();
        next.push({
            id: "storageTestConsumable",
            name: "Storage Test Consumable",
            description: "Used to verify registry storage persistence.",
            category: "consumable",
            effect: "heal",
            value: 11,
            cooldown: 2000,
        });

        const errors = replaceItemRegistry(next);
        expect(errors).toEqual([]);

        const raw = localStorage.getItem(ITEM_REGISTRY_STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw ?? "{}") as { items?: { id?: string }[] };
        const persistedIds = new Set((parsed.items ?? []).map(item => item.id));
        expect(persistedIds.has("storageTestConsumable")).toBe(true);
    });

    it("loads registry data from localStorage into runtime registries", () => {
        const saved = getAllItemDefinitions();
        saved.push({
            id: "loadedFromStorage",
            name: "Loaded From Storage",
            description: "Should appear after loading from storage.",
            category: "key",
            keyId: "loaded_from_storage_key",
        });

        localStorage.setItem(ITEM_REGISTRY_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: saved,
        }));

        const errors = loadItemRegistryFromStorage();
        expect(errors).toEqual([]);
        expect(getItem("loadedFromStorage")?.category).toBe("key");
    });

    it("clears invalid stored payloads when loading fails validation", () => {
        const invalid = getAllItemDefinitions().filter(item => item.id !== "fist");
        localStorage.setItem(ITEM_REGISTRY_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: invalid,
        }));

        const errors = loadItemRegistryFromStorage();

        expect(errors.length).toBeGreaterThan(0);
        expect(localStorage.getItem(ITEM_REGISTRY_STORAGE_KEY)).toBeNull();
    });

    it("clears structurally invalid stored payloads without throwing", () => {
        localStorage.setItem(ITEM_REGISTRY_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: [null],
        }));

        let errors: string[] = [];
        expect(() => {
            errors = loadItemRegistryFromStorage();
        }).not.toThrow();
        expect(errors.length).toBeGreaterThan(0);
        expect(localStorage.getItem(ITEM_REGISTRY_STORAGE_KEY)).toBeNull();
    });

    it("can clear stored registry explicitly", () => {
        localStorage.setItem(ITEM_REGISTRY_STORAGE_KEY, JSON.stringify({
            version: 1,
            items: getAllItemDefinitions(),
        }));

        clearStoredItemRegistry();

        expect(localStorage.getItem(ITEM_REGISTRY_STORAGE_KEY)).toBeNull();
    });
});
