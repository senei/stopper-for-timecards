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
