---
date: 2026-10-12T14:13:02Z
researcher: Claude Sonnet 5.5 (Claude Code)
git_commit: 4d7c32c
branch: main
repository: stopper-for-timecards (origin github.com/senei/stopper-for-timecards; local dir x10-dev--curse)
topic: "AI code review in GitHub Actions: how the course templates fit this repo, its CI and the reviewer package"
tags: [research, github-actions, ci, composite-action, reviewer, m5l3]
status: partial
last_updated: 2026-10-12
last_updated_by: Claude Sonnet 5.5 (Claude Code)
---

# Research: AI code review in GitHub Actions for this repo

**Date**: 2026-10-12T14:13:02Z
**Researcher**: Claude Sonnet 5.5 (Claude Code)
**Git Commit**: 4d7c32c
**Branch**: main
**Repository**: stopper-for-timecards (local dir x10-dev--curse)

## Research Question

On the basis of `context/changes/ci-cd-code-review/requirements.md`: what does it take to run the review agent in a GitHub Actions workflow for every pull request, with a composite action doing the review, a PR comment, an `ai-cr:passed` or `ai-cr:failed` label, and an on-demand re-run through the `ai-cr:review` label? Where do the two course templates fit this repository's CI and the `reviewer/` package?

## Summary

- **The requirements and both templates agree with each other.** The workflow template covers the comment, the labels, the failing check on `fail` and the re-run label (`.claude/config-templates/m5l3-review.yml.template:2-4,49-67`), and the action template is the composite action the requirements ask for (`requirements.md:4`; `.claude/config-templates/m5l3-action.yml.template:36-58`).
- **The action template's runtime contract does not match `reviewer/` on seven inspected points** (table in Detailed Findings 2): program path, diff source, PR title and body, API-key variable name, model variable name, a build step that does not exist, and Node version.
- **PR title and body are not used by the reviewer at all.** `reviewDiff(reviewer, diff)` and `buildUserPrompt(diff)` take only the diff (`reviewer/src/reviewer.ts:18-24`, `reviewer/src/prompts/user.ts:2-4`), although the requirements list title, description and diff as inputs (`requirements.md:8-10`).
- **Branch mismatch.** The workflow template filters `branches: [master]` (`m5l3-review.yml.template:10`) and the requirements say `master` (`requirements.md:3`); this repository's CI uses `main` (`.github/workflows/ci.yml:5,7`).
- **Existing CI is untouched by the templates but differs in style.** `ci.yml` pins actions by major tag (`@v7`, lines 13,14,31,32,66,67), uses Node 22 (lines 16,34,69) and has no `permissions:` key; the templates pin full commit SHAs and set explicit permissions.
- **Platform facts that shape the design** (from GitHub documentation, read through a summarising fetch tool): secrets are not passed to workflows from forked PRs; a required check can be satisfied by a job skipped through an `if:`; a label alone does not gate a merge, only a check result does.
- **Status is partial.** Four facts are not confirmed by any source read here and are listed under Open Questions; nothing was executed and no GitHub API was called.

## Detailed Findings

### 1. What the requirements ask for

- Trigger on every new pull request to the target branch, with the review in a composite action so the main workflow stays readable (`requirements.md:3-4`).
- Inputs: PR title, PR description (flagged "cost trade-off") and the git diff (`requirements.md:8-10`).
- Six criteria scored 1-10, a binding `verdict` of `pass` or `fail`, and a Markdown `summary`; the merge gate reads only `verdict` (`requirements.md:12-43`). The schema in `reviewer/` has the same six fields (`reviewer/src/review-schema.ts:10-54`).
- Side effects: a PR comment with the summary, and one label, `ai-cr:failed` (red) or `ai-cr:passed` (green) (`requirements.md:52-53`).
- Re-run on demand by adding the `ai-cr:review` label (`requirements.md:57`).
- Business-fit and architectural-fit criteria are deferred (`requirements.md:45-48`).

### 2. Templates against the reviewer package

| Aspect          | Action template                                                                       | `reviewer/` today                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program         | `node "$GITHUB_ACTION_PATH/dist/review.js"` (`m5l3-action.yml.template:55`)           | `tsx src/index.ts` via `npm run review` (`reviewer/package.json:10`); no build script and no `dist/` (`reviewer/package.json:9-12`)                           |
| Diff source     | `DIFF_FILE` env (`:51`)                                                               | stdin (`reviewer/src/index.ts:17-21`)                                                                                                                         |
| PR title / body | `PR_TITLE`, `PR_BODY` env (`:49-50`)                                                  | not read anywhere among non-test source files                                                                                                                 |
| API key         | `LLM_PROVIDER_API_KEY` (`:48`; workflow secret at `m5l3-review.yml.template:44`)      | `OPENROUTER_API_KEY` (`reviewer/src/index.ts:28`)                                                                                                             |
| Model           | `REVIEW_MODEL`, input default `z-ai/glm-5.3` (`:52,26`)                               | `REVIEWER_MODEL` (`reviewer/src/index.ts:29`)                                                                                                                 |
| Output          | JSON to stdout redirected to a file (`:55`); verdict must be `pass` or `fail` (`:56`) | JSON to stdout (`reviewer/src/index.ts:33`); token line to stderr (`:34`); `verdict` is `"pass" \| "fail"` in the schema (`reviewer/src/review-schema.ts:53`) |
| Node            | `setup-node` with `node-version: 24` (`:39-41`)                                       | `engines.node >=22` (`reviewer/package.json:6-8`); `ci.yml` uses 22                                                                                           |

