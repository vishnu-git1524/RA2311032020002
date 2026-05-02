export interface RawNotification {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string;
}

export interface NotificationsApiResponse {
  notifications: RawNotification[];
}

export interface ScoredNotification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  priorityScore: number;
}

const typeWeights: Record<string, number> = {
  Placement: 10,
};

const defaultTypeWeight = 5;

function getTypeWeight(type: string): number {
  return typeWeights[type] ?? defaultTypeWeight;
}

export function scoreAndSort(
  notifications: RawNotification[]
): ScoredNotification[] {
  if (notifications.length === 0) return [];

  const notificationsWithTime = notifications.map((notification) => ({
    ...notification,
    parsedTime: new Date(notification.Timestamp).getTime(),
  }));

  let oldestTime = notificationsWithTime[0].parsedTime;
  let newestTime = notificationsWithTime[0].parsedTime;

  for (const notification of notificationsWithTime) {
    if (notification.parsedTime < oldestTime) oldestTime = notification.parsedTime;
    if (notification.parsedTime > newestTime) newestTime = notification.parsedTime;
  }

  const timeRange = newestTime - oldestTime || 1;

  const scoredNotifications = notificationsWithTime.map((notification) => {
    const typeWeight = getTypeWeight(notification.Type);
    const recencyScore =
      ((notification.parsedTime - oldestTime) / timeRange) * 10;
    const priorityScore = parseFloat((typeWeight + recencyScore).toFixed(2));

    return {
      id: notification.ID,
      type: notification.Type,
      message: notification.Message,
      createdAt: notification.Timestamp,
      priorityScore,
    };
  });

  return scoredNotifications.sort(
    (current, next) => next.priorityScore - current.priorityScore
  );
}
