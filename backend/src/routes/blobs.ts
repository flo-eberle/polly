import express, { Router } from "express";
import { getDb } from "../db.js";

/**
 * Binary data that does not belong in a record: the site plan background and,
 * later, journal photos. Records only carry the blob id.
 *
 * Blobs are immutable. A client that changes an image uploads a new blob under
 * a new id, so a cached copy can never be stale.
 */

const router = Router();

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ALLOWED_MIME = /^image\/(png|jpeg|webp|gif)$/;
export const MAX_BLOB_BYTES = 20 * 1024 * 1024;

router.put("/:id", express.raw({ type: () => true, limit: MAX_BLOB_BYTES }), (req, res) => {
  const { id } = req.params;
  const mime = (req.get("content-type") ?? "").split(";")[0].trim();
  if (!ID.test(id)) {
    res.status(400).json({ error: "Invalid blob id" });
    return;
  }
  if (!ALLOWED_MIME.test(mime)) {
    res.status(415).json({ error: "Unsupported media type" });
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "Empty body" });
    return;
  }

  getDb()
    .prepare("INSERT OR IGNORE INTO blobs (id, mime, data) VALUES (?, ?, ?)")
    .run(id, mime, req.body);
  res.status(201).json({ id });
});

router.get("/:id", (req, res) => {
  const { id } = req.params;
  if (!ID.test(id)) {
    res.status(400).json({ error: "Invalid blob id" });
    return;
  }
  const row = getDb().prepare("SELECT mime, data FROM blobs WHERE id = ?").get(id) as
    | { mime: string; data: Buffer }
    | undefined;
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.set("Content-Type", row.mime);
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.send(row.data);
});

export default router;
