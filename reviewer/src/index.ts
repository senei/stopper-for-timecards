// CLI: diff in on stdin, structured JSON verdict out on stdout.
//   git diff | npm run review --prefix reviewer
// Config comes from the environment (reviewer/.env, see .env.example); no model ID is hardcoded.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { exceedsDiffLimit, parseMaxDiffChars } from "./limits.js";
import { createReviewer, reviewDiff } from "./reviewer.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing ${name}. Copy .env.example to .env and set it.\n`);
    process.exit(1);
  }
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const diff = (await readStdin()).trim();
if (!diff) {
  process.stderr.write("Empty diff on stdin. Usage: git diff | npm run review\n");
  process.exit(1);
}

// Optional limit: stop before any model call. Exit code 3 is distinct from usage/config errors (1).
const maxDiffChars = parseMaxDiffChars(process.env.MAX_DIFF_CHARS);
if (exceedsDiffLimit(diff, maxDiffChars)) {
  process.stderr.write(`Diff too large (${String(diff.length)} > ${String(maxDiffChars)} characters)\n`);
  process.exit(3);
}

const openrouter = createOpenRouter({ apiKey: requireEnv("OPENROUTER_API_KEY") });
const reviewer = createReviewer(openrouter(requireEnv("REVIEWER_MODEL")));

// Optional pull request context (set by the CI action); absent variables leave the prompt unchanged.
const { review, usage } = await reviewDiff(reviewer, diff, {
  title: process.env.PR_TITLE,
  body: process.env.PR_BODY,
});

process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
process.stderr.write(`tokens: input=${String(usage.inputTokens)} output=${String(usage.outputTokens)}\n`);
