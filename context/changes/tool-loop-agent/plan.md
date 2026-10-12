# Modular ToolLoopAgent Code Reviewer Implementation Plan

## Overview

Turn the single-file reviewer in `reviewer/src/index.ts` into a small, reusable module built on the AI SDK `ToolLoopAgent`. The review schema stays the only output contract, prompts move into their own modules, and a `createReviewer(model)` factory is exported so promptfoo evals can import the reviewer later. The CLI keeps its current behaviour. No tools and no eval environment are added in this change.

## Current State Analysis

- `reviewer/src/index.ts:31` makes a one-shot `generateText` call with `Output.object({ schema: REVIEW_SCHEMA })`; stdin handling, env handling and the model call all live in that one top-level file (`reviewer/src/index.ts:8-39`).
- `reviewer/src/review-schema.ts` mixes the contract with the prompt: it exports `SYSTEM_PROMPT`, `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA` and the `Review` type. It is a verbatim copy of `.claude/config-templates/m5l2-review-schema.ts.template`.
- `reviewer/` is a separate npm package (own `package.json`, `node_modules`, pinned `ai@7.0.137`, `@openrouter/ai-sdk-provider@3.1.0`, `zod@4.6.6`, `tsx@4.23.15`), but it sits inside the repo, so the repo's `tsc` (`tsconfig.json` includes `**/*`) and ESLint (`eslint.config.js`, `strictTypeChecked`, `no-console`) cover it.
- Root `vitest` only includes `src/**/*.test.{ts,tsx}` (`vitest.config.ts:12`), so tests in `reviewer/` are not part of the app's test run.

## Desired End State

`reviewer/src` contains a prompts module pair, an agent module exporting `createReviewer` and a `reviewDiff` helper, and a thin CLI. `npm test --prefix reviewer` passes without a network or key. `git diff | npm run review --prefix reviewer` returns the same JSON verdict shape as before. The root `tsc --noEmit` and ESLint stay clean, and root `vitest` is unchanged.

### Key Discoveries:

- Agent API in the installed version: `new ToolLoopAgent({ model, instructions, output })` and `await agent.generate({ prompt })`, with `result.output` typed from the schema (`reviewer/node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`, `src/agent/tool-loop-agent.ts:39`).
- The reference page's own `output` example passes a bare `{ schema }`, while the building-agents guide (`docs/03-agents/02-building-agents.mdx:296-315`) and the working `index.ts` use `Output.object({ schema })`; follow the latter.
- Default stop condition is `isStepCount(20)`; with no tools the loop ends after one step.
- Deterministic tests use `MockLanguageModelV4` from `ai/test` with `doGenerate` returning `content: [{ type: 'text', text: '<json>' }]` (`docs/03-ai-sdk-core/55-testing.mdx`).
- The schema file's own comment says scores are plain `z.number()` because Anthropic structured output rejects min/max on integer types; the 1-10 range is carried by descriptions and the prompt. Tests must not assume range validation.
- `lessons.md`: cold type-aware ESLint is slow in this repo; run the full lint once, in the last code phase.

## What We're NOT Doing

- No tools for the reviewer (empty tool set); real tool use is a later change.
- No promptfoo or any eval environment (explicitly out of scope; this change only makes the reviewer importable).
- No Claude Agent SDK variant, no CI/GitHub Actions integration (later lessons).
- No edits to the repo's root `vitest.config.ts`, `eslint.config.js`, `tsconfig.json`, hooks or pre-commit.
- No changes to the review criteria, scale or verdict semantics, and no hardcoded model ID.
- No streaming, retries tuning, or multi-model configuration.

## Implementation Approach

Split by responsibility: contract (`review-schema.ts`), prompts (`prompts/`), agent construction (`reviewer.ts`), and process I/O (`index.ts`). The agent module takes a `LanguageModel` instead of reading env, so tests inject a mock and evals can inject any provider. The CLI is the only place that touches stdin, `process.env` and the OpenRouter provider.

## Phase 1: Modules

### Overview

Split prompts out of the contract file, add the agent module and reduce `index.ts` to a thin CLI over it. The CLI behaves as before.

### Changes Required:

#### 1. Contract file

**File**: `reviewer/src/review-schema.ts`

**Intent**: Make the schema file the sole contract by removing the prompt from it.

**Contract**: Exports `REVIEW_SCHEMA`, `REVIEW_JSON_SCHEMA` and `Review` only; `SYSTEM_PROMPT` and its comment line are removed. The header comment is updated to say prompts live in `src/prompts/`. No change to the schema fields.

#### 2. Prompt modules

**Files**: `reviewer/src/prompts/system.ts`, `reviewer/src/prompts/user.ts`

**Intent**: Give each prompt its own module so evals can vary them without touching the contract.

**Contract**: `system.ts` exports `SYSTEM_PROMPT: string`, moved verbatim from the template. `user.ts` exports `buildUserPrompt(diff: string): string`, returning the same text the CLI sends today (`Oceń poniższy diff:\n\n<diff>`).

#### 3. Agent module

**File**: `reviewer/src/reviewer.ts`

**Intent**: Single reusable place that builds the reviewer and runs it on a diff, independent of env and process I/O.

**Contract**:

- `createReviewer(model: LanguageModel)` returns a `ToolLoopAgent` configured with `instructions: SYSTEM_PROMPT` and `output: Output.object({ schema: REVIEW_SCHEMA })`, no tools.
- `reviewDiff(reviewer, diff: string)` calls `reviewer.generate({ prompt: buildUserPrompt(diff) })` and returns `{ review: Review, usage }`, where `review` is the typed `result.output`.
- Both are named exports; the default stop condition is left unchanged.

