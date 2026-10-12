// CLI: diff in on stdin, structured JSON verdict out on stdout.
//   git diff | npm run review --prefix reviewer
// Config comes from the environment (reviewer/.env, see .env.example); no model ID is hardcoded.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
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

const openrouter = createOpenRouter({ apiKey: requireEnv("OPENROUTER_API_KEY") });
const reviewer = createReviewer(openrouter(requireEnv("REVIEWER_MODEL")));

const { review, usage } = await reviewDiff(reviewer, diff);

process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
process.stderr.write(`tokens: input=${String(usage.inputTokens)} output=${String(usage.outputTokens)}\n`);
