<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Fix silent error logging

- **Plan**: context/changes/fix-silent-error-logging/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: the diff 7d4a577..6231ebc touches 31 files and every plan file is present. Re-run today: `npx vitest run` 212 passed, `npx tsc --noEmit` exit 0, `npm run lint` clean. Grep checks: the only `console.*` calls are in `src/lib/log.ts`; the only bare `catch {` are `log.ts:81` (the logger's own fallback, exempted) and `WorkspaceCard.astro:274` (documented client fallback); no message-only rethrow remains in `src/lib`. Manual rows 1.4, 5.6 and 5.7 say who confirmed them (commit bodies 27c4882 and 117b34a), and the verify report `context/audits/observability/2026-10-02_verify-fix-silent-error-logging.md` exists. Not re-run: phase 5 probe suite (needs a local Supabase stack); its result was taken from the commit message and the verify report.

## Findings

### F1 — `String.replace` in the stack rewrite interprets `$` patterns

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/log.ts:42
- **Detail**: `stack.replace(err.message, serialized.message)` passes the truncated message as a replacement string, so `$&`, `$'` or `` $` `` inside it are expanded instead of copied (verified: `"a $& b".replace("a", "$&$&")` gives `"aa $& b"`). A 502 HTML body or a message with `$` could produce a slightly garbled stack line. Logging still works and nothing throws.
- **Fix**: Use a replacer function: `stack.replace(err.message, () => serialized.message)`.
- **Decision**: FIXED — replacer function in log.ts:42

### F2 — `logWarn` accepts an optional error, which the plan did not specify

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/log.ts:92
- **Detail**: The plan's contract was `logWarn(event, context)`. The implementation adds `...err: [] | [unknown]` so `form_parse_failed` can attach the parse error. The four routes use it that way and the plan says to log the bound error, so this is a harmless, useful extension; the plan text is now slightly behind the code.
- **Fix**: No code change; optionally note the extra parameter in the plan.
- **Decision**: FIXED — noted the extra parameter in plan.md (Phase 1, logger contract)
