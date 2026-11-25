import { useSyncExternalStore } from "react";

/**
 * Result of the latest sync round, shared between the hook that syncs (in the
 * top bar) and the places that only show it (settings). Not persisted.
 */
export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "unauthorized";

let status: SyncStatus = "idle";
const listeners = new Set<() => void>();

export function setSyncStatus(next: SyncStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSyncStatus,
    () => "idle",
  );
}
