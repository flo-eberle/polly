import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The app sends the access token (GARDENER_TOKEN) to its backend. The backend
 * is simulated here: it answers 401 unless the right bearer token comes along.
 */

const demoState = JSON.parse(readFileSync(new URL("./fixtures/demo-state.json", import.meta.url), "utf8")) as Record<string, unknown>;

async function fakeBackend(page: Page) {
  const auths: Array<string | null> = [];
  await page.route(/open-meteo\.com|openweathermap\.org/, (r) => r.abort());
  await page.route("**/api/health", (r) => r.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/changes**", (r) => {
    const auth = r.request().headers()["authorization"] ?? null;
    auths.push(auth);
    if (auth !== "Bearer secret") return r.fulfill({ status: 401, json: { error: "Unauthorized" } });
    return r.request().method() === "POST"
      ? r.fulfill({ json: { epoch: "e1", rev: 1 } })
      : r.fulfill({ json: { epoch: "e1", rev: 0, changes: [] } });
  });
  return auths;
}

test.use({ viewport: { width: 1440, height: 900 } });

test("a missing token shows up as access denied, the right one connects", async ({ page, baseURL }) => {
  const auths = await fakeBackend(page);
  await page.addInitScript(([state, url]) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("gardener-storage", JSON.stringify({ state: { ...state, backendUrl: url }, version: 4 }));
  }, [demoState, baseURL] as const);

  await page.goto("/#/settings");
  await expect(page.getByRole("status", { name: "Zugang verweigert: Token prüfen" })).toBeVisible({ timeout: 10_000 });
  const token = page.getByLabel("Zugangs-Token");
  await expect(page.getByText("Der Server hat den Token abgelehnt.")).toBeVisible();

  await token.fill("secret");
  await expect(page.getByRole("status", { name: "Mit dem Server verbunden" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Der Server hat den Token abgelehnt.")).toHaveCount(0);
  expect(auths).toContain("Bearer secret");
  expect(auths[0]).toBeNull();

  // The token stays on this device.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("gardener-storage")!).state.backendToken);
  expect(stored).toBe("secret");
});
