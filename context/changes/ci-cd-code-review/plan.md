# CI/CD Code Review in GitHub Actions Implementation Plan

## Overview

Add an `AI Code Review` workflow for pull requests to `main`, backed by a local composite action that runs the existing `reviewer/` package. The workflow posts one updated review comment, applies `ai-cr:passed` or `ai-cr:failed`, fails the check on a `fail` verdict or an oversized diff, and re-runs on demand when someone adds the `ai-cr:review` label. The reviewer gains optional PR title/description context and a diff-size limit, both backward compatible.

## Current State Analysis

- Requirements: run on every PR, composite action for the review, inputs title, description and diff, verdict `pass | fail`, comment plus `ai-cr:*` label, re-run on the `ai-cr:review` label (`context/changes/ci-cd-code-review/requirements.md:3-4,8-10,42-43,52-53,57`).
- Course templates exist for the workflow and the action (`.claude/config-templates/m5l3-review.yml.template`, `.claude/config-templates/m5l3-action.yml.template`) and agree with the requirements, but the action template runs `node dist/review.js` with `DIFF_FILE`, `PR_TITLE`, `PR_BODY` and `LLM_PROVIDER_API_KEY` (`m5l3-action.yml.template:47-55`).
- The reviewer reads the diff from stdin and the key and model from `OPENROUTER_API_KEY` and `REVIEWER_MODEL` (`reviewer/src/index.ts:17-21,28-29`). It has no build step and no `dist/` (`reviewer/package.json:9-12`), and PR title/body are not used (`reviewer/src/reviewer.ts:18-24`, `reviewer/src/prompts/user.ts:2-4`). It has no limit on diff size.
- Existing CI is a single `CI` workflow on `main` with three jobs, pins actions by major tag, uses Node 22 and has no `permissions:` key (`.github/workflows/ci.yml:3-7,13-16`). `.github/` contains only that file.
- The workflow template targets `master` (`m5l3-review.yml.template:10`); this repository uses `main`.
- `code-review-evals` (separate change, planned) calls `reviewDiff(reviewer, diff)` and relies on the current user-prompt shape, so the reviewer's signature changes here must stay backward compatible (`context/changes/code-review-evals/plan.md`, Phase 1 provider contract).

## Desired End State

A pull request to `main` triggers `AI Code Review`. A person sees one comment that is updated on each push, the label that matches the latest verdict and a `review` check that fails on `fail` or on a diff above the limit. Adding `ai-cr:review` re-runs it. Fork PRs are skipped. The reviewer CLI is unchanged for existing callers, and the existing `CI` workflow is untouched.

### Key Discoveries:

- The output and verdict contract of the template and the reviewer already match; the input channel, naming and packaging are what differ (`research.md`, Detailed Findings 2).
- Untrusted PR text must go through `env:`, never into a `run:` script, and the key is passed to the composite action as an input (`m5l3-action.yml.template:10-12,46-52`).
- A job skipped by an `if:` reports success, so it does not block a required check; a label alone never gates a merge (`research.md`, Findings 4).
- `gh pr comment --edit-last --create-if-none` exists locally (gh 2.101.0), which gives a single updated comment; the runner's `gh` version was not checked.
- Concurrency inference: the template groups by PR number at workflow level with `cancel-in-progress: true` and filters labels in a job-level `if:` (`m5l3-review.yml.template:18-20,24`), so an unrelated label could cancel an in-flight review. This is mitigated in the workflow by giving unrelated-label runs their own group key, and it is verified in Phase 3.
- `github.event.label.name` and the exact `GITHUB_TOKEN` permissions for comment and label calls are not confirmed by any source read; Phase 3 verifies them on a real PR.

## What We're NOT Doing

- No build or bundle step and no `dist/review.js`; the action installs `reviewer/` and runs it through `tsx`.
- No change to `.github/workflows/ci.yml`.
- No `pull_request_target`, no secrets for fork PRs; fork PRs are skipped.
- No eval setup (that is `code-review-evals`) and no Claude Code Action path (`10x-impl-review-ci`).
- No business-fit or architecture-fit criteria (deferred in the requirements).
- No change to repository settings from the plan: the secret and the required check are steps for the user in Phase 3.
- No reviewer tools and no change to the review criteria, schema or system prompt.

## Implementation Approach

Keep the reviewer the single place that builds the prompt, and keep the CI files thin. Phase 1 adds optional PR context and a size limit to the reviewer with offline tests. Phase 2 adds the composite action and the workflow from the templates, adapted to this repo, and verifies them statically. Phase 3 runs it for real on a throwaway PR, because several behaviours only exist on GitHub. Defaults chosen here, easy to change through action inputs: PR description cap 4000 characters and diff cap 200000 characters (about 50k tokens at a typical four characters per token).