#### 4. CLI

**File**: `reviewer/src/index.ts`

**Intent**: Keep only process concerns: read stdin, read env, build the OpenRouter model, call the module, print.

**Contract**: Same behaviour as today: empty stdin exits 1 with the usage message on stderr; missing `OPENROUTER_API_KEY` or `REVIEWER_MODEL` exits 1 with the existing messages; the review JSON goes to stdout and the token line to stderr. Uses `process.stdout`/`process.stderr` writes (repo `no-console` rule). Imports `createReviewer` and `reviewDiff` from `./reviewer.js`.

### Success Criteria:

#### Automated Verification:

- Type checking passes for the whole repo including `reviewer/`: `npx tsc --noEmit`
- Empty input still fails with the usage message: `echo "" | npm run review --prefix reviewer` exits non-zero and prints `Empty diff on stdin`
- `SYSTEM_PROMPT` is no longer exported from the schema file: `grep -n SYSTEM_PROMPT reviewer/src/review-schema.ts` returns nothing

#### Manual Verification:

- `reviewer/src` reads as four small modules (schema, prompts, agent, CLI) with no duplicated prompt text

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Verification

### Overview

Add a deterministic test suite for the agent module, wire an `npm test` script, and run the repo's gates once.

### Changes Required:

#### 1. Tests

**File**: `reviewer/src/reviewer.test.ts`

**Intent**: Prove the wiring (instructions, structured output, schema as contract) with the SDK's mock model, without network or key.

**Contract**: Uses `node:test` and `MockLanguageModelV4` from `ai/test`. Cases:

- valid JSON matching `REVIEW_SCHEMA` comes back as a typed `review` with the six scores, `verdict` and `summary`;
- the request sent to the mock contains `SYSTEM_PROMPT` as the system instruction and the diff inside the user prompt;
- model text that violates the schema (for example a `verdict` outside `pass | fail`) makes `reviewDiff` reject.

**File**: `reviewer/src/prompts/user.test.ts` (only if the three cases above leave `buildUserPrompt` uncovered)

**Intent**: Pin the user-prompt shape the evals will rely on.

**Contract**: `buildUserPrompt(diff)` contains the diff verbatim.

#### 2. Test script

**File**: `reviewer/package.json`

**Intent**: One command to run the suite from the reviewer package or the repo root.

**Contract**: `scripts.test` runs the built-in runner through `tsx` over `src/**/*.test.ts`, so `npm test --prefix reviewer` works. No new dependencies.

### Success Criteria:

#### Automated Verification:

- Reviewer tests pass: `npm test --prefix reviewer`
- Type checking passes: `npx tsc --noEmit`
- Linting passes on the package (run once, uncached, in this last code phase): `npx eslint --no-cache reviewer/src`
- App unit tests are unchanged: `npx vitest run`

#### Manual Verification:

- With `reviewer/.env` filled in (`OPENROUTER_API_KEY`, `REVIEWER_MODEL`), `git diff | npm run review --prefix reviewer` prints a JSON object with six scores, a `verdict` of `pass` or `fail` and a `summary`
- Deliberately breaking the output shape in a test (for example renaming a schema field) makes the suite fail, then restoring it makes it pass

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Agent wiring through `MockLanguageModelV4`: typed output, instructions and prompt content, schema-violation rejection.
- Edge: model returns non-JSON text (rejects, no partial result).

### Integration Tests:

- None in this change; a live model call is covered by the manual row because it needs a key and a structured-output-capable model.

### Manual Testing Steps:

1. Fill `reviewer/.env`, run `git diff | npm run review --prefix reviewer`, check the JSON shape.
2. Run it with an empty diff and with a missing key to confirm the two error paths.

## Performance Considerations

None. A single model call per review; the loop ends after one step with no tools.

## Migration Notes

None. The CLI contract (stdin in, JSON out, env names) is unchanged.

## References

- Prompt: `.claude/prompts/m5l2-agent.md`
- Template: `.claude/config-templates/m5l2-review-schema.ts.template`
- Agent API: `reviewer/node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`
- Testing helpers: `reviewer/node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx`
- Current implementation: `reviewer/src/index.ts:31`, `reviewer/src/review-schema.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Modules

#### Automated

- [x] 1.1 Type checking passes for the whole repo including `reviewer/`: `npx tsc --noEmit`
- [x] 1.2 Empty input still fails with the usage message: `echo "" | npm run review --prefix reviewer` exits non-zero and prints `Empty diff on stdin`
- [x] 1.3 `SYSTEM_PROMPT` is no longer exported from the schema file: `grep -n SYSTEM_PROMPT reviewer/src/review-schema.ts` returns nothing

#### Manual

- [x] 1.4 `reviewer/src` reads as four small modules (schema, prompts, agent, CLI) with no duplicated prompt text

### Phase 2: Verification

#### Automated

- [ ] 2.1 Reviewer tests pass: `npm test --prefix reviewer`
- [ ] 2.2 Type checking passes: `npx tsc --noEmit`
- [ ] 2.3 Linting passes on the package (run once, uncached, in this last code phase): `npx eslint --no-cache reviewer/src`
- [ ] 2.4 App unit tests are unchanged: `npx vitest run`

#### Manual

- [ ] 2.5 With `reviewer/.env` filled in (`OPENROUTER_API_KEY`, `REVIEWER_MODEL`), `git diff | npm run review --prefix reviewer` prints a JSON object with six scores, a `verdict` of `pass` or `fail` and a `summary`
- [ ] 2.6 Deliberately breaking the output shape in a test (for example renaming a schema field) makes the suite fail, then restoring it makes it pass
