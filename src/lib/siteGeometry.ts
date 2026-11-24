/**
 * Geometry of the site plan view. Plan coordinates are metres (x right,
 * y down); the view maps them to screen pixels: screen = plan * scale + offset.
 */

export interface Point {
  x: number;
  y: number;
}

export interface View {
  /** Screen offset of the plan origin, in px. */
  x: number;
  y: number;
  /** Pixels per metre. */
  scale: number;
}

export const MIN_SCALE = 0.2; // 1 px = 5 m
export const MAX_SCALE = 2000; // 1 px = 0.5 mm

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToPlan(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

export function planToScreen(view: View, p: Point): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** Zooms by `factor`, keeping the plan point under `anchor` (screen px) in place. */
export function zoomAt(view: View, anchor: Point, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const plan = screenToPlan(view, anchor);
  return { scale, x: anchor.x - plan.x * scale, y: anchor.y - plan.y * scale };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** View that shows `bounds` centred in a viewport of the given size. */
export function fitBounds(bounds: Bounds, viewport: { width: number; height: number }, padding = 24): View {
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const availW = Math.max(viewport.width - 2 * padding, 1);
  const availH = Math.max(viewport.height - 2 * padding, 1);
  const scale = clampScale(Math.min(availW / w, availH / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, x: viewport.width / 2 - cx * scale, y: viewport.height / 2 - cy * scale };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * New metres-per-pixel after the user marked a line of known length. The line
 * was measured in plan metres with the current scale, so the correction is a
 * plain ratio and independent of the image's position and rotation.
 */
export function calibratedMetersPerPixel(currentMpp: number, measuredM: number, actualM: number): number {
  if (!(measuredM > 0) || !(actualM > 0) || !(currentMpp > 0)) throw new Error("calibration needs positive lengths");
  return currentMpp * (actualM / measuredM);
}

/** Bounds of a w×h rectangle centred at (cx, cy) and rotated by `deg`. */
export function rotatedRectBounds(cx: number, cy: number, w: number, h: number, deg: number): Bounds {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (w * cos + h * sin) / 2;
  const halfH = (w * sin + h * cos) / 2;
  return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH };
}

const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** Smallest "nice" length in metres that is at least `minPx` long on screen. */
export function niceStep(scale: number, minPx: number): number {
  for (const step of NICE_STEPS) if (step * scale >= minPx) return step;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

/** Grid spacing: about 24 px or more between lines. */
export function gridStep(scale: number): number {
  return niceStep(scale, 24);
}

/** Scale bar: a nice length of at least 60 px. */
export function scaleBar(scale: number): { meters: number; px: number } {
  const meters = niceStep(scale, 60);
  return { meters, px: meters * scale };
}

/** Grid line positions covering the visible part of the plan. */
export function gridLines(view: View, viewport: { width: number; height: number }, step: number): { xs: number[]; ys: number[] } {
  const topLeft = screenToPlan(view, { x: 0, y: 0 });
  const bottomRight = screenToPlan(view, { x: viewport.width, y: viewport.height });
  const range = (from: number, to: number) => {
    const out: number[] = [];
    const start = Math.floor(from / step) * step;
    // Guard against pathological zoom levels producing huge arrays.
    for (let v = start; v <= to && out.length < 2000; v += step) out.push(Math.round(v / step) * step);
    return out;
  };
  return { xs: range(topLeft.x, bottomRight.x), ys: range(topLeft.y, bottomRight.y) };
}

/** "5 m", "50 cm", "1,5 km" style label, localised number. */
export function formatLength(meters: number, locale: string): string {
  const fmt = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  if (meters >= 1000) return `${fmt(meters / 1000)} km`;
  if (meters < 1) return `${fmt(meters * 100)} cm`;
  return `${fmt(meters)} m`;
}
