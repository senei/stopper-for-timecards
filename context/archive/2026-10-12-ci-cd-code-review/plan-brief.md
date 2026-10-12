# CI/CD Code Review in GitHub Actions — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Run the team's AI code reviewer automatically on every pull request to `main`: a workflow calls a local composite action that reviews the diff, posts a comment, labels the PR `ai-cr:passed` or `ai-cr:failed`, and fails the check on a `fail` verdict. Adding `ai-cr:review` re-runs it. The point is to make the review a gate the team can rely on instead of a script on one machine.

## Starting Point

`reviewer/` already produces the verdict as JSON from a diff on stdin, but the course action template expects a built `dist/review.js` with different env names and PR title/body inputs the reviewer does not read. The repo has one `CI` workflow on `main` and nothing else in `.github/`. The template also targets `master`.

## Desired End State

A PR to `main` shows one review comment that is edited on each push, the label for the latest verdict, and a `review` check that fails on `fail` or on a diff above the limit. Fork PRs are skipped. The reviewer CLI still works for existing callers, and `ci.yml` is untouched.

## Key Decisions Made

| Decision                         | Choice                                                                                 | Why (1 sentence)                                                       | Source                                |
| -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| How the action runs the reviewer | Install `reviewer/` and run it through `tsx`                                           | Adds no build step or tool and uses the CLI that is already tested.    | Plan                                  |
| PR text in the prompt            | Title plus description cut to 4000 characters                                          | The model sees intent while cost and injection surface stay bounded.   | Plan                                  |
| Oversized diff                   | Skip the model, comment, label `failed`, fail the check, default cap 200000 characters | Predictable cost and no silent pass of an unreviewed change.           | Plan                                  |
| Comment                          | One comment, edited on each run                                                        | Avoids noise on every push and keeps the current verdict on top.       | Plan                                  |
| Branch                           | `main`                                                                                 | The repo's CI uses `main`; the requirements and template say `master`. | Research                              |
| Variable and secret names        | `OPENROUTER_API_KEY`, `REVIEWER_MODEL`                                                 | Same names as the CLI and the planned evals.                           | Research                              |
| Fork PRs                         | Skipped by a job condition                                                             | Secrets are not available to fork PRs, so the review could not run.    | Research                              |
| Unrelated labels                 | Own concurrency group key                                                              | Prevents an unrelated label from cancelling an in-flight review.       | Plan (unverified, checked in Phase 3) |
| Reviewer API change              | Optional third argument and optional env vars                                          | Keeps the planned evals provider working unchanged.                    | Plan                                  |

## Scope

**In scope:** reviewer context and size limit with tests, composite action, workflow, a live verification on a throwaway PR.

**Out of scope:** a build/dist step, changes to `ci.yml`, `pull_request_target`, fork support, evals, the Claude Code Action path, repository settings changes made by the plan.

## Architecture / Approach

The reviewer owns the prompt, including the new optional PR context and the limit decision. The composite action only installs it, passes inputs through `env:`, and maps exit codes to outputs. The workflow does git diff, comment, labels and the gate, with all PR text passed through `env:` and never into scripts.

## Phases at a Glance

| Phase                            | What it delivers                                                                     | Key risk                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1. Reviewer context and limits   | Optional title/body in the prompt, size limit with exit code 3, offline tests        | Changing the prompt builder must not alter existing output                                  |
| 2. Composite action and workflow | `.github/actions/ai-reviewer` and `.github/workflows/review.yml`, statically checked | YAML cannot be run locally, so behaviour is only inferred until Phase 3                     |
| 3. Verification on GitHub        | Real PR run: comment, label, check, re-run, unrelated label, oversized diff          | Needs your secret and settings, spends credits, and exposes unverified platform assumptions |

**Prerequisites:** a repository secret `OPENROUTER_API_KEY`, push access, and the ability to open a PR on `senei/stopper-for-timecards`.
**Estimated effort:** ~2 sessions across 3 phases; Phase 3 depends on GitHub-side steps you perform.

## Open Risks & Assumptions

- Assumed but not confirmed: `github.event.label.name` exists for `labeled` events and the listed token permissions suffice; both are exercised in Phase 3.
- The concurrency mitigation reasoning is untested until Phase 3.
- The template's pinned SHAs are checked upstream in Phase 2, not assumed.
- Each run costs credits; default model prices are in the evals research.
- A required check is a repository setting only you can make; until then the labels and a red check do not block merging.

## Success Criteria (Summary)

- A real PR gets a single updated comment, the right label and a failing or passing check.
- Re-run on label works, unrelated labels do not cancel a review, and an oversized diff is skipped with a notice.
- Reviewer tests and repo gates stay green and `ci.yml` is unchanged.
