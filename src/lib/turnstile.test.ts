import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const fetchMock = vi.fn();

function respondWith(body: unknown, ok = true) {
  fetchMock.mockResolvedValueOnce({ ok, json: () => Promise.resolve(body) });
}

describe("verifyTurnstile", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    vi.stubGlobal("fetch", fetchMock);
  }

  it("returns true when Cloudflare reports success", async () => {
    stubFetch();
    respondWith({ success: true });

    expect(await verifyTurnstile("token", "1.2.3.4", "secret")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the secret, response and remote ip to the siteverify endpoint", async () => {
    stubFetch();
    respondWith({ success: true });

    await verifyTurnstile("token", "1.2.3.4", "secret");

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect(init.body.get("secret")).toBe("secret");
    expect(init.body.get("response")).toBe("token");
    expect(init.body.get("remoteip")).toBe("1.2.3.4");
  });

  it("returns false when Cloudflare reports failure", async () => {
    stubFetch();
    respondWith({ success: false, "error-codes": ["invalid-input-response"] });

    expect(await verifyTurnstile("token", null, "secret")).toBe(false);
  });

  it("returns false on a non-ok response", async () => {
    stubFetch();
    respondWith({ success: true }, false);

    expect(await verifyTurnstile("token", null, "secret")).toBe(false);
  });

  it("returns false on a network error, and logs it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch();
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(await verifyTurnstile("token", null, "secret")).toBe(false);

    expect(errorSpy).toHaveBeenCalledOnce();
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      event: "turnstile_verify_failed",
      route: "lib/turnstile",
      error: { message: "network down" },
    });
    errorSpy.mockRestore();
  });

  it("returns false without calling fetch when the token is empty or the secret is missing", async () => {
    stubFetch();

    expect(await verifyTurnstile("", null, "secret")).toBe(false);
    expect(await verifyTurnstile(null, null, "secret")).toBe(false);
    expect(await verifyTurnstile("token", null, undefined)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
