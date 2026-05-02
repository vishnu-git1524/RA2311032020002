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

