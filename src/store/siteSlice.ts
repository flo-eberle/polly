import type { StateCreator } from "zustand";
import {
  SITE_SCHEMA_VERSION,
  defaultSiteSettings,
  layerState,
  type SiteBackground,
  type SiteElement,
  type SiteLayerId,
  type SiteLayerState,
  type SiteSettings,
} from "@/types/site";

export interface SiteSlice {
  siteSettings: SiteSettings;
  siteElements: SiteElement[];
  setNorthDeg: (deg: number) => void;
  /** Replaces the background; `undefined` removes it. */
  setSiteBackground: (background: SiteBackground | undefined) => void;
  updateSiteBackground: (updates: Partial<SiteBackground>) => void;
  setSiteLayer: (layer: SiteLayerId, updates: Partial<SiteLayerState>) => void;
  addSiteElement: (element: Omit<SiteElement, "id" | "createdAt" | "updatedAt" | "schemaVersion">) => string;
  updateSiteElement: (id: string, updates: Partial<SiteElement>) => void;
  deleteSiteElement: (id: string) => void;
}

/** Normalises any angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const now = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `site-${crypto.randomUUID()}`
    : `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const createSiteSlice: StateCreator<SiteSlice> = (set) => {
  const patchSettings = (fn: (s: SiteSettings) => Partial<SiteSettings>) =>
    set((state) => ({ siteSettings: { ...state.siteSettings, ...fn(state.siteSettings), updatedAt: now() } }));

  return {
    siteSettings: defaultSiteSettings(),
    siteElements: [],

    setNorthDeg: (deg) => patchSettings(() => ({ northDeg: normalizeDeg(deg) })),

    setSiteBackground: (background) => patchSettings(() => ({ background })),

    updateSiteBackground: (updates) =>
      patchSettings((s) =>
        s.background
          ? {
              background: {
                ...s.background,
                ...updates,
                ...(updates.rotationDeg !== undefined ? { rotationDeg: normalizeDeg(updates.rotationDeg) } : {}),
              },
            }
          : {},
      ),

    setSiteLayer: (layer, updates) =>
      patchSettings((s) => ({ layers: { ...s.layers, [layer]: { ...layerState(s, layer), ...updates } } })),

    addSiteElement: (element) => {
      const id = newId();
      const stamp = now();
      set((state) => ({
        siteElements: [
          ...state.siteElements,
          { ...element, id, createdAt: stamp, updatedAt: stamp, schemaVersion: SITE_SCHEMA_VERSION } as SiteElement,
        ],
      }));
      return id;
    },

    updateSiteElement: (id, updates) =>
      set((state) => ({
        siteElements: state.siteElements.map((e) => (e.id === id ? { ...e, ...updates, id, updatedAt: now() } : e)),
      })),

    deleteSiteElement: (id) => set((state) => ({ siteElements: state.siteElements.filter((e) => e.id !== id) })),
  };
};
