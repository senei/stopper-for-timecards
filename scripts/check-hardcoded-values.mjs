// Fails when a view hardcodes colours or arbitrary sizes instead of design tokens.
// Usage: node scripts/check-hardcoded-values.mjs <files...> (lint-staged passes staged files).
// Skips the token/component layer (src/components/ui) and the dev kitchen sink.
import { readFileSync } from "node:fs";
import path from "node:path";

const SKIP = /^src\/(components\/ui|pages\/dev)\//;
const VIEW = /^src\/.*\.(tsx|astro)$/;
const LITERAL = new RegExp(
  [
    String.raw`#[0-9a-fA-F]{3,8}\b`,
    String.raw`\b(?:rgba?|hsla?|oklch)\(`,
    String.raw`-\[[0-9.]+(?:px|rem)\]`,
    String.raw`\b(?:bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b`,
  ].join("|"),
);

let failed = false;
for (const file of process.argv.slice(2)) {
  const rel = path.relative(process.cwd(), path.resolve(file)).split(path.sep).join("/");
  if (!VIEW.test(rel) || SKIP.test(rel)) continue;
  readFileSync(rel, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const hit = LITERAL.exec(line);
      if (hit) {
        failed = true;
        process.stderr.write(
          `${rel}:${i + 1}: hardcoded value "${hit[0]}" - use a design token (see src/styles/global.css)\n`,
        );
      }
    });
}
process.exit(failed ? 1 : 0);
