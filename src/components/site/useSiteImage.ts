import { useEffect, useState } from "react";
import { ensureRemoteBlob, loadBlob } from "@/lib/blobStore";

export type SiteImageState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; image: HTMLImageElement }
  | { status: "missing" };

/**
 * Loads the background image by blob id: from IndexedDB, or from the backend
 * when this device does not have it yet. With a backend configured, a local
 * image the backend lacks is uploaded, so other devices can fetch it.
 */
export function useSiteImage(imageId: string | undefined, backendUrl: string | null, backendToken: string | null = null): SiteImageState {
  const [state, setState] = useState<{ id: string; value: SiteImageState } | null>(null);

  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const backend = backendUrl ? { url: backendUrl, token: backendToken } : null;

    void (async () => {
      const blob = await loadBlob(imageId, backend).catch(() => null);
      if (cancelled) return;
      if (!blob) {
        setState({ id: imageId, value: { status: "missing" } });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        if (!cancelled) setState({ id: imageId, value: { status: "ready", image } });
      };
      image.onerror = () => {
        if (!cancelled) setState({ id: imageId, value: { status: "missing" } });
      };
      image.src = objectUrl;

      // Best effort; a failed upload is retried the next time the page opens.
      if (backend) void ensureRemoteBlob(imageId, backend).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId, backendUrl, backendToken]);

  if (!imageId) return { status: "none" };
  if (!state || state.id !== imageId) return { status: "loading" };
  return state.value;
}
