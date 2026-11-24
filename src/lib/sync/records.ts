/**
 * Record sync: pure logic, no network.
 *
 * The store stays as it is. The sync looks at it as a flat set of records,
 * one per item of every synced collection plus one for the shared settings,
 * each addressed by "collection/id". For every record it remembers a hash of the
 * version both sides last agreed on (the "base"). Comparing the store against
 * the base tells which records changed, appeared or vanished on this device,
 * without the slices having to track anything.
 *
 * Records pass through unchanged: fields this code does not know about are
 * neither dropped nor rewritten.
 */

/** Collections that are arrays of records. New collections are added here. */
export const SYNCED_COLLECTIONS = [
  "gardens", "tasks", "harvests", "journalEntries", "expenses", "seeds",
  "soilTests", "amendments", "pests", "waterEntries", "animals",
  "animalProducts", "feedEntries", "healthEvents", "pantryItems",
  "customPlants", "seasonArchives",
] as const;

export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

/** Household-wide settings, synced as the single record settings/settings. */
export const SYNCED_SETTINGS = [
  "locale", "lastFrostDate", "gridCellSizeCm", "locationLat", "locationLon",
  "locationName", "locationRegion", "theme", "alerts",
] as const;

export const SETTINGS_COLLECTION = "settings";
export const SETTINGS_ID = "settings";

type Item = Record<string, unknown>;
type State = Record<string, unknown>;

export interface LocalRecord {
  collection: string;
  id: string;
  data: Item;
  hash: string;
}

export type Change =
  | { collection: string; id: string; deleted: true }
  | { collection: string; id: string; deleted?: false; data: Item };

/** What both sides last agreed on, persisted per backend. */
export interface SyncBase {
  backendUrl: string;
  /** Server epoch the revision belongs to; changes with every server start. */
  epoch?: string;
  /** Highest server revision this device has pulled. */
  rev: number;
  /** "collection/id" → hash of the agreed version. */
  hashes: Record<string, string>;
}

/**
 * Season archives predate ids; they are identified by garden, season and the
 * moment they were archived.
 */
export function recordId(collection: string, item: Item): string | null {
  if (typeof item.id === "string" && item.id) return item.id;
  if (collection === "seasonArchives" && typeof item.gardenId === "string") {
    return `${item.gardenId}@${String(item.season)}@${String(item.archivedAt)}`;
  }
  return null;
}

export function recordKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

/** cyrb53: fast, well-distributed 53-bit string hash. Not cryptographic. */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function hashRecord(data: unknown): string {
  return hashString(JSON.stringify(data));
}

export function settingsRecord(state: State): Item {
  return Object.fromEntries(SYNCED_SETTINGS.map((key) => [key, state[key]]));
}

/** Every synced record currently in the store. */
export function collectLocalRecords(state: State): Map<string, LocalRecord> {
  const records = new Map<string, LocalRecord>();
  for (const collection of SYNCED_COLLECTIONS) {
    const items = state[collection];
    if (!Array.isArray(items)) continue;
    for (const item of items as Item[]) {
      const id = recordId(collection, item);
      if (!id) continue;
      records.set(recordKey(collection, id), { collection, id, data: item, hash: hashRecord(item) });
    }
  }
  const settings = settingsRecord(state);
  records.set(recordKey(SETTINGS_COLLECTION, SETTINGS_ID), {
    collection: SETTINGS_COLLECTION,
    id: SETTINGS_ID,
    data: settings,
    hash: hashRecord(settings),
  });
  return records;
}

/** Records that changed on this device since the base: upserts and deletions. */
export function diffAgainstBase(local: Map<string, LocalRecord>, base: Record<string, string>): Change[] {
  const changes: Change[] = [];
  for (const [key, record] of local) {
    if (base[key] !== record.hash) {
      changes.push({ collection: record.collection, id: record.id, data: record.data });
    }
  }
  for (const key of Object.keys(base)) {
    if (local.has(key)) continue;
    const slash = key.indexOf("/");
    // The settings record is never deleted; a device without it simply has defaults.
    if (key.slice(0, slash) === SETTINGS_COLLECTION) continue;
    changes.push({ collection: key.slice(0, slash), id: key.slice(slash + 1), deleted: true });
  }
  return changes;
}

/** The base after the server accepted the given changes. */
export function baseAfterPush(base: Record<string, string>, pushed: Change[]): Record<string, string> {
  const next = { ...base };
  for (const change of pushed) {
    const key = recordKey(change.collection, change.id);
    if (change.deleted) delete next[key];
    else next[key] = hashRecord(change.data);
  }
  return next;
}

