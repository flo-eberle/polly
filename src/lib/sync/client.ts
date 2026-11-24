import {
  applyRemoteChanges,
  baseAfterPush,
  collectLocalRecords,
  diffAgainstBase,
  initialBase,
  rejoinBase,
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
  epoch?: string;
  rev: number;
  changes: RemoteChange[];
}

async function pull(fetchFn: typeof fetch, url: string, since: number, tombstones = false): Promise<PullResponse> {
  const res = await fetchFn(`${url}/api/changes?since=${since}${tombstones ? "&tombstones=1" : ""}`);
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
    base = { backendUrl, epoch: remote.epoch, rev: remote.rev, hashes };
    store.setState({ ...updates, syncBase: base });
    pulled += remote.changes.length;
  }

  let pushed = await pushChanges(store, backendUrl, base, fetchFn);

  if (mode === "full" || pushed > 0) {
    base = store.getState().syncBase ?? base;
    const remote = await pull(fetchFn, backendUrl, base.rev);

    if (remote.epoch !== base.epoch) {
      // The server restarted, maybe on a restored database: revisions from
      // before are not comparable. Rejoin from its complete state.
      const full = await pull(fetchFn, backendUrl, 0, true);
      const current: SyncBase = store.getState().syncBase ?? base;
      const { updates, hashes } = rejoinBase(store.getState(), current.hashes, full.changes);
      store.setState({ ...updates, syncBase: { backendUrl, epoch: full.epoch, rev: full.rev, hashes } });
      pulled += full.changes.length;
      pushed += await pushChanges(store, backendUrl, store.getState().syncBase!, fetchFn);
      return { pushed, pulled };
    }

    const current: SyncBase = store.getState().syncBase ?? base;
    const { updates, hashes } = applyRemoteChanges(store.getState(), current.hashes, remote.changes);
    store.setState({ ...updates, syncBase: { backendUrl, epoch: remote.epoch, rev: remote.rev, hashes } });
    pulled += remote.changes.length;
  }

  return { pushed, pulled };
}

/** Pushes everything that differs from the base, in batches. */
async function pushChanges(store: SyncStore, backendUrl: string, base: SyncBase, fetchFn: typeof fetch): Promise<number> {
  const changes = diffAgainstBase(collectLocalRecords(store.getState()), base.hashes);
  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const batch = changes.slice(i, i + PUSH_BATCH);
    await push(fetchFn, backendUrl, batch);
    // Re-read: another round may have moved the base meanwhile.
    const current: SyncBase = store.getState().syncBase ?? base;
    store.setState({ syncBase: { ...current, hashes: baseAfterPush(current.hashes, batch) } });
  }
  return changes.length;
}
