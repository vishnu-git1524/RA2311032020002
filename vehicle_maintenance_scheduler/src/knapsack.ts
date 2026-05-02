/**
 * Space-optimized 0/1 Knapsack solver using bottom-up dynamic programming.
 * No external libraries — pure TypeScript implementation.
 *
 * Optimizations over the naive O(n × capacity) 2D table:
 *   1. 1D rolling dp array   → O(capacity) value storage
 *   2. Uint8Array keep matrix → 1 byte/cell vs 8 bytes for a number[][]
 *   3. Pre-filter tasks that exceed capacity (skips impossible items)
 *   4. Tight inner-loop bounds (iterate only [weight … capacity])
 */

export interface Task {
  id: string;
  duration: number; // weight
  impact: number;   // value
}

export interface DepotInput {
  id: number;
  mechanicHours: number; // capacity
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

/**
 * Solves the 0/1 Knapsack problem for a single depot.
 *
 * @param capacity - Maximum mechanic hours available (knapsack capacity)
 * @param tasks    - Array of tasks with duration (weight) and impact (value)
 * @returns        - Selected task IDs, total impact, total duration, and perf metrics
 *
 * Time:  O(n × capacity)
 * Space: O(capacity) for dp values + O(n × capacity) bits for backtracking
 *        (Uint8Array uses ~8× less memory than a number[][])
 */
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
  const start = performance.now();

  // ── Pre-filter: discard tasks that can never fit ──────────────────────────
  const feasible = tasks.filter((t) => t.duration > 0 && t.duration <= capacity);
  const n = feasible.length;

  if (n === 0 || capacity <= 0) {
    return {
      selectedTasks: [],
      totalImpact: 0,
      totalDuration: 0,
      tasksProcessed: 0,
      executionTimeMs: parseFloat((performance.now() - start).toFixed(2)),
    };
  }

  // ── 1D rolling DP array ──────────────────────────────────────────────────
  // dp[w] = max impact achievable with capacity w
  const dp = new Float64Array(capacity + 1); // zero-initialized

  // Keep matrix for backtracking (1 = item taken at this cell)
  // Flat Uint8Array: keep[i * stride + w],  stride = capacity + 1
  const stride = capacity + 1;
  const keep = new Uint8Array(n * stride); // ~1 byte/cell

  for (let i = 0; i < n; i++) {
    const weight = feasible[i].duration;
    const value = feasible[i].impact;
    const rowOffset = i * stride;

    // Traverse capacity RIGHT-TO-LEFT so each item is considered at most once
    for (let w = capacity; w >= weight; w--) {
      const withItem = dp[w - weight] + value;
      if (withItem > dp[w]) {
        dp[w] = withItem;
        keep[rowOffset + w] = 1;
      }
    }
  }

  // ── Backtrack to recover selected items ──────────────────────────────────
  const selectedTasks: string[] = [];
  let totalDuration = 0;
  let w = capacity;

  for (let i = n - 1; i >= 0; i--) {
    if (keep[i * stride + w] === 1) {
      selectedTasks.push(feasible[i].id);
      totalDuration += feasible[i].duration;
      w -= feasible[i].duration;
    }
  }

  selectedTasks.sort();

  return {
    selectedTasks,
    totalImpact: dp[capacity],
    totalDuration,
    tasksProcessed: n,
    executionTimeMs: parseFloat((performance.now() - start).toFixed(2)),
  };
}

/**
 * Runs knapsack optimization across all depots.
 * Each depot is independent — O(depots × n_i × capacity_i) total.
 */
export function optimizeAllDepots(depots: DepotInput[]): DepotResult[] {
  return depots.map((depot) => {
    const result = solveKnapsack(depot.mechanicHours, depot.tasks);
    return { depotId: depot.id, ...result };
  });
}
