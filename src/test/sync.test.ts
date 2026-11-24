import { describe, it, expect } from "vitest";
import {
  applyRemoteChanges,
  collectLocalRecords,
  diffAgainstBase,
  hashRecord,
  initialBase,
  recordId,
  type SyncBase,
} from "@/lib/sync/records";
import { runSyncRound, type SyncStore } from "@/lib/sync/client";

/**
 * Record sync. The backend is replaced by an in-memory double with the same
 * semantics as backend/src/routes/changes.ts (its own tests run there), so two
 * "devices" can be synced against each other here.
 */

type Item = Record<string, unknown>;

function fakeBackend() {
  const rows = new Map<string, { collection: string; id: string; data: Item | null; version: number; deleted: boolean }>();
  let rev = 0;
  let epoch = "epoch-1";
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (init?.method === "POST") {
      const { changes } = JSON.parse(String(init.body)) as {
        changes: Array<{ collection: string; id: string; deleted?: boolean; data?: Item }>;
      };
      for (const c of changes) {
        rows.set(`${c.collection}/${c.id}`, {
          collection: c.collection,
          id: c.id,
          data: c.deleted ? null : (JSON.parse(JSON.stringify(c.data)) as Item),
          version: ++rev,
          deleted: !!c.deleted,
        });
      }
      return new Response(JSON.stringify({ epoch, rev }));
    }
    const since = Number(url.searchParams.get("since") ?? 0);
    const tombstones = since > 0 || url.searchParams.get("tombstones") === "1";
    const changes = [...rows.values()]
      .filter((r) => (tombstones ? r.version > since : !r.deleted))
      .sort((a, b) => a.version - b.version)
      .map((r) => ({ collection: r.collection, id: r.id, version: r.version, ...(r.deleted ? { deleted: true } : { data: r.data }) }));
    return new Response(JSON.stringify({ epoch, rev, changes }));
  }) as typeof fetch;
  /** Simulates restoring the database from a backup taken earlier. */
  const snapshot = () => {
    const saved = { rows: new Map([...rows].map(([k, v]) => [k, { ...v }])), rev };
    return () => {
      rows.clear();
      for (const [k, v] of saved.rows) rows.set(k, v);
      rev = saved.rev;
      epoch = `epoch-${Math.random()}`; // a restore always comes with a restart
    };
  };
  const restart = () => {
    epoch = `epoch-${Math.random()}`;
  };
  return { fetchFn, rows, snapshot, restart };
}

const SETTINGS = {
  locale: "de", lastFrostDate: "2026-05-15", gridCellSizeCm: 30, locationLat: null, locationLon: null,
  locationName: "", locationRegion: "", theme: "system", alerts: { frostAlertEnabled: true },
};

function device(initial: Item = {}) {
  let state: Item & { syncBase: SyncBase | null } = { ...SETTINGS, harvests: [], gardens: [], seasonArchives: [], syncBase: null, ...initial };
  const store: SyncStore = {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial } as typeof state;
    },
  };
  return {
    store,
    get state() { return state; },
    set(partial: Item) { store.setState(partial); },
  };
}

const URL_ = "http://backend";
const h = (id: string, weightGrams = 100) => ({ id, plantId: "tomato", date: "2026-08-01", weightGrams });
const ids = (items: unknown) => (items as Item[]).map((i) => i.id);

describe("record helpers", () => {
  it("identifies season archives without an id", () => {
    expect(recordId("seasonArchives", { gardenId: "g1", season: "2025", archivedAt: "x" })).toBe("g1@2025@x");
    expect(recordId("harvests", { plantId: "x" })).toBeNull();
  });

  it("finds upserts and deletions against the base", () => {
    const local = collectLocalRecords({ ...SETTINGS, harvests: [h("a", 150), h("c")] });
    const base = {
      "harvests/a": hashRecord(h("a")),
      "harvests/b": hashRecord(h("b")),
      "settings/settings": [...local.values()].find((r) => r.collection === "settings")!.hash,
    };
    const changes = diffAgainstBase(local, base);
    expect(changes.map((c) => [c.id, !!c.deleted]).sort()).toEqual([["a", false], ["b", true], ["c", false]]);
  });

  it("keeps a local edit that is not pushed yet", () => {
    const state = { ...SETTINGS, harvests: [h("a", 999)] };
    const base = { "harvests/a": hashRecord(h("a")) };
    const { updates } = applyRemoteChanges(state, base, [{ collection: "harvests", id: "a", data: h("a", 200) }]);
    expect(updates.harvests).toBeUndefined();
  });

  it("ignores collections this version does not know", () => {
    const { updates } = applyRemoteChanges({ ...SETTINGS }, {}, [{ collection: "futureThings", id: "x", data: { id: "x" } }]);
    expect(updates).toEqual({});
  });

  it("lets the server win the overlap on first contact", () => {
    const state = { ...SETTINGS, harvests: [h("a", 1), h("local")] };
    const { updates } = initialBase(state, [{ collection: "harvests", id: "a", data: h("a", 2) }]);
    expect(updates.harvests).toEqual([h("a", 2), h("local")]);
  });
});

