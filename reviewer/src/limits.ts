// Diff-size limit: one pure decision for "too large", so the CLI can stop before any model call.

export function parseMaxDiffChars(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function exceedsDiffLimit(diff: string, max: number | undefined): boolean {
  if (max === undefined || !Number.isInteger(max) || max <= 0) return false;
  return diff.length > max;
}

// Output bound for the CLI. Without it a provider can reserve the model's whole default maximum up front
// (for example 131072 tokens), which an account with a small balance cannot cover. A review is about 1.5k tokens
// and the largest seen in the evals was about 3k, so 8192 leaves room for reasoning models without that reservation.
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export function resolveMaxOutputTokens(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_OUTPUT_TOKENS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_OUTPUT_TOKENS;
}