## Phase 1: Reviewer context and limits

### Overview

Optional PR title/description in the prompt, a configurable diff-size limit with its own exit code, and tests, all backward compatible.

### Changes Required:

#### 1. User prompt with PR context

**File**: `reviewer/src/prompts/user.ts`

**Intent**: Let the prompt carry the PR title and a bounded description without changing today's output when no context is given.

**Contract**:

- `buildUserPrompt(diff: string, context?: { title?: string; body?: string })`.
- With no `context`, or with empty title and body, the result is identical to today's `Oceń poniższy diff:\n\n${diff}`.
- With context, a short block with the title and the description precedes the diff; the description is cut to an exported constant `MAX_BODY_CHARS = 4000`, and a visible marker is appended when it was cut.
- Title and body are inserted as data only, never concatenated into instructions.

#### 2. Reviewer helper

**File**: `reviewer/src/reviewer.ts`

**Intent**: Pass the context through without breaking existing callers.

**Contract**: `reviewDiff(reviewer, diff, context?)` forwards `context` to `buildUserPrompt`; the return type and the two existing arguments are unchanged.

#### 3. Diff-size limit

**File**: `reviewer/src/limits.ts`

**Intent**: One pure, testable decision for "too large".

**Contract**: `exceedsDiffLimit(diff: string, max: number | undefined): boolean`; no limit when `max` is undefined or not a positive integer.

#### 4. CLI

**File**: `reviewer/src/index.ts`

**Intent**: Read the new optional inputs from env and stop before any model call when the diff is over the limit.

**Contract**:

- Optional env `PR_TITLE`, `PR_BODY` (passed as `context`) and `MAX_DIFF_CHARS`.
- When the diff exceeds `MAX_DIFF_CHARS`, write `Diff too large (<n> > <max> characters)` to stderr and exit with code `3` before reading `OPENROUTER_API_KEY` or creating a model.
- With none of the new variables set, behaviour and output are exactly as before; exit code `1` remains for usage and config errors.

#### 5. Tests and env example

**Files**: `reviewer/src/prompts/user.test.ts`, `reviewer/src/limits.test.ts`, `reviewer/src/reviewer.test.ts`, `reviewer/.env.example`

**Intent**: Pin the new behaviour offline and document the new variables.

**Contract**: Tests cover: unchanged output without context; title and body present with context; body truncated with the marker; context reaches the model prompt through `reviewDiff` (mock model); `exceedsDiffLimit` for undefined, below, equal and above the limit. `.env.example` lists `PR_TITLE`, `PR_BODY` and `MAX_DIFF_CHARS` as optional.

### Success Criteria:

#### Automated Verification:

- Reviewer tests pass offline, including the new context and limit tests: `npm test --prefix reviewer`
- Type checking passes: `npx tsc --noEmit`
- Linting passes on the package (run once, uncached, in this last TypeScript phase): `npx eslint --no-cache reviewer/src`
- App unit tests are unchanged: `npx vitest run`
- A diff above the limit exits with code 3 before any model call: `cd reviewer && printf 'xxxxxxxxxxxx' | MAX_DIFF_CHARS=5 OPENROUTER_API_KEY=unused REVIEWER_MODEL=unused npx tsx src/index.ts; test $? -eq 3`

#### Manual Verification:

- `git diff | npm run review --prefix reviewer` with none of the new variables set prints the same JSON shape as before

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Composite action and workflow

### Overview

The two CI files, adapted from the templates, verified statically. Nothing runs on GitHub yet.

### Changes Required:

#### 1. Composite action

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Run the reviewer on a diff file and expose the verdict and status as outputs.

**Contract**:

- Inputs: `api-key` (required), `model` (default `z-ai/glm-5.3`), `pr-title`, `pr-body` (default empty), `diff-file` (required), `max-diff-chars` (default `200000`).
- Steps use `shell: bash`; `actions/setup-node` pinned to the template's commit SHA with Node 22 to match `ci.yml`; `npm ci --prefix reviewer`; then the reviewer is run from `reviewer/` with `tsx`, stdin from the diff file, writing JSON to a file under `$RUNNER_TEMP`.
- Untrusted values (`pr-title`, `pr-body`) and the key go only through step `env:` (`OPENROUTER_API_KEY`, `REVIEWER_MODEL`, `PR_TITLE`, `PR_BODY`, `MAX_DIFF_CHARS`).
- Outputs: `status` (`reviewed` or `too-large`, from exit code 0 or 3), `verdict` (`pass` or `fail`, validated against those two values), `review-file`. Any other non-zero exit fails the step.

