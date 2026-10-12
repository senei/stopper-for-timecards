// The reusable reviewer: a ToolLoopAgent bound to REVIEW_SCHEMA. It takes a model instead of reading env,
// so tests and evals can inject any provider. Process I/O lives in index.ts.
import { Output, ToolLoopAgent, type LanguageModel, type LanguageModelUsage } from "ai";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { buildUserPrompt, type PullRequestContext } from "./prompts/user.js";
import { REVIEW_SCHEMA, type Review } from "./review-schema.js";

export function createReviewer(model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    output: Output.object({ schema: REVIEW_SCHEMA }),
  });
}

export type Reviewer = ReturnType<typeof createReviewer>;

export async function reviewDiff(
  reviewer: Reviewer,
  diff: string,
  context?: PullRequestContext,
): Promise<{ review: Review; usage: LanguageModelUsage }> {
  const result = await reviewer.generate({ prompt: buildUserPrompt(diff, context) });
  return { review: result.output, usage: result.usage };
}
