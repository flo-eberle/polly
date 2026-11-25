import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";
import {
  calibratedMetersPerPixel,
  fitBounds,
  formatLength,
  gridLines,
  gridStep,
  planToScreen,
  rotatedRectBounds,
  scaleBar,
  screenToPlan,
  zoomAt,
  MAX_SCALE,
  MIN_SCALE,
} from "@/lib/siteGeometry";
import { fitWithin, MAX_BACKGROUND_EDGE } from "@/lib/siteImage";
import { ensureRemoteBlob, loadBlob } from "@/lib/blobStore";
import { attachBlobs, buildExportData, referencedBlobIds } from "@/lib/dataExport";
import { importAllData, restoreBlobs } from "@/lib/dataImport";
import {
  edgeMidpoints,
  insertVertex,
  moveVertex,
  pathLength,
  polygonArea,
  rectCorners,
  rectFromCorners,
  removeVertex,
  shapeArea,
  shapeBounds,
  shapeLength,
  toPoints,
  translateShape,
  unionBounds,
} from "@/lib/siteShapes";
import { ELEMENT_TYPES, MATERIAL_COLORS, elementType, elementVariant, resolvedType, shadowCasterOptions } from "@/components/site/elementTypes";
import { fieldUpdates, fieldValue, fieldsFor } from "@/components/site/elementFields";
import { isVisibleInView } from "@/components/site/siteView";
import { MAX_SHADOW_M, TRUNK_RADIUS_M, casterFor, compassKey, shadowLength, shadowOffset, shadowPolygons, sunAt } from "@/lib/siteShadow";
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { newSiteElement, normalizeDeg } from "@/store/siteSlice";
import { useElementHistory } from "@/components/site/useElementHistory";
import { SITE_LAYERS, defaultSiteSettings, layerState, type SiteBackground, type SiteSettings } from "@/types/site";

const BG: SiteBackground = {
  imageId: "site-bg-1",
  widthPx: 2000,
  heightPx: 1000,
  x: 0,
  y: 0,
  rotationDeg: 0,
  metersPerPixel: 0.05,
  opacity: 1,
  locked: false,
};

function resetSite() {
  useStore.setState({ siteSettings: defaultSiteSettings(), siteElements: [] });
}

