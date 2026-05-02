import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import axios, { AxiosError } from "axios";
import { log } from "../../logging_middleware/src/logger";
import { scoreAndSort, NotificationsApiResponse } from "./priority";

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;

const evaluationServiceUrl = "http://20.207.122.201/evaluation-service";
const authToken = process.env.AUTH_TOKEN || "";
const authHeaders = { Authorization: `Bearer ${authToken}` };

app.use(express.json());

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  await log("backend", "info", "middleware", `${req.method} ${req.originalUrl}`);
  next();
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "Notification App Backend is running" });
});

app.get("/notifications", async (_req: Request, res: Response) => {
  await log("backend", "info", "handler", "Fetching notifications");

  const notificationList = [
    { id: 1, type: "reminder", message: "Oil change due in 3 days", read: false },
    { id: 2, type: "alert", message: "Tire pressure low", read: false },
    { id: 3, type: "info", message: "Service completed successfully", read: true },
  ];

  res.json(notificationList);
});

app.post("/notifications", async (req: Request, res: Response) => {
  const { type, message } = req.body as { type?: string; message?: string };

  if (!type || !message) {
    await log(
      "backend",
      "error",
      "handler",
      "Missing required fields in notification creation"
    );
    res.status(400).json({ error: "type and message are required" });
    return;
  }

  await log("backend", "info", "handler", `Notification created: ${type}`);
  res.status(201).json({ id: Date.now(), type, message, read: false });
});

app.get("/priority-notifications", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 10);

    await log(
      "backend",
      "info",
      "handler",
      `Priority notifications requested (limit=${limit})`
    );

    const response = await axios.get<NotificationsApiResponse>(
      `${evaluationServiceUrl}/notifications`,
      { headers: authHeaders, timeout: 10000 }
    );

    const externalNotifications = response.data.notifications;

    await log(
      "backend",
      "info",
      "handler",
      `Fetched ${externalNotifications.length} notifications from external API`
    );

    const priorityNotifications = scoreAndSort(externalNotifications);
    const returnedCount = Math.min(limit, priorityNotifications.length);

    await log(
      "backend",
      "info",
      "handler",
      `Scoring and sorting completed - returning top ${returnedCount} of ${priorityNotifications.length}`
    );

    res.json({ notifications: priorityNotifications.slice(0, limit) });
  } catch (error) {
    const requestError = error as AxiosError;
    const status = requestError.response?.status ?? "NETWORK_ERROR";
    const message = requestError.message || "Unknown error fetching notifications";

    await log(
      "backend",
      "error",
      "handler",
      `Priority notifications failed: ${message} (${status})`
    );

    res.status(502).json({
      error: "Failed to fetch notifications",
      details: message,
    });
  }
});

app.use(async (error: Error, _req: Request, res: Response, _next: NextFunction) => {
  await log("backend", "fatal", "handler", `Unhandled error: ${error.message}`);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Notification App Backend running on http://localhost:${port}`);
  log("backend", "info", "service", "Notification App Backend started");
});

export default app;
