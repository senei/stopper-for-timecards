import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import { generateToken } from "@/lib/link-token";
import { findLinkByToken } from "@/lib/links";
import { correctEntry, CorrectionRefusedError, deleteEntry, type CorrectionRefusal } from "@/lib/time-entries";
import { ALL as correctAll, POST as correct } from "@/pages/api/w/[token]/entries/[entryId]/correct";
import { ALL as deleteAll, POST as del } from "@/pages/api/w/[token]/entries/[entryId]/delete";

vi.mock("@/lib/links", () => ({ findLinkByToken: vi.fn() }));
// Loading the real `time-entries.ts` (for CorrectionRefusedError) must not pull in `astro:env/server` through
// `supabase-admin`.
vi.mock("@/lib/supabase-admin", () => ({ adminOrThrow: vi.fn() }));
vi.mock("@/lib/time-entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/time-entries")>()),
  correctEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

const findLink = vi.mocked(findLinkByToken);
const callCorrect = vi.mocked(correctEntry);
const callDelete = vi.mocked(deleteEntry);

const ENTRY_ID = "11111111-1111-1111-1111-111111111111";
const CORRECT_ROUTE = "POST /api/w/[token]/entries/[entryId]/correct";
const DELETE_ROUTE = "POST /api/w/[token]/entries/[entryId]/delete";

type Handler = typeof correct;

