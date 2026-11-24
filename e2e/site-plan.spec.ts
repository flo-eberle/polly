import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Site plan, phase 1: import a background image, calibrate it against a known
 * distance, set the north direction, and keep all of it across a reload.
 * Phones get a view-only page.
 */

const demoState = JSON.parse(readFileSync(new URL("./fixtures/demo-state.json", import.meta.url), "utf8")) as Record<string, unknown>;

async function seed(page: Page) {
  await page.route(/open-meteo\.com|openweathermap\.org/, (r) => r.abort());
  await page.addInitScript((state) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("gardener-storage", JSON.stringify({ state, version: 4 }));
  }, demoState);
}

/** A 400×200 PNG drawn in the page, so the test needs no binary fixture. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#cde8c4";
    ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = "#333";
    ctx.fillRect(50, 150, 100, 6); // a "scale bar"
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(base64, "base64");
}

async function siteSettings(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("gardener-storage");
    return raw ? (JSON.parse(raw) as { state: { siteSettings: Record<string, unknown> } }).state.siteSettings : null;
  });
}

test.describe("site plan", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("import, calibrate, orient and reload", async ({ page }) => {
    await seed(page);
    await page.goto("/#/site");
    await expect(page.getByRole("heading", { level: 1, name: "Grundstück" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Noch kein Lageplan")).toBeVisible();

    const png = await makePng(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Bild importieren" }).click();
    await (await chooser).setFiles({ name: "plan.png", mimeType: "image/png", buffer: png });

    const canvas = page.getByTestId("site-canvas");
    await expect(canvas.locator("canvas").first()).toBeVisible();
    await expect(page.getByText(/Maßstab noch nicht festgelegt: Klicke/)).toBeVisible();

    const bg = (await siteSettings(page))?.background as { widthPx: number; heightPx: number; metersPerPixel: number; calibrated: boolean };
    expect(bg.widthPx).toBe(400);
    expect(bg.heightPx).toBe(200);
    expect(bg.calibrated).toBe(false);

    // Trace a horizontal line and call it 10 m.
    await page.getByRole("button", { name: "Maßstab festlegen" }).click();
    await expect(page.getByText("Klicke auf Anfang und Ende")).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.click(box.x + box.width / 2 - 100, y);
    await page.mouse.click(box.x + box.width / 2 + 100, y);

    const dialog = page.getByRole("dialog", { name: "Länge der Strecke" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Tatsächliche Länge in Metern").fill("10");
    await dialog.getByRole("button", { name: "Maßstab übernehmen" }).click();
    await expect(dialog).toBeHidden();

    const calibrated = (await siteSettings(page))?.background as { metersPerPixel: number; calibrated: boolean };
    expect(calibrated.calibrated).toBe(true);
    expect(calibrated.metersPerPixel).not.toBeCloseTo(bg.metersPerPixel, 6);
    await expect(page.getByText(/Maßstab: 1 Pixel = /)).toBeVisible();

    await page.getByLabel("Norden (Grad, im Uhrzeigersinn von oben)").fill("30");
    expect((await siteSettings(page))?.northDeg).toBe(30);

    // Locking the background layer is the same lock as the checkbox: no dragging, no rotating.
    await page.getByRole("button", { name: "Ebene „Hintergrund“ sperren" }).click();
    await expect(page.getByLabel("Hintergrund sperren")).toBeChecked();
    await expect(page.getByLabel("Drehung (Grad, im Uhrzeigersinn)")).toBeDisabled();
    const before = (await siteSettings(page))?.background as { x: number; y: number };
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 80, centre.y + 40, { steps: 8 });
    await page.mouse.up();
    const after = (await siteSettings(page))?.background as { x: number; y: number };
    expect(after).toMatchObject({ x: before.x, y: before.y });
    await page.getByLabel("Hintergrund sperren").uncheck();
    await expect(page.getByRole("button", { name: "Ebene „Hintergrund“ sperren" })).toBeVisible();

    // Image from IndexedDB, settings from localStorage: both survive a reload.
    await page.reload();
    await expect(page.getByTestId("site-canvas").locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Hintergrundbild ist auf diesem Gerät nicht vorhanden/)).toHaveCount(0);
    await expect(page.getByText(/Maßstab: 1 Pixel = /)).toBeVisible();
  });
});

type Shape = { type: string; cx?: number; cy?: number; r?: number; w?: number; h?: number; points?: number[] };
type Element = { id: string; kind: string; layer: string; shape: Shape };

async function siteElements(page: Page): Promise<Element[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("gardener-storage");
    return raw ? (JSON.parse(raw) as { state: { siteElements: Element[] } }).state.siteElements : [];
  });
}

test.describe("site plan drawing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("draw, select, move, undo, edit corners, delete", async ({ page }) => {
    await seed(page);
    await page.goto("/#/site");
    await page.getByRole("button", { name: "Ohne Bild beginnen" }).click();
    const canvas = page.getByTestId("site-canvas");
    await expect(canvas.locator("canvas").first()).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
    };

    // Building: rectangle by dragging (10 px per metre at the start: 20 m × 12 m).
    await page.getByRole("button", { name: "Gebäude zeichnen" }).click();
    await expect(page.getByText("Von Ecke zu Ecke ziehen.", { exact: false })).toBeVisible();
    await drag({ x: c.x - 300, y: c.y - 200 }, { x: c.x - 100, y: c.y - 80 });
    let els = await siteElements(page);
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ kind: "building", layer: "buildings", shape: { type: "rect" } });
    expect(els[0].shape.w).toBeCloseTo(20, 0);
    expect(els[0].shape.h).toBeCloseTo(12, 0);
    await expect(page.getByRole("region", { name: "Ausgewähltes Element" })).toContainText("240 m²");

    // Surface: polygon, closed by clicking the first point.
    await page.getByRole("button", { name: "Fläche zeichnen" }).click();
    const poly = [{ x: c.x + 50, y: c.y - 200 }, { x: c.x + 250, y: c.y - 200 }, { x: c.x + 250, y: c.y - 50 }, { x: c.x + 50, y: c.y - 50 }];
    for (const p of poly) await page.mouse.click(p.x, p.y);
    await page.mouse.click(poly[0].x, poly[0].y);
    els = await siteElements(page);
    expect(els).toHaveLength(2);
    expect(els[1]).toMatchObject({ kind: "surface", shape: { type: "polygon" } });
    expect(els[1].shape.points).toHaveLength(8);

    // Tree: circle dragged out from the centre (4 m radius).
    await page.getByRole("button", { name: "Baum zeichnen" }).click();
    await drag({ x: c.x - 200, y: c.y + 150 }, { x: c.x - 160, y: c.y + 150 });
    // Hedge: polyline, finished with Enter.
    await page.getByRole("button", { name: "Hecke zeichnen" }).click();
    for (const dx of [0, 100, 200]) await page.mouse.click(c.x + dx, c.y + 200);
    await page.keyboard.press("Enter");
    // Path: quick clicks in different places must not finish it; a double click on the last point does.
    await page.getByRole("button", { name: "Weg zeichnen" }).click();
    await page.mouse.click(c.x + 300, c.y);
    await page.mouse.click(c.x + 300, c.y + 100);
    await page.mouse.dblclick(c.x + 380, c.y + 100);
    const path = (await siteElements(page)).at(-1)!;
    expect(path).toMatchObject({ kind: "path", shape: { type: "polyline" } });
    expect(path.shape.points).toHaveLength(6);
    await page.keyboard.press("Control+z"); // keep the expectations below simple

    els = await siteElements(page);
    expect(els.map((e) => e.kind)).toEqual(["building", "surface", "tree", "hedge"]);
    expect(els[2].shape.r).toBeCloseTo(4, 0);
    expect(els[3].shape.points).toHaveLength(6);

    // Back to selecting; move the building and undo/redo the move.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Auswählen und verschieben" })).toHaveAttribute("aria-pressed", "true");
    const building = { x: c.x - 200, y: c.y - 140 };
    await page.mouse.click(building.x, building.y);
    await drag(building, { x: building.x + 50, y: building.y });
    const movedCx = (await siteElements(page))[0].shape.cx!;
    expect(movedCx - els[0].shape.cx!).toBeCloseTo(5, 0);
    await page.keyboard.press("Control+z");
    expect((await siteElements(page))[0].shape.cx).toBeCloseTo(els[0].shape.cx!, 3);
    await page.keyboard.press("Control+Shift+z");
    expect((await siteElements(page))[0].shape.cx).toBeCloseTo(movedCx, 3);

    // Drag a corner of the surface outwards.
    await page.mouse.click(c.x + 150, c.y - 120);
    await drag(poly[1], { x: poly[1].x + 50, y: poly[1].y });
    const surface = (await siteElements(page))[1];
    expect(surface.shape.points![2] - els[1].shape.points![2]).toBeCloseTo(5, 0);

    // Delete the tree with confirmation.
    await page.mouse.click(c.x - 200, c.y + 150);
    await expect(page.getByRole("region", { name: "Ausgewähltes Element" })).toContainText("Baum");
    await page.keyboard.press("Delete");
    await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
    expect((await siteElements(page)).map((e) => e.kind)).toEqual(["building", "surface", "hedge"]);

    await page.reload();
    await expect(page.getByTestId("site-canvas").locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    expect(await siteElements(page)).toHaveLength(3);
  });
});

test.describe("site plan on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("is view only", async ({ page }) => {
    await seed(page);
    await page.goto("/#/site");
    await expect(page.getByRole("heading", { level: 1, name: "Grundstück" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Der Lageplan wird am Computer angelegt.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Bild importieren" })).toHaveCount(0);
  });
});
