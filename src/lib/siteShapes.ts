/**
 * Measurements and edits on site plan shapes. All values in plan metres.
 */
import type { SiteShape } from "@/types/site";
import type { Bounds, Point } from "./siteGeometry";

export function toPoints(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

export function toFlat(points: Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

/** Corners of a rotated rectangle, clockwise from top-left. */
export function rectCorners(cx: number, cy: number, w: number, h: number, rotationDeg: number): Point[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
}

/** Shoelace formula; absolute area of a simple polygon. */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function pathLength(points: Point[], closed = false): number {
  let total = 0;
  const n = points.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Area in m²; lines have none (null). */
export function shapeArea(shape: SiteShape): number | null {
  switch (shape.type) {
    case "rect":
      return Math.abs(shape.w * shape.h);
    case "circle":
      return Math.PI * shape.r * shape.r;
    case "polygon":
      return polygonArea(toPoints(shape.points));
    case "polyline":
      return null;
  }
}

/** Perimeter of areas, length of lines, in m. */
export function shapeLength(shape: SiteShape): number {
  switch (shape.type) {
    case "rect":
      return 2 * (Math.abs(shape.w) + Math.abs(shape.h));
    case "circle":
      return 2 * Math.PI * shape.r;
    case "polygon":
      return pathLength(toPoints(shape.points), true);
    case "polyline":
      return pathLength(toPoints(shape.points));
  }
}

export function pointsBounds(points: Point[], pad = 0): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function shapeBounds(shape: SiteShape): Bounds | null {
  switch (shape.type) {
    case "rect":
      return pointsBounds(rectCorners(shape.cx, shape.cy, shape.w, shape.h, shape.rotationDeg));
    case "circle":
      return { minX: shape.cx - shape.r, minY: shape.cy - shape.r, maxX: shape.cx + shape.r, maxY: shape.cy + shape.r };
    case "polygon":
      return pointsBounds(toPoints(shape.points));
    case "polyline":
      return pointsBounds(toPoints(shape.points), shape.width / 2);
  }
}

export function unionBounds(list: (Bounds | null | undefined)[]): Bounds | null {
  const valid = list.filter((b): b is Bounds => !!b);
  if (valid.length === 0) return null;
  return {
    minX: Math.min(...valid.map((b) => b.minX)),
    minY: Math.min(...valid.map((b) => b.minY)),
    maxX: Math.max(...valid.map((b) => b.maxX)),
    maxY: Math.max(...valid.map((b) => b.maxY)),
  };
}

/** The shape moved by (dx, dy). */
export function translateShape(shape: SiteShape, dx: number, dy: number): SiteShape {
  switch (shape.type) {
    case "rect":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "circle":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "polygon":
    case "polyline":
      return { ...shape, points: shape.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  }
}

/** Points with vertex `index` replaced. */
export function moveVertex(flat: number[], index: number, p: Point): number[] {
  const next = [...flat];
  next[index * 2] = p.x;
  next[index * 2 + 1] = p.y;
  return next;
}

/** Points with a new vertex inserted after vertex `afterIndex`. */
export function insertVertex(flat: number[], afterIndex: number, p: Point): number[] {
  const at = (afterIndex + 1) * 2;
  return [...flat.slice(0, at), p.x, p.y, ...flat.slice(at)];
}

/** Points without vertex `index`, unless that would leave fewer than `min` vertices. */
export function removeVertex(flat: number[], index: number, min: number): number[] {
  if (flat.length / 2 <= min) return flat;
  return [...flat.slice(0, index * 2), ...flat.slice(index * 2 + 2)];
}

/** Midpoints of the edges; for a closed shape including the closing edge. */
export function edgeMidpoints(flat: number[], closed: boolean): Point[] {
  const pts = toPoints(flat);
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/** Rectangle from two opposite corners (axis-aligned). */
export function rectFromCorners(a: Point, b: Point): Extract<SiteShape, { type: "rect" }> {
  return {
    type: "rect",
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
    rotationDeg: 0,
  };
}
