import { beforeEach, describe, expect, it, vi } from "vitest";
import { countRecentLinks, createLink, deleteAccount, findLinkByToken, regenerateLink } from "./links";
import { deleteProject, getProject, listProjects } from "./projects";
import { adminOrThrow } from "./supabase-admin";
import { getCurrentTimer, startTimer, stopTimer, switchTimer } from "./timer";
import { fetchWeekEntries } from "./weekly-grid-query";

vi.mock("./supabase-admin", () => ({ adminOrThrow: vi.fn() }));

const dbFailure = { message: "boom", code: "XX000", details: "the details", hint: "the hint" };

/**
 * An admin client whose every call fails with `dbFailure`: `rpc` resolves with it, and any `from(...)` query chain
 * resolves with it no matter which builder methods are called, so each wrapper in `src/lib` reaches its error branch.
 */
function failingAdmin() {
  const result = { data: null, error: dbFailure };
  const chain: object = new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "then"
          ? (resolve: (value: unknown) => void) => {
              resolve(result);
            }
          : () => chain,
    },
  );
  return { rpc: () => Promise.resolve(result), from: () => chain };
}

beforeEach(() => {
  vi.mocked(adminOrThrow).mockReturnValue(failingAdmin() as unknown as ReturnType<typeof adminOrThrow>);
});

// Every Supabase `{ error }` in the data layer is rethrown through `dbError`: the message text callers and tests match on
// is unchanged, and the original PostgREST object (code, details, hint) survives as `cause` for the logger.
describe("data layer errors keep their cause", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["createLink", () => createLink(), "create_link failed"],
    ["regenerateLink", () => regenerateLink("token"), "regenerate_link failed"],
    ["deleteAccount", () => deleteAccount("link-1"), "delete_account failed"],
    ["findLinkByToken", () => findLinkByToken("token"), "link lookup failed"],
    ["countRecentLinks", () => countRecentLinks(10), "recent link count failed"],
    ["listProjects", () => listProjects("link-1"), "project list failed"],
    ["getProject", () => getProject("link-1", "project-1"), "project lookup failed"],
    ["deleteProject", () => deleteProject("link-1", "project-1"), "project delete failed"],
    ["startTimer", () => startTimer("link-1", "Project"), "start_timer failed"],
    ["switchTimer", () => switchTimer("link-1", "Project"), "switch_timer failed"],
    ["stopTimer", () => stopTimer("link-1"), "stop_timer failed"],
    ["getCurrentTimer", () => getCurrentTimer("link-1"), "current timer lookup failed"],
    [
      "fetchWeekEntries",
      () => fetchWeekEntries("link-1", new Date("2026-09-28T00:00:00Z")),
      "week entries lookup failed",
    ],
  ];

  it.each(cases)("%s", async (_name, call, prefix) => {
    const error: unknown = await call().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`${prefix}: boom`);
    expect((error as Error).cause).toBe(dbFailure);
  });
});
