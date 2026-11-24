import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { currentRevision, getDb } from "../db.js";

/**
 * Record sync.
 *
 * Every record is one row, keyed by (collection, id). Each write gets the next
 * global revision, so a client only has to remember the highest revision it has
 * seen and asks for everything newer. Deletions are kept as tombstones.
 *
 * Record contents are stored verbatim: the frontend owns their shape, and a
 * field this server does not know about must survive the round trip.
 *
 * The epoch changes with every start of the server. Revisions are only
 * comparable within one epoch: after the database was restored from a backup,
 * a device's last revision may point past the restored state. A device that
 * sees a new epoch therefore joins afresh (GET ?since=0&tombstones=1) and
 * pushes back whatever the server lost.
 */

const router = Router();
export const EPOCH = randomUUID();

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const ChangeSchema = z.union([
  z.object({
    collection: z.string().regex(NAME),
    id: z.string().min(1).max(200),
    deleted: z.literal(true),
  }),
  z.object({
    collection: z.string().regex(NAME),
    id: z.string().min(1).max(200),
    deleted: z.literal(false).optional(),
    data: z.record(z.string(), z.unknown()),
  }),
]);

const PushSchema = z.object({
  changes: z.array(ChangeSchema).max(1000),
});

interface RecordRow {
  collection: string;
  id: string;
  data: string | null;
  version: number;
  updated_at: string;
  deleted: number;
}

// GET /api/changes?since=<rev> — every record written after <rev>
router.get("/", (req, res) => {
  const since = Number(req.query.since ?? 0);
  if (!Number.isInteger(since) || since < 0) {
    res.status(400).json({ error: "since must be a non-negative integer" });
    return;
  }

  const db = getDb();
  // A first pull needs no tombstones unless asked for: a new device has nothing
  // to delete, but a device rejoining after a restore does.
  const withTombstones = since > 0 || req.query.tombstones === "1";
  const rows = db
    .prepare(
      withTombstones
        ? "SELECT * FROM records WHERE version > ? ORDER BY version"
        : "SELECT * FROM records WHERE deleted = 0 ORDER BY version",
    )
    .all(...(withTombstones ? [since] : [])) as RecordRow[];

  res.json({
    epoch: EPOCH,
    rev: currentRevision(db),
    changes: rows.map((r) => ({
      collection: r.collection,
      id: r.id,
      version: r.version,
      updatedAt: r.updated_at,
      ...(r.deleted ? { deleted: true } : { data: JSON.parse(r.data ?? "null") }),
    })),
  });
});

// POST /api/changes — upserts and deletions, applied in one transaction
router.post("/", (req, res) => {
  const result = PushSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.message });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO records (collection, id, data, version, updated_at, deleted)
     VALUES (@collection, @id, @data, @version, @now, @deleted)
     ON CONFLICT (collection, id) DO UPDATE SET
       data = excluded.data, version = excluded.version,
       updated_at = excluded.updated_at, deleted = excluded.deleted`,
  );

  const rev = db.transaction(() => {
    let version = currentRevision(db);
    for (const change of result.data.changes) {
      const deleted = change.deleted === true;
      upsert.run({
        collection: change.collection,
        id: change.id,
        data: deleted ? null : JSON.stringify((change as { data: unknown }).data),
        version: ++version,
        now,
        deleted: deleted ? 1 : 0,
      });
    }
    return version;
  })();

  res.json({ epoch: EPOCH, rev });
});

export default router;
