const MAX_MESSAGE_LENGTH = 500;
const MAX_CAUSE_DEPTH = 3;
const TRUNCATION_MARKER = "…[truncated]";

/** What a log line may say about where it happened. Deliberately has no token field: a secret cannot ride along. */
export interface LogContext {
  /** The route template, for example `POST /api/w/[token]/timer/start`, never a concrete URL. */
  route: string;
  linkId?: string;
  projectId?: string;
  op?: string;
  detail?: string;
}

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
  details?: string;
  hint?: string;
  cause?: SerializedError;
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}${TRUNCATION_MARKER}` : message;
}

function stringField(value: object, key: string): string | undefined {
  if (key in value && typeof value[key as keyof typeof value] === "string") {
    return value[key as keyof typeof value];
  }
  return undefined;
}

/**
 * Turns anything that was thrown or returned as an error into a plain, JSON-safe record. Handles an `Error` (with its
 * `cause` chain, to a depth of 3), a PostgREST-style `{ message, code, details, hint }` object, and any other value.
 */
export function serializeError(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const serialized: SerializedError = { name: err.name, message: truncate(err.message) };
    const stack = err.stack;
    if (stack !== undefined) {
      serialized.stack = stack.replace(err.message, serialized.message);
    }
    for (const key of ["code", "details", "hint"] as const) {
      const value = stringField(err, key);
      if (value !== undefined) {
        serialized[key] = truncate(value);
      }
    }
    if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
      serialized.cause = serializeError(err.cause, depth + 1);
    }
    return serialized;
  }

  if (typeof err === "object" && err !== null) {
    const message = stringField(err, "message");
    if (message !== undefined) {
      const serialized: SerializedError = { message: truncate(message) };
      for (const key of ["code", "details", "hint"] as const) {
        const value = stringField(err, key);
        if (value !== undefined) {
          serialized[key] = truncate(value);
        }
      }
      return serialized;
    }
  }

  return { message: truncate(String(err)) };
}

function toLine(level: "error" | "warn", event: string, context: LogContext, err?: unknown): string {
  try {
    const entry =
      level === "error" ? { level, event, ...context, error: serializeError(err) } : { level, event, ...context };
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({ level, event, route: context.route, error: { message: "log serialization failed" } });
  }
}

/** Writes one JSON line for a failure. Never throws. */
export function logError(event: string, context: LogContext, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(toLine("error", event, context, err));
}

/** Writes one JSON line for something odd that did not fail the request. Never throws. */
export function logWarn(event: string, context: LogContext): void {
  // eslint-disable-next-line no-console
  console.warn(toLine("warn", event, context));
}
