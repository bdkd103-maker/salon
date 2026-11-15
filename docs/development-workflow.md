# SALO local development workflow

This is development tooling, not release/deployment automation. SALO's current
behavior is incomplete and unverified. Define acceptance criteria per task;
passing mocks do not prove real API, database, concurrency or end-to-end behavior.

## One writer and explicit scope

Codex is the primary coding agent. Copilot can assist the same interactive
coding session. Claude Code or another agent can independently review read-only.
Only one agent writes this working tree at a time. No agents/extensions are
installed or launched by these files. A review workflow is guidance, not an
automatic second-model opinion or an access-control boundary.

Use the local skills `.agents/skills/salo-development/SKILL.md` and
`.agents/skills/salo-review/SKILL.md`. They use the installed SKILL.md frontmatter
format. Invoke by name if discovered, or explicitly ask Codex/another reviewer
to read the relevant path. Discovery may require reloading the client and is not
assumed verified by creating these files. The development sequence is ANALYZE,
PLAN, IMPLEMENT, TEST, REVIEW. Approval-first requests stop at PLAN; audits do
not implement anything. No global Codex configuration is changed.

## Commands (repository root)

Use `npm.cmd` on PowerShell if npm.ps1 is blocked. `--ignore-scripts` prevents
pre/post npm hooks; each command invokes only local Node tooling, never npx.
The pure-unit loader needs Node's `module.registerHooks` and experimental
TypeScript transformation support; the installed Node version is used unchanged.
Git trust is scoped to each command for this repository, with no global config edit.

```text
npm.cmd --ignore-scripts run quality:capture -- --files scripts/example.mjs
```

Capture BEFORE implementation using the actual approved paths, not the example.
It creates a new UUID JSON file under the existing ignored
`.verification-test-build/quality-gate/` directory. Keep its printed relative path.
After edits:

```text
npm.cmd --ignore-scripts run quality:fast -- --baseline <printed-path> --files scripts/example.mjs
npm.cmd --ignore-scripts run quality:finish -- --baseline <printed-path> --files scripts/example.mjs
npm.cmd --ignore-scripts run quality:review -- --baseline <printed-path> --files scripts/example.mjs
```

Capture and comparison fingerprint safe Git-listed source files, including
untracked source. Sensitive/diagnostic paths are path-only. Ignored files are not
covered. No contents of environment files, credential tooling or live diagnostic
scripts are opened. This is NOT a backup or complete preservation proof. Existing
work stays untouched; no stash/reset/clean/commit is performed. Explicit scope is
mandatory because this working tree already contains substantial unrelated work.

Fast mode checks scope, tracked/new-file whitespace, JSON and inline classic-JS
parsing, standalone JavaScript syntax and applicable root/www byte parity.
HTML extraction is deliberately limited; inline modules report BLOCKED. CSS,
Markdown and images require review; their file inspection is not lint or behavior
validation. No ESLint is installed/configured; no lint pass is claimed.

Finish mode adds the six audited mock browser suites for frontend paths, full
backend TypeScript checking for backend paths, and selected pure backend unit
groups where mapped. Tooling/package changes select the workflow regression tests.
Existing browser hashes/guards are reused unchanged.
Currently only service-visit, staff-presence and basic loyalty helpers have
audited pure-unit mappings. Unmapped backend behavior reports BLOCKED instead
of discovering or running arbitrary tests. Auth/queue/loyalty persistence contracts
need a separately reviewed mock-only expansion; no live scripts are substituted.

```text
npm.cmd --ignore-scripts run test:backend:unit
npm.cmd --ignore-scripts run test:browser:mock
npm.cmd --ignore-scripts run test:workflow
```

The pure-unit runner pins the existing test hashes and permits imports of only
six audited test/helper modules and three Node builtins. Prisma, backend startup,
dotenv and network modules are unavailable through that loader; fetch and
WebSocket throw. Child environments do not inherit application secrets/URLs or
NODE_OPTIONS. This is a trusted-code regression boundary, not an OS sandbox for
malicious JavaScript. Do not automatically refresh hashes or allow new imports.

## Results and review

- PASS (exit 0): all required selected checks passed. Fast PASS is static-only.
- FAIL (exit 1): a selected check failed or source changed outside scope.
- BLOCKED (exit 2): missing scope/evidence/tool, unknown coverage or unsafe paths.
  FAIL takes precedence if both failing and blocked checks exist.

Evidence includes each command/check, exit status and bounded output. Capture is
not a functional baseline. Review mode compares scope and emits a manual review
checklist without running tests or writing reports. Human/agent review still
needs acceptance criteria, diffs and integration reasoning. No gate result
certifies application correctness or deployment readiness.

Full-project TypeScript previously had failures, and the generated Prisma client
is stale; these must remain visible. No compiler baseline is silently waived.
No builds, live database checks, migrations, mail, backend servers or deployment
commands are automatic. Existing release/bootstrap blockers are not prerequisites
for a documentation edit, but schema/infrastructure changes require specialized
review and report BLOCKED. Independent backup remains a separate authorized task.