describe("site geometry", () => {
  it("zooms around the anchor point", () => {
    const view = { x: 100, y: 50, scale: 10 };
    const anchor = { x: 300, y: 200 };
    const before = screenToPlan(view, anchor);
    const zoomed = zoomAt(view, anchor, 2);
    expect(zoomed.scale).toBe(20);
    const after = screenToPlan(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps the zoom", () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 1e-6).scale).toBe(MIN_SCALE);
    expect(zoomAt({ x: 0, y: 0, scale: 1000 }, { x: 0, y: 0 }, 1e6).scale).toBe(MAX_SCALE);
  });

  it("round-trips between plan and screen", () => {
    const view = { x: -40, y: 12, scale: 7.5 };
    const p = { x: 3.2, y: -1.4 };
    const back = screenToPlan(view, planToScreen(view, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("fits bounds centred into the viewport", () => {
    const view = fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, { width: 548, height: 548 }, 24);
    expect(view.scale).toBe(5); // 500 px for 100 m
    const centre = screenToPlan(view, { x: 274, y: 274 });
    expect(centre.x).toBeCloseTo(50);
    expect(centre.y).toBeCloseTo(25);
  });

  it("calibrates from a traced distance", () => {
    // Traced 4 m at 5 cm/px, but the bar says 5 m: each pixel is 6.25 cm.
    expect(calibratedMetersPerPixel(0.05, 4, 5)).toBeCloseTo(0.0625);
    expect(() => calibratedMetersPerPixel(0.05, 0, 5)).toThrow();
    expect(() => calibratedMetersPerPixel(0.05, 4, -1)).toThrow();
  });

  it("computes the bounds of a rotated rectangle", () => {
    const b = rotatedRectBounds(0, 0, 4, 2, 90);
    expect(b.maxX - b.minX).toBeCloseTo(2);
    expect(b.maxY - b.minY).toBeCloseTo(4);
  });

  it("picks readable grid steps and scale bars", () => {
    expect(gridStep(10)).toBe(5); // 10 px/m: 5 m = 50 px ≥ 24 px; 2 m = 20 px too dense
    expect(gridStep(100)).toBe(0.5);
    const bar = scaleBar(10);
    expect(bar.meters).toBe(10);
    expect(bar.px).toBe(100);
  });

  it("covers the viewport with grid lines on step multiples", () => {
    const { xs, ys } = gridLines({ x: 0, y: 0, scale: 10 }, { width: 100, height: 50 }, 5);
    expect(xs).toEqual([0, 5, 10]);
    expect(ys).toEqual([0, 5]);
  });

  it("formats lengths", () => {
    expect(formatLength(5, "de")).toBe("5 m");
    expect(formatLength(0.5, "de")).toBe("50 cm");
    expect(formatLength(1500, "de")).toBe("1,5 km");
  });

  it("downscales large images to the edge limit", () => {
    expect(fitWithin(8000, 4000)).toEqual({ width: MAX_BACKGROUND_EDGE, height: 2048 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
});

describe("site slice", () => {
  beforeEach(resetSite);

  it("normalises angles", () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(720)).toBe(0);
    useStore.getState().setNorthDeg(-10);
    expect(useStore.getState().siteSettings.northDeg).toBe(350);
  });

  it("updates the background and ignores updates without one", () => {
    const { updateSiteBackground, setSiteBackground } = useStore.getState();
    updateSiteBackground({ opacity: 0.5 });
    expect(useStore.getState().siteSettings.background).toBeUndefined();

    setSiteBackground(BG);
    updateSiteBackground({ rotationDeg: 370, opacity: 0.5 });
    const bg = useStore.getState().siteSettings.background!;
    expect(bg.rotationDeg).toBe(10);
    expect(bg.opacity).toBe(0.5);
    expect(bg.imageId).toBe("site-bg-1");
  });

  it("toggles layers with visible and unlocked as default", () => {
    const { setSiteLayer } = useStore.getState();
    expect(layerState(useStore.getState().siteSettings, "woody")).toEqual({ visible: true, locked: false });
    setSiteLayer("woody", { visible: false });
    setSiteLayer("woody", { locked: true });
    expect(layerState(useStore.getState().siteSettings, "woody")).toEqual({ visible: false, locked: true });
  });

  it("adds, updates and deletes elements and keeps unknown fields", () => {
    const { addSiteElement, updateSiteElement, deleteSiteElement } = useStore.getState();
    const id = addSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 1, cy: 2, r: 3 }, futureField: 42 });
    let el = useStore.getState().siteElements[0];
    expect(el.id).toBe(id);
    expect(el.schemaVersion).toBe(1);
    expect(el.futureField).toBe(42);

    updateSiteElement(id, { name: "Apfel", id: "ignored" });
    el = useStore.getState().siteElements[0];
    expect(el.name).toBe("Apfel");
    expect(el.id).toBe(id);
    expect(el.futureField).toBe(42);

    deleteSiteElement(id);
    expect(useStore.getState().siteElements).toEqual([]);
  });
});

describe("site plan in backup", () => {
  beforeEach(resetSite);

  it("exports settings, elements and the referenced blob", async () => {
    useStore.getState().setSiteBackground(BG);
    useStore.getState().addSiteElement({ kind: "building", layer: "buildings", shape: { type: "polygon", points: [0, 0, 1, 0, 1, 1] } });

    const data = buildExportData();
    expect(data.data.siteSettings?.background?.imageId).toBe("site-bg-1");
    expect(data.data.siteElements).toHaveLength(1);
    expect(referencedBlobIds(data.data)).toEqual(["site-bg-1"]);

    const withBlobs = await attachBlobs(data, async () => new Blob(["png"], { type: "image/png" }));
    expect(withBlobs.data.blobs?.["site-bg-1"]).toMatch(/^data:image\/png;base64,/);

    const missing = await attachBlobs(data, async () => null);
    expect(missing.data.blobs).toBeUndefined();
  });

  it("restores the site plan on overwrite and keeps the local one on merge", () => {
    const exported = buildExportData();
    exported.data.siteSettings = { ...defaultSiteSettings(), northDeg: 15, background: BG };
    exported.data.siteElements = [
      { id: "e1", kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 2 }, createdAt: "", updatedAt: "", schemaVersion: 1 },
    ];

    const result = importAllData(exported, "overwrite");
    expect(result.stats.siteElements).toBe(1);
    expect(useStore.getState().siteSettings.northDeg).toBe(15);

    // Merge into a device that has its own background: its settings stay.
    const own: SiteSettings = { ...defaultSiteSettings(), northDeg: 3, background: { ...BG, imageId: "own" } };
    useStore.setState({ siteSettings: own, siteElements: [] });
    const merged = importAllData(exported, "merge");
    expect(merged.stats.siteElements).toBe(1);
    expect(useStore.getState().siteSettings.background?.imageId).toBe("own");
  });

  it("falls back to defaults for backups without a site plan", () => {
    useStore.getState().setSiteBackground(BG);
    const exported = buildExportData();
    delete exported.data.siteSettings;
    delete exported.data.siteElements;
    importAllData(exported, "overwrite");
    expect(useStore.getState().siteSettings.background).toBeUndefined();
    expect(useStore.getState().siteElements).toEqual([]);
  });

  it("restores only valid blobs", async () => {
    const written: string[] = [];
    const count = await restoreBlobs(
      {
        "site-bg-1": "data:image/png;base64,cG5n",
        "../evil": "data:image/png;base64,cG5n",
        "site-bg-2": "not a data url",
      },
      async (id) => { written.push(id); },
    );
    expect(count).toBe(1);
    expect(written).toEqual(["site-bg-1"]);
  });
});

describe("blob sync with the backend", () => {
  const respond = (status: number, body: BodyInit | null = null) => new Response(body, { status });

  it("uploads only when the backend lacks the blob", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "HEAD") return respond(404);
      return respond(201);
    }) as typeof fetch;
    const result = await ensureRemoteBlob("site-bg-1", { url: "http://b", fetch: fetchFn }, async () => new Blob(["x"], { type: "image/png" }));
    expect(result).toBe("uploaded");
    expect(calls).toEqual(["HEAD http://b/api/blobs/site-bg-1", "PUT http://b/api/blobs/site-bg-1"]);

    const present = await ensureRemoteBlob("site-bg-1", { url: "http://b", fetch: (async () => respond(200)) as typeof fetch });
    expect(present).toBe("present");
  });

  it("loads from the local cache first and caches what it downloads", async () => {
    const cache = new Map<string, Blob>();
    const local = { get: async (id: string) => cache.get(id) ?? null, put: async (id: string, b: Blob) => { cache.set(id, b); } };
    let downloads = 0;
    const fetchFn = (async () => { downloads += 1; return respond(200, new Blob(["img"], { type: "image/png" })); }) as typeof fetch;

    expect(await loadBlob("a", { url: "http://b", fetch: fetchFn }, local)).not.toBeNull();
    expect(await loadBlob("a", { url: "http://b", fetch: fetchFn }, local)).not.toBeNull();
    expect(downloads).toBe(1);
    expect(await loadBlob("b", null, local)).toBeNull();
  });
});

