import {
  applyRemoteChanges,
  baseAfterPush,
  collectLocalRecords,
  diffAgainstBase,
  initialBase,
  type Change,
  type RemoteChange,
  type SyncBase,
} from "./records";

/**
 * One sync round against the record API: push what changed here, then pull
 * what changed elsewhere. The store is reached through the accessors so the
 * round can run against a test double.
 */

export interface SyncStore {
  getState: () => Record<string, unknown> & { syncBase: SyncBase | null };
  setState: (partial: Record<string, unknown>) => void;
}

export type SyncMode = "push" | "full";

export interface SyncRoundResult {
  pushed: number;
  pulled: number;
}

const PUSH_BATCH = 500;

interface PullResponse {
  rev: number;
  changes: RemoteChange[];
}

async function pull(fetchFn: typeof fetch, url: string, since: number): Promise<PullResponse> {
  const res = await fetchFn(`${url}/api/changes?since=${since}`);
  if (!res.ok) throw new Error(`pull responded ${res.status}`);
  return (await res.json()) as PullResponse;
}

async function push(fetchFn: typeof fetch, url: string, changes: Change[]): Promise<void> {
  const res = await fetchFn(`${url}/api/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  if (!res.ok) throw new Error(`push responded ${res.status}`);
}

/**
 * Runs one round. In "push" mode the pull is skipped unless this device had
 * nothing in common with the backend yet; store changes trigger "push", the
 * timer and window focus trigger "full".
 */
export async function runSyncRound(
  store: SyncStore,
  backendUrl: string,
  mode: SyncMode,
  fetchFn: typeof fetch = fetch,
): Promise<SyncRoundResult> {
  let pulled = 0;
  const stored = store.getState().syncBase;
  let base: SyncBase;

  if (stored && stored.backendUrl === backendUrl) {
    base = stored;
  } else {
    // First contact with this backend: join both sides before anything is pushed.
    const remote = await pull(fetchFn, backendUrl, 0);
    const { updates, hashes } = initialBase(store.getState(), remote.changes);
    base = { backendUrl, rev: remote.rev, hashes };
    store.setState({ ...updates, syncBase: base });
    pulled += remote.changes.length;
  }

  const changes = diffAgainstBase(collectLocalRecords(store.getState()), base.hashes);
  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const batch = changes.slice(i, i + PUSH_BATCH);
    await push(fetchFn, backendUrl, batch);
    // Re-read: a pull from another round must not be overwritten.
    const current: SyncBase = store.getState().syncBase ?? base;
    base = { ...current, hashes: baseAfterPush(current.hashes, batch) };
    store.setState({ syncBase: base });
  }

  if (mode === "full" || changes.length > 0) {
    const remote = await pull(fetchFn, backendUrl, base.rev);
    const current: SyncBase = store.getState().syncBase ?? base;
    const { updates, hashes } = applyRemoteChanges(store.getState(), current.hashes, remote.changes);
    store.setState({ ...updates, syncBase: { backendUrl, rev: remote.rev, hashes } });
    pulled += remote.changes.length;
  }

  return { pushed: changes.length, pulled };
}
