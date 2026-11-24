import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/** Starts the app on a free port; DB_PATH must be set before this is imported. */
export async function startServer(options: { token?: string } = {}) {
  const { createApp } = await import("../src/app.js");
  const app = createApp({ token: options.token, rateLimitPerMinute: 10_000 });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
