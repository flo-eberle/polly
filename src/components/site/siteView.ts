import type { SiteElement } from "@/types/site";

/**
 * Which elements a plan view shows:
 * - all: everything
 * - current: what is there today (existing and to be removed)
 * - target: what there will be (existing and planned)
 */
export type SiteView = "all" | "current" | "target";

export function isVisibleInView(element: Pick<SiteElement, "status">, view: SiteView): boolean {
  const status = element.status ?? "existing";
  if (view === "current") return status !== "planned";
  if (view === "target") return status !== "remove";
  return true;
}
