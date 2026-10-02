import { describe, expect, it } from "vitest";
import { dbError } from "./db-error";

describe("dbError", () => {
  it("keeps the message text of the old `${op} failed: ${message}` format", () => {
    const error = dbError("recent link count", { message: "connection lost" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("recent link count failed: connection lost");
  });

  it("keeps the original error as the cause", () => {
    const original = { message: "boom", code: "42P01", details: "no such table", hint: "create it" };

    expect(dbError("link lookup", original).cause).toBe(original);
  });
});
