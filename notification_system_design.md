# Stage 1: Notification System Design

## Overview

This design covers a REST API for sending, reading, updating, and deleting notifications. It also includes a real-time delivery path so users do not need to keep polling when they are already connected.

---

## Common Headers

| Header | Value | Required |
|--------|-------|----------|
| Authorization | `Bearer <token>` | Yes |
| Content-Type | `application/json` | Yes |

---

## API Endpoints

### A. `POST /notifications/send`

Sends a notification to one or more users.

**Request Body**

```json
{
  "userIds": ["user_01", "user_02"],
  "title": "Maintenance Alert",
  "message": "Your vehicle service is due tomorrow.",
  "type": "info"
}
```

| Field | Type | Description |
|-------|------|-------------|
| userIds | `string[]` | List of target user IDs |
| title | `string` | Notification title |
| message | `string` | Notification body |
| type | `string` | One of: `info`, `alert`, `warning` |

**Response** - `201 Created`

```json
{
  "status": "success",
  "notificationId": "ntf_a3f8c912"
}
```

---

### B. `GET /notifications/{userId}`

Returns notifications for a single user.

**Response** - `200 OK`

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

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique notification ID |
| title | `string` | Notification title |
| message | `string` | Notification body |
| type | `string` | `info` / `alert` / `warning` |
| read | `boolean` | Whether the user has read it |
| createdAt | `timestamp` | ISO 8601 creation timestamp |

---

### C. `PATCH /notifications/{id}/read`

Marks one notification as read.

**Response** - `200 OK`

```json
{
  "status": "updated"
}
```

---

### D. `DELETE /notifications/{id}`

Deletes a notification permanently.

**Response** - `200 OK`

```json
{
  "status": "deleted"
}
```

---

## Error Response Format

Errors use the same shape across all endpoints:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authorization token."
  }
}
```

| Code | HTTP Status | When |
|------|-------------|------|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token |
| `NOT_FOUND` | 404 | Notification or user not found |
| `VALIDATION_ERROR` | 400 | Malformed or missing fields |
| `INTERNAL_ERROR` | 500 | Unexpected server failure |

---

## Real-Time Notification Design

### Delivery Mechanism

Use **WebSockets** or **Server-Sent Events (SSE)** for instant push delivery. In practice, SSE is simpler for one-way server-to-client updates, while WebSockets make sense if the client also needs to send live events back.

```text
Sender -> POST -> Server -> push -> Client
                    |
              WebSocket / SSE
              connection held open
