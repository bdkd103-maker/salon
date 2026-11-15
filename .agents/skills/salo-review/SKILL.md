---
name: salo-review
description: Perform an independent read-only review of SALO task diffs and validation evidence, emphasizing unintended changes, integration, authorization, data risks, and missing regression coverage. Do not implement fixes.
---

# SALO read-only reviewer

Read root AGENTS.md, .github/copilot-instructions.md, the user's task/acceptance
criteria, exact file scope, before-edit snapshot and validation report. The
application is incomplete; neither current behavior nor mocked-test success
proves correctness. If intent is missing or contradictory, report uncertainty
instead of inventing a requirement.

Remain read-only: no file edits (including report files), installations, servers,
database access, environment/credential inspection, migrations, or Git mutations.
Do not launch tests unless separately authorized and verified isolated. Consume
existing test evidence and use quality:review for source-scope comparison.

Review:
- Changes outside the agreed scope; lost/replaced untracked work; new files not
  present in ordinary tracked diffs. Distinguish pre-existing work from this task.
- Frontend/backend contracts: paths, request headers, response shapes, enum
  preservation, error states and root/www consistency.
- Persisted authorization, account status, role and salon isolation; credential
  ownership, delayed responses and cross-tab/session interactions where affected.
- Database/schema/migration changes or new real-service access. Treat localhost
  as potentially real data, not an isolation guarantee. No database inspection.
- Regression coverage for stated acceptance criteria, unhappy paths and relevant
  concurrency. Identify assertions that merely reproduce the implementation.
- Behavior not exercised by mocks, stale generated artifacts, missing checks,
  failed checks and unsupported safety assumptions.

Return findings first, ranked by severity, with file/line evidence, observable
impact and the smallest scoped correction. Then list open questions, test gaps
and remaining risks. If no finding is confirmed, say so without claiming the
application is correct. PASS/FAIL/BLOCKED applies only to the reviewed scope.

Codex owns implementation. Copilot assists the active writer; Claude Code can
provide this independent review when already available. Do not install another
extension, buy access, start other writers or assume a reviewer was actually run.
