import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import { errorBoundary } from "./error-boundary";

const TOKEN = "L_bt-dZIUt8Tvv0zHuQHyTWeRGHV5s_1nwsghQYDM0o";
const PROJECT_ID = "1f0d3c2a-6b5e-4c7d-9a8b-0123456789ab";

/** A fake context whose URL carries the private token and a project id, the way the real pages' URLs do. */
function context(routePattern = "/w/[token]/projects/[projectId]/delete", method = "GET") {
  const request = new Request(`http://localhost/w/${TOKEN}/projects/${PROJECT_ID}/delete`, { method });
  return { request, routePattern } as unknown as Pick<APIContext, "request" | "routePattern">;
}

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedLines(): Record<string, unknown>[] {
  return errorSpy.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
}

describe("errorBoundary", () => {
  describe("when the request renders without throwing", () => {
    it.each([200, 404, 500, 503])("returns the very same response and logs nothing for status %i", async (status) => {
      const response = new Response("body", { status });

      const result = await errorBoundary(context(), () => Promise.resolve(response));

      expect(result).toBe(response);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when rendering throws", () => {
    it("rethrows the very same error object", async () => {
      const failure = new Error("current timer lookup failed: boom");

      await expect(errorBoundary(context(), () => Promise.reject(failure))).rejects.toBe(failure);
    });

    it("logs exactly one unhandled_request_error line with the error's message and stack", async () => {
      const failure = new Error("current timer lookup failed: boom");

      await errorBoundary(context(), () => Promise.reject(failure)).catch(() => undefined);

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(loggedLines()[0]).toMatchObject({
        level: "error",
        event: "unhandled_request_error",
        error: { name: "Error", message: "current timer lookup failed: boom" },
      });
      expect(loggedLines()[0]?.error).toHaveProperty("stack");
    });

    it("labels the event with the method and the route pattern", async () => {
      await errorBoundary(context("/api/w/[token]/timer/start", "POST"), () => Promise.reject(new Error("x"))).catch(
        () => undefined,
      );

      expect(loggedLines()[0]).toMatchObject({ route: "POST /api/w/[token]/timer/start" });
    });

    it("never puts the token or the project id from the URL into the log line", async () => {
      await errorBoundary(context(), () => Promise.reject(new Error("x"))).catch(() => undefined);

      const line = String(errorSpy.mock.calls[0]?.[0]);
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(PROJECT_ID);
      expect(loggedLines()[0]).toMatchObject({ route: "GET /w/[token]/projects/[projectId]/delete" });
    });

    it("logs and rethrows a value that is not an Error unchanged", async () => {
      // Deliberately not an Error: anything can be thrown in JavaScript, and the boundary must cope with it.
      const notAnError = "plain string failure" as unknown as Error;

      await expect(errorBoundary(context(), () => Promise.reject(notAnError))).rejects.toBe(notAnError);

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(loggedLines()[0]).toMatchObject({
        event: "unhandled_request_error",
        error: { message: "plain string failure" },
      });
    });
  });
});
