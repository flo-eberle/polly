import type { LucideIcon } from "lucide-react";
import { Fence, Footprints, House, LandPlot, RectangleHorizontal, Shrub, TreeDeciduous, Trees } from "lucide-react";
import type { SiteLayerId, SiteShape } from "@/types/site";

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
  /** Default height in metres, used later for shadows. */
  heightM?: number;
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
