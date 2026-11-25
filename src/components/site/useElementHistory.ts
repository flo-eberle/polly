import { useCallback, useRef, useState } from "react";
import { useStore } from "@/store";
import type { SiteElement } from "@/types/site";

const LIMIT = 50;

/**
 * Undo/redo for the site plan elements: every edit stores the element list it
 * replaced. Snapshots are cheap, because unchanged elements are shared between
 * them. The history lives with the page and starts empty on every visit.
 */
export function useElementHistory() {
  const past = useRef<SiteElement[][]>([]);
  const future = useRef<SiteElement[][]>([]);
  // Mirrors the stack sizes for rendering; the stacks themselves live in refs.
  const [counts, setCounts] = useState({ past: 0, future: 0 });

  const lastKey = useRef<string | null>(null);

  /**
   * Stores `next` and remembers what it replaced. Consecutive commits with the
   * same `coalesceKey` (typing into one field) form a single undo step.
   */
  const commit = useCallback((next: SiteElement[], coalesceKey?: string) => {
    const { siteElements, replaceSiteElements } = useStore.getState();
    const coalesce = coalesceKey !== undefined && coalesceKey === lastKey.current && past.current.length > 0;
    lastKey.current = coalesceKey ?? null;
    if (!coalesce) past.current = [...past.current.slice(-(LIMIT - 1)), siteElements];
    future.current = [];
    replaceSiteElements(next);
    setCounts({ past: past.current.length, future: future.current.length });
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    lastKey.current = null;
    const { siteElements, replaceSiteElements } = useStore.getState();
    future.current = [...future.current, siteElements];
    replaceSiteElements(previous);
    setCounts({ past: past.current.length, future: future.current.length });
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    lastKey.current = null;
    const { siteElements, replaceSiteElements } = useStore.getState();
    past.current = [...past.current, siteElements];
    replaceSiteElements(next);
    setCounts({ past: past.current.length, future: future.current.length });
  }, []);

  return { commit, undo, redo, canUndo: counts.past > 0, canRedo: counts.future > 0 };
}