```

### Flow

1. Client opens a persistent connection after login.
2. `POST /notifications/send` stores the notification.
3. The server pushes it to connected target users immediately.
4. Client renders the notification without polling.

### Fallback Strategy

If the real-time connection drops or is not supported:

- Client falls back to short polling via `GET /notifications/{userId}` at a configurable interval, for example every 15 seconds.
- On reconnect, the client fetches missed notifications since the last known timestamp.

---

# Stage 2: Data Storage and Scaling Design

## 1. Relational Database Schema

The model keeps notification content separate from per-user state. That matters because one notification can be delivered to many users, but read status belongs to each user individually.

### A. `users`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `UUID` | Primary Key |
| name | `VARCHAR(255)` | NOT NULL |
| email | `VARCHAR(255)` | NOT NULL, UNIQUE |

### B. `notifications`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `UUID` | Primary Key |
| title | `VARCHAR(255)` | NOT NULL |
| message | `TEXT` | NOT NULL |
| type | `ENUM` | `info`, `alert`, `warning` |
| created_at | `TIMESTAMP` | DEFAULT `NOW()` |

### C. `user_notifications`

| Column | Type | Constraints |
|--------|------|-------------|
| id | `UUID` | Primary Key |
| user_id | `UUID` | Foreign Key -> `users.id` |
| notification_id | `UUID` | Foreign Key -> `notifications.id` |
| read | `BOOLEAN` | DEFAULT `false` |
| read_at | `TIMESTAMP` | NULLABLE |

### Relationships

```text
users (1) ---- (N) user_notifications (N) ---- (1) notifications
```

- One notification can be sent to many users through `user_notifications`.
- One user can receive many notifications.
- `user_notifications` tracks read state per user.

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

The main pressure points are predictable for a notification feed:

- **Large notification volume per user**: users accumulate thousands of rows, so full-table scans get expensive.
- **High write throughput**: sending one notification to thousands of users creates a burst of `INSERT` operations on `user_notifications`.
- **Slow reads**: `GET /notifications/{userId}` gets worse as the table grows without indexing and pagination.
- **Real-time delivery delays**: synchronous DB writes on the send path add latency before WebSocket/SSE push can happen.

---

## 3. Solutions

### Indexing

```sql
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_notif_id ON user_notifications(notification_id);
CREATE INDEX idx_user_notifications_unread ON user_notifications(user_id, read) WHERE read = FALSE;
```

The `(user_id, read)` index helps unread notification queries avoid scanning a user's full history.

### Pagination

Cursor-based pagination is the better default here. Use `created_at` + `id` as the cursor so deep pages do not degrade the way `OFFSET` does.

```text
GET /notifications/{userId}?cursor=2026-05-01T00:00:00Z&limit=20
```

Offset-based pagination is still acceptable for small-to-medium datasets:

```text
GET /notifications/{userId}?limit=20&offset=40
```

### Caching (Redis)

- Cache recent or unread notifications per user in Redis sorted sets.
- Key: `notifications:{userId}`, sorted by `created_at`.
- TTL: 15-30 minutes.
- Invalidate on new notification or read.
- This can cut DB reads by 80%+ for active users.

### Message Queue (Async Processing)

```text
POST /send -> Kafka/RabbitMQ -> Worker -> DB INSERT + WebSocket push
```

This keeps the API response separate from fan-out work. The sender gets a quick `201`, and workers handle inserts plus push delivery in the background.

### Horizontal Scaling

- **Read replicas**: route `GET` queries to replicas so the primary stays focused on writes.
- **Application-level sharding**: partition `user_notifications` by `user_id` hash once the table reaches billions of rows.

### Archiving

Move notifications older than 90 days into cold storage or an archive table. This keeps the hot table small enough for regular queries to stay fast.

```sql
INSERT INTO user_notifications_archive SELECT * FROM user_notifications WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM user_notifications WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## 4. SQL vs NoSQL Decision

| Criteria | SQL (PostgreSQL) | NoSQL (MongoDB / DynamoDB) |
|----------|------------------|----------------------------|
| **Consistency** | Strong (ACID transactions) | Eventual (tunable) |
| **Relationships** | Native JOINs across users -> notifications | Denormalized, embedded documents |
| **Query flexibility** | Full SQL, complex filters | Limited query patterns |
| **Write throughput** | Good with connection pooling | Higher out-of-the-box at massive scale |
| **Schema** | Fixed, enforced | Flexible, schema-less |
| **Best for** | Structured relational data, moderate scale | High-velocity feeds, very large scale |

### Conclusion

Start with **SQL (PostgreSQL)**. It gives strong consistency, relational queries, and a clear path to scale with indexes and read replicas.

If scale later demands it, move to a hybrid model: use NoSQL, such as DynamoDB, for the notification feed or timeline as a read-optimized store, while SQL remains the source of truth for users and notification metadata.

---

# Stage 3: Query Optimization and Indexing Strategy

## 1. Slow Query Analysis

### The Query

