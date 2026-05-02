# Stage 1: Notification System Design

## Overview

REST API design for a backend notification platform that supports sending, retrieving, updating, and deleting notifications with real-time delivery capabilities.

---

## Common Headers

| Header          | Value                 | Required |
|-----------------|-----------------------|----------|
| Authorization   | `Bearer <token>`      | Yes      |
| Content-Type    | `application/json`    | Yes      |

---

## API Endpoints

### A. `POST /notifications/send`

Send a notification to one or multiple users.

**Request Body**

```json
{
  "userIds": ["user_01", "user_02"],
  "title": "Maintenance Alert",
  "message": "Your vehicle service is due tomorrow.",
  "type": "info"
}
```

| Field     | Type       | Description                             |
|-----------|------------|-----------------------------------------|
| userIds   | `string[]` | List of target user IDs                 |
| title     | `string`   | Notification title                      |
| message   | `string`   | Notification body                       |
| type      | `string`   | One of: `info`, `alert`, `warning`      |

**Response** — `201 Created`

```json
{
  "status": "success",
  "notificationId": "ntf_a3f8c912"
}
```

---

### B. `GET /notifications/{userId}`

Fetch all notifications for a specific user.

**Response** — `200 OK`

```json
{
  "notifications": [
    {
      "id": "ntf_a3f8c912",
      "title": "Maintenance Alert",
      "message": "Your vehicle service is due tomorrow.",
      "type": "info",
      "read": false,
      "createdAt": "2026-05-02T10:30:00Z"
    }
  ]
}
```

| Field     | Type        | Description                        |
|-----------|-------------|------------------------------------|
| id        | `string`    | Unique notification ID             |
| title     | `string`    | Notification title                 |
| message   | `string`    | Notification body                  |
| type      | `string`    | `info` / `alert` / `warning`       |
| read      | `boolean`   | Whether the user has read it       |
| createdAt | `timestamp` | ISO 8601 creation timestamp        |

---

### C. `PATCH /notifications/{id}/read`

Mark a single notification as read.

**Response** — `200 OK`

```json
{
  "status": "updated"
}
```

---

### D. `DELETE /notifications/{id}`

Delete a notification permanently.

**Response** — `200 OK`

```json
{
  "status": "deleted"
}
```

---

## Error Response Format

All endpoints return errors in a consistent structure:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authorization token."
  }
}
```

| Code                | HTTP Status | When                              |
|---------------------|-------------|-----------------------------------|
| `UNAUTHORIZED`      | 401         | Missing or invalid Bearer token   |
| `NOT_FOUND`         | 404         | Notification or user not found    |
| `VALIDATION_ERROR`  | 400         | Malformed or missing fields       |
| `INTERNAL_ERROR`    | 500         | Unexpected server failure         |

---

## Real-Time Notification Design

### Delivery Mechanism

Use **WebSockets** or **Server-Sent Events (SSE)** for instant push delivery.

```
┌────────┐          ┌────────────┐          ┌────────┐
│ Sender │──POST──▶│   Server   │──push──▶ │ Client │
└────────┘          └────────────┘          └────────┘
                         │
                    WebSocket / SSE
                    connection held open
