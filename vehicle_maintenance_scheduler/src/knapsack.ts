export interface Task {
  id: string;
  duration: number;
  impact: number;
}

export interface DepotInput {
  id: number;
  mechanicHours: number;
  tasks: Task[];
}

export interface DepotResult {
  depotId: number;
  selectedTasks: string[];
  totalImpact: number;
  totalDuration: number;
  tasksProcessed: number;
  executionTimeMs: number;
}

export interface KnapsackResult {
  selectedTasks: string[];
  totalImpact: number;
  totalDuration: number;
  tasksProcessed: number;
  executionTimeMs: number;
}

export function solveKnapsack(
  capacity: number,
  tasks: Task[]
): KnapsackResult {
  const startedAt = performance.now();
  const feasibleTasks = tasks.filter(
    (task) => task.duration > 0 && task.duration <= capacity
  );

  if (feasibleTasks.length === 0 || capacity <= 0) {
    return {
      selectedTasks: [],
      totalImpact: 0,
      totalDuration: 0,
      tasksProcessed: 0,
      executionTimeMs: parseFloat((performance.now() - startedAt).toFixed(2)),
    };
  }

  const taskCount = feasibleTasks.length;
  const dp = new Float64Array(capacity + 1);
  const rowSize = capacity + 1;
  const keep = new Uint8Array(taskCount * rowSize);

  for (let taskIndex = 0; taskIndex < taskCount; taskIndex++) {
    const task = feasibleTasks[taskIndex];
    const rowOffset = taskIndex * rowSize;

    // walk backwards so each task is used at most once
    for (let hours = capacity; hours >= task.duration; hours--) {
      const impactWithTask = dp[hours - task.duration] + task.impact;

      if (impactWithTask > dp[hours]) {
        dp[hours] = impactWithTask;
        keep[rowOffset + hours] = 1;
      }
    }
  }

  const selectedTasks: string[] = [];
  let totalDuration = 0;
  let remainingHours = capacity;

  for (let taskIndex = taskCount - 1; taskIndex >= 0; taskIndex--) {
    const task = feasibleTasks[taskIndex];

    if (keep[taskIndex * rowSize + remainingHours] === 1) {
      selectedTasks.push(task.id);
      totalDuration += task.duration;
      remainingHours -= task.duration;
    }
  }

  selectedTasks.sort();

  return {
    selectedTasks,
    totalImpact: dp[capacity],
    totalDuration,
    tasksProcessed: taskCount,
    executionTimeMs: parseFloat((performance.now() - startedAt).toFixed(2)),
  };
}

export function optimizeAllDepots(depots: DepotInput[]): DepotResult[] {
  return depots.map((depot) => ({
    depotId: depot.id,
    ...solveKnapsack(depot.mechanicHours, depot.tasks),
  }));
}
