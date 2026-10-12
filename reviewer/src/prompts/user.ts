// User prompt for one review: the diff to assess, verbatim.
export function buildUserPrompt(diff: string): string {
  return `Oceń poniższy diff:\n\n${diff}`;
}
