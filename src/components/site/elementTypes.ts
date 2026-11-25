import type { LucideIcon } from "lucide-react";
import { BrickWall, Fence, Footprints, House, LandPlot, RectangleHorizontal, Recycle, Shrub, TreeDeciduous, Trees, Warehouse, Waves } from "lucide-react";
import type { SiteElement, SiteLayerId, SiteShape } from "@/types/site";

/**
 * Element registry: everything that differs between kinds of site plan
 * elements is described here, in one place. A new kind is a new entry; the
 * canvas, the toolbar and (in the next step) the properties panel read it.
 */

export type ShapeType = SiteShape["type"];

export interface ElementStyle {
  fill?: string;
  stroke: string;
  /** Outline width in screen pixels. */
  strokeWidthPx: number;
  dash?: number[];
}

/**
 * A sub-kind (greenhouse under building, wall under fence). It shares layer
 * and shapes with its kind and overrides only what differs.
 */
/** How an element casts its shadow (see lib/siteShadow.ts). */
export interface ShadowSpec {
  /** Fraction of the height where the shading part starts: a crown above its trunk. */
  baseFraction?: number;
  /** Translucent (fence, glass): drawn lighter. */
  partial?: boolean;
}

export interface ElementVariant {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  style?: Partial<ElementStyle>;
  lineWidthM?: number;
  heightM?: number;
  shadow?: ShadowSpec;
}

export interface ElementType {
  kind: string;
  layer: SiteLayerId;
  /** i18n key of the name, e.g. "site.kinds.building". */
  labelKey: string;
  icon: LucideIcon;
  /** Shapes this kind can be drawn as; the first is the default. */
  shapes: ShapeType[];
  style: ElementStyle;
  /** Line width in metres for polyline kinds (path, hedge, fence). */
  lineWidthM?: number;
  /** Default height in metres, used for shadows. Kinds without one cast none. */
  heightM?: number;
  shadow?: ShadowSpec;
  /** Sub-kinds; the first is the default and should describe the kind itself. */
  variants?: ElementVariant[];
}

export const ELEMENT_TYPES: ElementType[] = [
  {
    kind: "building",
    layer: "buildings",
    labelKey: "site.kinds.building",
    icon: House,
    shapes: ["rect", "polygon"],
    style: { fill: "#d6cfc4", stroke: "#6f6355", strokeWidthPx: 1.5 },
    heightM: 5,
    variants: [
      { id: "building", labelKey: "site.kinds.building", icon: House },
      {
        id: "greenhouse",
        labelKey: "site.variants.greenhouse",
        icon: Warehouse,
        style: { fill: "rgba(186,230,253,0.6)", stroke: "#0284c7" },
        heightM: 2.5,
        shadow: { partial: true },
      },
      {
        id: "compost",
        labelKey: "site.variants.compost",
        icon: Recycle,
        style: { fill: "rgba(107,79,58,0.75)", stroke: "#4a3426" },
        heightM: 1,
      },
    ],
  },
  {
    kind: "surface",
    layer: "surfaces",
    labelKey: "site.kinds.surface",
    icon: LandPlot,
    shapes: ["polygon", "rect"],
    style: { fill: "rgba(214,211,209,0.85)", stroke: "#a8a29e", strokeWidthPx: 1 },
  },
  {
    kind: "pond",
    layer: "surfaces",
    labelKey: "site.kinds.pond",
    icon: Waves,
    shapes: ["polygon", "circle"],
    style: { fill: "rgba(56,152,214,0.55)", stroke: "#1d6fa5", strokeWidthPx: 1.5 },
  },
  {
    kind: "path",
    layer: "surfaces",
    labelKey: "site.kinds.path",
    icon: Footprints,
    shapes: ["polyline"],
    style: { stroke: "rgba(205,190,160,0.95)", strokeWidthPx: 1 },
    lineWidthM: 1,
  },
  {
    kind: "bed",
    layer: "beds",
    labelKey: "site.kinds.bed",
    icon: RectangleHorizontal,
    shapes: ["rect", "polygon"],
    style: { fill: "rgba(150,111,76,0.55)", stroke: "#7f5539", strokeWidthPx: 1.5 },
  },
  {
    kind: "tree",
    layer: "woody",
    labelKey: "site.kinds.tree",
    icon: TreeDeciduous,
    shapes: ["circle"],
    style: { fill: "rgba(63,125,78,0.45)", stroke: "#2f6b40", strokeWidthPx: 1.5 },
    heightM: 6,
    // The crown starts at about a third of the height; the trunk's shadow is negligible.
    shadow: { baseFraction: 0.3 },
  },
  {
    kind: "shrub",
    layer: "woody",
    labelKey: "site.kinds.shrub",
    icon: Shrub,
    shapes: ["circle"],
    style: { fill: "rgba(110,160,80,0.5)", stroke: "#4d7c3a", strokeWidthPx: 1.5 },
    heightM: 1.5,
  },
  {
    kind: "hedge",
    layer: "woody",
    labelKey: "site.kinds.hedge",
    icon: Trees,
    shapes: ["polyline"],
    style: { stroke: "rgba(63,125,78,0.7)", strokeWidthPx: 1 },
    lineWidthM: 1,
    heightM: 2,
  },
  {
    kind: "fence",
    layer: "lines",
    labelKey: "site.kinds.fence",
    icon: Fence,
    shapes: ["polyline"],
    style: { stroke: "#57534e", strokeWidthPx: 1, dash: [6, 3] },
    lineWidthM: 0.08,
    heightM: 1.2,
    shadow: { partial: true },
    variants: [
      { id: "fence", labelKey: "site.kinds.fence", icon: Fence },
      {
        id: "wall",
        labelKey: "site.variants.wall",
        icon: BrickWall,
        style: { stroke: "#8a8580", dash: undefined },
        lineWidthM: 0.25,
        heightM: 1.5,
        shadow: { partial: false },
      },
    ],
  },
];

