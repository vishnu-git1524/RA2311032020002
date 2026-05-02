import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import axios, { AxiosError } from "axios";
import { log } from "../../logging_middleware/src/logger";
import { optimizeAllDepots, DepotInput } from "./knapsack";

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const evaluationServiceUrl = "http://20.207.122.201/evaluation-service";
const authToken = process.env.AUTH_TOKEN || "";
const authHeaders = { Authorization: `Bearer ${authToken}` };

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

interface MaintenanceStore {
  depots: RawDepot[] | null;
  vehicles: RawVehicleTask[] | null;
  lastFetchedAt: string | null;
}

const maintenanceStore: MaintenanceStore = {
  depots: null,
  vehicles: null,
  lastFetchedAt: null,
};

app.use(express.json());

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  await log("backend", "info", "middleware", `${req.method} ${req.originalUrl}`);
  next();
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "Vehicle Maintenance Scheduler is running" });
});

app.get("/optimize", async (_req: Request, res: Response) => {
  try {
    await log(
      "backend",
      "info",
      "handler",
      "Fetching depot and vehicle data for optimization"
    );

    const [depotsResponse, vehiclesResponse] = await Promise.all([
      axios.get<DepotsApiResponse>(`${evaluationServiceUrl}/depots`, {
        headers: authHeaders,
        timeout: 10000,
      }),
      axios.get<VehiclesApiResponse>(`${evaluationServiceUrl}/vehicles`, {
        headers: authHeaders,
        timeout: 10000,
      }),
    ]);

    maintenanceStore.depots = depotsResponse.data.depots;
    maintenanceStore.vehicles = vehiclesResponse.data.vehicles;
    maintenanceStore.lastFetchedAt = new Date().toISOString();

    await log(
      "backend",
      "info",
      "handler",
      `Fetched ${maintenanceStore.depots.length} depots and ${maintenanceStore.vehicles.length} tasks`
    );

    const taskLookup = new Map<string, RawVehicleTask>();
    const availableTasks = maintenanceStore.vehicles.map((task) => {
      taskLookup.set(task.TaskID, task);
      return {
        id: task.TaskID,
        duration: task.Duration,
        impact: task.Impact,
      };
    });

    const depotInputs: DepotInput[] = maintenanceStore.depots.map((depot) => ({
      id: depot.ID,
      mechanicHours: depot.MechanicHours,
      tasks: availableTasks,
    }));

    const taskCount = depotInputs.reduce(
      (total, depot) => total + depot.tasks.length,
      0
    );

    await log(
      "backend",
      "info",
      "handler",
      `Optimization started - ${depotInputs.length} depots, ${taskCount} total tasks (space-optimized 0/1 Knapsack DP)`
    );

    const startedAt = Date.now();
    const depotResults = optimizeAllDepots(depotInputs);
    const elapsedMs = Date.now() - startedAt;

    for (const depotResult of depotResults) {
      await log(
        "backend",
        "info",
        "handler",
        `Depot ${depotResult.depotId}: selected ${depotResult.selectedTasks.length}/${depotResult.tasksProcessed} tasks, ` +
          `impact=${depotResult.totalImpact}, duration=${depotResult.totalDuration}, solved in ${depotResult.executionTimeMs}ms`
      );
    }

    const processedTaskCount = depotResults.reduce(
      (total, depotResult) => total + depotResult.tasksProcessed,
      0
    );

    await log(
      "backend",
      "info",
      "handler",
      `Optimization completed - ${processedTaskCount} tasks processed across ${depotResults.length} depots in ${elapsedMs}ms`
    );

    const results = depotResults.map((depotResult) => ({
      depotId: depotResult.depotId,
      assignedTasks: depotResult.selectedTasks.map((taskId) => {
        const task = taskLookup.get(taskId);

        return {
          taskID: taskId,
          duration: task?.Duration ?? 0,
          impact: task?.Impact ?? 0,
        };
      }),
      totalImpact: depotResult.totalImpact,
      totalDuration: depotResult.totalDuration,
    }));

    res.json({ results });
  } catch (error) {
    const requestError = error as AxiosError;
    const status = requestError.response?.status ?? "NETWORK_ERROR";
    const message = requestError.message || "Unknown error during optimization";

    await log(
      "backend",
      "error",
      "handler",
      `Optimization failed: ${message} (${status})`
    );

    res.status(502).json({
      error: "Optimization failed",
      details: message,
    });
  }
});

app.use(async (error: Error, _req: Request, res: Response, _next: NextFunction) => {
  await log("backend", "fatal", "handler", `Unhandled error: ${error.message}`);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Vehicle Maintenance Scheduler running on http://localhost:${port}`);
  log("backend", "info", "service", "Vehicle Maintenance Scheduler started");
});

export default app;
