// PostToolUse (Write|Edit): lint only the file the agent just edited.
// Exit 2 + stderr is the only combination Claude Code shows the agent.
import path from "node:path";
import { BIN, ROOT, clip, isLintTarget, readStdinJson, run } from "./_lib.mjs";

const input = readStdinJson();
const file = input?.tool_input?.file_path;
if (typeof file !== "string" || !file || !isLintTarget(file)) process.exit(0);

const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join("/");
const { ok, out } = run(BIN.eslint, ["--quiet", rel], 40_000);
if (!ok) {
  process.stderr.write(`ESLint reported errors in ${rel}:\n${clip(out)}\n`);
  process.exit(2);
}
process.exit(0);
