// Offline tests for the promptfoo provider. The model is the SDK's mock, so no network or key is needed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createReviewerProvider } from "./provider.js";

const REVIEW = {
  implementationCorrectness: 3,
  idiomaticity: 4,
  complexity: 5,
  testRiskCoverage: 2,
  documentation: 6,
  securitySafety: 1,
  verdict: "fail",
  summary: "Three problems found.",
};

function mockReturning(text: string) {
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

function providerWith(model: MockLanguageModelV4, calls: { count: number }) {
  const Provider = createReviewerProvider(() => {
    calls.count += 1;
    return model;
  });
  return Provider;
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
});

void describe("reviewer provider", () => {
  void it("returns the review as JSON text with token usage", async () => {
    const calls = { count: 0 };
    const Provider = providerWith(mockReturning(JSON.stringify(REVIEW)), calls);
    const provider = new Provider({ config: { model: "vendor/model-a" } });

    const result = await provider.callApi("ignored prompt text", { vars: { diff: "+const a = 1;" } });

    assert.equal(result.error, undefined);
    assert.deepEqual(JSON.parse(result.output ?? "null"), REVIEW);
    assert.deepEqual(result.tokenUsage, { prompt: 10, completion: 20, total: 30 });
  });

  void it("takes the diff from vars and not from the prompt text", async () => {
    const model = mockReturning(JSON.stringify(REVIEW));
    const Provider = providerWith(model, { count: 0 });
    const provider = new Provider({ config: { model: "vendor/model-a" } });

    await provider.callApi("PROMPT-TEXT-SHOULD-NOT-BE-USED", { vars: { diff: "+DIFF-FROM-VARS" } });

    const [call] = model.doGenerateCalls;
    assert.ok(call, "the model was called once");
    const sent = JSON.stringify(call.prompt);
    assert.ok(sent.includes("+DIFF-FROM-VARS"));
    assert.ok(!sent.includes("PROMPT-TEXT-SHOULD-NOT-BE-USED"));
  });

  void it("labels itself with the configured model", () => {
    const Provider = providerWith(mockReturning("{}"), { count: 0 });

    assert.equal(new Provider({ config: { model: "vendor/model-a" } }).id(), "reviewer:vendor/model-a");
    assert.equal(new Provider({}).id(), "reviewer:unconfigured");
  });

  void it("returns an error and makes no model call when the diff is missing", async () => {
    const calls = { count: 0 };
    const Provider = providerWith(mockReturning(JSON.stringify(REVIEW)), calls);
    const provider = new Provider({ config: { model: "vendor/model-a" } });

    const result = await provider.callApi("prompt", { vars: {} });

    assert.match(result.error ?? "", /diff/);
    assert.equal(result.output, undefined);
    assert.equal(calls.count, 0);
  });

  void it("returns an error when the model is not configured", async () => {
    const Provider = providerWith(mockReturning(JSON.stringify(REVIEW)), { count: 0 });

    const result = await new Provider({}).callApi("prompt", { vars: { diff: "+x" } });

    assert.match(result.error ?? "", /config\.model/);
  });

  void it("returns an error when the API key is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const Provider = providerWith(mockReturning(JSON.stringify(REVIEW)), { count: 0 });
    const provider = new Provider({ config: { model: "vendor/model-a" } });

    const result = await provider.callApi("prompt", { vars: { diff: "+x" } });

    assert.match(result.error ?? "", /OPENROUTER_API_KEY/);
  });

  void it("turns a model output that breaks the schema into an error result instead of throwing", async () => {
    const Provider = providerWith(mockReturning("not json at all"), { count: 0 });
    const provider = new Provider({ config: { model: "vendor/model-a" } });

    const result = await provider.callApi("prompt", { vars: { diff: "+x" } });

    assert.equal(result.output, undefined);
    assert.ok((result.error ?? "").length > 0);
  });
});