```sql
SELECT *
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Why It Is Slow

Without the right index, the database has to work too hard:

- No index on `studentID` or `isRead`, so it may read every row to find matches.
- `ORDER BY createdAt DESC` can force a file-sort over the matched rows.
- A composite index is needed to cover both the filter and sort pattern.

At millions of rows, this usually moves from milliseconds to seconds.

---

## 2. Why "Index Every Column" Is Wrong

Adding indexes blindly feels safe, but it creates its own problems.

| Drawback | Impact |
|----------|--------|
| **Increased write latency** | Every `INSERT`, `UPDATE`, and `DELETE` must update all indexes. On a high-write table like notifications, that cost adds up quickly. |
| **High storage overhead** | Each index consumes disk space proportional to the table size. Indexing every column can double or triple storage needs. |
| **Inefficient index usage** | The planner may choose poor single-column indexes or ignore them. Multiple single-column indexes rarely beat one well-designed composite index. |

Rule of thumb: index for query patterns, not for columns.

---

## 3. Optimal Solution - Composite Index

```sql
CREATE INDEX idx_notifications_user_read_created
ON notifications (studentID, isRead, createdAt DESC);
```

### How It Works

```text
studentID = 1042
  -> isRead = false
      -> createdAt DESC
```

The index first seeks directly to `studentID = 1042`, narrows to unread rows, and then reads entries already ordered by `createdAt DESC`. That removes the full scan and avoids a separate file-sort.

Result: an index-only range scan, which is much faster than scanning the whole table.

---

## 4. Query Optimization Improvements

### Avoid `SELECT *`

Fetch only the columns the client needs. This reduces I/O, memory use, and network transfer.

### Add Pagination

Do not return an unbounded notification history in one response.

### Optimized Query

```sql
SELECT id, title, message, createdAt
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC
LIMIT 20;
```

This version keeps the response small, avoids unnecessary columns, and works cleanly with the composite index.

### Cursor-Based Pagination (For Deep Pages)

```sql
SELECT id, title, message, createdAt
FROM notifications
WHERE studentID = 1042
  AND isRead = false
  AND createdAt < '2026-05-01T00:00:00Z'
ORDER BY createdAt DESC
LIMIT 20;
```

Using `createdAt` as the cursor avoids the performance cost of `OFFSET` on large datasets.

---

## 5. Second Problem - Students Notified by Type

### Requirement

Find all students who received a "Placement" notification in the last 7 days.

### Optimized Query

```sql
SELECT DISTINCT studentID
FROM notifications
WHERE type = 'Placement'
  AND createdAt >= NOW() - INTERVAL 7 DAY;
```

### Recommended Index

```sql
CREATE INDEX idx_notifications_type_created
ON notifications (type, createdAt);
```

### Why This Works

The index jumps to `'Placement'` rows first, then scans only the recent `createdAt` range. `DISTINCT studentID` still happens, but over a much smaller result set.

| Index | Covers Query | Purpose |
|-------|--------------|---------|
| `(studentID, isRead, createdAt DESC)` | Unread notifications per student | Filter + sort without file-sort |
| `(type, createdAt)` | Notifications by type in date range | Type filter + date range scan |

---

# Stage 4: Performance Optimization and Trade-offs

## 1. The Problem

```text
User opens page -> GET /notifications/{userId} -> DB query -> response
```

If every page load hits the database, active users generate repeated reads even when nothing changed. Under load, that fills the connection pool and pushes response times up.

---

## 2. Solutions and Trade-offs

### A. Caching (Redis)

Cache recent notifications per user in Redis so common reads avoid the database.

```text
GET /notifications/{userId}
  -> Check Redis (key: notifications:{userId})
  -> Cache HIT -> return cached data
  -> Cache MISS -> query DB -> store in Redis (TTL: 5-15 min) -> return
```

- **Invalidation**: delete or update the user's cache key when a new notification is created.
- **Data structure**: Redis Sorted Set, with `createdAt` timestamp as the score.

Trade-offs: data can be stale up to the TTL, and the write path needs cache invalidation logic.

### B. Pagination / Lazy Loading

Fetch a fixed page size instead of the full history.

```text
GET /notifications/{userId}?limit=20&cursor=<last_createdAt>
```

The first load returns the latest 20 notifications. "Load more" requests the next page with the cursor. This adds a little client-side state, but each API call stays fast.

### C. Push-Based Model (WebSockets / SSE)

```text
Client connects -> WebSocket open
Server creates notification -> pushes to connected client instantly
```

This removes repeated `GET` calls for connected users. Disconnected clients can still fall back to polling.

Trade-offs: persistent connections use memory and require connection management, heartbeats, and reconnect handling.

### D. Read Replicas

```text
Writes -> Primary DB
Reads  -> Replica 1, Replica 2, ... (load-balanced)
```

Read replicas scale read traffic without overloading the primary. One thing to note: replicas can lag by a few milliseconds, so a just-sent notification may not appear immediately.

### E. Background Processing (Message Queue)

```text
POST /notifications/send
  -> Publish to queue -> return 201 immediately
  -> Worker consumes -> INSERT into DB -> push via WebSocket -> invalidate cache