describe("sync rounds between two devices", () => {
  it("brings records, edits and deletions from one device to the other", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("1"), h("2")] });
    const b = device();

    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    expect(ids(b.state.harvests)).toEqual(["1", "2"]);

    a.set({ harvests: [h("1", 500)] }); // edit 1, delete 2
    await runSyncRound(a.store, URL_, "push", server.fetchFn);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    expect(b.state.harvests).toEqual([h("1", 500)]);
  });

  it("only sends what changed", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("1"), h("2")] });
    await runSyncRound(a.store, URL_, "full", server.fetchFn);

    a.set({ harvests: [h("1"), h("2", 7)] });
    const result = await runSyncRound(a.store, URL_, "push", server.fetchFn);
    expect(result.pushed).toBe(1);

    const again = await runSyncRound(a.store, URL_, "push", server.fetchFn);
    expect(again.pushed).toBe(0);
  });

  it("keeps the local-only records of a device that joins late", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("shared", 1)] });
    await runSyncRound(a.store, URL_, "full", server.fetchFn);

    const b = device({ harvests: [h("shared", 2), h("only-b")] });
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    expect(b.state.harvests).toEqual([h("shared", 1), h("only-b")]);

    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    expect(ids(a.state.harvests)).toEqual(["shared", "only-b"]);
  });

  it("does not resurrect a record deleted elsewhere", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("1")] });
    const b = device();
    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);

    b.set({ harvests: [] });
    await runSyncRound(b.store, URL_, "push", server.fetchFn);
    a.set({ harvests: [...(a.state.harvests as Item[]), h("new")] });
    await runSyncRound(a.store, URL_, "full", server.fetchFn);

    expect(ids(a.state.harvests)).toEqual(["new"]);
    expect(server.rows.get("harvests/1")?.deleted).toBe(true);
  });

  it("syncs settings and fields the app does not know yet", async () => {
    const server = fakeBackend();
    const a = device({ locale: "en", harvests: [{ ...h("1"), futureField: { x: 1 } }] });
    const b = device();
    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    expect(b.state.locale).toBe("en");
    expect((b.state.harvests as Item[])[0].futureField).toEqual({ x: 1 });
  });

  it("starts over when the backend URL changes", async () => {
    const first = fakeBackend();
    const second = fakeBackend();
    const a = device({ harvests: [h("1")] });
    await runSyncRound(a.store, URL_, "full", first.fetchFn);
    await runSyncRound(a.store, "http://other", "full", second.fetchFn);
    expect(second.rows.has("harvests/1")).toBe(true);
    expect(a.state.syncBase?.backendUrl).toBe("http://other");
  });

  it("joins afresh after the server database was restored from a backup", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("1")] });
    const b = device();
    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    const restore = server.snapshot();

    a.set({ harvests: [h("1"), h("after-backup")] });
    await runSyncRound(a.store, URL_, "push", server.fetchFn);
    restore(); // server loses "after-backup" and goes back to an older revision

    // b writes on the restored server; a must still see it.
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    b.set({ harvests: [...(b.state.harvests as Item[]), h("from-b")] });
    await runSyncRound(b.store, URL_, "push", server.fetchFn);

    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    expect(ids(a.state.harvests)).toEqual(["1", "after-backup", "from-b"]);
    expect(server.rows.has("harvests/after-backup")).toBe(true);
  });

  it("survives a plain server restart without resurrecting or losing anything", async () => {
    const server = fakeBackend();
    const a = device({ harvests: [h("1"), h("2")] });
    const b = device();
    await runSyncRound(a.store, URL_, "full", server.fetchFn);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);

    b.set({ harvests: [h("1")] }); // b deletes 2
    await runSyncRound(b.store, URL_, "push", server.fetchFn);
    a.set({ harvests: [h("1", 777), h("2")] }); // a edits 1 offline
    server.restart();

    const result = await runSyncRound(a.store, URL_, "full", server.fetchFn);
    expect(a.state.harvests).toEqual([h("1", 777)]);
    expect(result.pushed).toBe(1);
    await runSyncRound(b.store, URL_, "full", server.fetchFn);
    expect(b.state.harvests).toEqual([h("1", 777)]);
  });

  it("leaves the base untouched when the backend is unreachable", async () => {
    const a = device({ harvests: [h("1")] });
    const failing = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await expect(runSyncRound(a.store, URL_, "full", failing)).rejects.toThrow();
    expect(a.state.syncBase).toBeNull();
  });
});
