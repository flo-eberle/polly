import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store";
import { runSyncRound, type SyncMode, type SyncStore } from "@/lib/sync/client";
import { setSyncStatus } from "@/lib/sync/status";
import { UnauthorizedError } from "@/lib/backend";

/**
 * Record sync with the optional backend (see lib/sync/records.ts).
 *
 * - A store change pushes the changed records 2 s later.
 * - Every 30 s, when the window comes back into view and when the connection
 *   returns, the device also pulls what changed elsewhere.
 * - Offline nothing is lost: the diff against the agreed base is computed
 *   afresh each round, so pending changes go out once the backend is back.
 */

const PUSH_DELAY_MS = 2000;
const PULL_INTERVAL_MS = 30000;

export type SyncOutcome = { kind: "idle" } | { kind: "synced" } | { kind: "failed" } | { kind: "unauthorized" };

export function useBackendSync() {
  const backendUrl = useStore((s) => s.backendUrl);
  const backendToken = useStore((s) => s.backendToken);
  const [online, setOnline] = useState<{ url: string; ok: boolean } | null>(null);
  const connected = !!backendUrl && online?.url === backendUrl && online.ok;
  const [syncing, setSyncing] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome>({ kind: "idle" });

  const runningRef = useRef(false);
  const pendingRef = useRef<SyncMode | null>(null);
  /** Set while the sync writes into the store, so its own writes do not trigger a push. */
  const applyingRef = useRef(false);

  const sync = useCallback(
    async (mode: SyncMode) => {
      if (!backendUrl) return;
      if (runningRef.current) {
        // Remember the strongest request and run it once the current round is done.
        pendingRef.current = pendingRef.current === "full" || mode === "full" ? "full" : "push";
        return;
      }
      runningRef.current = true;
      setSyncing(true);

      const store: SyncStore = {
        getState: () => useStore.getState() as unknown as ReturnType<SyncStore["getState"]>,
        setState: (partial) => {
          applyingRef.current = true;
          try {
            useStore.setState(partial as never);
          } finally {
            applyingRef.current = false;
          }
        },
      };

      let next: SyncMode | null = mode;
      setSyncStatus("syncing");
      while (next) {
        pendingRef.current = null;
        try {
          await runSyncRound(store, backendUrl, next, fetch, backendToken);
          setOnline({ url: backendUrl, ok: true });
          setOutcome({ kind: "synced" });
          setSyncStatus("synced");
        } catch (error) {
          setOnline({ url: backendUrl, ok: false });
          const unauthorized = error instanceof UnauthorizedError;
          setOutcome({ kind: unauthorized ? "unauthorized" : "failed" });
          setSyncStatus(unauthorized ? "unauthorized" : "offline");
        }
        next = pendingRef.current;
      }
      runningRef.current = false;
      setSyncing(false);
    },
    [backendUrl, backendToken],
  );

  // Full round on start, on a timer, on focus and when the network returns.
  useEffect(() => {
    if (!backendUrl) return;
    const full = () => void sync("full");
    const onVisible = () => {
      if (document.visibilityState === "visible") full();
    };
    full();
    const interval = setInterval(full, PULL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", full);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", full);
    };
  }, [backendUrl, sync]);

  // Push shortly after local edits.
  useEffect(() => {
    if (!backendUrl) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useStore.subscribe(() => {
      if (applyingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void sync("push"), PUSH_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [backendUrl, sync]);

  const syncNow = useCallback(() => sync("full"), [sync]);

  return { connected, syncing, outcome, syncNow };
}
