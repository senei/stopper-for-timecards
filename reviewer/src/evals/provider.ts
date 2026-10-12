// promptfoo custom provider: runs the real reviewer (createReviewer/reviewDiff) for one configured OpenRouter model.
// The diff comes from the test vars, not from the prompt text, so the reviewer builds its own prompt:
// - `vars.diffFile`: path to a diff file (relative to the working directory, which is reviewer/ for `npm run eval`).
//   Prefer this for fixtures: promptfoo renders variable values through its template engine, so a diff that
//   contains `{{` (JSX style objects, Vue, Handlebars, Go templates) breaks when passed inline as `vars.diff`.
// - `vars.diff`: the diff text itself, used when no file is involved (and in tests).
// Types are declared locally on purpose: promptfoo is run through npx and is not a dependency of this package.
import { readFile } from "node:fs/promises";
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

      const vars = context?.vars;
      let diff: string | undefined;
      if (typeof vars?.diff === "string" && vars.diff !== "") {
        diff = vars.diff;
      } else if (typeof vars?.diffFile === "string" && vars.diffFile !== "") {
        try {
          diff = await readFile(vars.diffFile, "utf8");
        } catch (error) {
          return { error: `Cannot read diffFile: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
      if (diff === undefined || diff === "") return { error: "Test var `diff` or `diffFile` is missing or empty" };

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