const BY_KIND = new Map(ELEMENT_TYPES.map((t) => [t.kind, t]));

/** Fallback for kinds this version does not know (written by a newer one). */
const UNKNOWN: ElementType = {
  kind: "unknown",
  layer: "objects",
  labelKey: "site.kinds.unknown",
  icon: LandPlot,
  shapes: ["polygon"],
  style: { fill: "rgba(156,163,175,0.4)", stroke: "#6b7280", strokeWidthPx: 1, dash: [4, 4] },
};

export function elementType(kind: string): ElementType {
  return BY_KIND.get(kind) ?? UNKNOWN;
}

/** The variant an element uses; the kind's first variant when unset or unknown. */
export function elementVariant(kind: string, variantId: string | undefined): ElementVariant | null {
  const variants = elementType(kind).variants;
  if (!variants?.length) return null;
  return variants.find((v) => v.id === variantId) ?? variants[0];
}

/**
 * Fill (areas) or stroke (paths) per surface material, so a lawn looks like
 * one. Materials without an entry keep the kind's colour.
 */
export const MATERIAL_COLORS: Record<string, string> = {
  lawn: "rgba(134,186,102,0.75)",
  paving: "rgba(176,172,166,0.9)",
  gravel: "rgba(214,200,170,0.9)",
  concrete: "rgba(200,200,196,0.9)",
  asphalt: "rgba(110,110,112,0.9)",
  decking: "rgba(181,137,92,0.9)",
  soil: "rgba(140,104,72,0.75)",
  mulch: "rgba(120,84,56,0.85)",
};

/** Style, line width and height of an element: the kind's, overridden by its variant and material. */
export function resolvedType(element: Pick<SiteElement, "kind" | "variant" | "material">): {
  style: ElementStyle;
  lineWidthM?: number;
  heightM?: number;
  labelKey: string;
  icon: LucideIcon;
  shadow: ShadowSpec;
} {
  const type = elementType(element.kind);
  const variant = elementVariant(element.kind, element.variant);
  const materialColor = element.material ? MATERIAL_COLORS[element.material] : undefined;
  const style: ElementStyle = { ...type.style, ...variant?.style };
  if (materialColor) {
    if (style.fill !== undefined) style.fill = materialColor;
    else style.stroke = materialColor;
  }
  return {
    style,
    lineWidthM: variant?.lineWidthM ?? type.lineWidthM,
    heightM: variant?.heightM ?? type.heightM,
    labelKey: variant?.labelKey ?? type.labelKey,
    icon: variant?.icon ?? type.icon,
    shadow: { ...type.shadow, ...variant?.shadow },
  };
}

/**
 * What an element casts: its height (own or the registry default) and shadow
 * spec. With `mature`, trees and shrubs use their mature height and crown.
 */
export function shadowCasterOptions(element: SiteElement, mature: boolean) {
  const resolved = resolvedType(element);
  const height = (mature ? element.matureHeightM : undefined) ?? element.heightM ?? resolved.heightM;
  return {
    height,
    baseFraction: resolved.shadow.baseFraction,
    partial: resolved.shadow.partial,
    crownDiameterM: mature ? element.matureCrownDiameterM : undefined,
  };
}
