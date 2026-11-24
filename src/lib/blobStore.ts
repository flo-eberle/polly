/**
 * Binary data addressed by id: the site plan background now, journal photos
 * later. Locally in IndexedDB, on the backend under /api/blobs/:id.
 *
 * Blobs are immutable: a changed image gets a new id, so a copy that exists
 * is always the right one and syncing is "upload if missing, download if
 * missing".
 */

const DB_NAME = "gardener-blobs";
const STORE = "blobs";
const DB_VERSION = 1;

/** Same rule as the backend: letters, digits, "-" and "_". */
export const BLOB_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function newBlobId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A failed open must not stick; the next call tries again.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  if (!BLOB_ID.test(id)) throw new Error(`invalid blob id: ${id}`);
  await tx("readwrite", (store) => store.put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | null> {
  const blob = await tx<Blob | undefined>("readonly", (store) => store.get(id));
  return blob ?? null;
}

export async function deleteBlob(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

// --- Backend ---------------------------------------------------------------

export interface BlobBackend {
  url: string;
  fetch?: typeof fetch;
}

/** Uploads the local blob unless the backend already has it. */
export async function ensureRemoteBlob(
  id: string,
  backend: BlobBackend,
  readLocal: (id: string) => Promise<Blob | null> = getBlob,
): Promise<"present" | "uploaded" | "missing-local"> {
  const doFetch = backend.fetch ?? fetch;
  const head = await doFetch(`${backend.url}/api/blobs/${id}`, { method: "HEAD" });
  if (head.ok) return "present";
  if (head.status !== 404) throw new Error(`blob check responded ${head.status}`);
  const blob = await readLocal(id);
  if (!blob) return "missing-local";
  const put = await doFetch(`${backend.url}/api/blobs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!put.ok) throw new Error(`blob upload responded ${put.status}`);
  return "uploaded";
}

/** Returns the local blob, fetching and caching it from the backend if needed. */
export async function loadBlob(
  id: string,
  backend: BlobBackend | null,
  local: { get: (id: string) => Promise<Blob | null>; put: (id: string, blob: Blob) => Promise<void> } = {
    get: getBlob,
    put: putBlob,
  },
): Promise<Blob | null> {
  const cached = await local.get(id).catch(() => null);
  if (cached) return cached;
  if (!backend) return null;
  const res = await (backend.fetch ?? fetch)(`${backend.url}/api/blobs/${id}`);
  if (!res.ok) return null;
  const blob = await res.blob();
  await local.put(id, blob).catch(() => undefined);
  return blob;
}

// --- Backup ----------------------------------------------------------------

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