- The output and verdict contract matches. The input channel, naming and packaging do not.
- Dependencies of `reviewer/` live in its own `node_modules` and lockfile (`reviewer/package.json:13-18`), separate from the root package; a workflow step that runs the reviewer needs its own install.

### 3. Workflow template against this repository's CI

- Existing triggers: `push` and `pull_request` on `main` (`ci.yml:3-7`); jobs `ci`, `smoke`, `e2e` (`ci.yml:10,28,63`). The template adds a separate workflow with job `review`, so job names do not collide.
- The template sets workflow-level `permissions` to `contents: read`, `pull-requests: write`, `issues: write` (`m5l3-review.yml.template:13-16`). `ci.yml` has no `permissions:` key, so it runs with the repository's default token permission.
- Secrets in use today are `SUPABASE_URL` and `SUPABASE_KEY` (`ci.yml:25-26`); the template needs one more, `LLM_PROVIDER_API_KEY` (`m5l3-review.yml.template:44`). Whether any LLM secret exists in the repository settings is **not known** from files.
- Concurrency: group is `ai-review-<PR number>` with `cancel-in-progress: true` at workflow level (`m5l3-review.yml.template:18-20`); the label filter is a job-level `if:` (`:24`). See inference in Open Questions 6.
- Ordering inside the job: checkout with `fetch-depth: 0` (`:30-32`), diff to a file (`:34-37`), action (`:39-47`), comment and label under `if: always() && verdict != ''` (`:49-61`), then a gate step that fails on any verdict other than `pass` (`:63-67`).

### 4. GitHub platform facts (documentation read 2026-10-12; summarised by a fetch tool)

