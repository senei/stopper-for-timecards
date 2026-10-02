import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { verifyTurnstile } from "./turnstile";

// Opt-in test against the real Cloudflare siteverify endpoint (`npm run test:integration` with TURNSTILE_LIVE=1). It uses
// Cloudflare's documented dummy secrets, which force an outcome without any fault injection, so the verdicts and the
// real `error-codes` strings are proven rather than assumed, and a change on Cloudflare's side shows up here.
// Needs network access to challenges.cloudflare.com; it is not part of the default suite or CI.
const live = process.env.TURNSTILE_LIVE === "1";

const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SECRET_ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
const SECRET_ALWAYS_FAILS = "2x0000000000000000000000000000000AA";
const SECRET_TOKEN_ALREADY_SPENT = "3x0000000000000000000000000000000AA";
const SECRET_NOT_A_REAL_ONE = "made-up-secret-that-cloudflare-does-not-know";

const title = live
  ? "verifyTurnstile against the real siteverify (Cloudflare dummy secrets)"
  : "verifyTurnstile against the real siteverify — skipped: set TURNSTILE_LIVE=1 (needs network access)";

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedEvents(spy: MockInstance<typeof console.error>): string[] {
  return spy.mock.calls.map((args) => (JSON.parse(String(args[0])) as { event: string }).event);
}

describe.skipIf(!live)(title, () => {
  it("passes for the always-pass secret and logs nothing", async () => {
    expect(await verifyTurnstile(DUMMY_TOKEN, null, SECRET_ALWAYS_PASSES)).toEqual({ ok: true });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects, with Cloudflare's codes, for the always-fail secret, and logs a warning", async () => {
    const verdict = await verifyTurnstile(DUMMY_TOKEN, null, SECRET_ALWAYS_FAILS);

    expect(verdict).toMatchObject({ ok: false, reason: "rejected" });
    const codes = verdict.ok ? [] : (verdict.errorCodes ?? []);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => typeof code === "string" && code.length > 0)).toBe(true);
    expect(loggedEvents(warnSpy)).toEqual(["turnstile_rejected"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rejects with timeout-or-duplicate for the already-spent secret, and logs a warning", async () => {
    const verdict = await verifyTurnstile(DUMMY_TOKEN, null, SECRET_TOKEN_ALREADY_SPENT);

    expect(verdict).toMatchObject({ ok: false, reason: "rejected" });
    expect(verdict.ok ? [] : verdict.errorCodes).toContain("timeout-or-duplicate");
    expect(loggedEvents(warnSpy)).toEqual(["turnstile_rejected"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rejects with invalid-input-secret for a secret Cloudflare does not know, and logs an error", async () => {
    const verdict = await verifyTurnstile(DUMMY_TOKEN, null, SECRET_NOT_A_REAL_ONE);

    expect(verdict).toMatchObject({ ok: false, reason: "rejected" });
    expect(verdict.ok ? [] : verdict.errorCodes).toContain("invalid-input-secret");
    expect(loggedEvents(errorSpy)).toEqual(["turnstile_rejected"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