describe("site shapes", () => {
  const square = [0, 0, 4, 0, 4, 3, 0, 3];

  it("measures areas and lengths", () => {
    expect(polygonArea(toPoints(square))).toBe(12);
    expect(shapeArea({ type: "polygon", points: square })).toBe(12);
    expect(shapeLength({ type: "polygon", points: square })).toBe(14);
    expect(shapeArea({ type: "rect", cx: 0, cy: 0, w: 2, h: 5, rotationDeg: 33 })).toBe(10);
    expect(shapeArea({ type: "circle", cx: 0, cy: 0, r: 1 })).toBeCloseTo(Math.PI);
    expect(shapeArea({ type: "polyline", points: [0, 0, 3, 4], width: 1 })).toBeNull();
    expect(shapeLength({ type: "polyline", points: [0, 0, 3, 4, 3, 10], width: 1 })).toBe(11);
    expect(pathLength(toPoints(square), true)).toBe(14);
  });

  it("rotates rectangle corners about the centre", () => {
    const c = rectCorners(0, 0, 2, 2, 90);
    expect(c[0].x).toBeCloseTo(1);
    expect(c[0].y).toBeCloseTo(-1);
  });

  it("computes bounds, including line width and rotation", () => {
    expect(shapeBounds({ type: "polyline", points: [0, 0, 10, 0], width: 2 })).toEqual({ minX: -1, minY: -1, maxX: 11, maxY: 1 });
    const b = shapeBounds({ type: "rect", cx: 0, cy: 0, w: 4, h: 2, rotationDeg: 90 })!;
    expect(b.maxY - b.minY).toBeCloseTo(4);
    expect(unionBounds([null, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: -2, minY: 0, maxX: 0, maxY: 5 }])).toEqual({ minX: -2, minY: 0, maxX: 1, maxY: 5 });
    expect(unionBounds([])).toBeNull();
  });

  it("moves shapes and edits vertices", () => {
    expect(translateShape({ type: "polygon", points: [0, 0, 1, 1] }, 2, 3)).toEqual({ type: "polygon", points: [2, 3, 3, 4] });
    expect(translateShape({ type: "circle", cx: 0, cy: 0, r: 1 }, 1, -1)).toEqual({ type: "circle", cx: 1, cy: -1, r: 1 });
    expect(moveVertex(square, 1, { x: 5, y: 0 })).toEqual([0, 0, 5, 0, 4, 3, 0, 3]);
    expect(insertVertex(square, 0, { x: 2, y: -1 })).toEqual([0, 0, 2, -1, 4, 0, 4, 3, 0, 3]);
    expect(removeVertex(square, 0, 3)).toEqual([4, 0, 4, 3, 0, 3]);
    expect(removeVertex([0, 0, 1, 0, 1, 1], 0, 3)).toEqual([0, 0, 1, 0, 1, 1]);
    expect(edgeMidpoints(square, true)).toHaveLength(4);
    expect(edgeMidpoints(square, false)).toHaveLength(3);
  });

  it("builds a rectangle from two corners in any order", () => {
    expect(rectFromCorners({ x: 4, y: 3 }, { x: 0, y: 1 })).toEqual({ type: "rect", cx: 2, cy: 2, w: 4, h: 2, rotationDeg: 0 });
  });
});

