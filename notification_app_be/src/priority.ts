/**
 * Priority scoring for notifications.
 * No external libraries — pure TypeScript implementation.
 *
 * Score = typeWeight + recencyScore
 *   - typeWeight:    "Placement" = 10, others = 5
 *   - recencyScore:  Normalized 0–10 based on how recent the notification is
 *                    relative to the oldest in the batch.
 */

// ── Raw shape from the external API ──────────────────────────────────────────
export interface RawNotification {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string; // e.g. "2026-04-22 17:51:30"
}

export interface NotificationsApiResponse {
  notifications: RawNotification[];
}

// ── Scored output ────────────────────────────────────────────────────────────
export interface ScoredNotification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  priorityScore: number;
}

// ── Type weights ─────────────────────────────────────────────────────────────
const TYPE_WEIGHTS: Record<string, number> = {
  Placement: 10,
};
const DEFAULT_WEIGHT = 5;

function getTypeWeight(type: string): number {
  return TYPE_WEIGHTS[type] ?? DEFAULT_WEIGHT;
}

/**
 * Compute priority scores for a batch of notifications.
 *
 * @param raw - Notifications from the external API
 * @returns   - Scored and sorted (descending) notifications
 */
export function scoreAndSort(raw: RawNotification[]): ScoredNotification[] {
  if (raw.length === 0) return [];

  // Parse timestamps once
  const withTime = raw.map((n) => ({
    ...n,
    parsedTime: new Date(n.Timestamp).getTime(),
  }));

  // Find oldest and newest for normalization
  let oldest = withTime[0].parsedTime;
  let newest = withTime[0].parsedTime;
  for (const n of withTime) {
    if (n.parsedTime < oldest) oldest = n.parsedTime;
    if (n.parsedTime > newest) newest = n.parsedTime;
  }

  const range = newest - oldest || 1; // avoid division by zero

  // Score each notification
  const scored: ScoredNotification[] = withTime.map((n) => {
    const typeWeight = getTypeWeight(n.Type);
    // Recency: 0 (oldest) → 10 (newest)
    const recencyScore = ((n.parsedTime - oldest) / range) * 10;
    const priorityScore = parseFloat((typeWeight + recencyScore).toFixed(2));

    return {
      id: n.ID,
      type: n.Type,
      message: n.Message,
      createdAt: n.Timestamp,
      priorityScore,
    };
  });

  // Sort descending by priorityScore (no external libraries)
  scored.sort((a, b) => b.priorityScore - a.priorityScore);

  return scored;
}
