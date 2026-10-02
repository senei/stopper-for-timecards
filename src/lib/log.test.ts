import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logError, logWarn, serializeError } from "./log";

const context = { route: "POST /api/w/[token]/timer/start", linkId: "link-1", op: "timer_start" };

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The single argument of the single call, parsed: a log event must be exactly one JSON line. */
function loggedLine(spy: MockInstance<typeof console.error>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledOnce();
  const args: unknown[] = spy.mock.calls[0];
  expect(args).toHaveLength(1);
  expect(typeof args[0]).toBe("string");
  return JSON.parse(args[0] as string) as Record<string, unknown>;
}

describe("logError", () => {
  it("writes one parseable JSON line with level, event, the context fields and the error", () => {
    logError("timer_start_failed", context, new Error("boom"));

    const line = loggedLine(errorSpy);
    expect(line).toMatchObject({
      level: "error",
      event: "timer_start_failed",
      route: "POST /api/w/[token]/timer/start",
      linkId: "link-1",
      op: "timer_start",
      error: { name: "Error", message: "boom" },
    });
    expect(line.error).toHaveProperty("stack");
  });

  it("adds no key beyond level, event, the context and error", () => {
    logError("x", context, new Error("boom"));

    expect(Object.keys(loggedLine(errorSpy)).sort()).toEqual(["error", "event", "level", "linkId", "op", "route"]);
  });

  it("surfaces the code, details and hint of an Error's cause", () => {
    const cause = { message: "relation missing", code: "42P01", details: "no such table", hint: "run the migration" };

    logError(
      "link_lookup_failed",
      { route: "GET /w/[token]" },
      new Error("link lookup failed: relation missing", { cause }),
    );

    expect(loggedLine(errorSpy).error).toMatchObject({
      message: "link lookup failed: relation missing",
      cause: { message: "relation missing", code: "42P01", details: "no such table", hint: "run the migration" },
    });
  });

  it("keeps all four fields of a plain PostgREST-style object", () => {
    logError("x", context, { message: "m", code: "XX000", details: "d", hint: "h" });

    expect(loggedLine(errorSpy).error).toEqual({ message: "m", code: "XX000", details: "d", hint: "h" });
  });

  it.each([
    ["a string", "something odd"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])("does not throw for %s", (_label, value) => {
    expect(() => {
      logError("x", context, value);
    }).not.toThrow();
    expect(loggedLine(errorSpy).error).toHaveProperty("message");
  });

  it("truncates a 600-character message", () => {
    logError("x", context, new Error(`<html>${"a".repeat(600)}</html>`));

    const message = (loggedLine(errorSpy).error as { message: string }).message;
    expect(message.length).toBeLessThan(600);
    expect(message.startsWith("<html>")).toBe(true);
    expect(message.endsWith("[truncated]")).toBe(true);
  });

  it("never throws, even for an error that cannot be serialised", () => {
    const circular: Record<string, unknown> = { message: "loop" };
    circular.self = circular;
    const hostile = {
      get message(): string {
        throw new Error("getter blew up");
      },
    };

    expect(() => {
      logError("x", context, circular);
    }).not.toThrow();
    expect(() => {
      logError("x", context, hostile);
    }).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("logWarn", () => {
  it("writes one JSON line through console.warn, with no error", () => {
    logWarn("timer_start_already_running", context);

    expect(errorSpy).not.toHaveBeenCalled();
    const line = loggedLine(warnSpy);
    expect(line).toMatchObject({ level: "warn", event: "timer_start_already_running", linkId: "link-1" });
    expect(line).not.toHaveProperty("error");
  });
});

describe("serializeError", () => {
  it("follows the cause chain to a depth of 3", () => {
    const chain = new Error("0", {
      cause: new Error("1", { cause: new Error("2", { cause: new Error("3", { cause: new Error("4") }) }) }),
    });

    const level0 = serializeError(chain);
    const level3 = level0.cause?.cause?.cause;
    expect(level3?.message).toBe("3");
    expect(level3?.cause).toBeUndefined();
  });
});