describe("element registry", () => {
  it("puts every kind on a known layer with at least one shape", () => {
    const kinds = new Set<string>();
    for (const type of ELEMENT_TYPES) {
      expect(SITE_LAYERS).toContain(type.layer);
      expect(type.shapes.length).toBeGreaterThan(0);
      if (type.shapes.includes("polyline")) expect(type.lineWidthM).toBeGreaterThan(0);
      expect(kinds.has(type.kind)).toBe(false);
      kinds.add(type.kind);
    }
  });

  it("gives every variant a unique id and resolves overrides", () => {
    for (const type of ELEMENT_TYPES) {
      const ids = (type.variants ?? []).map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const wall = resolvedType({ kind: "fence", variant: "wall" });
    expect(wall.lineWidthM).toBe(0.25);
    expect(wall.style.dash).toBeUndefined();
    expect(wall.labelKey).toBe("site.variants.wall");
    const fence = resolvedType({ kind: "fence" });
    expect(fence.style.dash).toEqual([6, 3]);
    expect(resolvedType({ kind: "building", variant: "greenhouse" }).heightM).toBe(2.5);
    // Unknown variants fall back to the kind's default; kinds without variants have none.
    expect(elementVariant("building", "future")?.id).toBe("building");
    expect(elementVariant("tree", undefined)).toBeNull();
  });

  it("colours surfaces and paths by material", () => {
    expect(resolvedType({ kind: "surface", material: "lawn" }).style.fill).toBe(MATERIAL_COLORS.lawn);
    expect(resolvedType({ kind: "path", material: "gravel" }).style.stroke).toBe(MATERIAL_COLORS.gravel);
    expect(resolvedType({ kind: "surface", material: "other" }).style.fill).toBe(elementType("surface").style.fill);
  });

  it("falls back for kinds written by a newer version", () => {
    expect(elementType("future-kind").kind).toBe("unknown");
    expect(elementType("tree").layer).toBe("woody");
  });
});

describe("element history", () => {
  beforeEach(resetSite);

  it("undoes and redoes element edits and clears redo on a new edit", () => {
    const { result } = renderHook(() => useElementHistory());
    const a = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 1 } });
    const b = newSiteElement({ kind: "bed", layer: "beds", shape: { type: "rect", cx: 0, cy: 0, w: 1, h: 2, rotationDeg: 0 } });

    act(() => result.current.commit([a]));
    act(() => result.current.commit([a, b]));
    expect(useStore.getState().siteElements).toHaveLength(2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(useStore.getState().siteElements).toEqual([a]);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(useStore.getState().siteElements).toEqual([a, b]);

    act(() => result.current.undo());
    act(() => result.current.commit([]));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(useStore.getState().siteElements).toEqual([a]);
  });
});

