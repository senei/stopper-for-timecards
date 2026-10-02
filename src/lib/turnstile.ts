import { logError, logWarn } from "./log";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;
const ROUTE = "lib/turnstile";
const MAX_LOGGED_CODES = 10;

/**
 * Cloudflare `error-codes` that say our side is wrong (the secret, the request, or Cloudflare itself) rather than that
 * the visitor failed the check. A rejection carrying one of these is logged as an error, not a warning.
 */
const OPERATOR_CODES = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

export type TurnstileRefusal = "missing_token" | "missing_secret" | "rejected" | "unavailable" | "bad_response";

/** `ok: true` only when Cloudflare answered `success: true`; every other outcome says why it was refused. */
export type TurnstileVerdict = { ok: true } | { ok: false; reason: TurnstileRefusal; errorCodes?: string[] };

function refuse(reason: TurnstileRefusal, errorCodes?: string[]): TurnstileVerdict {
  return errorCodes === undefined ? { ok: false, reason } : { ok: false, reason, errorCodes };
}

/**
 * Verifies a Cloudflare Turnstile token server-side and says why it did not pass.
 *
 * Fails closed: only `success: true` is `ok`. A missing secret or token, a network error or non-2xx from Cloudflare,
 * an unreadable answer and a failed challenge are all refusals, and each one writes a log line (the visitor still sees
 * one generic message). Nothing secret is logged: no token, secret or IP, only the reason and Cloudflare's codes. The
 * secret is passed in (rather than read from astro:env here) so this module stays testable without the Astro runtime.
 */
export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
  secret: string | undefined,
): Promise<TurnstileVerdict> {
  // The operator's problem outranks an empty token: with no secret every visitor is refused.
  if (!secret) {
    logError(
      "turnstile_secret_missing",
      { route: ROUTE },
      { message: "TURNSTILE_SECRET_KEY is not set; every sign-up is refused until it is" },
    );
    return refuse("missing_secret");
  }
  if (!token) {
    logWarn("turnstile_missing_token", { route: ROUTE });
    return refuse("missing_token");
  }

  let response: Response;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) {
      body.set("remoteip", ip);
    }
    response = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
  } catch (err) {
    logError("turnstile_unavailable", { route: ROUTE }, err);
    return refuse("unavailable");
  }
  if (!response.ok) {
    logError(
      "turnstile_unavailable",
      { route: ROUTE, detail: `HTTP ${String(response.status)}` },
      { message: "siteverify did not answer with a 2xx status" },
    );
    return refuse("unavailable");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (err) {
    logError("turnstile_bad_response", { route: ROUTE }, err);
    return refuse("bad_response");
  }
  if (typeof result !== "object" || result === null || !("success" in result) || typeof result.success !== "boolean") {
    logError(
      "turnstile_bad_response",
      { route: ROUTE },
      { message: "siteverify answered with a body that has no boolean success" },
    );
    return refuse("bad_response");
  }
  if (result.success) {
    return { ok: true };
  }

  const codes: unknown = "error-codes" in result ? result["error-codes"] : undefined;
  const errorCodes = Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
  const context = { route: ROUTE, detail: errorCodes.slice(0, MAX_LOGGED_CODES).join(",") };
  if (errorCodes.some((code) => OPERATOR_CODES.has(code))) {
    logError("turnstile_rejected", context, { message: "Turnstile refused the check for a reason on our side" });
  } else {
    logWarn("turnstile_rejected", context);
  }
  return refuse("rejected", errorCodes);
}
