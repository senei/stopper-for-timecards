// Stop: sweep everything this turn changed before the agent finishes. One retry only.
// Also covers files rewritten through shell commands, which never reach the per-edit hook.
import { existsSync } from "node:fs";
import path from "node:path";
import { BIN, ROOT, clip, git, isLintTarget, readStdinJson, run } from "./_lib.mjs";

const input = readStdinJson();

// Already sent back once by this hook: let the turn end. Pre-commit/CI catch the rest.
// (loop_count covers Cursor, which imports Stop hooks from .claude/settings.json.)
if (input.stop_hook_active === true || (Number(input.loop_count) || 0) > 0) process.exit(0);

const split = (s) => s.split("\0").filter(Boolean);
const changed = [
  ...new Set([
    ...split(git(["diff", "--name-only", "-z", "HEAD"])),
    ...split(git(["ls-files", "-o", "--exclude-standard", "-z"])),
  ]),
];
if (changed.length === 0) process.exit(0); // Q&A turn: nothing to check

const lintFiles = changed.filter(isLintTarget);
const touchesCode =
  lintFiles.length > 0 || changed.some((f) => /(^|\/)(package\.json|tsconfig\.json|vitest[^/]*\.config\.ts)$/.test(f));
if (!touchesCode) process.exit(0);

const sections = [];

if (lintFiles.length > 0) {
  const r = run(BIN.eslint, ["--quiet", ...lintFiles], 120_000);
  if (!r.ok) sections.push(`ESLint failed in changed files:\n${clip(r.out)}`);
}

// Whole unit suite runs in seconds (112 tests, ~5 s), so run it all: it also catches
// a red test in a module this turn only imported. Integration tests are opt-in, not run here.
{
  const r = run(BIN.vitest, ["run"], 100_000);
  if (!r.ok) sections.push(`Unit tests fail:\n${clip(r.out)}`);
}

// Generated types are gitignored: regenerate them here instead of failing on astro:* modules.
if (!existsSync(path.join(ROOT, ".astro", "types.d.ts"))) run(BIN.astro, ["sync"], 100_000);
{
  const r = run(BIN.tsc, ["--noEmit", "--pretty", "false"], 100_000);
  if (!r.ok) sections.push(`Typecheck fails:\n${clip(r.out)}`);
}

if (sections.length > 0) {
  process.stderr.write(`Fix these before you finish:\n\n${sections.join("\n\n")}\n`);
  process.exit(2);
}
process.exit(0);
