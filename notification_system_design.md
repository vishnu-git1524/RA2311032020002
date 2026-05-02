# Notification System Design

## Overview

This document outlines the architecture and design of the AffordMed notification system backend, built with **TypeScript** and **Express**.

## Components

### 1. Logging Middleware (`logging_middleware`)
- Centralized logging service that sends structured logs to the AffordMed evaluation endpoint.
- Strict TypeScript types enforcing valid `stack`, `level`, and `package` values.
- Convenience helpers: `debug()`, `info()`, `warn()`, `error()`, `fatal()`.
- Reusable across all backend and frontend services.

### 2. Vehicle Maintenance Scheduler (`vehicle_maintenance_scheduler`)
- Express-based REST API for managing vehicle maintenance schedules.
- Integrates the logging middleware for request/event tracking.
- Input validation with typed request bodies.

### 3. Notification App Backend (`notification_app_be`)
- Express-based REST API that handles notification delivery and management.
- Integrates the logging middleware for request/event tracking.
- Input validation with typed request bodies.

## Architecture

```
┌──────────────────────────────┐
│       External Clients       │
└──────────┬───────────────────┘
           │
     ┌─────▼──────┐     ┌──────────────┐
     │ notification│     │   vehicle     │
     │  _app_be   │     │ maintenance  │
     │  (Express) │     │ _scheduler   │
     │  :3002     │     │  (Express)   │
     └─────┬──────┘     │  :3001       │
           │            └──────┬───────┘
     ┌─────▼───────────────────▼──────┐
     │      logging_middleware        │
     │   (Shared TypeScript Module)   │
     └───────────────┬────────────────┘
                     │ POST
         ┌───────────▼────────────┐
         │  Evaluation Service    │
         │  20.207.122.201        │
         └────────────────────────┘
```

## Log API Contract

### Endpoint
`POST http://20.207.122.201/evaluation-service/logs`

### Headers
| Header          | Value                |
|-----------------|----------------------|
| Content-Type    | application/json     |
| Authorization   | Bearer \<TOKEN\>     |

### Request Body
```json
{
  "stack": "backend",
  "level": "error",
  "package": "handler",
  "message": "received string, expected bool"
}
```

### Valid Values

| Field   | Backend                                                                                          | Frontend                                               | Both                              |
|---------|--------------------------------------------------------------------------------------------------|--------------------------------------------------------|-----------------------------------|
| Stack   | `"backend"`                                                                                      | `"frontend"`                                           | —                                 |
| Level   | `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`                                              | same                                                   | same                              |
| Package | `"cache"`, `"controller"`, `"cron_job"`, `"db"`, `"dbsilo"`, `"handler"`, `"repository"`, `"route"`, `"service"` | `"api"`, `"component"`, `"hook"`, `"page"`, `"state"`, `"style"` | `"auth"`, `"config"`, `"middleware"`, `"utils"` |

### Response (200)
```json
{
  "logID": "a4aad82e-1900-4153-86d9-58bf55d7c402",
  "message": "log created successfully"
}
```

## Endpoints

### Vehicle Maintenance Scheduler (:3001)
| Method | Path        | Description                     |
|--------|-------------|---------------------------------|
| GET    | `/`         | Health check                    |
| GET    | `/schedules`| Fetch maintenance schedules     |
| POST   | `/schedules`| Create a new maintenance entry  |

### Notification App Backend (:3002)
| Method | Path              | Description                |
|--------|-------------------|----------------------------|
| GET    | `/`               | Health check               |
| GET    | `/notifications`  | Fetch notifications        |
| POST   | `/notifications`  | Create a new notification  |

## Running

```bash
# Install dependencies for each module
cd logging_middleware   && npm install
cd vehicle_maintenance_scheduler && npm install
cd notification_app_be && npm install

# Development (any service)
npm run dev

# Production build & start
npm run build
npm start
```
