import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MAX_OUTPUT_TOKENS, exceedsDiffLimit, parseMaxDiffChars, resolveMaxOutputTokens } from "./limits.js";

void describe("exceedsDiffLimit", () => {
  void it("has no limit when max is undefined", () => {
    assert.equal(exceedsDiffLimit("x".repeat(1_000_000), undefined), false);
  });

  void it("allows a diff below and exactly at the limit", () => {
    assert.equal(exceedsDiffLimit("abcd", 5), false);
    assert.equal(exceedsDiffLimit("abcde", 5), false);
  });

  void it("rejects a diff above the limit", () => {
    assert.equal(exceedsDiffLimit("abcdef", 5), true);
  });

  void it("treats a non-positive or non-integer max as no limit", () => {
    assert.equal(exceedsDiffLimit("abcdef", 0), false);
    assert.equal(exceedsDiffLimit("abcdef", -1), false);
    assert.equal(exceedsDiffLimit("abcdef", 2.5), false);
    assert.equal(exceedsDiffLimit("abcdef", Number.NaN), false);
  });
});

void describe("resolveMaxOutputTokens", () => {
  void it("defaults to a bound well below a model's huge default maximum", () => {
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 8192);
    assert.equal(resolveMaxOutputTokens(undefined), DEFAULT_MAX_OUTPUT_TOKENS);
    assert.equal(resolveMaxOutputTokens(""), DEFAULT_MAX_OUTPUT_TOKENS);
  });

  void it("uses a positive integer from the environment", () => {
    assert.equal(resolveMaxOutputTokens("2048"), 2048);
  });

  void it("falls back to the default for zero, negative, fractional or non-numeric input", () => {
    for (const raw of ["0", "-1", "1.5", "abc", "   "]) {
      assert.equal(resolveMaxOutputTokens(raw), DEFAULT_MAX_OUTPUT_TOKENS, `input ${raw}`);
    }
  });
});

void describe("parseMaxDiffChars", () => {
  void it("parses a positive integer", () => {
    assert.equal(parseMaxDiffChars("200000"), 200000);
  });

  void it("returns undefined for unset, blank, zero, negative, fractional or non-numeric input", () => {
    for (const raw of [undefined, "", "   ", "0", "-5", "1.5", "abc"]) {
      assert.equal(parseMaxDiffChars(raw), undefined, `input ${String(raw)}`);
    }
  });
});
