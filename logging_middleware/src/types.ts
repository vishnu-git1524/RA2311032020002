/**
 * Valid stack values accepted by the evaluation service.
 */
export type Stack = "backend" | "frontend";

/**
 * Valid log level values accepted by the evaluation service.
 */
export type Level = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Package names that can only be used in Backend applications.
 */
export type BackendPackage =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "dbsilo"
  | "handler"
  | "repository"
  | "route"
  | "service";

/**
 * Package names that can only be used in Frontend applications.
 */
export type FrontendPackage =
  | "api"
  | "component"
  | "hook"
  | "page"
  | "state"
  | "style";

/**
 * Package names that can be used in both Backend and Frontend applications.
 */
export type SharedPackage = "auth" | "config" | "middleware" | "utils";

/**
 * All valid package names for backend stack.
 */
export type BackendAllowedPackage = BackendPackage | SharedPackage;

/**
 * All valid package names for frontend stack.
 */
export type FrontendAllowedPackage = FrontendPackage | SharedPackage;

/**
 * Union of every valid package name.
 */
export type Package = BackendPackage | FrontendPackage | SharedPackage;

/**
 * Request body sent to the evaluation service log endpoint.
 */
export interface LogPayload {
  stack: Stack;
  level: Level;
  package: Package;
  message: string;
}

/**
 * Successful response from the evaluation service.
 */
export interface LogResponse {
  logID: string;
  message: string;
}

/**
 * Configuration options for the logger.
 */
export interface LoggerConfig {
  /** Base URL of the evaluation service (without trailing slash). */
  baseUrl: string;
  /** Bearer token for Authorization header. */
  token: string;
  /** Default stack value. */
  defaultStack: Stack;
}