- **Triggers**: `pull_request` runs for `opened`, `synchronize`, `reopened` unless `types` is set; `branches` filters the **base** branch; there is no label filter on the trigger, so a label restriction is a job-level condition (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- **Forks**: secrets are not passed to workflows triggered from a forked repository except `GITHUB_TOKEN`, which is read-only for fork PRs; `pull_request_target` runs with secrets and is documented as dangerous with untrusted code (same page; https://docs.github.com/en/actions/reference/security/secure-use).
- **Permissions**: once any `permissions` key is set, unspecified keys become `none`; PR comments and labels use the Issues endpoints with the PR number (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax; https://docs.github.com/en/rest/issues/comments).
- **Composite actions**: `runs.using: composite`; every `run:` step needs `shell:`; outputs need a `value` mapped from a step id; a local action is referenced as `uses: ./.github/actions/<name>` after a checkout (https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action; https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax).
- **Merge gating**: a required status check must be successful, skipped or neutral to merge; a job skipped by an `if:` reports success, while a whole workflow skipped by branch or path filters leaves its check pending (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches; skipped-job statement from a search summary of the troubleshooting page). Nothing read says a label blocks a merge.
- **Pinning**: GitHub recommends pinning to a full-length commit SHA (https://docs.github.com/en/actions/reference/security/secure-use); the repo's `ci.yml` pins by tag.
- **Sizes**: a PR comment limit of 65536 characters is reported by third-party sources, not by GitHub's docs; no documented limit was found for `GITHUB_OUTPUT` values, and large values are recommended to go through files.

### 5. Alternative path present in the repository

- The `10x-impl-review-ci` skill ships its own workflow template based on a Claude Code action: it needs `ANTHROPIC_API_KEY`, `contents: write` to commit the review file back, `pull-requests: write` and `statuses: write` (`.claude/skills/10x-impl-review-ci/references/workflow-template.yml:4-6,53`). It reviews an implementation against a plan, which is a different input and a different gate from the requirements here. It is out of the stated requirements and listed only because it is a second, distinct way to put a review in CI.

## Code References

- `context/changes/ci-cd-code-review/requirements.md:3-4,8-10,42-43,52-53,57` - requirements.
- `.claude/config-templates/m5l3-review.yml.template:10-11,13-16,18-20,24,30-32,34-37,39-47,49-61,63-67` - workflow template.
- `.claude/config-templates/m5l3-action.yml.template:4-5,9-26,36-58` - composite action template, contract and runtime.
- `.github/workflows/ci.yml:3-7,10,13-16,25-26,28,63` - existing CI (triggers, jobs, node, secrets).
- `reviewer/src/index.ts:8-12,17-21,28-29,33-34` - CLI env, stdin, model, output.
- `reviewer/src/reviewer.ts:18-24` and `reviewer/src/prompts/user.ts:2-4` - diff-only reviewer input.
- `reviewer/package.json:6-12,13-18` - engines, scripts, dependencies.
- `.claude/skills/10x-impl-review-ci/references/workflow-template.yml:4-6,53` - alternative workflow.

## Architecture Insights

- The templates assume a **built, self-contained reviewer** that reads files and env set by the action. The repository's reviewer is a **source package run through `tsx`** that reads stdin. Closing that gap is the main design decision of this change; the candidate shapes are (a) add a build or bundle step to produce a `dist` entry point, (b) have the action install `reviewer/` and run it through `tsx`, or (c) change the action to call the existing CLI with the diff on stdin. Each has different install time, lockfile and secret-handling consequences; none was tested.
- The composite action receives the API key as an **input** in the template (`m5l3-action.yml.template:10-12`), and untrusted PR text goes through env, not script interpolation (`:46-52`). Both are consistent with the secure-use guidance read above.
- Gating is by **check result**: the template fails the job on any non-`pass` verdict (`m5l3-review.yml.template:63-67`), and a failing required check, not the label, is what blocks a merge.
- Every PR to `main` would run two workflows: the existing `CI` (three jobs, including a local Supabase stack) and the new review. They are independent files and run in parallel.

## Historical Context (from prior changes)

- `context/archive/2026-10-12-tool-loop-agent/plan.md:31` - "No Claude Agent SDK variant, no CI/GitHub Actions integration (later lessons)". Supported: that change delivered the importable reviewer and left CI to this change.
- `context/changes/code-review-evals/plan.md` ("What We're NOT Doing") - "No CI or GitHub Actions wiring (that is the separate `ci-cd-code-review` exercise)". Supported: evals are planned as a separate change and do not touch workflows.
- `context/foundation/lessons.md` has no entry about GitHub Actions, workflows or labels (whole file inspected, 2026-10-12).

## Related Research

- `context/changes/code-review-evals/research.md` - the reviewer's importability and prompt reuse, relevant to how the action can call it.

## Open Questions

1. **How the action runs the reviewer** (design decision): build to `dist/review.js`, install `reviewer/` and run via `tsx`, or reshape the action around stdin. Affects install time, lockfile use and the template's `DIFF_FILE` contract.
2. **PR title and description** (product decision, from `requirements.md:9`): include the body or not, given the stated cost trade-off. Either way the reviewer's input must change, because it takes only the diff today.
3. **Naming alignment**: use the template's `LLM_PROVIDER_API_KEY` and `REVIEW_MODEL`, or the reviewer's `OPENROUTER_API_KEY` and `REVIEWER_MODEL`. Includes the repository secret's name and whether it exists; the repository's actual secrets and branch-protection settings were not inspected (no GitHub API call was made).
4. **Target branch**: `main`, as in `ci.yml`, instead of the `master` in the requirements and the template.
5. **Required check** (repository setting, outside the files): whether the review check is made required in branch protection; without it the verdict labels and a red check do not block merging. How a job is selected as required was not confirmed from a primary page.
6. **Concurrency inference, not verified**: the concurrency group is set for the whole workflow (`m5l3-review.yml.template:18-20`) and the label filter is a job-level `if:` (`:24`). If a run triggered by an unrelated label enters the same group before its job is skipped, `cancel-in-progress: true` could cancel an in-flight review. This reasoning was not confirmed by a documented statement or a run.
7. **Unconfirmed platform facts**: that `github.event.label.name` is exposed for `labeled` events (the template relies on it at `:24`; a docs fetch was inconclusive); the minimum `GITHUB_TOKEN` permissions for comment and label calls (`issues: write` alone or with `pull-requests: write`; the fine-grained PAT table lists both, the `GITHUB_TOKEN` table was not retrieved); whether composite actions may read `secrets.*` directly; and the 65536-character comment limit, which is third-party sourced.
8. **Fork PRs**: with no secrets on fork PRs, the review step cannot call the model; behaviour for that case (skip, fail, or comment) is undecided.
9. **Diff size and cost**: the diff goes to the model unbounded; no size cap or cost estimate exists in the templates or the reviewer. Per-model prices from OpenRouter's live list (2026-10-12) are in the `code-review-evals` research.
10. **Pinned SHAs in the template** (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0 at `m5l3-review.yml.template:30` and `m5l3-action.yml.template:39`) were not verified against the actions' repositories.
