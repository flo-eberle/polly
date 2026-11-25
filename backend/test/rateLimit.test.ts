import { it, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.DB_PATH = ":memory:";

let server: Server | undefined;
after(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

it("rate-limits per client behind trusted proxies, not per proxy", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp({ rateLimitPerMinute: 2, trustProxy: 2 });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/changes?since=0`;
  // As seen behind NPM and the container's nginx: client, NPM.
  const from = (client: string) => fetch(url, { headers: { "X-Forwarded-For": `${client}, 10.0.0.2` } }).then((r) => r.status);

  assert.deepEqual([await from("203.0.113.1"), await from("203.0.113.1"), await from("203.0.113.1")], [200, 200, 429]);
  // Another household device still gets through.
  assert.equal(await from("203.0.113.2"), 200);
});