```

### Flow

1. Client opens a persistent connection (WebSocket or SSE) on login.
2. When `POST /notifications/send` is called, the server:
   - Stores the notification.
   - Pushes it to all connected target users instantly.
3. Client receives and renders the notification without polling.

### Fallback Strategy

If the real-time connection drops or is unsupported:

- Client falls back to **short polling** via `GET /notifications/{userId}` at a configurable interval (e.g. every 15s).
- On reconnect, the client fetches any missed notifications since the last known timestamp.

---

# Stage 2: Data Storage and Scaling Design

## 1. Relational Database Schema

### A. `users`

| Column | Type         | Constraints       |
|--------|--------------|--------------------|
| id     | `UUID`       | Primary Key        |
| name   | `VARCHAR(255)` | NOT NULL         |
| email  | `VARCHAR(255)` | NOT NULL, UNIQUE |

### B. `notifications`

| Column     | Type           | Constraints        |
|------------|----------------|--------------------|
| id         | `UUID`         | Primary Key        |
| title      | `VARCHAR(255)` | NOT NULL           |
| message    | `TEXT`         | NOT NULL           |
| type       | `ENUM`         | `info`, `alert`, `warning` |
| created_at | `TIMESTAMP`    | DEFAULT `NOW()`    |

### C. `user_notifications`

| Column          | Type        | Constraints                          |
|-----------------|-------------|--------------------------------------|
| id              | `UUID`      | Primary Key                          |
| user_id         | `UUID`      | Foreign Key → `users.id`             |
| notification_id | `UUID`      | Foreign Key → `notifications.id`     |
| read            | `BOOLEAN`   | DEFAULT `false`                      |
| read_at         | `TIMESTAMP` | NULLABLE                             |

### Relationships

```
users (1) ──── (N) user_notifications (N) ──── (1) notifications
```

- **One notification** can be sent to **many users** (via `user_notifications`).
- **One user** can receive **many notifications**.
- `user_notifications` is the **join table** that tracks per-user read status.

### DDL

```sql
CREATE TABLE users (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name  VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      VARCHAR(255) NOT NULL,
    message    TEXT NOT NULL,
    type       VARCHAR(10) CHECK (type IN ('info', 'alert', 'warning')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
    read            BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMP
);
```

---

## 2. Potential Scaling Problems

| Problem | Cause |
|---------|-------|
| **Large notification volume per user** | Users accumulate thousands of notifications over time, making full-table scans expensive. |
| **High write throughput** | Broadcasting a single notification to thousands of users generates a burst of `INSERT` operations on `user_notifications`. |
| **Slow reads** | `GET /notifications/{userId}` becomes slower as the table grows without proper indexing and pagination. |
| **Real-time delivery delays** | Synchronous DB writes in the notification send path increase response latency and delay WebSocket/SSE push. |

---

## 3. Solutions

### Indexing

```sql
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_notif_id ON user_notifications(notification_id);
CREATE INDEX idx_user_notifications_unread ON user_notifications(user_id, read) WHERE read = FALSE;
```

- Composite index on `(user_id, read)` accelerates "unread notifications" queries.

### Pagination

- **Cursor-based** (preferred): Use `created_at` + `id` as the cursor to avoid offset performance degradation.

```
GET /notifications/{userId}?cursor=2026-05-01T00:00:00Z&limit=20
```

- **Offset-based** (simpler): `?limit=20&offset=40` — acceptable for small-to-medium datasets.

### Caching (Redis)

- Cache recent/unread notifications per user in Redis sorted sets.
- Key: `notifications:{userId}` → sorted by `created_at`.
- TTL: 15–30 minutes. Invalidate on new notification or read.
- Reduces DB reads by 80%+ for active users.

### Message Queue (Async Processing)

```
POST /send  →  Kafka/RabbitMQ  →  Worker  →  DB INSERT + WebSocket push
```

- Decouple the API response from DB writes and push delivery.
- The sender gets an immediate `201` response.
- Workers consume from the queue and handle fan-out (inserting into `user_notifications` + pushing to connected clients).

### Horizontal Scaling

- **Read replicas**: Route `GET` queries to read replicas to offload the primary DB.
- **Application-level sharding**: Partition `user_notifications` by `user_id` hash if the table exceeds billions of rows.

### Archiving

- Move notifications older than 90 days to a cold storage / archive table.
- Keeps the hot table small and queries fast.

```sql
INSERT INTO user_notifications_archive SELECT * FROM user_notifications WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM user_notifications WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## 4. SQL vs NoSQL Decision

| Criteria            | SQL (PostgreSQL)                        | NoSQL (MongoDB / DynamoDB)               |
|---------------------|-----------------------------------------|------------------------------------------|
| **Consistency**     | Strong (ACID transactions)              | Eventual (tunable)                       |
| **Relationships**   | Native JOINs across users ↔ notifications | Denormalized, embedded documents        |
| **Query flexibility** | Full SQL, complex filters             | Limited query patterns                   |
| **Write throughput** | Good with connection pooling           | Higher out-of-the-box at massive scale   |
| **Schema**          | Fixed, enforced                         | Flexible, schema-less                    |
| **Best for**        | Structured relational data, moderate scale | High-velocity feeds, very large scale  |

### Conclusion

- **Start with SQL (PostgreSQL)**: Provides strong consistency, relational queries, and proven scalability with indexing + read replicas.
- **Move to hybrid if scale demands it**: Use NoSQL (e.g. DynamoDB) for the notification feed/timeline as a read-optimized store, while keeping SQL as the source of truth for users and notification metadata.

