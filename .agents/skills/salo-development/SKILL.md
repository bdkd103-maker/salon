---
name: salo-development
description: Develop SALO changes through explicit acceptance criteria, scoped implementation, isolated validation, and review. Use for SALO coding and bug-fix tasks; respect audit-only and approval-before-implementation requests.
---

# SALO development

Read root AGENTS.md and .github/copilot-instructions.md. The application is
incomplete: current behavior and passing mocked tests are evidence, not a verified
functional specification. Preserve unrelated work, not a confirmed bug.

Follow **ANALYZE → PLAN → IMPLEMENT → TEST → REVIEW**:

1. **ANALYZE:** State intended behavior, observable acceptance criteria, current
   evidence and uncertainty. Trace affected frontend/API/helper paths. Inspect
   existing Git changes and relevant untracked files; do not inspect secrets.
2. **PLAN:** Name the smallest exact file scope, tests, integration risks and
   expected evidence. Read [the local workflow guide](../../../docs/development-workflow.md)
   for gate commands. Capture safe-source fingerprints before edits. This is a
   change-attribution snapshot, not a backup or functional baseline. If the user
   requested approval before implementation, stop after presenting this plan;
   elapsed time and silence are not approval. An audit-only task ends at analysis.
3. **IMPLEMENT:** Codex is the primary writer. Copilot may assist interactively
   under that same coordinated edit session. Claude Code/other agents may review
   read-only. No independent parallel writers in the working tree. Make the
   narrow change; preserve unrelated modifications and untracked content.
4. **TEST:** Add focused regression coverage for a confirmed bug, testing the
   intended result rather than freezing broken behavior. Use the gate's fast
   checks during edits and finish checks at completion. Only audited pure-unit
   and intercepted browser tests run automatically. Never substitute live tests
   for a blocked check. A new test or changed pinned suite requires isolation
   review before expanding its allowlist. Existing TypeScript failures remain
   failures; do not suppress them or claim they were introduced without evidence.
5. **REVIEW:** Use the salo-review workflow or ask an independent reviewer to
   read its SKILL.md. Inspect task diffs including new files, frontend/API
   contracts, role/salon boundaries, and acceptance evidence. Resolve actionable
   findings within the authorized scope. Report changed files, actual commands,
   PASS/FAIL/BLOCKED results, skipped coverage and remaining uncertainty.

Do not install tools, alter databases, migrate, deploy, commit, or push as a side
effect. Only the user can authorize scope expansion or operations requiring
approval. Do not automatically rewrite suite hashes, repair existing unrelated
errors, clean the working tree, or treat the gate as a deployment decision.
