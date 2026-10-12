# Mom Test Validation Plan

## Input Idea

`manual-evidence-report` — a read-only script over `context/changes/*/plan.md` Progress rows and `git log` bodies that lists manual-verification rows ticked with no note of how they were verified. Source: `context/team/opportunity-map.md` (signal S4, recommended first candidate). Possible later direction: a check inside `/10x-impl-review`.

## Hypotheses

- **User/role**: the developer who runs `/10x-implement` and ticks manual Progress rows; the reviewer running `/10x-impl-review` who must decide whether a ticked row is trustworthy. In this repo these may be the same person, which limits the number of independent interviewees.
- **Friction**: manual rows (real-browser Stop, light/dark theme checks, form submission) are ticked on a person's word alone, so a later reader cannot tell confirmed-by-person from script-verified rows.
- **Current workaround**: lessons.md rule "Record how each manual Progress row was verified" (added 2026-09-25): write "confirmed by the user" in the commit body or a "How the manual rows were verified" note in plan.md.
- **Risky assumptions**:
  1. Missing evidence notes actually cause a wrong decision or a shipped defect; a missing note may just be cosmetic.
  2. The rule is not followed because nobody notices, not because it is judged pointless. If rows are skipped on purpose, a report will be ignored too.
  3. Someone reads the report at the moment it matters (before archive/merge), rather than once.
  4. The evidence gap is large enough to automate; a handful of rows per change could be checked by eye in `/10x-impl-review`.
  5. A report over text conventions can be parsed reliably (Progress format and commit wording vary).
- **Evidence already present** (facts, from this repo):
  - lessons.md records that rows 3.5, 3.7, 3.8 of timer-stop-and-flags were ticked on user confirmation alone (rule added 2026-09-25).
  - The `no-referrer` form bug passed smoke and curl (both set `Origin` themselves) and was found only by manual testing in timer-switch-rounding Phase 3 (lessons.md).
  - 23 archived plans, all mention manual verification (about 3–17 mentions each).
  - Only 3 archived plans contain a "How the manual rows were verified" note, although the rule dates from 2026-09-25 and roughly 16 archived changes are dated on or after that day (coarse grep count, not row-level).
  - 27 commit bodies contain "confirmed by the user"; so the commit-body convention is partly followed.
  - Not present: any incident where a missing note led to a wrong ship decision, apart from the `no-referrer` case, which is about smoke blind spots rather than missing notes.

## Critique

- **Solution vs problem.** The pain is "I can't tell how a manual row was verified". The candidate answers a narrower question, "which rows lack a note", and assumes a note is the thing that was missing. The `no-referrer` incident was a verification-method problem (a script that cannot see real-browser behaviour), which a note-detector would not have caught: the row would have carried a note saying "smoke passed".
- **Past behaviour vs future intent.** "I would read this report before merging" is a future intent. Past behaviour is what happened to the existing lessons.md rule: it exists since 2026-09-25 and 3 of ~16 later plans follow one of its two forms. That is the strongest evidence in the file, and it points two ways: the rule is easy to forget (supports automation), or it is judged low value (argues against).
- **Who is the user?** If the developer and the reviewer are one person (with an AI agent doing the ticking), the report mostly audits the agent's discipline. A cheaper fix may be a line in `/10x-implement`'s Progress-row template or the commit-message hook, not a new report.
- **What would show it is not worth building.** If, on a manual pass over the 28 archived changes, most untagged rows turn out to be low-risk (cosmetic, re-verified later by a script) and no row corresponds to a real defect, the gap is bookkeeping, not risk.
- **Existing tool that may be good enough.** `git log --grep="confirmed by the user"` plus the plan's "How the manual rows were verified" note, plus the pre-commit/end-of-turn hooks in `.claude/hooks/`. A one-line hook check on commits that tick a manual row could cover most of the value without a report.
- **Strong evidence to continue:** a row-level count on the archive showing a substantial share of manual rows with no evidence, and at least one example where the missing note changed a decision.

## Interview Guide

Target interviewees: you (as developer), anyone who reviewed a change with `/10x-impl-review` or read a plan before merge, and if available a teammate who inherited a change. 20–30 minutes each. Ask for artefacts (a plan.md, a commit) instead of opinions.