#### 2. Workflow

**File**: `.github/workflows/review.yml`

**Intent**: Trigger on PRs to `main`, call the action, publish comment and label, and gate on the result.

**Contract**:

- `on.pull_request`: `branches: [main]`, `types: [opened, synchronize, reopened, labeled]`.
- `permissions`: `contents: read`, `pull-requests: write`, `issues: write`.
- `concurrency`: group keyed by PR number; runs triggered by a `labeled` event whose label is not `ai-cr:review` get a unique group key so they cannot cancel a review; `cancel-in-progress: true`.
- Job `review` runs only when the event is not `labeled` or the label is `ai-cr:review`, and the PR head repository equals this repository.
- Steps: checkout (SHA pin from the template, `fetch-depth: 0`), diff to a file with `git diff "origin/$BASE_REF...HEAD"`, the action, a comment-and-label step under `if: always()` when `status` is set, then a gate step that fails unless the verdict is `pass` (and always fails for `too-large`).
- Comment step: one comment, created if none exists and edited on later runs (`gh pr comment --edit-last --create-if-none`); body is `## AI Code Review: <verdict>` plus the summary, or a "diff too large" notice. Labels `ai-cr:passed` (green) and `ai-cr:failed` (red) are created if missing and swapped; `ai-cr:review` is removed after a run; `too-large` applies `ai-cr:failed`.
- All values from the PR event pass to scripts through `env:`; `gh` uses `GH_TOKEN: ${{ github.token }}`.

### Success Criteria:

#### Automated Verification:

- Workflow and action parse as YAML: `node -e "const {parse}=require('yaml'),fs=require('fs');['.github/workflows/review.yml','.github/actions/ai-reviewer/action.yml'].forEach(f=>parse(fs.readFileSync(f,'utf8')))"`
- Workflow targets main and does not mention master: `grep -c "master" .github/workflows/review.yml` prints 0
- Pinned checkout SHA exists upstream: `git ls-remote https://github.com/actions/checkout 'refs/tags/v7.0.1*' | grep -c 3d3c42e5aac5ba805825da76410c181273ba90b1` prints 1 or more
- Pinned setup-node SHA exists upstream: `git ls-remote https://github.com/actions/setup-node 'refs/tags/v7.1.0*' | grep -c 949feb2413d6458794dcd2491c4babbbce0c15c1` prints 1 or more
- Existing CI workflow is unchanged: `git diff --quiet HEAD -- .github/workflows/ci.yml`

#### Manual Verification:

- Untrusted PR text (title, body) is referenced only in `env:` blocks of the workflow and the action, never inside a `run:` script
- Workflow permissions are limited to `contents: read`, `pull-requests: write` and `issues: write`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Verification on GitHub

### Overview

Run it for real on a throwaway PR. Several steps are repository settings only the user can change, and a run spends model credits.

### Changes Required:

#### 1. Repository setup and observation

**Files**: none (repository settings and a throwaway branch)

**Intent**: Confirm the behaviours that cannot be tested locally and settle the open platform questions.

**Contract**: The user adds the secret `OPENROUTER_API_KEY` in repository settings and pushes the branch. A throwaway PR carries a small deliberately flawed change. Observations to record in the phase commit body: comment count after two pushes, label after each run, behaviour of the unrelated-label case, whether `github.event.label.name` and the chosen token permissions worked. Making `review` a required check is a user action in branch protection; the plan does not change that setting.

### Success Criteria:

#### Automated Verification:

- Workflow is registered after the push: `gh workflow list | grep -c "AI Code Review"` prints 1

#### Manual Verification:

- Repository secret `OPENROUTER_API_KEY` exists (created by the user in repository settings)
- A PR with a deliberately flawed change gets one review comment, the `ai-cr:failed` label and a failing `review` check
- A second push to the same PR updates the existing comment instead of adding another, and the label reflects the new verdict
- Adding the `ai-cr:review` label re-runs the review and the label is removed afterwards
- Adding an unrelated label while a review is running does not cancel that run
- A PR whose diff exceeds the limit gets a comment saying so, no model call and a failing `review` check
- With the `review` check set as required in branch protection (user action), a failing review blocks the merge button

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Prompt context, truncation marker and the unchanged no-context output (`user.test.ts`).
- Size-limit decision at undefined, below, equal and above the limit (`limits.test.ts`).
- Context reaching the mock model through `reviewDiff` (`reviewer.test.ts`).

### Integration Tests:

- Static: YAML parse, SHA existence upstream, branch name, unchanged `ci.yml` (Phase 2).
- Live: Phase 3 on a throwaway PR is the integration test and spends credits.

### Manual Testing Steps:

1. Open a throwaway PR with a small flawed change and read the comment, label and check.
2. Push again and confirm the same comment is edited.
3. Add `ai-cr:review`, then an unrelated label during a run.
4. Open a PR with an oversized diff and confirm the skip notice.

## Performance Considerations

The action runs `npm ci --prefix reviewer` on every run; the package is small compared with the app. One model call per run. The cap bounds cost: at the default 200000 characters the input is around 50k tokens, which at the per-million prices recorded for the default model is a fraction of a cent. The existing `CI` workflow runs in parallel and is unaffected.

## Migration Notes

None. New files only, plus backward-compatible reviewer changes. Rollback is deleting `.github/workflows/review.yml`, which stops the workflow without affecting CI.

## References

- Research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Templates: `.claude/config-templates/m5l3-review.yml.template`, `.claude/config-templates/m5l3-action.yml.template`
- Existing CI: `.github/workflows/ci.yml`
- Reviewer: `reviewer/src/index.ts`, `reviewer/src/reviewer.ts`, `reviewer/src/prompts/user.ts`
- Related change: `context/changes/code-review-evals/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reviewer context and limits

#### Automated

- [x] 1.1 Reviewer tests pass offline, including the new context and limit tests: `npm test --prefix reviewer` — b0d2a2a
- [x] 1.2 Type checking passes: `npx tsc --noEmit` — b0d2a2a
- [x] 1.3 Linting passes on the package (run once, uncached, in this last TypeScript phase): `npx eslint --no-cache reviewer/src` — b0d2a2a
- [x] 1.4 App unit tests are unchanged: `npx vitest run` — b0d2a2a
- [x] 1.5 A diff above the limit exits with code 3 before any model call: `cd reviewer && printf 'xxxxxxxxxxxx' | MAX_DIFF_CHARS=5 OPENROUTER_API_KEY=unused REVIEWER_MODEL=unused npx tsx src/index.ts; test $? -eq 3` — b0d2a2a

#### Manual

- [ ] 1.6 `git diff | npm run review --prefix reviewer` with none of the new variables set prints the same JSON shape as before

### Phase 2: Composite action and workflow

#### Automated

- [x] 2.1 Workflow and action parse as YAML: `node -e "const {parse}=require('yaml'),fs=require('fs');['.github/workflows/review.yml','.github/actions/ai-reviewer/action.yml'].forEach(f=>parse(fs.readFileSync(f,'utf8')))"` — f730432
- [x] 2.2 Workflow targets main and does not mention master: `grep -c "master" .github/workflows/review.yml` prints 0 — f730432
- [x] 2.3 Pinned checkout SHA exists upstream: `git ls-remote https://github.com/actions/checkout 'refs/tags/v7.0.1*' | grep -c 3d3c42e5aac5ba805825da76410c181273ba90b1` prints 1 or more — f730432
- [x] 2.4 Pinned setup-node SHA exists upstream: `git ls-remote https://github.com/actions/setup-node 'refs/tags/v7.1.0*' | grep -c 949feb2413d6458794dcd2491c4babbbce0c15c1` prints 1 or more — f730432
- [x] 2.5 Existing CI workflow is unchanged: `git diff --quiet HEAD -- .github/workflows/ci.yml` — f730432

#### Manual

- [x] 2.6 Untrusted PR text (title, body) is referenced only in `env:` blocks of the workflow and the action, never inside a `run:` script — f730432
- [x] 2.7 Workflow permissions are limited to `contents: read`, `pull-requests: write` and `issues: write` — f730432

### Phase 3: Verification on GitHub

#### Automated

- [ ] 3.1 Workflow is registered after the push: `gh workflow list | grep -c "AI Code Review"` prints 1

#### Manual

- [ ] 3.2 Repository secret `OPENROUTER_API_KEY` exists (created by the user in repository settings)
- [ ] 3.3 A PR with a deliberately flawed change gets one review comment, the `ai-cr:failed` label and a failing `review` check
- [ ] 3.4 A second push to the same PR updates the existing comment instead of adding another, and the label reflects the new verdict
- [ ] 3.5 Adding the `ai-cr:review` label re-runs the review and the label is removed afterwards
- [ ] 3.6 Adding an unrelated label while a review is running does not cancel that run
- [ ] 3.7 A PR whose diff exceeds the limit gets a comment saying so, no model call and a failing `review` check
- [ ] 3.8 With the `review` check set as required in branch protection (user action), a failing review blocks the merge button