function call(
  handler: Handler,
  token: string,
  entryId: string,
  init?: { body: BodyInit; contentType: string },
): Promise<Response> {
  const request = new Request(`http://localhost/api/w/${token}/entries/${entryId}/x`, {
    method: "POST",
    body: init?.body ?? new URLSearchParams({ startedAt: "2026-10-05T09:00", endedAt: "2026-10-05T10:00" }),
    headers: init ? { "content-type": init.contentType } : undefined,
  });
  const context = {
    params: { token, entryId },
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
let infoSpy: MockInstance<typeof console.info>;

beforeEach(() => {
  vi.restoreAllMocks();
  findLink.mockReset().mockResolvedValue({ id: "link-1" });
  callCorrect.mockReset();
  callDelete.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

const REFUSALS: { reason: Exclude<CorrectionRefusal, "entry_not_found">; code: string }[] = [
  { reason: "entry_running", code: "entry-running" },
  { reason: "outside_window", code: "entry-outside-window" },
  { reason: "bad_range", code: "entry-range" },
  { reason: "in_future", code: "entry-in-future" },
  { reason: "overlap", code: "entry-overlap" },
];

describe("POST entries/[entryId]/correct", () => {
  it("rewrites to /404 for a malformed token", async () => {
    const response = await call(correct, "not-a-token", ENTRY_ID);

    expect(response.status).toBe(404);
    expect(findLink).not.toHaveBeenCalled();
  });

  it("answers 503 and logs link_lookup_failed, never the token, when the lookup fails", async () => {
    const token = generateToken();
    findLink.mockRejectedValue(new Error("database down"));

    const response = await call(correct, token, ENTRY_ID);

    expect(response.status).toBe(503);
    expect(lines(errorSpy)).toMatchObject([
      { event: "link_lookup_failed", route: CORRECT_ROUTE, error: { message: "database down" } },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("rewrites to /404 when the link is missing", async () => {
    const token = generateToken();
    findLink.mockResolvedValue(null);

    expect((await call(correct, token, ENTRY_ID)).status).toBe(404);
  });

  it("rewrites to /404 for a malformed entry id, without calling correctEntry", async () => {
    const token = generateToken();

    const response = await call(correct, token, "not-an-id");

    expect(response.status).toBe(404);
    expect(callCorrect).not.toHaveBeenCalled();
  });

  it("redirects with entry-time-invalid and does not call correctEntry when a time is unparseable", async () => {
    const token = generateToken();
    const body = new URLSearchParams({ startedAt: "not-a-date", endedAt: "2026-10-05T10:00" });

    const response = await call(correct, token, ENTRY_ID, {
      body: body.toString(),
      contentType: "application/x-www-form-urlencoded",
    });

    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=entry-time-invalid`);
    expect(callCorrect).not.toHaveBeenCalled();
  });

  it("redirects with entry-time-invalid when a time is missing", async () => {
    const token = generateToken();
    const body = new URLSearchParams({ startedAt: "2026-10-05T09:00" });

    const response = await call(correct, token, ENTRY_ID, {
      body: body.toString(),
      contentType: "application/x-www-form-urlencoded",
    });

    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=entry-time-invalid`);
  });

  it("warns form_parse_failed for a non-form body, then refuses the time as before", async () => {
    const token = generateToken();

    const response = await call(correct, token, ENTRY_ID, { body: "{not a form", contentType: "application/json" });

    expect(response.headers.get("Location")).toContain("error=entry-time-invalid");
    expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({
      event: "form_parse_failed",
      linkId: "link-1",
      entryId: ENTRY_ID,
      detail: "application/json",
    });
  });

  it("calls correctEntry with link.id, the entry id and the parsed UTC instants", async () => {
    const token = generateToken();
    callCorrect.mockResolvedValue({
      entryId: ENTRY_ID,
      startedAt: "2026-10-05T09:00:00.000Z",
      endedAt: "2026-10-05T10:00:00.000Z",
    });

    await call(correct, token, ENTRY_ID);

    expect(callCorrect).toHaveBeenCalledExactlyOnceWith(
      "link-1",
      ENTRY_ID,
      new Date("2026-10-05T09:00:00.000Z"),
      new Date("2026-10-05T10:00:00.000Z"),
    );
  });

  it("redirects with entry-corrected and logs one entry_corrected line on success", async () => {
    const token = generateToken();
    callCorrect.mockResolvedValue({
      entryId: ENTRY_ID,
      startedAt: "2026-10-05T09:00:00.000Z",
      endedAt: "2026-10-05T10:00:00.000Z",
    });

    const response = await call(correct, token, ENTRY_ID);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?status=entry-corrected`);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(infoSpy.mock.calls[0][0]))).toMatchObject({
      event: "entry_corrected",
      linkId: "link-1",
      entryId: ENTRY_ID,
    });
  });

  it.each(REFUSALS)(
    "maps the $reason refusal to ?error=$code and logs one warn line, never the token",
    async ({ reason, code }) => {
      const token = generateToken();
      callCorrect.mockRejectedValue(new CorrectionRefusedError(reason));

      const response = await call(correct, token, ENTRY_ID);

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=${code}`);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({
        event: "entry_correction_refused",
        linkId: "link-1",
        entryId: ENTRY_ID,
        op: reason,
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(token);
    },
  );

  it("rewrites to /404 for an entry_not_found refusal, without warning", async () => {
    const token = generateToken();
    callCorrect.mockRejectedValue(new CorrectionRefusedError("entry_not_found"));

    const response = await call(correct, token, ENTRY_ID);

    expect(response.status).toBe(404);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs entry_correct_failed and redirects with the generic error for an unexpected error", async () => {
    const token = generateToken();
    callCorrect.mockRejectedValue(new Error("rpc failed"));

    const response = await call(correct, token, ENTRY_ID);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=1`);
    expect(lines(errorSpy)).toMatchObject([
      { level: "error", event: "entry_correct_failed", route: CORRECT_ROUTE, linkId: "link-1", entryId: ENTRY_ID },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("answers 405 to other methods", () => {
    const response = correctAll({} as APIContext) as Response;

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("POST entries/[entryId]/delete", () => {
  it("rewrites to /404 for a malformed token", async () => {
    const response = await call(del, "not-a-token", ENTRY_ID);

    expect(response.status).toBe(404);
    expect(findLink).not.toHaveBeenCalled();
  });

  it("answers 503 and logs link_lookup_failed, never the token, when the lookup fails", async () => {
    const token = generateToken();
    findLink.mockRejectedValue(new Error("database down"));

    const response = await call(del, token, ENTRY_ID);

    expect(response.status).toBe(503);
    expect(lines(errorSpy)).toMatchObject([
      { event: "link_lookup_failed", route: DELETE_ROUTE, error: { message: "database down" } },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("rewrites to /404 when the link is missing", async () => {
    const token = generateToken();
    findLink.mockResolvedValue(null);

    expect((await call(del, token, ENTRY_ID)).status).toBe(404);
  });

  it("rewrites to /404 for a malformed entry id, without calling deleteEntry", async () => {
    const token = generateToken();

    const response = await call(del, token, "not-an-id");

    expect(response.status).toBe(404);
    expect(callDelete).not.toHaveBeenCalled();
  });

  it("calls deleteEntry with link.id and the entry id", async () => {
    const token = generateToken();
    callDelete.mockResolvedValue(ENTRY_ID);

    await call(del, token, ENTRY_ID);

    expect(callDelete).toHaveBeenCalledExactlyOnceWith("link-1", ENTRY_ID);
  });

  it("redirects with entry-deleted and logs one entry_deleted line on success", async () => {
    const token = generateToken();
    callDelete.mockResolvedValue(ENTRY_ID);

    const response = await call(del, token, ENTRY_ID);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?status=entry-deleted`);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(infoSpy.mock.calls[0][0]))).toMatchObject({
      event: "entry_deleted",
      linkId: "link-1",
      entryId: ENTRY_ID,
    });
  });

  it.each(REFUSALS)(
    "maps the $reason refusal to ?error=$code and logs one warn line, never the token",
    async ({ reason, code }) => {
      const token = generateToken();
      callDelete.mockRejectedValue(new CorrectionRefusedError(reason));

      const response = await call(del, token, ENTRY_ID);

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=${code}`);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({
        event: "entry_deletion_refused",
        linkId: "link-1",
        entryId: ENTRY_ID,
        op: reason,
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(token);
    },
  );

  it("rewrites to /404 for an entry_not_found refusal, without warning", async () => {
    const token = generateToken();
    callDelete.mockRejectedValue(new CorrectionRefusedError("entry_not_found"));

    const response = await call(del, token, ENTRY_ID);

    expect(response.status).toBe(404);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs entry_delete_failed and redirects with the generic error for an unexpected error", async () => {
    const token = generateToken();
    callDelete.mockRejectedValue(new Error("rpc failed"));

    const response = await call(del, token, ENTRY_ID);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/w/${token}/corrections?error=1`);
    expect(lines(errorSpy)).toMatchObject([
      { level: "error", event: "entry_delete_failed", route: DELETE_ROUTE, linkId: "link-1", entryId: ENTRY_ID },
    ]);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
  });

  it("answers 405 to other methods", () => {
    const response = deleteAll({} as APIContext) as Response;

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
