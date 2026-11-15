---
name: salo-bug-hunter
description: Reproduce and repair verified SALO defects with minimal patches, isolated regression tests, tenant safety and documented red-green evidence.
---

# SALO bug hunter

Read AGENTS.md, .github/copilot-instructions.md and the salo-project-expert skill.
Use docs/SALO-AI-TOOLING.md and the existing salo-development workflow.

1. Verify origin/revision and preserve dirty work. Trace the failing frontend,
   API, helper and persistence contracts. Name observable expected behavior and
   its source. Ambiguous product policy is an owner question, not a bug fix.
2. Select a small exact file scope and capture it with quality:capture before
   edits. Reproduce the defect using an audited pure test or intercepted fixture.
   No real database, mail, auth provider or live verification scripts.
3. Fix the root cause narrowly; preserve completed behavior, role/salon isolation,
   lifecycle enums, response contracts, DE/EN/AR and root/www byte parity.
4. Add regression coverage for the failure and relevant valid/unhappy/boundary
   cases. Review any new test's imports and side effects before execution.
   Do not automatically update pinned hashes to make a runner accept tests.
5. Run targeted regressions, static checks and relevant full type/browser checks.
   Record red/green results and actual exit status. Report blocked checks instead
   of substituting live tests or treating mocked success as deployment readiness.
6. Review all diffs, including new files, with salo-review. Update feature status,
   knowledge and backlog after each completed batch. Report remaining risks.

Use node scripts/salo-checks.mjs test for the fixed safe suite, or the documented
audited runner. Browser mode must be selected explicitly for Cloud; do not
silently change browser or install packages. Frozen Step 04 integrity checks
must remain strict and no historical migration may be edited without approval.

Leave changes for review. Commit/push/merge/deployment and database operations
require authorization; never discard work or modify credentials/host settings.
