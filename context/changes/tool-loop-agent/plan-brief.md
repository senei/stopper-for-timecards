# Modular ToolLoopAgent Code Reviewer — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Turn the single-file reviewer in `reviewer/src/index.ts` into a small reusable module built on the AI SDK `ToolLoopAgent`. The review schema stays the only output contract and prompts move into their own modules, so later promptfoo evals can import the reviewer without touching the CLI.

## Starting Point

`reviewer/` is a scaffold: one `index.ts` that reads stdin, reads env, builds the OpenRouter model and makes a one-shot `generateText` call. `review-schema.ts` is a verbatim copy of the lesson template and still carries the system prompt next to the schema.

## Desired End State

`reviewer/src` has four small modules (schema, prompts, agent, CLI). `createReviewer(model)` is exported and takes any language model. `npm test --prefix reviewer` passes with a mock model and no key, and the CLI prints the same JSON verdict shape as today. Repo `tsc`, ESLint and app tests are unaffected.

## Key Decisions Made

| Decision                      | Choice                                                        | Why (1 sentence)                                                                           | Source |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| Where the system prompt lives | `src/prompts/system.ts`, moved out of the schema file         | Makes the schema the sole contract, as requested, and lets evals swap prompts.             | Plan   |
| Tools                         | None in this change (empty tool set)                          | Keeps the first version small and deterministic; real tool use is a later change.          | Plan   |
| Tests                         | `node:test` inside `reviewer/` with `MockLanguageModelV4`     | Runs without network or key and leaves the app's vitest, lint and pre-commit config alone. | Plan   |
| Agent construction            | `createReviewer(model)` takes a model, CLI builds it from env | Lets tests and evals inject any provider instead of reading env inside the module.         | Plan   |
| Structured output form        | `Output.object({ schema })`                                   | The reference page's bare `{ schema }` conflicts with the guide and the working code.      | Plan   |

## Scope

**In scope:** split prompts and agent out of `index.ts`, export the reviewer, add a mock-model test suite and `npm test` script.

**Out of scope:** tools, promptfoo or any eval setup, Claude Agent SDK variant, CI integration, edits to root vitest/ESLint/tsconfig/hooks, changes to review criteria.

## Architecture / Approach

Split by responsibility: contract (`review-schema.ts`), prompts (`prompts/`), agent construction (`reviewer.ts`, no env or I/O) and process I/O (`index.ts`). Only the CLI touches stdin, `process.env` and the OpenRouter provider.

## Phases at a Glance

| Phase           | What it delivers                                               | Key risk                                                                    |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Modules      | Prompts split out, `createReviewer` and `reviewDiff`, thin CLI | Behaviour drift in the CLI during the split                                 |
| 2. Verification | Mock-model tests, `npm test` script, repo gates once           | Cold type-aware lint is slow; live structured output untested without a key |

**Prerequisites:** the `reviewer/` scaffold is in place; a key and model are needed only for the manual live run.
**Estimated effort:** ~1 session across 2 small phases.

## Open Risks & Assumptions

- Structured output through OpenRouter depends on the chosen model supporting it; this cannot be verified without a key.
- Score ranges are not enforced by the schema (plain numbers by template design), so tests only check shape, not 1-10.
- `reviewer/` sits inside the repo, so root lint and typecheck cover it; test files must pass those rules too.

## Success Criteria (Summary)

- The reviewer is importable as `createReviewer(model)` with the schema as its only contract.
- The suite passes offline and the CLI output shape is unchanged.
- Repo gates stay green and no root config was touched.
