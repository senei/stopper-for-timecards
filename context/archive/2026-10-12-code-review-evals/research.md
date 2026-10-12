---
date: 2026-10-12T13:32:12Z
researcher: Claude Sonnet 5.5 (Claude Code)
git_commit: 4d7c32c
branch: main
repository: stopper-for-timecards (origin github.com/senei/stopper-for-timecards; local dir x10-dev--curse)
topic: "Can the current reviewer in reviewer/ take promptfoo evals: prompt reuse, agent importability, tool fit"
tags: [research, promptfoo, evals, reviewer, openrouter, m5l3]
status: partial
last_updated: 2026-10-12
last_updated_by: Claude Sonnet 5.5 (Claude Code)
---

# Research: Current state of `reviewer/` for promptfoo evals

**Date**: 2026-10-12T13:32:12Z
**Researcher**: Claude Sonnet 5.5 (Claude Code)
**Git Commit**: 4d7c32c
**Branch**: main
**Repository**: stopper-for-timecards (local dir x10-dev--curse)

## Research Question

Analyse the current state of `reviewer/` for introducing evals: reusability of prompts, importability of the agent and so on. promptfoo is the first-choice tool; if the stack is compatible, follow that direction, otherwise consider other OSS tools. Use current documentation.

## Summary

- **promptfoo fits this stack on the paper evidence gathered.** The npm `latest` tag is `promptfoo@0.124.1` (queried 2026-10-12, modified 2026-10-08). It is ESM and requires Node `>=22.22.0`. The local runtime is Node `v24.18.0`, which satisfies that. `reviewer/package.json:6-8` declares only `>=22`, which is looser than promptfoo's floor for the first 22.x minors (22.0 to 22.21). No alternative tool was analysed because no incompatibility was found.
- **The prompts are importable as they are.** `SYSTEM_PROMPT` is a plain string export (`reviewer/src/prompts/system.ts:3`) and `buildUserPrompt(diff)` a pure function (`reviewer/src/prompts/user.ts:2-4`). Neither reads env or I/O.
- **The agent is importable as code, but not packaged.** `createReviewer(model: LanguageModel)` takes the model as an argument and reads no env (`reviewer/src/reviewer.ts:8-14`); `reviewDiff(reviewer, diff)` returns `{ review, usage }` (`reviewer/src/reviewer.ts:18-24`). Among the non-test source files in `reviewer/src`, `process.env`, stdin and stdout are used in `index.ts` only (`reviewer/src/index.ts:8,18,24-25,33-34`). The package has no `main`, `exports` or build step and runs through `tsx` (`reviewer/package.json:9-12`).
- **Two integration shapes are supported by the evidence, with different trade-offs** (see Architecture Insights). The course template builds shape A; shape B tests the real agent. Whether promptfoo can load a `.ts` provider in 0.124.1 without a loader is **not verified**.
- **The template's assertions are valid forms per docs**, and its judge is a different model family from the three evaluated models.
- **The three template model IDs and the grader ID exist on OpenRouter's live list** (checked 2026-10-12), and each advertises `structured_outputs`.
- **Status is partial**: the TypeScript-loading question, OpenRouter's `response_format` passthrough, and a JS prompt function returning a chat array are documented as unknown and nothing was executed.

## Detailed Findings

### 1. Prompts in `reviewer/`