```

The sender does not wait for fan-out. Workers can be scaled separately as write volume grows.

Trade-offs: this adds queue infrastructure, dead-letter handling, monitoring, and a small amount of eventual consistency.

### F. Pre-computation / Materialized Views

Maintain a flattened feed per user and update it on write.

```sql
CREATE MATERIALIZED VIEW user_notification_feed AS
SELECT un.user_id, n.id, n.title, n.message, n.type, un.read, n.created_at
FROM user_notifications un
JOIN notifications n ON un.notification_id = n.id
ORDER BY n.created_at DESC;
```

Reads become simple scans on a denormalized feed. The cost is extra storage and either scheduled refreshes or trigger-based update overhead.

---

## 3. Recommended Approach

Use three pieces together:

- **Redis caching** for the hot path. Repeat reads by active users do not touch the DB.
- **Pagination** to cap response size and keep cache misses cheap.
- **Read replicas** to absorb remaining read traffic while the primary handles writes.

This works well because it improves the common case without making the system much harder to operate. Add **WebSockets** and **message queues** when real-time delivery or high write throughput becomes the bottleneck.

---

# Stage 5: Reliable Notification Delivery and Failure Handling

## 1. Problems with the Current Synchronous Approach

```text
POST /notifications/send
  -> for each student:
       send_email()
       save_to_db()
       send_push()
  -> return 200
```

The synchronous version is easy to understand, but it does not hold up for large fan-out:

- **Sequential processing**: notifying 50,000 users can take minutes.
- **No retry mechanism**: if `send_email()` fails, the notification can be lost.
- **Partial completion**: if the server crashes at user 25,000, there is no clean resume point.
- **Tight coupling**: a slow email provider can block DB writes and push delivery.

---

## 2. Redesigned Architecture - Async Queue-Based

```text
API -> Message Queue (Kafka/RMQ) -> Worker Pool
 |                                  |
 enqueue one job per user           send_email()
 return 202 Accepted                save_to_db()
                                    send_push()
```

### Flow

1. API receives the "notify all" request.
2. It enqueues one job per student into Kafka or RabbitMQ.
3. API returns `202 Accepted` immediately.
4. Workers consume jobs concurrently.
5. Email, DB, and push delivery succeed or fail independently.

---

## 3. Retry Mechanism - Exponential Backoff

### Job Status Lifecycle

```text
pending -> processing -> sent
                     -> failed -> retry (1) -> retry (2) -> retry (3) -> dead_letter
```

### Retry Strategy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1st retry | 2 seconds | Re-enqueue with backoff |
| 2nd retry | 8 seconds | Re-enqueue with backoff |
| 3rd retry | 32 seconds | Re-enqueue with backoff |
| Max retries exceeded | - | Move to **dead-letter queue** for manual review |

### Status Field

```sql
ALTER TABLE user_notifications ADD COLUMN status VARCHAR(10) DEFAULT 'pending';
-- Values: pending | sent | failed | retried
```

- `pending`: job created, not processed yet.
- `sent`: all channels delivered successfully.
- `failed`: delivery failed after all retries.
- `retried`: currently being retried.

---

## 4. Fault Tolerance

### Independent Channels

Each delivery channel runs separately. If email fails, DB storage and push delivery can still succeed.

```text
Worker processes job for student_1042:
  save_to_db() -> success
  send_email() -> failed (SMTP timeout) -> enqueue retry for email only
  send_push()  -> success