describe("element fields", () => {
  const tree = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 2 } });
  const keys = (kind: string) => fieldsFor(kind).map((f) => f.key);

  it("lists common fields around the kind's own, with the variant only where there are variants", () => {
    expect(keys("tree")).toEqual(["name", "status", "plannedYear", "speciesText", "variety", "usage", "plantedYear", "crownDiameterM", "matureHeightM", "matureCrownDiameterM", "heightM", "notes"]);
    expect(keys("building")).toContain("variant");
    expect(keys("tree")).not.toContain("variant");
    expect(keys("future-kind")).toEqual(["name", "status", "plannedYear", "heightM", "notes"]);
  });

  it("shows the planned year only for planned elements", () => {
    const planned = fieldsFor("tree").find((f) => f.key === "plannedYear")!;
    expect(planned.visible!(tree)).toBe(false);
    expect(planned.visible!({ ...tree, status: "planned" })).toBe(true);
  });

  it("edits the crown through the circle and the width through the line", () => {
    const crown = fieldsFor("tree").find((f) => f.key === "crownDiameterM")!;
    expect(fieldValue(crown, tree)).toBe(4);
    expect(fieldUpdates(crown, tree, 6)).toEqual({ shape: { type: "circle", cx: 0, cy: 0, r: 3 } });
    expect(fieldUpdates(crown, tree, 0)).toEqual({});

    const hedge = newSiteElement({ kind: "hedge", layer: "woody", shape: { type: "polyline", points: [0, 0, 5, 0], width: 1 } });
    const width = fieldsFor("hedge").find((f) => f.key === "lineWidthM")!;
    expect(fieldValue(width, hedge)).toBe(1);
    expect(fieldUpdates(width, hedge, 1.5)).toEqual({ shape: { type: "polyline", points: [0, 0, 5, 0], width: 1.5 } });
  });

  it("removes a value instead of storing an empty one", () => {
    const name = fieldsFor("tree")[0];
    expect(fieldUpdates(name, tree, "")).toEqual({ name: undefined });
    const usage = fieldsFor("tree").find((f) => f.key === "usage")!;
    expect(fieldUpdates(usage, tree, [])).toEqual({ usage: undefined });
    expect(fieldUpdates(usage, tree, ["harvest"])).toEqual({ usage: ["harvest"] });
    expect(fieldValue(fieldsFor("tree")[1], tree)).toBe("existing");
  });

  it("has every label of kinds, variants and fields in all four languages", () => {
    const labelKeys = new Set<string>();
    for (const type of [...ELEMENT_TYPES, elementType("unknown")]) {
      labelKeys.add(type.labelKey);
      for (const v of type.variants ?? []) labelKeys.add(v.labelKey);
      for (const f of fieldsFor(type.kind)) {
        labelKeys.add(f.labelKey);
        if (f.hintKey) labelKeys.add(f.hintKey);
        if (f.type === "select" || f.type === "multi") for (const o of f.options) labelKeys.add(o.labelKey);
      }
    }
    for (const lng of ["de", "en", "es", "fr"]) {
      const dict = JSON.parse(readFileSync(`public/locales/${lng}/translation.json`, "utf8")) as Record<string, unknown>;
      const missing = [...labelKeys].filter((key) => typeof key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict) !== "string");
      expect(missing, lng).toEqual([]);
    }
  });
});

