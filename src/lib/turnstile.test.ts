import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { verifyTurnstile } from "./turnstile";

const SECRET = "very-secret-key";
const TOKEN = "visitor-token-123";
const IP = "203.0.113.7";

const fetchMock = vi.fn();

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every log line written, parsed, with the console method it came through. */
function lines(): { via: "error" | "warn"; line: Record<string, unknown> }[] {
  const parse = (spy: MockInstance<typeof console.error>, via: "error" | "warn") =>
    spy.mock.calls.map((args) => ({ via, line: JSON.parse(String(args[0])) as Record<string, unknown> }));
  return [...parse(errorSpy, "error"), ...parse(warnSpy, "warn")];
}

/** Nothing secret may reach the log: not the token, the secret, or the visitor's IP. */
function expectNoSecretsLogged() {
  const everything = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
  expect(everything).not.toContain(TOKEN);
  expect(everything).not.toContain(SECRET);
  expect(everything).not.toContain(IP);
}

describe("verifyTurnstile", () => {
  describe("a passing check", () => {
    it("is ok and logs nothing when Cloudflare reports success", async () => {
      respondWith({ success: true, hostname: "example.test", "error-codes": [] });

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lines()).toEqual([]);
    });

    it("sends the secret, response and remote ip to the siteverify endpoint", async () => {
      respondWith({ success: true });

      await verifyTurnstile(TOKEN, IP, SECRET);

      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: URLSearchParams }];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(init.method).toBe("POST");
      expect(init.body.get("secret")).toBe(SECRET);
      expect(init.body.get("response")).toBe(TOKEN);
      expect(init.body.get("remoteip")).toBe(IP);
    });

    it("omits the remote ip when there is none", async () => {
      respondWith({ success: true });

      await verifyTurnstile(TOKEN, null, SECRET);

      expect((fetchMock.mock.calls[0] as [string, { body: URLSearchParams }])[1].body.has("remoteip")).toBe(false);
    });
  });

  describe("refusals before any request", () => {
    it("is missing_secret, logged as an error, and makes no request when the secret is unset or empty", async () => {
      for (const secret of [undefined, ""]) {
        expect(await verifyTurnstile(TOKEN, IP, secret)).toEqual({ ok: false, reason: "missing_secret" });
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lines().map(({ via, line }) => [via, line.event])).toEqual([
        ["error", "turnstile_secret_missing"],
        ["error", "turnstile_secret_missing"],
      ]);
      expectNoSecretsLogged();
    });

    it("is missing_token, logged as a warning, and makes no request when the token is empty or null", async () => {
      for (const token of ["", null]) {
        expect(await verifyTurnstile(token, IP, SECRET)).toEqual({ ok: false, reason: "missing_token" });
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lines().map(({ via, line }) => [via, line.event])).toEqual([
        ["warn", "turnstile_missing_token"],
        ["warn", "turnstile_missing_token"],
      ]);
      expectNoSecretsLogged();
    });

    it("reports the missing secret, not the empty token, when both are missing", async () => {
      expect(await verifyTurnstile(null, null, undefined)).toEqual({ ok: false, reason: "missing_secret" });
    });
  });

  describe("a rejected token", () => {
    it.each(["invalid-input-response", "timeout-or-duplicate", "missing-input-response"])(
      "is rejected and logged as a warning for the visitor-side code %s",
      async (code) => {
        respondWith({ success: false, "error-codes": [code] });

        expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "rejected", errorCodes: [code] });

        expect(lines()).toEqual([
          { via: "warn", line: expect.objectContaining({ event: "turnstile_rejected", detail: code }) as unknown },
        ]);
        expectNoSecretsLogged();
      },
    );

    it.each(["invalid-input-secret", "missing-input-secret", "bad-request", "internal-error"])(
      "is rejected and logged as an error for the operator-side code %s",
      async (code) => {
        respondWith({ success: false, "error-codes": [code] });

        expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "rejected", errorCodes: [code] });

        expect(lines()).toEqual([
          { via: "error", line: expect.objectContaining({ event: "turnstile_rejected", detail: code }) as unknown },
        ]);
        expectNoSecretsLogged();
      },
    );

    it("logs as an error when any one of several codes is operator-side, and lists them all", async () => {
      respondWith({ success: false, "error-codes": ["timeout-or-duplicate", "invalid-input-secret"] });

      const verdict = await verifyTurnstile(TOKEN, IP, SECRET);

      expect(verdict).toEqual({
        ok: false,
        reason: "rejected",
        errorCodes: ["timeout-or-duplicate", "invalid-input-secret"],
      });
      expect(lines()).toEqual([
        {
          via: "error",
          line: expect.objectContaining({ detail: "timeout-or-duplicate,invalid-input-secret" }) as unknown,
        },
      ]);
    });

    it("is still rejected, with an empty list, when Cloudflare sends no error-codes", async () => {
      respondWith({ success: false });

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "rejected", errorCodes: [] });
      expect(lines()).toEqual([
        { via: "warn", line: expect.objectContaining({ event: "turnstile_rejected", detail: "" }) as unknown },
      ]);
    });

    it("ignores error-codes entries that are not strings", async () => {
      respondWith({ success: false, "error-codes": ["invalid-input-response", 7, null, { a: 1 }] });

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({
        ok: false,
        reason: "rejected",
        errorCodes: ["invalid-input-response"],
      });
    });

    it("caps how many codes one log line carries", async () => {
      respondWith({ success: false, "error-codes": Array.from({ length: 30 }, (_, i) => `code-${String(i)}`) });

      await verifyTurnstile(TOKEN, IP, SECRET);

      const detail = String(lines()[0]?.line.detail);
      expect(detail.split(",")).toHaveLength(10);
    });
  });

  describe("Cloudflare unavailable or unreadable", () => {
    it("is unavailable and logged as an error with the status on a non-2xx answer", async () => {
      respondWith({ success: true }, 503);

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "unavailable" });

      expect(lines()).toEqual([
        {
          via: "error",
          line: expect.objectContaining({ event: "turnstile_unavailable", detail: "HTTP 503" }) as unknown,
        },
      ]);
      expectNoSecretsLogged();
    });

    it.each([
      { name: "a network error", error: new Error("network down") },
      { name: "a timeout", error: new DOMException("The operation was aborted due to timeout", "TimeoutError") },
    ])("is unavailable and logged as an error with the cause on $name", async ({ error }) => {
      fetchMock.mockRejectedValueOnce(error);

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "unavailable" });

      expect(lines()).toEqual([
        {
          via: "error",
          line: expect.objectContaining({
            event: "turnstile_unavailable",
            route: "lib/turnstile",
            error: expect.objectContaining({ message: error.message }) as unknown,
          }) as unknown,
        },
      ]);
      expectNoSecretsLogged();
    });

    it("is bad_response and logged as an error when the body is not JSON", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      });

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "bad_response" });
      expect(lines().map(({ via, line }) => [via, line.event])).toEqual([["error", "turnstile_bad_response"]]);
      expectNoSecretsLogged();
    });

    it.each([
      { name: "has no success", body: { "error-codes": [] } },
      { name: "has a non-boolean success", body: { success: "true" } },
      { name: "is null", body: null },
      { name: "is a string", body: "ok" },
    ])("is bad_response, never ok, when the body $name", async ({ body }) => {
      respondWith(body);

      expect(await verifyTurnstile(TOKEN, IP, SECRET)).toEqual({ ok: false, reason: "bad_response" });
      expect(lines().map(({ via, line }) => [via, line.event])).toEqual([["error", "turnstile_bad_response"]]);
    });
  });

  it("fails closed: nothing but success === true is ok", async () => {
    const bodies = [{ success: 1 }, { success: "true" }, { success: null }, { ok: true }, [], {}];
    for (const body of bodies) {
      respondWith(body);
      expect((await verifyTurnstile(TOKEN, IP, SECRET)).ok).toBe(false);
    }
  });
});
