// Shared helpers for the agent hooks. Hook output is read by the model, not a terminal:
// plain text, no colour, bounded length.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

const PLAIN_ENV = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };
delete PLAIN_ENV.GREP_OPTIONS;

// Extensions ESLint covers here (eslint.config.js: ts/tsx/js/jsx via typescript-eslint, .astro via eslint-plugin-astro).
export const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|astro)$/;

// eslint.config.js ignores .claude/** and everything in .gitignore (dist, .astro, node_modules, ...).
export function isLintTarget(file) {
  const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (!LINTABLE.test(rel)) return false;
  if (/^(\.claude|node_modules|dist|\.astro|\.wrangler)\//.test(rel)) return false;
  return existsSync(path.resolve(ROOT, rel));
}

export function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function run(binRelativeToRoot, args, timeoutMs = 90_000) {
  const res = spawnSync(process.execPath, [path.join(ROOT, binRelativeToRoot), ...args], {
    cwd: ROOT,
    env: PLAIN_ENV,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  const timedOut = res.error?.code === "ETIMEDOUT";
  return { ok: res.status === 0 && !timedOut, out: timedOut ? `${out}\n(timed out after ${timeoutMs / 1000}s)` : out };
}

export function git(args) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return res.status === 0 ? res.stdout : "";
}

export function clip(text, max = 6000) {
  return text.length > max ? `${text.slice(0, max)}\n... (output truncated)` : text;
}

export const BIN = {
  eslint: "node_modules/eslint/bin/eslint.js",
  vitest: "node_modules/vitest/vitest.mjs",
  tsc: "node_modules/typescript/bin/tsc",
  astro: "node_modules/astro/bin/astro.mjs",
};
