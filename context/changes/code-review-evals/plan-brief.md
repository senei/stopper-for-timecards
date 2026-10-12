# Code Review Evals with promptfoo — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Add a promptfoo evaluation setup to `reviewer/` that runs the real code reviewer on three models through OpenRouter against one React 16 to 19 migration diff with three planted flaws. The point is to see, before wiring the reviewer into CI, whether the same review prompt reliably catches known defects and returns a binding `fail` verdict.

## Starting Point

`reviewer/` already exposes `createReviewer(model)` and `reviewDiff(...)` with prompts in their own modules, and no code in them reads env or I/O. There is no eval config, no fixture and no promptfoo dependency. The course template exists but is stale on one point: it copies the system prompt into `review.txt`, which the repo no longer needs.

## Desired End State

`npm run eval --prefix reviewer` runs three providers through the real reviewer on a fixture diff, grades them with an LLM judge and a static `verdict === "fail"` assertion, and writes a git-ignored results file. The provider has offline tests, and a live run has been done with per-model outcome and token usage recorded.

## Key Decisions Made

| Decision           | Choice                                                                                                           | Why (1 sentence)                                                                                | Source             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| Integration shape  | Custom provider that calls `reviewDiff`                                                                          | Tests the same code the CLI and CI will run and avoids copying the system prompt.               | Plan (after spike) |
| TypeScript loading | `.ts` provider loaded by promptfoo directly                                                                      | An isolated spike ran the real reviewer module through promptfoo 0.124.1 without extra tooling. | Research + spike   |
| Fixture            | One React 16 to 19 diff, three flaws: removed API, effect without cleanup, unsanitised `dangerouslySetInnerHTML` | Matches the exercise and covers migration, lifecycle and security.                              | Plan               |
| promptfoo install  | `npx promptfoo@0.124.1`, no dependency entry                                                                     | Keeps `reviewer/`'s lockfile and CI install lean; the spike install exceeded 280 s.             | Plan               |
| Judge              | `openrouter:anthropic/claude-sonnet-5.5`, set explicitly                                                         | The default grader depends on credentials and an OpenRouter key is not in the documented list.  | Research           |
| Diff transport     | Provider reads `context.vars.diff`                                                                               | A prompt function's chat array arrives as a JSON string, not as the diff.                       | Spike              |
| Results            | Git-ignored, not committed                                                                                       | Generated, run-specific and cost-bearing.                                                       | Plan               |

## Scope

**In scope:** TypeScript provider with tests, one fixture, promptfoo config, `eval` script, `.gitignore` entry, one live run with recorded outcome.

**Out of scope:** CI wiring, a second fixture, prompt tuning, reviewer tools, Claude Agent SDK variant, committed results, root vitest/ESLint/tsconfig edits.

## Architecture / Approach

The provider lives under `reviewer/src/evals/`, so the repo's lint, typecheck and the package's test glob cover it. Each provider entry in the config sets a model id; the provider builds an OpenRouter model for it and calls `reviewDiff`, returning the review as JSON text plus token usage. Config, fixture and results live next to the package.

## Phases at a Glance

| Phase              | What it delivers                                                                       | Key risk                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Harness offline | Provider and tests, fixture, config, script, ignore rule, all verified without network | The fixture's three flaws must be unambiguous or the judge result is noise                          |
| 2. Live run        | Real eval on three models with recorded outcome and token usage                        | Cold start took 157 s in the spike, and a model id could be rejected or a grader behave differently |

**Prerequisites:** `reviewer/.env` with `OPENROUTER_API_KEY` for Phase 2 only; network access for the first `npx` fetch.
**Estimated effort:** ~1 to 2 sessions across 2 phases; Phase 2 spends API credits.

## Open Risks & Assumptions

- Live `llm-rubric` grading through OpenRouter is unverified until Phase 2, and a model may return JSON that fails `is-json` or the schema.
- The three model ids come from the course template and were present on OpenRouter's list on 2026-10-12; they can change.
- `--no-cache` makes every run cost credits, and the eval is slow to start on this machine.
- `npx` leaves transitive promptfoo dependencies unpinned by a lockfile.

## Success Criteria (Summary)

- The provider and its tests pass offline and repo gates stay green.
- A live run produces one result per model with token usage.
- The per-model verdict and which planted flaws each review found are recorded.
