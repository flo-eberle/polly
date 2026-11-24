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
