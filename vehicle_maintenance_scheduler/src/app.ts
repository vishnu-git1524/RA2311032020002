import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import axios, { AxiosError } from "axios";
import { log } from "../../logging_middleware/src/logger";
import { optimizeAllDepots, DepotInput } from "./knapsack";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = "http://20.207.122.201/evaluation-service";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_TOKEN}` };

// ── In-memory store ──────────────────────────────────────────────────────────
// API returns PascalCase fields
interface RawDepot {
  ID: number;
  MechanicHours: number;
}

interface RawVehicleTask {
  TaskID: string;
  Duration: number;
  Impact: number;
}

interface DepotsApiResponse {
  depots: RawDepot[];
}

interface VehiclesApiResponse {
  vehicles: RawVehicleTask[];
}

interface InMemoryStore {
  depots: RawDepot[] | null;
  vehicles: RawVehicleTask[] | null;
  lastFetchedAt: string | null;
}

const store: InMemoryStore = {
  depots: null,
  vehicles: null,
  lastFetchedAt: null,
};

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
  res.json({ status: "Vehicle Maintenance Scheduler is running" });
});

/** GET /optimize — fetch data & run 0/1 Knapsack optimization per depot */
app.get("/optimize", async (_req: Request, res: Response) => {
  try {
    // ── 1. Fetch raw data ─────────────────────────────────────────────────
    await log("backend", "info", "handler", "Fetching depot and vehicle data for optimization");

    const [depotsResponse, vehiclesResponse] = await Promise.all([
      axios.get<DepotsApiResponse>(`${BASE_URL}/depots`, { headers: AUTH_HEADER, timeout: 10000 }),
      axios.get<VehiclesApiResponse>(`${BASE_URL}/vehicles`, { headers: AUTH_HEADER, timeout: 10000 }),
    ]);

    // Unwrap from wrapper objects
    store.depots = depotsResponse.data.depots;
    store.vehicles = vehiclesResponse.data.vehicles;
    store.lastFetchedAt = new Date().toISOString();

    await log("backend", "info", "handler",
      `Fetched ${store.depots.length} depots and ${store.vehicles.length} tasks`);

    // ── 2. Build task lookup & knapsack inputs ────────────────────────────
    // All tasks are available for every depot (shared pool)
    const taskLookup = new Map<string, RawVehicleTask>();
    const allTasks = store.vehicles.map((t) => {
      taskLookup.set(t.TaskID, t);
      return { id: t.TaskID, duration: t.Duration, impact: t.Impact };
    });

    const depotInputs: DepotInput[] = store.depots.map((depot) => ({
      id: depot.ID,
      mechanicHours: depot.MechanicHours,
      tasks: allTasks,
    }));

    // ── 3. Run knapsack optimization ──────────────────────────────────────
    const totalTasks = depotInputs.reduce((sum, d) => sum + d.tasks.length, 0);
    await log("backend", "info", "handler",
      `Optimization started — ${depotInputs.length} depots, ${totalTasks} total tasks (space-optimized 0/1 Knapsack DP)`);

    const startTime = Date.now();
    const rawResults = optimizeAllDepots(depotInputs);
    const elapsed = Date.now() - startTime;

    // Log per-depot summaries
    for (const r of rawResults) {
      await log("backend", "info", "handler",
        `Depot ${r.depotId}: selected ${r.selectedTasks.length}/${r.tasksProcessed} tasks, ` +
        `impact=${r.totalImpact}, duration=${r.totalDuration}, solved in ${r.executionTimeMs}ms`);
    }

    const totalProcessed = rawResults.reduce((s, r) => s + r.tasksProcessed, 0);
    await log("backend", "info", "handler",
      `Optimization completed — ${totalProcessed} tasks processed across ${rawResults.length} depots in ${elapsed}ms`);

    // ── 4. Shape into required output format ──────────────────────────────
    const results = rawResults.map((r) => ({
      depotId: r.depotId,
      assignedTasks: r.selectedTasks.map((taskID) => {
        const task = taskLookup.get(taskID);
        return {
          taskID,
          duration: task?.Duration ?? 0,
          impact: task?.Impact ?? 0,
        };
      }),
      totalImpact: r.totalImpact,
      totalDuration: r.totalDuration,
    }));

    // ── 5. Return clean JSON ──────────────────────────────────────────────
    res.json({ results });
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status ?? "NETWORK_ERROR";
    const message = axiosErr.message || "Unknown error during optimization";

    await log("backend", "error", "handler",
      `Optimization failed: ${message} (${status})`);

    res.status(502).json({
      error: "Optimization failed",
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
  console.log(`Vehicle Maintenance Scheduler running on http://localhost:${PORT}`);
  log("backend", "info", "service", "Vehicle Maintenance Scheduler started");
});

export default app;
