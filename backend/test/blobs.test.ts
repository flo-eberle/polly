import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

process.env.DB_PATH = ":memory:";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer({ token: "secret" }); });
after(async () => { await server.close(); });

const auth = { Authorization: "Bearer secret" };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("/api/blobs", () => {
  it("stores and serves a blob with its media type", async () => {
    const put = await fetch(`${server.url}/api/blobs/bg-1`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "image/png" },
      body: png,
    });
    assert.equal(put.status, 201);

    const get = await fetch(`${server.url}/api/blobs/bg-1`, { headers: auth });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await get.arrayBuffer()), png);
  });

  it("requires the token", async () => {
    const res = await fetch(`${server.url}/api/blobs/bg-1`);
    assert.equal(res.status, 401);
  });

  it("rejects other media types, bad ids and unknown blobs", async () => {
    const wrongType = await fetch(`${server.url}/api/blobs/x`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "text/html" },
      body: "<script></script>",
    });
    assert.equal(wrongType.status, 415);

    const badId = await fetch(`${server.url}/api/blobs/a.b`, { headers: auth });
    assert.equal(badId.status, 400);

    const missing = await fetch(`${server.url}/api/blobs/nope`, { headers: auth });
    assert.equal(missing.status, 404);
  });

  it("still parses JSON on the other routes", async () => {
    const res = await fetch(`${server.url}/api/changes`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    });
    assert.equal(res.status, 200);
  });
});
