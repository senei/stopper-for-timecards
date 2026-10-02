import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext, AstroCookies } from "astro";
import { generateToken } from "@/lib/link-token";
import { deleteAccount, findLinkByToken } from "@/lib/links";
import { ALL, POST } from "@/pages/api/w/[token]/delete-account";

vi.mock("@/lib/links", () => ({ findLinkByToken: vi.fn(), deleteAccount: vi.fn() }));

const findLink = vi.mocked(findLinkByToken);
const removeAccount = vi.mocked(deleteAccount);

// Oracle: PRD FR-010 -- one explicit, hard-to-misclick confirmation (a typed phrase), then everything the person
// owns is deleted and the person is left with no link. Decided in planning: the phrase is DELETE, checked on the
// server as well as in the page.
function call({ token, phrase, cookie }: { token: string; phrase?: string; cookie?: string }) {
  const form = new FormData();
  if (phrase !== undefined) form.set("confirm", phrase);
  const del = vi.fn();
  const cookies = {
    get: (name: string) => (name === "stopper_link" && cookie !== undefined ? { value: cookie } : undefined),
    delete: del,
  } as unknown as AstroCookies;
  const rewrite = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
  const context = {
    params: { token },
    request: new Request(`http://localhost/api/w/${token}/delete-account`, { method: "POST", body: form }),
    cookies,
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    rewrite,
  } as unknown as APIContext;
  return { response: POST(context), del, rewrite };
}

/** The one error line the route wrote: parsed, matching `expected`, and never containing the URL token. */
function expectLoggedError(spy: MockInstance<typeof console.error>, token: string, expected: Record<string, unknown>) {
  expect(spy).toHaveBeenCalledOnce();
  const line = String(spy.mock.calls[0][0]);
  expect(JSON.parse(line)).toMatchObject({ level: "error", ...expected });
  expect(line).not.toContain(token);
}

beforeEach(() => {
  findLink.mockReset();
  removeAccount.mockReset();
  vi.restoreAllMocks();
});

describe("POST /api/w/[token]/delete-account", () => {
  it.each([
    { name: "no phrase at all", phrase: undefined },
    { name: "an empty phrase", phrase: "" },
    { name: "the phrase in lower case", phrase: "delete" },
    { name: "the phrase with extra words", phrase: "DELETE everything" },
  ])("deletes nothing and returns to the confirm page when the phrase is wrong ($name)", async ({ phrase }) => {
    const token = generateToken();
    findLink.mockResolvedValue({ id: "link-1" });

    const { response } = call({ token, phrase });
    const result = await response;

    expect(removeAccount).not.toHaveBeenCalled();
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(`/w/${token}/delete-account?error=confirm-phrase`);
  });

  it("deletes the person and sends them to the home page with the deleted notice when the phrase is DELETE", async () => {
    const token = generateToken();
    findLink.mockResolvedValue({ id: "link-1" });
    removeAccount.mockResolvedValue(true);

    const result = await call({ token, phrase: "DELETE" }).response;

    expect(removeAccount).toHaveBeenCalledExactlyOnceWith("link-1");
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe("/?status=account-deleted");
  });

  it("forgets the remembered link when the browser's cookie holds the deleted link, and only then", async () => {
    const token = generateToken();
    findLink.mockResolvedValue({ id: "link-1" });
    removeAccount.mockResolvedValue(true);

    const own = call({ token, phrase: "DELETE", cookie: token });
    await own.response;
    expect(own.del).toHaveBeenCalledWith("stopper_link", { path: "/" });

    const someoneElses = call({ token, phrase: "DELETE", cookie: generateToken() });
    await someoneElses.response;
    expect(someoneElses.del).not.toHaveBeenCalled();
  });

  it("is a 404 and deletes nothing for a link that does not exist, even with the right phrase", async () => {
    findLink.mockResolvedValue(null);

    const { response, rewrite } = call({ token: generateToken(), phrase: "DELETE" });
    await response;

    expect(removeAccount).not.toHaveBeenCalled();
    expect(rewrite).toHaveBeenCalledWith("/404");
  });

  it("goes back to the confirm page with the generic error and keeps the remembered link when the delete throws", async () => {
    const token = generateToken();
    findLink.mockResolvedValue({ id: "link-1" });
    removeAccount.mockRejectedValue(new Error("database down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response, del } = call({ token, phrase: "DELETE", cookie: token });
    const result = await response;

    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(`/w/${token}/delete-account?error=1`);
    expect(del).not.toHaveBeenCalled();
    expectLoggedError(errorSpy, token, {
      event: "account_delete_failed",
      route: "POST /api/w/[token]/delete-account",
      linkId: "link-1",
      error: { message: "database down" },
    });
  });

  it("is a 404 and keeps the remembered link when the link was already gone by the time of the delete", async () => {
    const token = generateToken();
    findLink.mockResolvedValue({ id: "link-1" });
    removeAccount.mockResolvedValue(false);

    const { response, del, rewrite } = call({ token, phrase: "DELETE", cookie: token });
    await response;

    expect(rewrite).toHaveBeenCalledWith("/404");
    expect(del).not.toHaveBeenCalled();
  });

  it("answers 503 and deletes nothing when the link lookup fails", async () => {
    findLink.mockRejectedValue(new Error("database down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = generateToken();

    const result = await call({ token, phrase: "DELETE" }).response;

    expect(result.status).toBe(503);
    expect(removeAccount).not.toHaveBeenCalled();
    expectLoggedError(errorSpy, token, {
      event: "link_lookup_failed",
      route: "POST /api/w/[token]/delete-account",
      error: { message: "database down" },
    });
  });

  it("looks up and deletes the person whose token is in the URL, not the one whose link the cookie holds", async () => {
    const urlToken = generateToken();
    const cookieToken = generateToken();
    findLink.mockImplementation((token) =>
      Promise.resolve({ id: token === urlToken ? "url-person" : "cookie-person" }),
    );
    removeAccount.mockResolvedValue(true);

    await call({ token: urlToken, phrase: "DELETE", cookie: cookieToken }).response;

    expect(findLink).toHaveBeenCalledExactlyOnceWith(urlToken);
    expect(removeAccount).toHaveBeenCalledExactlyOnceWith("url-person");
  });

  it("is a 404 for a malformed token without touching the database", async () => {
    const { response, rewrite } = call({ token: "not-a-token", phrase: "DELETE" });
    await response;

    expect(rewrite).toHaveBeenCalledWith("/404");
    expect(findLink).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it("refuses every method other than POST with a 405", () => {
    const result = ALL({} as APIContext) as Response;

    expect(result.status).toBe(405);
    expect(result.headers.get("Allow")).toBe("POST");
  });

  describe("documents the current plan decision (the phrase is DELETE, trimmed of outer whitespace and case-sensitive)", () => {
    it("accepts the phrase with surrounding whitespace", async () => {
      findLink.mockResolvedValue({ id: "link-1" });
      removeAccount.mockResolvedValue(true);

      const result = await call({ token: generateToken(), phrase: "  DELETE  " }).response;

      expect(removeAccount).toHaveBeenCalledExactlyOnceWith("link-1");
      expect(result.headers.get("Location")).toBe("/?status=account-deleted");
    });
  });
});
