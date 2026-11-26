/**
 * Requests to Polly's own backend (sync, blobs). Adds the access token when one
 * is set and turns a 401 into an UnauthorizedError, so callers can tell "wrong
 * or missing token" apart from "backend unreachable".
 */

export interface BackendConfig {
  url: string;
  /** GARDENER_TOKEN of the backend; sent as a bearer token. */
  token?: string | null;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("backend rejected the access token");
    this.name = "UnauthorizedError";
  }
}

export async function backendFetch(config: BackendConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = config.token?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await (config.fetch ?? fetch)(`${config.url}${path}`, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError();
  return res;
}
