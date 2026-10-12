// promptfoo custom provider: runs the real reviewer (createReviewer/reviewDiff) for one configured OpenRouter model.
// The diff comes from the test's `vars.diff`, not from the prompt text, so the reviewer builds its own prompt.
// Types are declared locally on purpose: promptfoo is run through npx and is not a dependency of this package.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { createReviewer, reviewDiff } from "../reviewer.js";

interface ProviderOptions {
  id?: string;
  config?: { model?: unknown };
}

interface CallContext {
  vars?: Record<string, unknown>;
}

interface ProviderResponse {
  output?: string;
  error?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export type MakeModel = (modelId: string, apiKey: string) => LanguageModel;

export function createReviewerProvider(makeModel: MakeModel) {
  return class ReviewerProvider {
    private readonly model: string | undefined;

    constructor(options: ProviderOptions = {}) {
      const configured = options.config?.model;
      this.model = typeof configured === "string" && configured !== "" ? configured : undefined;
    }

    id(): string {
      return `reviewer:${this.model ?? "unconfigured"}`;
    }

    async callApi(_prompt: string, context?: CallContext): Promise<ProviderResponse> {
      if (this.model === undefined) return { error: "Provider config.model is missing" };

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (apiKey === undefined || apiKey === "") return { error: "OPENROUTER_API_KEY is not set" };

      const diff = context?.vars?.diff;
      if (typeof diff !== "string" || diff === "") return { error: "Test var `diff` is missing or empty" };

      try {
        const reviewer = createReviewer(makeModel(this.model, apiKey));
        const { review, usage } = await reviewDiff(reviewer, diff);
        const prompt = usage.inputTokens ?? 0;
        const completion = usage.outputTokens ?? 0;
        return {
          output: JSON.stringify(review),
          tokenUsage: { prompt, completion, total: prompt + completion },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
}

export default createReviewerProvider((modelId, apiKey) => createOpenRouter({ apiKey })(modelId));
