/**
 * Unified diagnostics: error reporting + logging.
 *
 * Centralizes what was previously scattered ad-hoc: ~95 empty catches, ~61
 * swallowed `.catch(() => {})`, and `console.*` calls (whose debug/info are
 * tree-shaken in production). Everything that should survive in a shipped
 * build goes through `@tauri-apps/plugin-log`, which is already a dependency
 * and has its capability granted — it was just never imported from the frontend.
 */
import { error, info, warn } from "@tauri-apps/plugin-log";
import { toast } from "sonner";

/**
 * Report an error to the user (toast) and persist it (plugin-log).
 *
 * @param e       The error value (Error, string, or unknown).
 * @param context A short label for where/what, e.g. "resolve conflict".
 * @param opts    `silent: true` to skip the toast (log only); `fatal: true`
 *                for a longer-lived destructive toast.
 */
export function reportError(
  e: unknown,
  context: string,
  opts?: { silent?: boolean; fatal?: boolean },
): void {
  const message = errorMessage(e);
  const full = context ? `${context}: ${message}` : message;
  // Persist to the Rust log sink (survives across runs; bundled with backend logs).
  void error(full);
  if (opts?.fatal) {
    toast.error(full);
  } else if (!opts?.silent) {
    toast.error(message, { description: context });
  }
}

/** Log an informational message to the persistent sink (no toast). */
export function logInfo(message: string): void {
  void info(message);
}

/** Log a warning to the persistent sink (no toast). */
export function logWarn(message: string): void {
  void warn(message);
}

/** Normalize any thrown value into a human-readable string. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}
