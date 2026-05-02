import "dotenv/config";
import axios, { AxiosError } from "axios";
import {
  Level,
  Package,
  Stack,
  LogPayload,
  LogResponse,
  LoggerConfig,
} from "./types";

const DEFAULT_CONFIG: LoggerConfig = {
  baseUrl: "http://20.207.122.201",
  token: process.env.LOG_SERVICE_TOKEN || "",
  defaultStack: "backend",
};

/**
 * Sends a structured log entry to the AffordMed evaluation service.
 *
 * @param stack   - "backend" or "frontend"
 * @param level   - "debug" | "info" | "warn" | "error" | "fatal"
 * @param pkg     - Package origin of the log (must be valid for the given stack)
 * @param message - Human-readable description of the event
 * @param config  - Optional overrides for base URL / token / stack
 * @returns       - The LogResponse on success, or null on failure
 */
export async function log(
  stack: Stack,
  level: Level,
  pkg: Package,
  message: string,
  config: Partial<LoggerConfig> = {}
): Promise<LogResponse | null> {
  const { baseUrl, token } = { ...DEFAULT_CONFIG, ...config };

  const payload: LogPayload = {
    stack,
    level,
    package: pkg,
    message,
  };

  try {
    const { data } = await axios.post<LogResponse>(
      `${baseUrl}/evaluation-service/logs`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 5000,
      }
    );

    console.log(`[LOG ✓] ${stack}/${pkg} ${level.toUpperCase()}: ${message}`);
    return data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status ?? "NETWORK_ERROR";
    console.error(
      `[LOG ✗] ${stack}/${pkg} ${level.toUpperCase()}: ${message} (${status})`
    );
    return null;
  }
}

// ── Convenience helpers (backend stack) ──────────────────────────────────────

export const debug = (pkg: Package, message: string) =>
  log("backend", "debug", pkg, message);

export const info = (pkg: Package, message: string) =>
  log("backend", "info", pkg, message);

export const warn = (pkg: Package, message: string) =>
  log("backend", "warn", pkg, message);

export const error = (pkg: Package, message: string) =>
  log("backend", "error", pkg, message);

export const fatal = (pkg: Package, message: string) =>
  log("backend", "fatal", pkg, message);

export { Level, Package, Stack, LogPayload, LogResponse, LoggerConfig };