describe("plan views", () => {
  it("shows today's state and the target state", () => {
    const of = (status?: "existing" | "planned" | "remove") => ({ status });
    expect([of(), of("planned"), of("remove")].map((e) => isVisibleInView(e, "current"))).toEqual([true, false, true]);
    expect([of(), of("planned"), of("remove")].map((e) => isVisibleInView(e, "target"))).toEqual([true, true, false]);
    expect([of(), of("planned"), of("remove")].every((e) => isVisibleInView(e, "all"))).toBe(true);
  });
});

describe("history coalescing", () => {
  beforeEach(resetSite);

  it("turns typing into one field into a single undo step", () => {
    const { result } = renderHook(() => useElementHistory());
    const a = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 1 } });
    act(() => result.current.commit([a]));
    for (const name of ["A", "Ap", "Apf"]) act(() => result.current.commit([{ ...a, name }], "a:name"));
    act(() => result.current.commit([{ ...a, name: "Apf", variety: "B" }], "a:variety"));

    act(() => result.current.undo());
    expect(useStore.getState().siteElements[0].name).toBe("Apf");
    expect(useStore.getState().siteElements[0].variety).toBeUndefined();
    act(() => result.current.undo());
    expect(useStore.getState().siteElements[0].name).toBeUndefined();
  });
});

