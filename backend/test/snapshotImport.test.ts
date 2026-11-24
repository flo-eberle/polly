import { it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "polly-import-"));
after(() => rmSync(dir, { recursive: true, force: true }));

it("turns an existing snapshot into records once", async () => {
  const path = join(dir, "gardener.db");
  const legacy = new Database(path);
  legacy.exec(`CREATE TABLE state_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  legacy
    .prepare("INSERT INTO state_snapshot (id, data, updated_at) VALUES (1, ?, ?)")
    .run(
      JSON.stringify({
        gardens: [{ id: "g1", name: "Hexenhaus", beds: [] }],
        harvests: [{ id: "h1" }, { id: "h2" }, { noId: true }],
        settings: { locale: "de" },
        savedAt: "2026-11-01T00:00:00.000Z",
      }),
      "2026-11-01T00:00:00.000Z",
    );
  legacy.close();

  process.env.DB_PATH = path;
  const { getDb, currentRevision } = await import("../src/db.js");
  const db = getDb();

  const rows = db.prepare("SELECT collection, id FROM records ORDER BY version").all();
  assert.deepEqual(rows, [
    { collection: "gardens", id: "g1" },
    { collection: "harvests", id: "h1" },
    { collection: "harvests", id: "h2" },
    { collection: "settings", id: "settings" },
  ]);
  assert.equal(currentRevision(db), 4);
});
