import { describe, it, expect } from "vitest";
import { generateToken, hashToken, isWellFormedToken } from "./link-token";

describe("generateToken", () => {
  it("returns 43 base64url characters", () => {
    const token = generateToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is unique across many calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is deterministic lowercase hex of 64 characters", async () => {
    const token = generateToken();
    const first = await hashToken(token);
    const second = await hashToken(token);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different tokens", async () => {
    expect(await hashToken(generateToken())).not.toBe(await hashToken(generateToken()));
  });

  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("isWellFormedToken", () => {
  it("accepts a generated token", () => {
    expect(isWellFormedToken(generateToken())).toBe(true);
  });

  it("rejects empty, short, long and padded input", () => {
    expect(isWellFormedToken("")).toBe(false);
    expect(isWellFormedToken("a".repeat(42))).toBe(false);
    expect(isWellFormedToken("a".repeat(44))).toBe(false);
    expect(isWellFormedToken("a".repeat(42) + "=")).toBe(false);
    expect(isWellFormedToken(" " + "a".repeat(43))).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
    expect(isWellFormedToken(42)).toBe(false);
    expect(isWellFormedToken({})).toBe(false);
  });
});