- The system prompt is one exported template-literal constant, moved out of the contract file in change `tool-loop-agent` (`reviewer/src/prompts/system.ts:3`; it is no longer in `reviewer/src/review-schema.ts`, which exports only `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA` and `Review` at lines 10, 58, 60).
- The user prompt is `Oceń poniższy diff:\n\n${diff}` (`reviewer/src/prompts/user.ts:2-4`). It is the only place the diff enters the prompt on the agent path (`reviewer/src/reviewer.ts:22`).
- **Discrepancy with the course template.** `m5l3-promptfooconfig.yaml.template` says `prompts/review.txt` "holds the system prompt from review-schema.ts" (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:3-5`). On this repo's checked state that statement is stale: the prompt is in `src/prompts/system.ts`. A `review.txt` that copies it would be a second copy of the same text.

### 2. The agent and its contract

- Output contract: `Output.object({ schema: REVIEW_SCHEMA })` is set on the agent (`reviewer/src/reviewer.ts:12`). `REVIEW_SCHEMA` has six numeric score fields, `verdict` as `"pass" | "fail"`, and `summary` (`reviewer/src/review-schema.ts:10-54`). Scores are plain `z.number()`; the 1-10 range is carried only by field descriptions and the prompt (comment at `reviewer/src/review-schema.ts:8-9`), so a score outside 1-10 is not rejected by the schema.
- Model injection: the model is a parameter, so an eval harness can supply any `LanguageModel`; the CLI builds an OpenRouter model from `OPENROUTER_API_KEY` and `REVIEWER_MODEL` (`reviewer/src/index.ts:28-29` on the inspected state).
- Existing deterministic test pattern: a mock model with `MockLanguageModelV4` drives `createReviewer`/`reviewDiff` offline (`reviewer/src/reviewer.test.ts`).
- Packaging: `"type": "module"`, `engines.node >=22`, scripts `review` and `test` only; no `main`, `exports`, `types` or build output (`reviewer/package.json:4-12`). Sources are TypeScript and are executed through `tsx` (`reviewer/package.json:10-11,16`).

### 3. promptfoo: providers, prompts, config (primary-source reports, summarised by a fetch tool)

- **OpenRouter provider** id syntax is `openrouter:<vendor>/<model>`; key from `OPENROUTER_API_KEY`, or `apiKey` / `apiKeyEnvar` in config (https://www.promptfoo.dev/docs/providers/openrouter/).
- **Custom providers**: `file://` JS/ESM and TS files are documented. A provider needs `id` and `callApi`; `callApi(prompt, context, options)` returns an object with required `output` and optional `tokenUsage`, `cost`, `error` (https://www.promptfoo.dev/docs/providers/custom-api/).
- **TypeScript providers**: docs state they are loaded by Node, that path aliases come from `tsconfig.json` `compilerOptions.paths`, and that `promptfoo eval` should run from the project root. They do **not** name the loader and never show a literal `file://provider.ts` reference. A mirrored example for a TypeScript _config_ file uses `NODE_OPTIONS='--import tsx'`. Whether `.ts` providers load natively in 0.124.1 is **unverified**.
- **Prompts**: `.txt` with Nunjucks `{{var}}`; chat format as a JSON array of `{role, content}`; a JS function prompt `file://generate_prompt.js` that may return a string or `{prompt, config}` (https://www.promptfoo.dev/docs/configuration/prompts/). The named-function suffix is shown only for Python; JS `:fn`, TS prompt files and a function returning a chat array are **unverified**.
- **Relative `file://` paths** resolve from the config file's directory per the `basePath` setting (https://www.promptfoo.dev/docs/configuration/reference/).
- **Windows**: no Windows-specific `file://` form is documented; data dir is `%USERPROFILE%\.promptfoo` (https://www.promptfoo.dev/docs/installation/).

### 4. promptfoo: assertions, grading, caching, exit codes

- **`is-json`** accepts an inline schema or `file://` schema; without a value it only checks JSON validity (https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/).
- **`llm-rubric`** grader precedence is `assertion.provider` > `test.options.provider` > `defaultTest.options.provider`. The template sets `defaultTest.options.provider` (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:16-19`), which is a documented position. The default grader is chosen from credentials present in the environment (OpenAI, Anthropic, Google and others); an OpenRouter key is not in that documented list, and behaviour with no recognised credential is not stated (https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/).
- **`javascript`** assertions: JSON text stays a string, so `JSON.parse(output)` is the documented way to read fields, and `JSON.parse(output).verdict === "fail"` is a valid single-expression form (https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/). If `output` is not valid JSON, `JSON.parse` throws and the assertion errors. The template's second test also reads `.securitySafety` (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:43`), which exists in the schema (`reviewer/src/review-schema.ts:46`).
- **Exit codes**: `promptfoo eval` exits 100 when at least one test fails or the pass rate is under threshold (`PROMPTFOO_PASS_RATE_THRESHOLD`, default 100%), and 1 for other errors (https://www.promptfoo.dev/docs/usage/command-line/).
- **Caching** is on by default, TTL 14 days, stored under `~/.promptfoo/cache`; `--no-cache` disables it, and docs recommend it when comparing inference costs (https://www.promptfoo.dev/docs/configuration/caching/).
- **Cost**: outputs include token usage and estimated cost "when available"; exact JSON field names are not in the fetched docs. OpenRouter cost uses the provider-reported `usage.cost` (https://www.promptfoo.dev/docs/providers/openrouter/).
- **Judge independence**: docs list self-preference as a bias and recommend a judge different from the system under test (https://www.promptfoo.dev/docs/guides/llm-as-a-judge/).

### 5. OpenRouter models named in the exercise (live list, 2026-10-12)

| ID                                     | In list | `structured_outputs` | Context   | Price in / out per M tokens |
| -------------------------------------- | ------- | -------------------- | --------- | --------------------------- |
| `z-ai/glm-5.3`                         | yes     | yes                  | 1,048,576 | $0.079 / $4.80              |
| `deepseek/deepseek-v4.1-flash`         | yes     | yes                  | 1,048,576 | $0.15 / $0.60               |
| `openai/gpt-5.6-luna`                  | yes     | yes                  | 1,050,000 | $0.20 / $1.20               |
| `anthropic/claude-sonnet-5.5` (grader) | yes     | yes                  | 1,000,000 | $2.00 / $10.00              |

Source: `https://openrouter.ai/api/v1/models`, 458 models in the response, no `expiration_date` set for these four. Listed support for a parameter is not proof that every upstream route honours it.

### 6. What the template ships vs what the exercise asks

- The template defines two tests, a React 16 to 19 migration and a SQL injection diff (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:21-43`). The exercise text asks for one fairly complex React diff with three flaws plus a static `verdict == fail` assertion (`.claude/prompts/m5l3-promptfoo.md`, Plan section).
- The template references `file://fixtures/react19-migration.diff` and `file://fixtures/sql-injection.diff` (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:24,37`). Those fixture files do not exist in `reviewer/` on the inspected state (`ls reviewer` shows `node_modules`, `package.json`, `package-lock.json`, `src`).

## Code References

- `reviewer/src/reviewer.ts:8-14` - `createReviewer(model)`: ToolLoopAgent with instructions and `Output.object({ schema })`.
- `reviewer/src/reviewer.ts:18-24` - `reviewDiff`: `generate({ prompt })`, returns `{ review, usage }`.
- `reviewer/src/prompts/system.ts:3` - exported `SYSTEM_PROMPT` (Polish).
- `reviewer/src/prompts/user.ts:2-4` - `buildUserPrompt(diff)`.
- `reviewer/src/review-schema.ts:10-54,58,60` - contract fields, JSON Schema export, `Review` type.
- `reviewer/src/index.ts:8,18,24-25,28-29,33-34` - the env/stdin/stdout use among non-test source files; builds the OpenRouter model.
- `reviewer/package.json:4-12,16` - ESM, engines, scripts, `tsx`, no `main`/`exports`/build.
- `.claude/config-templates/m5l3-promptfooconfig.yaml.template:3-5,8-11,13-14,16-19,21-43` - template header, providers, prompt file, grader, tests.
- `.claude/prompts/m5l3-promptfoo.md` - the exercise's research and plan instructions.

## Architecture Insights

- **Shape A (course template):** promptfoo's built-in OpenRouter providers x a `prompts/review.txt` file. It evaluates prompt-plus-model but bypasses `createReviewer`, so the agent's `Output.object` schema enforcement is not exercised and JSON shape depends on the model following the instruction. Needs no TypeScript loading. Needs the system prompt text duplicated or generated into `review.txt` (finding 1 discrepancy).
- **Shape B (custom provider):** a provider file that imports `createReviewer`/`reviewDiff`, builds a model per configured id and returns `JSON.stringify(review)` as `output`. It evaluates the code that would run in CI, reuses `SYSTEM_PROMPT` and `buildUserPrompt` without copying, and has schema enforcement in the path. It depends on promptfoo loading TypeScript from `reviewer/src` (unverified) or on adding a build step the package does not have. _Inference from the evidence above, not a tested fact._
- Both shapes keep the same assertion block, since `output` is JSON text in each.
- The repo's own gates cover `reviewer/`: root `tsconfig.json` includes `**/*` with `dist` excluded (`tsconfig.json:3-4`), and ESLint's explicit ignore entry names `.claude/**` while gitignored paths are excluded through `includeIgnoreFile` (`eslint.config.js:104,106`); `reviewer/src` is in neither list. Any provider or config script added under `reviewer/` is linted and typechecked like application code.

## Historical Context (from prior changes)

- `context/archive/2026-10-12-tool-loop-agent/plan.md:30` - "No promptfoo or any eval environment (explicitly out of scope; this change only makes the reviewer importable)". Supported: that change left evals out and delivered the importable surface found above.
- `context/archive/2026-10-12-tool-loop-agent/plan.md:60,122` - prompt modules and the user-prompt shape were designed "so evals can vary them" and "the evals will rely on". Supported by `reviewer/src/prompts/*.ts`.
- `context/foundation/lessons.md` has no entry about evals or promptfoo (inspected whole file, 2026-10-12).

## Related Research

None. No other `research.md` under `context/changes/` or `context/archive/` concerns evals (`grep` for "promptfoo|evals" found only the archived `tool-loop-agent` plan and brief).

## Open Questions

1. **TypeScript loading** (blocking for shape B): does `promptfoo@0.124.1` load a `.ts` provider that imports sibling `.ts` modules with `.js` specifiers (as `reviewer/src` does), natively or only with `tsx`/`NODE_OPTIONS=--import tsx`? Resolve with a minimal local spike.
2. **OpenRouter `response_format`**: does the promptfoo OpenRouter provider forward `response_format` / structured output? Only the OpenAI provider page documents it. Matters for shape A.
3. **Prompt function return types**: can a JS prompt function return a chat-message array, and is the `file://x.js:fn` form valid? Matters for avoiding a duplicate `review.txt` under shape A.
4. **Default grader with only `OPENROUTER_API_KEY`**: behaviour is undocumented; the template avoids it by setting an explicit grader.
5. **Cost per run**: not computed; depends on diff size and the model's output length. Per-million prices are in the table above.
6. **Product decisions for the plan** (not research questions): shape A vs B; whether promptfoo is a `reviewer/` devDependency or run with `npx`; one fixture diff (exercise text) or two (template); which three flaws the React fixture plants; whether eval results are committed.
7. **Windows**: `file://` path forms and the TypeScript loader on Windows are undocumented; the working machine is Windows 11.
8. **Verification limits**: promptfoo docs were read through a summarising fetch tool and no promptfoo command was executed; quoted behaviours are paraphrases unless given in quotes.
