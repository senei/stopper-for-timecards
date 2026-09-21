# Session log — 2026-09-21: roadmap M-01 and GitHub backlog

## What was done
- Ran `/10x-roadmap` on the PRD (v3, since promoted to `context/foundation/prd.md`; the old v1 is now `prd-v1.md`). Readiness 4/4, Open Questions none.
- Opened milestone **M-01: Core timecard flow** in `context/foundation/roadmap.md`: 0 foundations, 8 vertical slices (S-01..S-08), 4 streams.
- Interview answers (confirmed by the user): baseline correct, `main_goal: speed`, north star = S-02 (add project + start timer), `top_blocker: capacity`.
- Installed GitHub CLI (`winget install --id GitHub.cli --scope user`; the machine-wide install failed with 1602 when the UAC prompt was cancelled). `gh` is logged in as `senei`.
- Created labels `roadmap`, `M-01`, `blocked` and issues #1–#8 in `senei/stopper-for-timecards`, one per slice, prerequisites linked. Issue numbers are recorded in the roadmap's Backlog Handoff table.

## State at end of session
- Ready to plan: S-01 (`private-link-access`, issue #1). Next: `/10x-plan private-link-access`.
- Blocked: S-06 (`weekly-grid-summary`, #6) until the open question below is answered.
- No slice work has started; no code was changed. The roadmap formal self-review pass was not run (checked by hand).

## Open items
1. **Where do Task, Type and Work Type come from for the weekly grid?** PRD names them as grid columns but has no requirement capturing them. Blocks S-06, shapes the S-02 project model.
2. Minor unknowns (non-blocking), recorded per slice: fate of the starter email/password pages (S-01), sub-15-minute rounding rule (S-03), "suspiciously long" threshold (S-04), time zone for Mon–Sun boundaries (S-06).

## Notes
- Baseline caveat: `time_entries` in `supabase/migrations/` is a placeholder; S-02 replaces it and S-08 re-points the purge worker (`workers/purge-job`) at the real model.
- `gh` was installed mid-session, so new shells need a restart to see it on PATH.
- The Linear MCP command was pasted but not run; GitHub issues were used instead.
