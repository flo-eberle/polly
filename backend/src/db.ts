import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "./data/gardener.db";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gardens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      garden_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS state_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Record sync (/api/changes): one row per record, versioned by a global
    -- revision. Deleted records stay as tombstones so the deletion reaches
    -- every device.
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS records_version ON records (version);

    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  importSnapshotIntoRecords(db);
}

/** The highest revision handed out so far; 0 for an empty table. */
export function currentRevision(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS rev FROM records").get() as { rev: number };
  return row.rev;
}

/**
 * One-time hand-over from the old snapshot sync: when `records` is still empty
 * but a snapshot exists, every collection in it becomes a set of records and the
 * settings object becomes the single record settings/settings.
 */
function importSnapshotIntoRecords(db: Database.Database) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM records").get() as { count: number };
  if (count > 0) return;

  const row = db.prepare("SELECT data, updated_at FROM state_snapshot WHERE id = 1").get() as
    | { data: string; updated_at: string }
    | undefined;
  if (!row) return;

  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    console.warn("[gardener] stored snapshot is not valid JSON, skipping import into records");
    return;
  }

  const insert = db.prepare(
    "INSERT OR REPLACE INTO records (collection, id, data, version, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0)",
  );
  let version = 0;
  db.transaction(() => {
    for (const [collection, value] of Object.entries(snapshot)) {
      if (collection === "settings" && value && typeof value === "object" && !Array.isArray(value)) {
        insert.run("settings", "settings", JSON.stringify(value), ++version, row.updated_at);
        continue;
      }
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") continue;
        insert.run(collection, (item as { id: string }).id, JSON.stringify(item), ++version, row.updated_at);
      }
    }
  })();
  if (version > 0) console.log(`[gardener] imported ${version} records from the snapshot sync`);
}
