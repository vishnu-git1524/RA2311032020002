import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import axios, { AxiosError } from "axios";
import { log } from "../../logging_middleware/src/logger";
import {
  scoreAndSort,
  NotificationsApiResponse,
} from "./priority";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = "http://20.207.122.201/evaluation-service";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_TOKEN}` };

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());

// ── Request logging middleware ───────────────────────────────────────────────
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  await log("backend", "info", "middleware", `${req.method} ${req.originalUrl}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

/** Health check */
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "Notification App Backend is running" });
});

/** GET /notifications — sample notifications */
app.get("/notifications", async (_req: Request, res: Response) => {
  await log("backend", "info", "handler", "Fetching notifications");

  const notifications = [
    { id: 1, type: "reminder", message: "Oil change due in 3 days", read: false },
    { id: 2, type: "alert", message: "Tire pressure low", read: false },
    { id: 3, type: "info", message: "Service completed successfully", read: true },
  ];

  res.json(notifications);
});

/** POST /notifications — create a new notification */
app.post("/notifications", async (req: Request, res: Response) => {
  const { type, message } = req.body as { type?: string; message?: string };

  if (!type || !message) {
    await log("backend", "error", "handler", "Missing required fields in notification creation");
    res.status(400).json({ error: "type and message are required" });
    return;
  }

  await log("backend", "info", "handler", `Notification created: ${type}`);
  res.status(201).json({ id: Date.now(), type, message, read: false });
});

/**
 * GET /priority-notifications?limit=10
 *
 * Fetches notifications from the external evaluation service,
 * scores them by type weight + recency, and returns the top N.
 */
app.get("/priority-notifications", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 10);

    // ── 1. Fetch from external API ──────────────────────────────────────
    await log("backend", "info", "handler",
      `Priority notifications requested (limit=${limit})`);

    const response = await axios.get<NotificationsApiResponse>(
      `${BASE_URL}/notifications`,
      { headers: AUTH_HEADER, timeout: 10000 }
    );

    const raw = response.data.notifications;

    await log("backend", "info", "handler",
      `Fetched ${raw.length} notifications from external API`);

    // ── 2. Score and sort ───────────────────────────────────────────────
    const scored = scoreAndSort(raw);

    await log("backend", "info", "handler",
      `Scoring and sorting completed — returning top ${Math.min(limit, scored.length)} of ${scored.length}`);

    // ── 3. Return top N ─────────────────────────────────────────────────
    res.json({ notifications: scored.slice(0, limit) });
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status ?? "NETWORK_ERROR";
    const message = axiosErr.message || "Unknown error fetching notifications";

    await log("backend", "error", "handler",
      `Priority notifications failed: ${message} (${status})`);

    res.status(502).json({
      error: "Failed to fetch notifications",
      details: message,
    });
  }
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use(async (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  await log("backend", "fatal", "handler", `Unhandled error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Notification App Backend running on http://localhost:${PORT}`);
  log("backend", "info", "service", "Notification App Backend started");
});

export default app;
