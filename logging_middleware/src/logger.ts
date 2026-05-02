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

export async function log(
  stack: Stack,
  level: Level,
  packageName: Package,
  message: string,
  config: Partial<LoggerConfig> = {}
): Promise<LogResponse | null> {
  const { baseUrl, token } = { ...DEFAULT_CONFIG, ...config };

  const payload: LogPayload = {
    stack,
    level,
    package: packageName,
    message,
  };

  try {
    const { data: logResponse } = await axios.post<LogResponse>(
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

    console.log(
      `[LOG OK] ${stack}/${packageName} ${level.toUpperCase()}: ${message}`
    );
    return logResponse;
  } catch (error) {
    const requestError = error as AxiosError;
    const status = requestError.response?.status ?? "NETWORK_ERROR";

    console.error(
      `[LOG FAILED] ${stack}/${packageName} ${level.toUpperCase()}: ${message} (${status})`
    );
    return null;
  }
}

export const debug = (packageName: Package, message: string) =>
  log("backend", "debug", packageName, message);

export const info = (packageName: Package, message: string) =>
  log("backend", "info", packageName, message);

export const warn = (packageName: Package, message: string) =>
  log("backend", "warn", packageName, message);

export const error = (packageName: Package, message: string) =>
  log("backend", "error", packageName, message);

export const fatal = (packageName: Package, message: string) =>
  log("backend", "fatal", packageName, message);

export { Level, Package, Stack, LogPayload, LogResponse, LoggerConfig };