export interface RemoteChange {
  collection: string;
  id: string;
  deleted?: boolean;
  data?: Item;
}

export interface ApplyResult {
  /** Store fields to set; empty when nothing changed locally. */
  updates: State;
  hashes: Record<string, string>;
}

/**
 * Applies pulled changes to the store.
 *
 * A record that was edited on this device and not pushed yet keeps the local
 * version; it goes out with the next push and wins there. With one person
 * editing at a time that is the rare case, and the newer write winning is the
 * expected outcome.
 */
export function applyRemoteChanges(
  state: State,
  base: Record<string, string>,
  remote: RemoteChange[],
): ApplyResult {
  const hashes = { ...base };
  const local = collectLocalRecords(state);
  const collections = new Map<string, Item[]>();
  let settings: Item | null = null;

  const itemsOf = (collection: string): Item[] => {
    let items = collections.get(collection);
    if (!items) {
      items = [...((state[collection] as Item[] | undefined) ?? [])];
      collections.set(collection, items);
    }
    return items;
  };

  for (const change of remote) {
    const key = recordKey(change.collection, change.id);
    const mine = local.get(key);
    const dirty = mine ? base[key] !== mine.hash : key in base;
    const known = (SYNCED_COLLECTIONS as readonly string[]).includes(change.collection);
    const isSettings = change.collection === SETTINGS_COLLECTION && change.id === SETTINGS_ID;
    // A collection this version of the app does not know yet: leave it alone.
    if (!known && !isSettings) continue;

    if (change.deleted) {
      if (dirty && mine) continue; // edited here after the deletion; the edit wins
      delete hashes[key];
      if (!mine || isSettings) continue;
      const items = itemsOf(change.collection);
      const index = items.findIndex((item) => recordId(change.collection, item) === change.id);
      if (index >= 0) items.splice(index, 1);
      continue;
    }

    if (!change.data) continue;
    const remoteHash = hashRecord(change.data);
    if (mine && mine.hash === remoteHash) {
      hashes[key] = remoteHash; // already identical, e.g. our own push coming back
      continue;
    }
    if (dirty) continue;

    hashes[key] = remoteHash;
    if (isSettings) {
      settings = change.data;
      continue;
    }
    const items = itemsOf(change.collection);
    const index = items.findIndex((item) => recordId(change.collection, item) === change.id);
    if (index >= 0) items[index] = change.data;
    else items.push(change.data);
  }

  const updates: State = Object.fromEntries(collections);
  if (settings) {
    for (const key of SYNCED_SETTINGS) {
      const value = settings[key];
      if (value !== undefined && value !== null) updates[key] = value;
    }
  }
  return { updates, hashes };
}

/**
 * First contact with a backend: there is no base yet. Remote and local are
 * joined. Records only one side has survive; where both have a record, the
 * server's copy wins, because it is the household's shared state and this
 * device has never agreed with it. Local-only records are pushed afterwards
 * by the normal diff.
 */
export function initialBase(state: State, remote: RemoteChange[]): ApplyResult {
  // Treating every local record as clean lets the remote copy win the overlap;
  // local-only records have no base hash and stay dirty, so they get pushed.
  const local = collectLocalRecords(state);
  const pretendBase: Record<string, string> = {};
  for (const change of remote) {
    const key = recordKey(change.collection, change.id);
    const mine = local.get(key);
    if (mine) pretendBase[key] = mine.hash;
  }
  return applyRemoteChanges(state, pretendBase, remote);
}

/**
 * Joining again after the server's epoch changed, e.g. after its database was
 * restored from a backup. `remote` is the server's complete state including
 * tombstones.
 *
 * The old base still tells which local records are unpushed edits: those win
 * and go out with the next push. Clean records take the server's version. A
 * record the server has neither as a row nor as a tombstone was lost by the
 * restore; dropping its base hash makes the next push send it back.
 */
export function rejoinBase(state: State, oldBase: Record<string, string>, remote: RemoteChange[]): ApplyResult {
  const result = applyRemoteChanges(state, oldBase, remote);
  const onServer = new Set(remote.map((change) => recordKey(change.collection, change.id)));
  for (const key of Object.keys(result.hashes)) {
    if (!onServer.has(key)) delete result.hashes[key];
  }
  return result;
}
