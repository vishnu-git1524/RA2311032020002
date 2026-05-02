import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { log } from "../../logging_middleware/src/logger";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;

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
