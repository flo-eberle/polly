/**
 * Preparing an imported background image for the site plan.
 */

/** Longest edge after import. Enough for a plot at a few cm per pixel. */
export const MAX_BACKGROUND_EDGE = 4096;

/** Scale guess until the user calibrates: 5 cm per pixel. */
export const DEFAULT_METERS_PER_PIXEL = 0.05;

const KEEP_AS_IS = /^image\/(png|jpeg|webp)$/;

/** Size that fits within `max` on the longest edge, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max = MAX_BACKGROUND_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Decodes the file and downscales it if it is larger than the limit. Small
 * PNG/JPEG/WebP files are kept byte for byte; everything else is re-encoded as
 * WebP (PNG where the browser cannot encode WebP), which keeps thin cadastral
 * lines sharper than JPEG.
 */
export async function prepareBackgroundImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const target = fitWithin(bitmap.width, bitmap.height);
    const unchanged = target.width === bitmap.width && target.height === bitmap.height;
    if (unchanged && KEEP_AS_IS.test(file.type)) {
      return { blob: file, width: bitmap.width, height: bitmap.height };
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
    if (!blob) throw new Error("image could not be encoded");
    return { blob, width: target.width, height: target.height };
  } finally {
    bitmap.close();
  }
}
