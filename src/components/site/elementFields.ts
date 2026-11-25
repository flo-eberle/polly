import type { SiteElement, SiteStatus, SiteUsage } from "@/types/site";
import { elementType } from "./elementTypes";

/**
 * Field definitions for the properties panel. The panel renders whatever the
 * list for a kind contains, so a new attribute is one entry here plus its
 * translation; nothing else changes.
 *
 * Values live directly on the element (`element[key]`). Fields that edit the
 * shape instead (crown diameter, line width) bring their own get/set.
 */

export interface FieldOption {
  value: string;
  labelKey: string;
}

interface FieldBase {
  key: string;
  labelKey: string;
  hintKey?: string;
  /** Shown only when this returns true, e.g. the planned year only for planned elements. */
  visible?: (element: SiteElement) => boolean;
  get?: (element: SiteElement) => unknown;
  set?: (element: SiteElement, value: unknown) => Partial<SiteElement>;
}

export type FieldDef =
  | (FieldBase & { type: "text" })
  | (FieldBase & { type: "textarea" })
  | (FieldBase & { type: "number"; unit?: "m"; min?: number; max?: number; step?: number })
  | (FieldBase & { type: "year" })
  | (FieldBase & { type: "select"; options: FieldOption[]; allowEmpty?: boolean })
  | (FieldBase & { type: "multi"; options: FieldOption[] })
  | (FieldBase & { type: "variant" });

export const STATUSES: SiteStatus[] = ["existing", "planned", "remove"];
export const USAGES: SiteUsage[] = ["harvest", "ornamental", "privacy", "wildlife"];

const opts = (prefix: string, values: string[]): FieldOption[] =>
  values.map((value) => ({ value, labelKey: `${prefix}.${value}` }));

// --- Common fields ------------------------------------------------------------

const NAME: FieldDef = { key: "name", type: "text", labelKey: "site.fields.name" };
const VARIANT: FieldDef = { key: "variant", type: "variant", labelKey: "site.fields.variant" };
const STATUS: FieldDef = {
  key: "status",
  type: "select",
  labelKey: "site.fields.status",
  options: opts("site.status", STATUSES),
  get: (el) => el.status ?? "existing",
};
const PLANNED_YEAR: FieldDef = {
  key: "plannedYear",
  type: "year",
  labelKey: "site.fields.plannedYear",
  visible: (el) => el.status === "planned",
};
const HEIGHT: FieldDef = { key: "heightM", type: "number", unit: "m", min: 0, max: 100, step: 0.1, labelKey: "site.fields.height", hintKey: "site.fields.heightHint" };
const NOTES: FieldDef = { key: "notes", type: "textarea", labelKey: "site.fields.notes" };

// --- Shape-backed fields -------------------------------------------------------

const CROWN: FieldDef = {
  key: "crownDiameterM",
  type: "number",
  unit: "m",
  min: 0.1,
  max: 50,
  step: 0.1,
  labelKey: "site.fields.crownDiameter",
  get: (el) => (el.shape.type === "circle" ? round(el.shape.r * 2) : undefined),
  set: (el, value) => (el.shape.type === "circle" && typeof value === "number" && value > 0 ? { shape: { ...el.shape, r: value / 2 } } : {}),
};

const LINE_WIDTH: FieldDef = {
  key: "lineWidthM",
  type: "number",
  unit: "m",
  min: 0.02,
  max: 20,
  step: 0.05,
  labelKey: "site.fields.width",
  get: (el) => (el.shape.type === "polyline" ? round(el.shape.width) : undefined),
  set: (el, value) => (el.shape.type === "polyline" && typeof value === "number" && value > 0 ? { shape: { ...el.shape, width: value } } : {}),
};

// --- Kind-specific fields -------------------------------------------------------

const SPECIES: FieldDef = { key: "speciesText", type: "text", labelKey: "site.fields.species", hintKey: "site.fields.speciesHint" };
const VARIETY: FieldDef = { key: "variety", type: "text", labelKey: "site.fields.variety" };
const USAGE: FieldDef = { key: "usage", type: "multi", labelKey: "site.fields.usage", options: opts("site.usage", USAGES) };
const PLANTED: FieldDef = { key: "plantedYear", type: "year", labelKey: "site.fields.plantedYear" };
const MATURE_HEIGHT: FieldDef = { key: "matureHeightM", type: "number", unit: "m", min: 0, max: 100, step: 0.5, labelKey: "site.fields.matureHeight" };
const MATURE_CROWN: FieldDef = { key: "matureCrownDiameterM", type: "number", unit: "m", min: 0, max: 50, step: 0.5, labelKey: "site.fields.matureCrown" };

const SURFACE_MATERIAL: FieldDef = {
  key: "material",
  type: "select",
  labelKey: "site.fields.material",
  allowEmpty: true,
  options: opts("site.materials", ["lawn", "paving", "gravel", "concrete", "asphalt", "decking", "soil", "mulch", "other"]),
};
const PATH_MATERIAL: FieldDef = {
  key: "material",
  type: "select",
  labelKey: "site.fields.material",
  allowEmpty: true,
  options: opts("site.materials", ["paving", "gravel", "mulch", "lawn", "concrete", "decking", "soil", "other"]),
};
const DEPTH: FieldDef = { key: "depthM", type: "number", unit: "m", min: 0, max: 10, step: 0.1, labelKey: "site.fields.depth" };

const KIND_FIELDS: Record<string, FieldDef[]> = {
  tree: [SPECIES, VARIETY, USAGE, PLANTED, CROWN, MATURE_HEIGHT, MATURE_CROWN],
  shrub: [SPECIES, VARIETY, USAGE, PLANTED, CROWN, MATURE_HEIGHT, MATURE_CROWN],
  hedge: [SPECIES, USAGE, PLANTED, LINE_WIDTH, MATURE_HEIGHT],
  surface: [SURFACE_MATERIAL],
  path: [PATH_MATERIAL, LINE_WIDTH],
  fence: [LINE_WIDTH],
  pond: [DEPTH],
};

/** All fields of an element's kind, in panel order. */
export function fieldsFor(kind: string): FieldDef[] {
  const variants = elementType(kind).variants;
  return [
    NAME,
    ...(variants && variants.length > 1 ? [VARIANT] : []),
    STATUS,
    PLANNED_YEAR,
    ...(KIND_FIELDS[kind] ?? []),
    HEIGHT,
    NOTES,
  ];
}

export function fieldValue(field: FieldDef, element: SiteElement): unknown {
  return field.get ? field.get(element) : (element as Record<string, unknown>)[field.key];
}

/** Updates that set a field. Empty values remove the field instead of storing "". */
export function fieldUpdates(field: FieldDef, element: SiteElement, value: unknown): Partial<SiteElement> {
  if (field.set) return field.set(element, value);
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  return { [field.key]: empty ? undefined : value } as Partial<SiteElement>;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
