const MAX_LENGTH = 200;

/** A valid project name: non-empty after trimming, and no more than 200 characters. */
export function isValidProjectName(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LENGTH;
}
