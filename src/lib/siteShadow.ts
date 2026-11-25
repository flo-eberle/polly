/**
 * Shadows on the site plan.
 *
 * Every element with a height casts a shadow: its footprint, lifted from the
 * ground, projected along the sun's rays onto the ground. For a sun at
 * altitude α a point at height h lands h / tan α away from its footprint,
 * opposite the sun. An object standing from `base` to `top` therefore shades
 * the footprint swept from `base / tan α` to `top / tan α` along that
 * direction. The sweep of a polygon is the union of the polygon at both ends
 * and one quad per edge between them; drawn opaque into one layer whose
 * opacity is applied once, overlaps never get darker, so no polygon union is
 * needed.
 *
 * Plan coordinates: metres, x right, y down. `northDeg` is the clockwise angle
 * from "up" on the plan to north.
 */
import * as SunCalc from "suncalc";
import type { SiteElement } from "@/types/site";
import type { Point } from "./siteGeometry";
import { rectCorners, toPoints } from "./siteShapes";

export interface Sun {
  /** Degrees above the horizon. */
  altitudeDeg: number;
  /** Compass bearing of the sun, degrees clockwise from north. */
  azimuthDeg: number;
}

/** SunCalc 2 already returns degrees and a north-based, clockwise azimuth. */
export function sunAt(date: Date, lat: number, lon: number): Sun {
  const pos = SunCalc.getPosition(date, lat, lon);
  return { altitudeDeg: pos.altitude, azimuthDeg: pos.azimuth };
}

/** Unit vector on the plan for a compass bearing. */
export function bearingToPlan(bearingDeg: number, northDeg: number): Point {
  const rad = ((northDeg + bearingDeg) * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Below this altitude shadows run off the plan; nothing is drawn. */
export const MIN_ALTITUDE_DEG = 2;
/** Shadows longer than this (metres) are cut off. */
export const MAX_SHADOW_M = 300;

/** Plan offset of a point at `height` metres: where its shadow lands. */
export function shadowOffset(height: number, sun: Sun, northDeg: number): Point | null {
  if (sun.altitudeDeg < MIN_ALTITUDE_DEG) return null;
  const length = Math.min(height / Math.tan((sun.altitudeDeg * Math.PI) / 180), MAX_SHADOW_M);
  // Away from the sun: the sun's bearing plus 180°.
  const dir = bearingToPlan(sun.azimuthDeg + 180, northDeg);
  return { x: dir.x * length, y: dir.y * length };
}

export interface Caster {
  /** Footprints on the ground; lines contribute one rectangle per segment. */
  footprints: Point[][];
  /** Height where the shading part starts (a crown above the trunk). */
  base: number;
  top: number;
  /** Translucent casters (fences, greenhouses) shade less. */
  partial: boolean;
}

const CIRCLE_SEGMENTS = 24;

function circlePoints(cx: number, cy: number, r: number): Point[] {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
    const a = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** One rectangle per segment of a line of the given width. */
function lineFootprints(points: Point[], width: number): Point[][] {
  const out: Point[][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nx = (-(b.y - a.y) / len) * (width / 2);
    const ny = ((b.x - a.x) / len) * (width / 2);
    out.push([
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ]);
  }
  return out;
}

export interface CasterOptions {
  /** Height in metres; elements without one cast no shadow. */
  height: number | undefined;
  /** Fraction of the height where the shading part starts (crowns). */
  baseFraction?: number;
  partial?: boolean;
  /** Use the mature crown diameter for circles, if given. */
  crownDiameterM?: number;
}

export function casterFor(element: SiteElement, options: CasterOptions): Caster | null {
  const top = options.height;
  if (!top || top <= 0) return null;
  const shape = element.shape;
  let footprints: Point[][];
  switch (shape.type) {
    case "rect":
      footprints = [rectCorners(shape.cx, shape.cy, shape.w, shape.h, shape.rotationDeg)];
      break;
    case "circle":
      footprints = [circlePoints(shape.cx, shape.cy, options.crownDiameterM ? options.crownDiameterM / 2 : shape.r)];
      break;
    case "polygon":
      footprints = [toPoints(shape.points)];
      break;
    case "polyline":
      footprints = lineFootprints(toPoints(shape.points), shape.width);
      break;
  }
  return { footprints, base: top * (options.baseFraction ?? 0), top, partial: !!options.partial };
}

const shift = (pts: Point[], d: Point) => pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

/**
 * Ground shadow of a caster as polygons (flat point arrays). Their union is the
 * shadow; draw them opaque into one layer.
 */
export function shadowPolygons(caster: Caster, sun: Sun, northDeg: number): number[][] {
  const near = shadowOffset(caster.base, sun, northDeg);
  const far = shadowOffset(caster.top, sun, northDeg);
  if (!near || !far) return [];
  const out: number[][] = [];
  for (const footprint of caster.footprints) {
    if (footprint.length < 3) continue;
    const a = shift(footprint, near);
    const b = shift(footprint, far);
    out.push(flat(a), flat(b));
    for (let i = 0; i < footprint.length; i++) {
      const j = (i + 1) % footprint.length;
      out.push(flat([a[i], a[j], b[j], b[i]]));
    }
  }
  return out;
}

/** Shadow length in metres for a height; null when the sun is too low. */
export function shadowLength(height: number, sun: Sun): number | null {
  const offset = shadowOffset(height, sun, 0);
  return offset ? Math.hypot(offset.x, offset.y) : null;
}

/** Eight-point compass name key for a bearing: "n", "ne", … */
export function compassKey(bearingDeg: number): string {
  const keys = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  return keys[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];
}
