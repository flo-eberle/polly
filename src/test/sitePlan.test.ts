import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store";
import { normalizeDeg } from "@/store/siteSlice";
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
import { defaultSiteSettings, layerState, type SiteBackground, type SiteSettings } from "@/types/site";

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
