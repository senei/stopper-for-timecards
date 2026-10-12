// Deterministic tests for the reviewer wiring. The model is the SDK's mock, so no network or key is needed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { createReviewer, reviewDiff } from "./reviewer.js";
import { REVIEW_SCHEMA } from "./review-schema.js";

const DIFF = "diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;";

const VALID_REVIEW = {
  implementationCorrectness: 8,
  idiomaticity: 7,
  complexity: 9,
  testRiskCoverage: 6,
  documentation: 5,
  securitySafety: 10,
  verdict: "pass",
  summary: "Looks good.",
};

function modelReturning(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

void describe("reviewer", () => {
  void it("returns the model output as a typed review that matches the schema", async () => {
    const reviewer = createReviewer(modelReturning(JSON.stringify(VALID_REVIEW)));

    const { review, usage } = await reviewDiff(reviewer, DIFF);

    assert.deepEqual(review, VALID_REVIEW);
    assert.equal(REVIEW_SCHEMA.safeParse(review).success, true);
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.outputTokens, 20);
  });

  void it("sends the system prompt as instructions, the diff as the prompt and asks for JSON output", async () => {
    const model = modelReturning(JSON.stringify(VALID_REVIEW));

    await reviewDiff(createReviewer(model), DIFF);

    const [call] = model.doGenerateCalls;
    assert.ok(call, "the model was called once");
    const system = call.prompt.find((message) => message.role === "system");
    assert.equal(system?.content, SYSTEM_PROMPT);
    assert.ok(JSON.stringify(call.prompt).includes("diff --git a/src/a.ts"), "the diff reaches the model");
    assert.equal(call.responseFormat?.type, "json");
  });

  void it("sends the pull request title and description to the model when context is given", async () => {
    const model = modelReturning(JSON.stringify(VALID_REVIEW));

    await reviewDiff(createReviewer(model), DIFF, { title: "TITLE-MARKER", body: "BODY-MARKER" });

    const [call] = model.doGenerateCalls;
    assert.ok(call, "the model was called once");
    const sent = JSON.stringify(call.prompt);
    assert.ok(sent.includes("TITLE-MARKER"));
    assert.ok(sent.includes("BODY-MARKER"));
    assert.ok(sent.includes("diff --git a/src/a.ts"));
  });

  void it("sends maxOutputTokens to the model when a limit is given and omits it otherwise", async () => {
    const limited = modelReturning(JSON.stringify(VALID_REVIEW));
    const unlimited = modelReturning(JSON.stringify(VALID_REVIEW));

    await reviewDiff(createReviewer(limited, { maxOutputTokens: 1234 }), DIFF);
    await reviewDiff(createReviewer(unlimited), DIFF);

    assert.equal(limited.doGenerateCalls[0]?.maxOutputTokens, 1234);
    assert.equal(unlimited.doGenerateCalls[0]?.maxOutputTokens, undefined);
  });

  void it("sends no pull request block when no context is given", async () => {
    const model = modelReturning(JSON.stringify(VALID_REVIEW));

    await reviewDiff(createReviewer(model), DIFF);

    const [call] = model.doGenerateCalls;
    assert.ok(call, "the model was called once");
    assert.ok(!JSON.stringify(call.prompt).includes("Tytuł PR:"));
  });

  void it("rejects when the model output violates the schema", async () => {
    const invalid = { ...VALID_REVIEW, verdict: "maybe" };
    const reviewer = createReviewer(modelReturning(JSON.stringify(invalid)));

    await assert.rejects(reviewDiff(reviewer, DIFF));
  });

  void it("rejects when the model output is not JSON", async () => {
    const reviewer = createReviewer(modelReturning("I think this is fine."));

    await assert.rejects(reviewDiff(reviewer, DIFF));
  });
});
