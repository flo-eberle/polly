import { describe, it, expect } from "vitest";
import { UnauthorizedError, backendFetch } from "@/lib/backend";
import { runSyncRound, type SyncStore } from "@/lib/sync/client";
import { ensureRemoteBlob } from "@/lib/blobStore";
import { collectLocalRecords } from "@/lib/sync/records";
import { buildExportData } from "@/lib/dataExport";
import { useStore } from "@/store";
import type { SyncBase } from "@/lib/sync/records";

/** A backend that wants `Bearer secret` and records what it received. */
function guardedBackend() {
  const seen: Array<{ url: string; method: string; auth: string | null }> = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    seen.push({ url: input, method: init?.method ?? "GET", auth });
    if (auth !== "Bearer secret") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    if (input.includes("/api/blobs/")) return new Response(null, { status: init?.method === "HEAD" ? 404 : 201 });
    if (init?.method === "POST") return new Response(JSON.stringify({ epoch: "e", rev: 1 }));
    return new Response(JSON.stringify({ epoch: "e", rev: 0, changes: [] }));
  }) as typeof fetch;
  return { fetchFn, seen };
}

function device(): SyncStore {
  let state: Record<string, unknown> & { syncBase: SyncBase | null } = { harvests: [{ id: "h1" }], syncBase: null };
  return { getState: () => state, setState: (p) => { state = { ...state, ...p } as typeof state; } };
}

describe("backend token", () => {
  it("sends a trimmed bearer token only when one is set", async () => {
    const { fetchFn, seen } = guardedBackend();
    await backendFetch({ url: "http://b", token: "  secret ", fetch: fetchFn }, "/api/changes?since=0");
    await expect(backendFetch({ url: "http://b", token: null, fetch: fetchFn }, "/api/changes?since=0")).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(backendFetch({ url: "http://b", token: "   ", fetch: fetchFn }, "/api/changes?since=0")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer secret", null, null]);
  });

  it("syncs with the token and reports a rejected one as unauthorized", async () => {
    const { fetchFn, seen } = guardedBackend();
    await expect(runSyncRound(device(), "http://b", "full", fetchFn, null)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(runSyncRound(device(), "http://b", "full", fetchFn, "wrong")).rejects.toBeInstanceOf(UnauthorizedError);

    const ok = device();
    const result = await runSyncRound(ok, "http://b", "full", fetchFn, "secret");
    expect(result.pushed).toBeGreaterThan(0);
    // Every request of the successful round carried the token: pull, push, pull.
    const lastRound = seen.slice(-3);
    expect(lastRound.map((s) => [s.method, s.auth])).toEqual([["GET", "Bearer secret"], ["POST", "Bearer secret"], ["GET", "Bearer secret"]]);
  });

  it("sends the token with blob uploads", async () => {
    const { fetchFn, seen } = guardedBackend();
    const result = await ensureRemoteBlob("site-bg-1", { url: "http://b", token: "secret", fetch: fetchFn }, async () => new Blob(["x"], { type: "image/png" }));
    expect(result).toBe("uploaded");
    expect(seen.every((s) => s.auth === "Bearer secret")).toBe(true);
  });

  it("keeps the token on the device: not synced, not exported", () => {
    useStore.setState({ backendToken: "secret" });
    const records = collectLocalRecords(useStore.getState() as unknown as Record<string, unknown>);
    expect(JSON.stringify([...records.values()])).not.toContain("secret");
    expect(JSON.stringify(buildExportData())).not.toContain("secret");
    useStore.setState({ backendToken: null });
  });
});
