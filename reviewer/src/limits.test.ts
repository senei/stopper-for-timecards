import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exceedsDiffLimit, parseMaxDiffChars } from "./limits.js";

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
