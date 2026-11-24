import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

process.env.DB_PATH = ":memory:";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function push(changes: unknown[]) {
  const res = await fetch(`${server.url}/api/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  return { status: res.status, body: (await res.json()) as { rev: number; error?: string } };
}

async function pull(since: number) {
  const res = await fetch(`${server.url}/api/changes?since=${since}`);
  return (await res.json()) as {
    rev: number;
    changes: Array<{ collection: string; id: string; version: number; deleted?: true; data?: Record<string, unknown> }>;
  };
}

describe("/api/changes", () => {
  it("starts empty", async () => {
    assert.deepEqual(await pull(0), { rev: 0, changes: [] });
  });

  it("hands out increasing revisions and returns only newer records", async () => {
    const first = await push([
      { collection: "harvests", id: "h1", data: { id: "h1", weightGrams: 100 } },
      { collection: "harvests", id: "h2", data: { id: "h2", weightGrams: 200 } },
    ]);
    assert.equal(first.status, 200);
    assert.equal(first.body.rev, 2);

    const second = await push([{ collection: "harvests", id: "h1", data: { id: "h1", weightGrams: 150 } }]);
    assert.equal(second.body.rev, 3);

    const newer = await pull(2);
    assert.equal(newer.rev, 3);
    assert.deepEqual(newer.changes.map((c) => [c.id, c.data?.weightGrams]), [["h1", 150]]);
  });

  it("keeps unknown fields verbatim", async () => {
    const data = { id: "s1", kind: "tree", future: { nested: [1, 2, 3] } };
    await push([{ collection: "siteElements", id: "s1", data }]);
    const all = await pull(0);
    assert.deepEqual(all.changes.find((c) => c.id === "s1")?.data, data);
  });

  it("propagates deletions as tombstones, but not into a first pull", async () => {
    const before = (await pull(0)).rev;
    await push([{ collection: "harvests", id: "h2", deleted: true }]);

    const incremental = await pull(before);
    assert.deepEqual(incremental.changes.map((c) => [c.id, c.deleted]), [["h2", true]]);

    const fresh = await pull(0);
    assert.equal(fresh.changes.some((c) => c.id === "h2"), false);
  });

  it("brings a deleted record back when it is written again", async () => {
    const before = (await pull(0)).rev;
    await push([{ collection: "harvests", id: "h2", data: { id: "h2", weightGrams: 5 } }]);
    const incremental = await pull(before);
    assert.deepEqual(incremental.changes.map((c) => [c.id, c.deleted, c.data?.weightGrams]), [["h2", undefined, 5]]);
  });

  it("rejects malformed input", async () => {
    assert.equal((await push([{ collection: "../etc", id: "x", data: {} }])).status, 400);
    assert.equal((await push([{ collection: "harvests", id: "", data: {} }])).status, 400);
    assert.equal((await push([{ collection: "harvests", id: "x" }])).status, 400);
    const res = await fetch(`${server.url}/api/changes?since=-1`);
    assert.equal(res.status, 400);
  });
});
