import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import gardensRouter from "./routes/gardens.js";
import tasksRouter from "./routes/tasks.js";
import syncRouter from "./routes/sync.js";
import changesRouter from "./routes/changes.js";
import blobsRouter from "./routes/blobs.js";
import { createAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";

export interface AppOptions {
  token?: string;
  allowedOrigins?: string[];
  /** Requests per minute per IP on /api; tests raise it. */
  rateLimitPerMinute?: number;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  app.use(cors({
    origin: options.allowedOrigins ?? ["http://localhost:5173", "http://localhost:4173", "http://localhost:8080"],
  }));

  app.use("/api/", rateLimit({
    windowMs: 60 * 1000,
    max: options.rateLimitPerMinute ?? 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }));
  app.use("/api/", createAuth(options.token));

  // Blobs take a raw body, so they are mounted before the JSON parser.
  app.use("/api/blobs", blobsRouter);
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/gardens", gardensRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/changes", changesRouter);

  app.use("/api/", notFound);
  app.use(errorHandler);

  return app;
}