describe("shadows", () => {
  const south = { altitudeDeg: 45, azimuthDeg: 180 }; // sun due south, 45° up

  it("points shadows away from the sun, rotated by the plan's north", () => {
    // North up: a southern sun throws the shadow up the plan (north), as long as the height.
    const up = shadowOffset(5, south, 0)!;
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-5);
    // North pointing right on the plan (90°): north is +x.
    const right = shadowOffset(5, south, 90)!;
    expect(right.x).toBeCloseTo(5);
    expect(right.y).toBeCloseTo(0);
    // Evening sun in the west throws shadows east.
    const east = shadowOffset(1, { altitudeDeg: 45, azimuthDeg: 270 }, 0)!;
    expect(east.x).toBeCloseTo(1);
  });

  it("casts nothing when the sun is down and caps very long shadows", () => {
    expect(shadowOffset(5, { altitudeDeg: -3, azimuthDeg: 180 }, 0)).toBeNull();
    expect(shadowLength(20, { altitudeDeg: 2.5, azimuthDeg: 180 })).toBe(MAX_SHADOW_M);
    expect(shadowLength(3, { altitudeDeg: 30, azimuthDeg: 0 })).toBeCloseTo(3 / Math.tan(Math.PI / 6));
  });

  it("sweeps a footprint from the base to the top height", () => {
    const tree = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "rect", cx: 0, cy: 0, w: 2, h: 2, rotationDeg: 0 } });
    const caster = casterFor(tree, { height: 6, baseFraction: 0.5 })!;
    expect(caster.parts).toHaveLength(1); // trunks only for round crowns
    expect(caster.parts[0].base).toBe(3);
    const polys = shadowPolygons(caster, south, 0);
    // Footprint at both ends plus one quad per edge.
    expect(polys).toHaveLength(2 + 4);
    const ys = polys.flatMap((p) => p.filter((_, i) => i % 2 === 1));
    // Crown shadow spans from 3 m to 6 m north, plus the footprint's own extent of ±1 m.
    expect(Math.max(...ys)).toBeCloseTo(-2);
    expect(Math.min(...ys)).toBeCloseTo(-7);
  });

  it("ties a raised crown to the ground with its trunk", () => {
    const tree = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 2 } });
    const caster = casterFor(tree, { height: 6, baseFraction: 0.3 })!;
    const [crown, trunk] = caster.parts;
    expect(crown.base).toBeCloseTo(1.8);
    expect(crown.top).toBe(6);
    expect(trunk.base).toBe(0);
    expect(trunk.top).toBeCloseTo(1.8);
    // The trunk's shadow starts at its foot (southern edge y = trunk radius) and runs to the crown's shadow.
    const ys = shadowPolygons({ parts: [trunk], partial: false }, south, 0).flatMap((p) => p.filter((_, i) => i % 2 === 1));
    expect(Math.max(...ys)).toBeCloseTo(TRUNK_RADIUS_M);
    expect(Math.min(...ys)).toBeCloseTo(-1.8 - TRUNK_RADIUS_M);
  });

  it("gives lines one rectangle per segment and skips elements without height", () => {
    const fence = newSiteElement({ kind: "fence", layer: "lines", shape: { type: "polyline", points: [0, 0, 10, 0, 10, 5], width: 0.2 } });
    expect(casterFor(fence, { height: 1.2 })!.parts[0].footprints).toHaveLength(2);
    expect(casterFor(fence, { height: undefined })).toBeNull();
  });

  it("uses own, default and mature heights from the registry", () => {
    const tree = newSiteElement({ kind: "tree", layer: "woody", shape: { type: "circle", cx: 0, cy: 0, r: 1 }, matureHeightM: 12, matureCrownDiameterM: 8 });
    expect(shadowCasterOptions(tree, false)).toMatchObject({ height: 6, baseFraction: 0.3 });
    expect(shadowCasterOptions(tree, true)).toMatchObject({ height: 12, crownDiameterM: 8 });
    expect(shadowCasterOptions({ ...tree, heightM: 4 }, false).height).toBe(4);
    const fence = newSiteElement({ kind: "fence", layer: "lines", shape: { type: "polyline", points: [0, 0, 1, 0], width: 0.1 } });
    expect(shadowCasterOptions(fence, false).partial).toBe(true);
    expect(shadowCasterOptions({ ...fence, variant: "wall" }, false).partial).toBe(false);
    const surface = newSiteElement({ kind: "surface", layer: "surfaces", shape: { type: "rect", cx: 0, cy: 0, w: 1, h: 1, rotationDeg: 0 } });
    expect(shadowCasterOptions(surface, false).height).toBeUndefined();
  });

  it("reads the sun from SunCalc as a compass bearing", () => {
    // Midsummer near Vienna, 8:00 and 16:00 CEST (UTC+2), independent of the test machine's zone.
    const morning = sunAt(new Date(Date.UTC(2026, 5, 21, 6)), 48.3, 16.6);
    const afternoon = sunAt(new Date(Date.UTC(2026, 5, 21, 14)), 48.3, 16.6);
    expect(morning.azimuthDeg).toBeGreaterThan(60);
    expect(morning.azimuthDeg).toBeLessThan(110);
    expect(afternoon.azimuthDeg).toBeGreaterThan(230);
    expect(compassKey(morning.azimuthDeg)).toBe("e");
    expect(compassKey(359)).toBe("n");
  });
});