1. Which change did you last tick a manual Progress row on? Walk me through what you did right before ticking it.
2. How did you actually check it: real browser, script, SQL, someone else's confirmation? Where is that written down today?
3. Tell me about the last time you read a plan or commit and wanted to know how a row had been verified. What did you do to find out?
4. What happened the last time a manual row turned out to be wrong or unverified after it was ticked? How long until you noticed?
5. Which lessons.md rule about manual rows are you aware of, and what did you do the last time one applied?
6. Show me the last plan where you skipped the "How the manual rows were verified" note. What was going on at that moment?
7. How do you decide today whether a ticked row is trustworthy when reviewing?
8. What do you do before archiving a change to be sure the manual rows are in order? How long does it take?
9. What other tool, hook or checklist already covers part of this (pre-commit, end-of-turn hook, impl-review)? What does it miss?
10. If this had to be checked automatically, what would have to be true for you to look at the output? (Ask only after 1–9; follow with: when did you last look at a similar report?)

Follow-ups for interesting answers: "What did that cost?", "Who else needed to know?", "What did you try first?", "When was that?"

Self-check before interviewing: read 5 archived plans and mark each manual row as evidenced / not evidenced / script-verified; this is the cheapest evidence and does not need other people.

## Survey

Short filter first; use only if there are three or more people who tick or review manual rows.

1. Did you tick or review a manual verification row in the last 30 days? (yes / no — end survey if no)
2. How many changes did that involve? (1 / 2–3 / 4–6 / 7+)
3. For the most recent one, how was the row verified? (real browser / script / SQL / someone's confirmation / don't remember)
4. Was that recorded anywhere a later reader could find? (commit body / plan note / chat only / nowhere)
5. In the last 30 days, how many times did you need to find out how a row had been verified? (0 / 1 / 2–3 / 4+)
6. When you needed it, how long did finding out take? (under 1 min / 1–5 min / over 5 min / couldn't find out)
7. In the last 90 days, did a ticked manual row turn out to be wrong or not actually checked? (no / once / more than once)
8. Open: describe the most recent time that happened or almost happened (what, when, what it cost).
9. Open: what do you currently do to avoid it?

## Decision Criteria

- **Proceed** if: in the archive pass (23 plans, 28 changes) at least ~30% of manual rows have no recoverable evidence **and** at least one interviewee describes, unprompted, a recent case where this cost time or a wrong decision, **and** at least 2 of 3 interviewees say they cannot answer "how was this row verified" without reading the diff.
- **Narrow scope** if: the gap exists but is concentrated in one kind of row (for example UI/real-browser rows) or one phase; then check only that kind, or only at archive time.
- **Do not build yet** if: fewer than ~10% of manual rows lack evidence, or nobody can name a case where it mattered; the problem is bookkeeping, not risk.
- **Try existing tool/process first** if: the lessons.md rule can be enforced by a one-line check in an existing hook or in the `/10x-implement` Progress template, or by `git log --grep`; try that for two changes before writing a separate report.

## Archive Pass Results (2026-10-12)

Read-only pass over the 23 plans in `context/archive/` (no active plans exist in `context/changes/`). Counts come from a script over each plan's `## Progress` section (`#### Manual` rows) and a text search for the verification note; they have not been checked row by row.

| Measure                                                                                    | Result                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Plans with manual rows                                                                     | 23 of 23                                            |
| Manual rows (ticked / total)                                                               | 143 ticked of 149                                   |
| Ticked rows that end with a commit SHA                                                     | 139 of 143                                          |
| Plans with a "How the manual rows were verified" note                                      | 1 of 23 (`2026-09-25-timer-stop-and-flags`, 6 rows) |
| Plans with any looser verification wording ("confirmed by the user", "verified by script") | 4 of 23                                             |
| Plans dated on or after the rule (2026-09-25) with the exact note                          | 1 of 16                                             |

**Correction:** the earlier line "only 3 of ~16 plans carry the note" came from a wider text match. The exact heading appears in 1 plan.

**What it says against the decision criteria**

- Under the PRD's business rule (a note in plan.md that accounts for the row) about 137 of 143 ticked manual rows, 96%, would be flagged. That is above the 30% "proceed" threshold, but it is also the "flags nearly everything" counter-argument confirmed: the list would be noise on day one.
- Almost every ticked row already carries a commit SHA, and most row texts already state the method ("In the local SQL editor...", "In a real browser..."). The rule ignores both, so it measures adherence to a note format, not missing evidence.
- Mixed signal, so the criterion that fits is **Narrow scope**: define evidence differently (for example a row counts as unevidenced when it has no commit SHA or no stated method) before building anything. By the SHA test only 4 ticked rows (all in `2026-09-25-time-entry-purge-verified`) and 6 unticked rows would be flagged.
- No named incident in this pass links a missing note to a wrong ship decision; the `no-referrer` case is a smoke blind spot, which the report does not address.

**Follow-up:** a shape/PRD attempt built on the rule above was run and then removed; if this opportunity is taken further, shape it again around the narrower evidence definition.
