/**
 * Site plan: the property in top view, to scale (docs/PLAN_LAGEPLAN.md).
 *
 * Coordinates are plan coordinates in metres: x to the right, y downwards,
 * like the background image and the screen. Where north is relative to "up"
 * on the plan is stored once in `SiteSettings.northDeg`; anything that needs
 * compass directions (shadows) converts with it.
 *
 * Extension rules: new fields are optional with a default, records carry a
 * `schemaVersion`, and nothing may drop fields it does not know.
 */

export const SITE_SCHEMA_VERSION = 1;

/** The user-facing layers; elements live in exactly one of them. */
export const SITE_LAYERS = [
  "background",
  "surfaces",
  "buildings",
  "beds",
  "woody",
  "lines",
  "objects",
  "labels",
] as const;
export type SiteLayerId = (typeof SITE_LAYERS)[number];

export interface SiteLayerState {
  visible: boolean;
  locked: boolean;
}

export interface SiteBackground {
  /** Blob id: IndexedDB locally, /api/blobs/:id on the backend. */
  imageId: string;
  /** Size of the stored image in pixels. */
  widthPx: number;
  heightPx: number;
  /** Position of the image centre on the plan, in metres. */
  x: number;
  y: number;
  /** Clockwise, in degrees. */
  rotationDeg: number;
  /** From the calibration: how many metres one image pixel covers. */
  metersPerPixel: number;
  /** 0–1 */
  opacity: number;
  locked: boolean;
  /** Set once the user calibrated the scale; until then metersPerPixel is a guess. */
  calibrated?: boolean;
}

/** The single settings record of the site plan. */
export interface SiteSettings {
  id: "site";
  /** Clockwise angle from "up" on the plan to north; 0 = north is up. */
  northDeg: number;
  background?: SiteBackground;
  layers?: Partial<Record<SiteLayerId, SiteLayerState>>;
  updatedAt: string;
  schemaVersion: number;
}

export type SiteShape =
  | { type: "polygon"; points: number[] }
  | { type: "rect"; cx: number; cy: number; w: number; h: number; rotationDeg: number }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "polyline"; points: number[]; width: number };

/**
 * Common fields of every element. Kind-specific fields (species, usage,
 * material, …) are added per kind in phase 2 via the element registry.
 */
export interface SiteElement {
  id: string;
  /** Key in the element registry, e.g. "tree", "building", "surface". */
  kind: string;
  /** Sub-kind from the registry (greenhouse, wall); the kind's default when unset. */
  variant?: string;
  layer: SiteLayerId;
  shape: SiteShape;
  status?: "existing" | "planned" | "remove";
  plannedYear?: number;
  name?: string;
  notes?: string;
  heightM?: number;
  /** Reserved for terrain (later). */
  baseElevationM?: number;
  z?: number;
  locked?: boolean;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  [extra: string]: unknown;
}

export function defaultSiteSettings(): SiteSettings {
  return {
    id: "site",
    northDeg: 0,
    updatedAt: new Date(0).toISOString(),
    schemaVersion: SITE_SCHEMA_VERSION,
  };
}

export function layerState(settings: SiteSettings, layer: SiteLayerId): SiteLayerState {
  return settings.layers?.[layer] ?? { visible: true, locked: false };
}
