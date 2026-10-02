import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import { generateToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { NoActiveTimerError, startTimer, stopTimer, switchTimer, TimerAlreadyRunningError } from "@/lib/timer";
import { POST as start } from "@/pages/api/w/[token]/timer/start";
import { POST as stop } from "@/pages/api/w/[token]/timer/stop";
import { POST as switchProject } from "@/pages/api/w/[token]/timer/switch";

vi.mock("@/lib/links", () => ({ findLinkByToken: vi.fn() }));
// Loading the real `timer.ts` (for its error classes) must not pull in `astro:env/server` through `supabase-admin`.
vi.mock("@/lib/supabase-admin", () => ({ adminOrThrow: vi.fn() }));
vi.mock("@/lib/timer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/timer")>()),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  switchTimer: vi.fn(),
}));

const findLink = vi.mocked(findLinkByToken);
const callStart = vi.mocked(startTimer);
const callStop = vi.mocked(stopTimer);
const callSwitch = vi.mocked(switchTimer);

const routes = [
  {
    name: "start",
    handler: start,
    route: "POST /api/w/[token]/timer/start",
    mock: callStart,
    failed: "timer_start_failed",
  },
  { name: "stop", handler: stop, route: "POST /api/w/[token]/timer/stop", mock: callStop, failed: "timer_stop_failed" },
  {
    name: "switch",
    handler: switchProject,
    route: "POST /api/w/[token]/timer/switch",
    mock: callSwitch,
    failed: "timer_switch_failed",
  },
] as const;

type Handler = typeof start;

function call(handler: Handler, token: string, init?: { body: BodyInit; contentType: string }) {
  const request = new Request(`http://localhost/api/w/${token}/timer/x`, {
    method: "POST",
    body: init?.body ?? new URLSearchParams({ projectName: "Alpha" }),
    headers: init ? { "content-type": init.contentType } : undefined,
  });
  const context = {
    params: { token },
    request,
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    rewrite: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as APIContext;
  return handler(context) as Promise<Response>;
}

/** Every line written to `spy`, parsed. */
function lines(spy: MockInstance<typeof console.error>): Record<string, unknown>[] {
  return spy.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
}

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.restoreAllMocks();
  findLink.mockReset().mockResolvedValue({ id: "link-1" });
  callStart.mockReset();
  callStop.mockReset();
  callSwitch.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe.each(routes)("POST timer/$name", ({ handler, route, mock, failed }) => {
  it("answers 503 and logs link_lookup_failed with the route, never the token, when the lookup fails", async () => {
    const token = generateToken();
    findLink.mockRejectedValue(new Error("database down"));

    const response = await call(handler, token);

    expect(response.status).toBe(503);
    expect(lines(errorSpy)).toMatchObject([
      { event: "link_lookup_failed", route, error: { message: "database down" } },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("redirects with the generic error and logs the failure with the link id when the timer call throws", async () => {
    const token = generateToken();
    mock.mockRejectedValue(new Error("rpc failed"));

    const response = await call(handler, token);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/w/${token}?error=1`);
    expect(lines(errorSpy)).toMatchObject([{ level: "error", event: failed, route, linkId: "link-1" }]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("logs nothing on success and redirects back to the workspace", async () => {
    const token = generateToken();
    mock.mockResolvedValue({ entryId: "e", projectId: "p", projectName: "Alpha", startedAt: "2026-10-02T08:00:00Z" });

    const response = await call(handler, token);

    expect(response.status).toBe(303);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("race backstops", () => {
  it.each([
    {
      name: "start",
      handler: start,
      mock: callStart,
      error: new TimerAlreadyRunningError(),
      event: "timer_start_already_running",
    },
    { name: "stop", handler: stop, mock: callStop, error: new NoActiveTimerError(), event: "timer_stop_no_active" },
    {
      name: "switch",
      handler: switchProject,
      mock: callSwitch,
      error: new NoActiveTimerError(),
      event: "timer_switch_no_active",
    },
  ])(
    "$name redirects quietly as before, but leaves a warning with the link id",
    async ({ handler, mock, error, event }) => {
      const token = generateToken();
      mock.mockRejectedValue(error);

      const response = await call(handler, token);

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/w/${token}`);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({ level: "warn", event, linkId: "link-1" });
    },
  );
});

describe("a body that is not a form", () => {
  it.each([
    { name: "start", handler: start },
    { name: "switch", handler: switchProject },
  ])(
    "$name warns with form_parse_failed and the content type, then refuses the name as before",
    async ({ handler }) => {
      const response = await call(handler, generateToken(), { body: "{not a form", contentType: "application/json" });

      expect(response.headers.get("Location")).toContain("error=");
      expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({
        event: "form_parse_failed",
        linkId: "link-1",
        detail: "application/json",
      });
    },
  );
});