```

The student still sees the push notification and DB record. Only the failed channel is retried.

### Idempotency

Retries and queue redelivery can create duplicates unless processing is idempotent.

```text
Before processing:
  -> Check whether (student_id, notification_id, channel) was already delivered
  -> If yes, skip
  -> If no, process and mark delivered
```

Use a unique constraint on `(user_id, notification_id)` in `user_notifications`. Store per-channel delivery status if needed:

```sql
CREATE TABLE delivery_log (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    notification_id UUID NOT NULL,
    channel         VARCHAR(10),  -- 'email', 'push', 'db'
    status          VARCHAR(10),  -- 'sent', 'failed'
    attempted_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, notification_id, channel)
);
```

---

## 5. Logging

Log enough to debug failed delivery without digging through unrelated request logs.

| Event | Log Level | Example Message |
|-------|-----------|-----------------|
| Job created | `info` | `Job enqueued: student=1042, notification=ntf_abc` |
| Email sent | `info` | `Email delivered: student=1042, channel=email` |
| Push sent | `info` | `Push delivered: student=1042, channel=push` |
| DB stored | `info` | `Notification stored: student=1042, notification=ntf_abc` |
| Failure | `error` | `Email failed: student=1042, error=SMTP_TIMEOUT, attempt=1/3` |
| Retry triggered | `warn` | `Retrying: student=1042, channel=email, attempt=2/3, delay=8s` |
| Dead-lettered | `error` | `Dead-lettered: student=1042, channel=email, max retries exceeded` |

Every log should include `timestamp`, `student_id`, `notification_id`, `channel`, and `status`.

---

## 6. Pseudocode

```python
def notify_all(student_ids, message):
    notification_id = create_notification(message)
    for student_id in student_ids:
        enqueue_job(student_id, notification_id, message)
    log("info", f"Enqueued {len(student_ids)} jobs for notification {notification_id}")
    return {"status": "accepted", "notificationId": notification_id}  # 202


def worker():
    while True:
        job = queue.consume()
        log("info", f"Processing job: student={job.student_id}")

        try:
            save_to_db(job)
            log("info", f"DB stored: student={job.student_id}")
        except Exception as e:
            log("error", f"DB failed: student={job.student_id}, error={e}")

        try:
            send_email(job.student_id, job.message)
            log("info", f"Email sent: student={job.student_id}")
        except Exception as e:
            log("error", f"Email failed: student={job.student_id}, error={e}")
            retry_with_backoff(job, channel="email")

        try:
            send_push(job.student_id, job.message)
            log("info", f"Push sent: student={job.student_id}")
        except Exception as e:
            log("error", f"Push failed: student={job.student_id}, error={e}")
            retry_with_backoff(job, channel="push")

        mark_job_complete(job)


def retry_with_backoff(job, channel):
    job.attempt += 1
    if job.attempt > MAX_RETRIES:
        move_to_dead_letter_queue(job)
        log("error", f"Dead-lettered: student={job.student_id}, channel={channel}")
        return
    delay = 2 ** (job.attempt + 1)   # 4s, 8s, 16s, 32s ...
    enqueue_job(job, delay=delay)
    log("warn", f"Retrying: student={job.student_id}, channel={channel}, delay={delay}s")
```

---

## 7. FAQ

### Q: What happens if email fails for 200 out of 50,000 students?

Each student's job is independent. The 200 failed email jobs are retried automatically with exponential backoff, and the other 49,800 keep moving. After max retries, any remaining failures go to the dead-letter queue for manual investigation.

### Q: Why is this better than the synchronous approach?

| Aspect | Synchronous | Async (Queue-Based) |
|--------|-------------|---------------------|
| **Processing** | Sequential, one-by-one | Parallel across worker pool |
| **Fault isolation** | One failure can block all | Each job fails independently |
| **Scalability** | Limited by single process | Scale workers horizontally |
| **Reliability** | No retry, no resume | Automatic retry + dead-letter |
| **Response time** | Blocks until all done | Returns `202` immediately |
| **Observability** | Limited | Full per-job logging |
