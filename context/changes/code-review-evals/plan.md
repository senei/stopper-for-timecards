# Code Review Evals with promptfoo Implementation Plan

## Overview

Add a promptfoo evaluation setup to `reviewer/` that runs the real reviewer (`createReviewer`/`reviewDiff`) on three models through OpenRouter against one React 16 to 19 migration diff with three planted flaws. An LLM judge checks that the review names the flaws, and a static assertion checks that the verdict is `fail`. promptfoo runs through `npx` with a pinned version. No CI wiring and no prompt tuning in this change.

## Current State Analysis

- The reviewer is importable: `createReviewer(model: LanguageModel)` and `reviewDiff(reviewer, diff)` take the model as an argument and read no env (`reviewer/src/reviewer.ts:8-24`). Prompts are plain exports (`reviewer/src/prompts/system.ts:3`, `reviewer/src/prompts/user.ts:2-4`). Env, stdin and stdout are used in `index.ts` only among non-test source files (`reviewer/src/index.ts:8,18,24-25,28-29,33-34`).
- The package has no `main`, `exports` or build step and runs through `tsx` (`reviewer/package.json:4-12`); its tests run with `node:test` over `src/**/*.test.ts` (`reviewer/package.json:11`).
- `reviewer/` has no `evals/`, no fixtures and no promptfoo config; the course template references `fixtures/react19-migration.diff` and `fixtures/sql-injection.diff`, which do not exist (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:24,37`).
- Root `tsc` and ESLint cover `reviewer/src` (`tsconfig.json:3-4`, `eslint.config.js:104,106`), so anything added there must pass the repo's rules (`no-console`, type-aware `strictTypeChecked`).
- The template's header says `prompts/review.txt` holds the system prompt from `review-schema.ts` (`.claude/config-templates/m5l3-promptfooconfig.yaml.template:3-5`); that is stale, because the prompt now lives in `src/prompts/system.ts`.

## Desired End State

`npm run eval --prefix reviewer` runs three providers (one per model) through the real reviewer against the fixture diff and writes `reviewer/evals/results.json`, which is git-ignored. The provider has offline unit tests, and the repo's `tsc`, ESLint and app tests stay green. A live run has been performed and its per-model outcome and token usage recorded.

### Key Discoveries:

- **Spike result** (isolated install outside the repo, `promptfoo@0.124.1`, Node 24.18, Windows 11, not part of the repo): a `file://provider.ts` provider loaded natively and ran `createReviewer`/`reviewDiff` from `reviewer/src/reviewer.ts` including its `.js`-specifier imports; a failed assertion produced exit code 100; `results.json` holds per-result `response.tokenUsage` and a `stats.tokenUsage` summary.
- A JS prompt function that returns a chat array reaches the provider as a **JSON string** in `prompt`, so a provider that needs the diff must read `context.vars.diff`, not the prompt.
- promptfoo loaded `OPENROUTER_API_KEY`-style variables from a `.env` in the working directory (an assertion on `process.env.SPIKE_FOO` passed with the variable unset in the shell), so the same `reviewer/.env` as the CLI works.
- A single-test run took 157 s on a cold start in the spike, so a three-model run must be started in the background.
- `npm install promptfoo@0.124.1` in the spike directory exceeded a 280 s limit on this machine (the package worked afterwards), which is the reason for running it through `npx` instead of adding it to `reviewer/package.json`.
- `llm-rubric` grader precedence is `assertion.provider` > `test.options.provider` > `defaultTest.options.provider`; the default grader is chosen from available credentials and an OpenRouter key is not in the documented list, so the grader is set explicitly (`research.md`, section 4).
- Not verified by any run: OpenRouter `response_format` passthrough (irrelevant to this design, because structured output goes through the SDK) and live `llm-rubric` grading (verified in Phase 2).

## What We're NOT Doing

- No CI or GitHub Actions wiring (that is the separate `ci-cd-code-review` exercise).
- No second fixture and no SQL-injection test (the exercise asks for one diff).
- No `promptfoo` entry in `reviewer/package.json` or its lockfile, and no `promptfoo` type imports.
- No prompt tuning, no tools for the reviewer, no Claude Agent SDK variant.
- No edits to root `vitest.config.ts`, `eslint.config.js`, `tsconfig.json` or hooks; the only root file touched is `.gitignore`.
- No committed eval results and no promptfoo web sharing or telemetry.

## Implementation Approach

Keep the eval harness thin and reuse the product code. The provider is a small TypeScript module under `reviewer/src/evals/` so the repo's lint, typecheck and the package's test glob cover it. It builds an OpenRouter model per provider entry from `config.model` and calls `reviewDiff`, so the assertions run against exactly what the CLI and the future CI action will run. Configuration, fixture and run script live next to the reviewer package. Phase 1 is fully offline; Phase 2 is the only phase that spends API credits.

## Phase 1: Harness offline

### Overview

Provider, fixture, config, run script and ignore rules, verified without network or key.

### Changes Required:

#### 1. Provider

**File**: `reviewer/src/evals/provider.ts`

**Intent**: A promptfoo custom provider that runs the real reviewer for one configured model and returns the review as JSON text with token usage.

**Contract**:

- Default export is a class with `id()` returning a label that includes the configured model, and `callApi(prompt, context)`.
- The constructor receives promptfoo's options and reads `options.config.model` (an OpenRouter model id).
- `callApi` takes the diff from `context.vars.diff` (string), never from `prompt`, and reads `OPENROUTER_API_KEY` from `process.env`.
- Success result: `{ output: JSON.stringify(review), tokenUsage: { prompt, completion, total } }`.
- Missing model, missing key or missing diff return `{ error: <message> }` instead of throwing.
- A named factory `createReviewerProvider(makeModel)` builds the class from a model factory so tests can inject the SDK's mock model; the default export uses `createOpenRouter`.
- No import from the `promptfoo` package; the few needed types are declared locally so root `tsc` does not depend on promptfoo being installed.

#### 2. Provider tests

**File**: `reviewer/src/evals/provider.test.ts`

**Intent**: Pin the provider's behaviour offline.

**Contract**: `node:test` with `MockLanguageModelV4` from `ai/test`. Cases: valid review comes back as JSON `output` with token usage mapped to `prompt`/`completion`/`total`; the diff is taken from `context.vars.diff` and not from `prompt`; missing `vars.diff`, missing model and missing key each return an `error` and no `output`.

#### 3. Fixture

**File**: `reviewer/evals/fixtures/react19-migration.diff`

**Intent**: One realistic unified diff migrating a React 16 component to React 19 that contains exactly three distinct planted flaws.

**Contract**: The three flaws sit in separate hunks and are unambiguous: (1) use of an API removed in React 19 (`ReactDOM.render` and `defaultProps` on a function component), (2) an effect that subscribes without a cleanup, (3) `dangerouslySetInnerHTML` fed with user-supplied input. The diff contains no comments that name the flaws.

#### 4. Config

**File**: `reviewer/promptfooconfig.yaml`

**Intent**: Run the same review on three models and grade the result.

**Contract**:

- `providers`: three entries, each `id: file://src/evals/provider.ts` with a distinct `label` and `config.model` of `z-ai/glm-5.3`, `deepseek/deepseek-v4.1-flash` and `openai/gpt-5.6-luna`.
- `prompts`: a single inline `{{diff}}` (the provider ignores the prompt text; promptfoo requires one).
- `defaultTest.options.provider`: `openrouter:anthropic/claude-sonnet-5.5` as the explicit judge.
- One test with `vars.diff: file://evals/fixtures/react19-migration.diff` and three assertions: `is-json`; `llm-rubric` whose text names the three planted flaws and asks that each be identified with a reason; `javascript` with `JSON.parse(output).verdict === "fail"`.
- Relative `file://` paths resolve from the config file's directory.

#### 5. Run script and ignore rules

**Files**: `reviewer/package.json`, `.gitignore`

**Intent**: One command to run the eval, and keep generated results out of git.

**Contract**: `scripts.eval` runs `npx --yes promptfoo@0.124.1 eval -c promptfooconfig.yaml --no-cache -o evals/results.json`; no dependency is added. `.gitignore` gains `reviewer/evals/results*.json`.

### Success Criteria:

#### Automated Verification:

- Provider unit tests pass offline: `npm test --prefix reviewer`
- Type checking passes: `npx tsc --noEmit`
- Linting passes on the package (run once, uncached, in this last code phase): `npx eslint --no-cache reviewer/src`
- Config lists three provider entries pointing at the provider file: `grep -c "file://src/evals/provider.ts" reviewer/promptfooconfig.yaml` prints 3
- App unit tests are unchanged: `npx vitest run`

#### Manual Verification:

- The fixture diff reads as a realistic React 16 to 19 migration with three distinct planted flaws (removed API, effect without cleanup, unsanitised dangerouslySetInnerHTML)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Live run

### Overview

Run the eval for real on three models with the key from `reviewer/.env`, check the results file and record the outcome.

### Changes Required:

#### 1. Run and record

**File**: `reviewer/evals/results.json` (generated, git-ignored)

**Intent**: Prove the harness end to end and capture per-model outcome and cost.

**Contract**: No source change. Run `npm run eval --prefix reviewer` in the background (cold start was 157 s in the spike, so it must not run in a blocking foreground call). The phase commit body records, per model, the outcome of each assertion and the token usage taken from the results file. If a model id is rejected by OpenRouter, that is a finding to record, not a reason to edit the id silently.

### Success Criteria:

#### Automated Verification:

- Eval run completes with exit code 0 or 100 (not 1): `npm run eval --prefix reviewer; rc=$?; [ $rc -eq 0 ] || [ $rc -eq 100 ]`
- Results file holds one result per provider: `node -e "process.exit(require('./reviewer/evals/results.json').results.results.length===3?0:1)"`
- Each result carries token usage: `node -e "process.exit(require('./reviewer/evals/results.json').results.results.every(r=>r.response&&r.response.tokenUsage&&r.response.tokenUsage.total>0)?0:1)"`
- Results file is ignored by git: `git check-ignore reviewer/evals/results.json`

#### Manual Verification:

- For each of the three models the llm-rubric reason names which of the three planted flaws were found, and the outcome per model is recorded in the phase commit body

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Provider behaviour with the SDK mock model (Phase 1): success shape, token mapping, diff source, three error paths.
- Edge: a model that returns text that is not valid JSON makes `reviewDiff` reject; the provider turns that rejection into an `error` result.

### Integration Tests:

- The live eval run in Phase 2 is the integration test; it needs the key and spends credits.

### Manual Testing Steps:

1. Read the fixture and confirm each of the three flaws is present in its own hunk.
2. Run the eval and open `reviewer/evals/results.json` or `npx promptfoo@0.124.1 view` to read the judge's reason per model.
3. Re-run once with the cache enabled to confirm repeat runs are cheap, if wanted.

## Performance Considerations

A cold promptfoo start took 157 s in the spike, and the first `npx` fetch is larger still. Run the eval in the background and expect minutes, not seconds. The script uses `--no-cache` so that token and cost numbers are real; this costs credits on every run. promptfoo's default concurrency is 4, which covers three providers at once.

## Migration Notes

None. The change adds files only, and the CLI and tests are untouched.

## References

- Research: `context/changes/code-review-evals/research.md`
- Exercise prompt: `.claude/prompts/m5l3-promptfoo.md`
- Template: `.claude/config-templates/m5l3-promptfooconfig.yaml.template`
- Reviewer: `reviewer/src/reviewer.ts:8-24`, `reviewer/src/prompts/system.ts:3`, `reviewer/src/prompts/user.ts:2-4`
- Prior change: `context/archive/2026-10-12-tool-loop-agent/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness offline

#### Automated

- [x] 1.1 Provider unit tests pass offline: `npm test --prefix reviewer` — 7fb9792
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — 7fb9792
- [x] 1.3 Linting passes on the package (run once, uncached, in this last code phase): `npx eslint --no-cache reviewer/src` — 7fb9792
- [x] 1.4 Config lists three provider entries pointing at the provider file: `grep -c "file://src/evals/provider.ts" reviewer/promptfooconfig.yaml` prints 3 — 7fb9792
- [x] 1.5 App unit tests are unchanged: `npx vitest run` — 7fb9792

#### Manual

- [x] 1.6 The fixture diff reads as a realistic React 16 to 19 migration with three distinct planted flaws (removed API, effect without cleanup, unsanitised dangerouslySetInnerHTML) — 7fb9792

### Phase 2: Live run

#### Automated

- [ ] 2.1 Eval run completes with exit code 0 or 100 (not 1): `npm run eval --prefix reviewer; rc=$?; [ $rc -eq 0 ] || [ $rc -eq 100 ]`
- [ ] 2.2 Results file holds one result per provider: `node -e "process.exit(require('./reviewer/evals/results.json').results.results.length===3?0:1)"`
- [ ] 2.3 Each result carries token usage: `node -e "process.exit(require('./reviewer/evals/results.json').results.results.every(r=>r.response&&r.response.tokenUsage&&r.response.tokenUsage.total>0)?0:1)"`
- [ ] 2.4 Results file is ignored by git: `git check-ignore reviewer/evals/results.json`

#### Manual

- [ ] 2.5 For each of the three models the llm-rubric reason names which of the three planted flaws were found, and the outcome per model is recorded in the phase commit body
