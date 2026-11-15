---
name: salo-quality-gate
description: Run SALO safe tests, security scans, TypeScript, skill and CI validation with explicit scope, preserved integrity checks and honest regression reporting.
---

# SALO quality gate

Read AGENTS.md, .github/copilot-instructions.md and docs/SALO-AI-TOOLING.md.
Verify origin/revision and inspect git status. Never overwrite existing work.

Use Node 24. Capture scoped source fingerprints before implementation with the
existing quality:capture command. Run quality:fast, quality:finish and
quality:review against the same scope and capture. These are attribution checks,
not backups or application certification. No auto-fix or cleanup side effects.

Use node scripts/salo-checks.mjs commands:
- skills: validate four repository skill names, metadata and source docs.
- config: parse and validate safe pull-request CI configuration.
- test: run only the fixed reviewed regression entrypoints and audited units.
- browser --browser system-chromium: explicit installed Cloud Chromium mode.
  browser --browser chromium selects bundled Playwright Chromium; default
  legacy runner behavior remains Edge. No implicit browser fallback/install.
- prisma: isolated engine-free Client generation with environment/network guards.
- typecheck: full backend noEmit with the isolated Client; failures remain failures.
- integrity: unchanged verifyPreparation; frozen digest failure is BLOCKED.
- scan: bounded changed-file sensitive-information patterns; prints metadata,
  never matched values. This is not an exhaustive secret/history scan.

Dependency installation is documented separately: project-local, locked and
ignore-scripts. Commands do not read .env, start the API, migrate, deploy or send
mail. Do not run arbitrary discovered tests or verify-real/verify-live scripts.
Audit new/changed suites before explicit allowlist changes. Preserve DB/network
guards and frozen SQL/schema/profile checksums. Do not waive errors to claim PASS.

Report PASS, FAIL or BLOCKED per check, exact commands, source scope and remaining
risks. Request no production credentials. CI execution and branch protection
require publishing/repository settings; local validation cannot prove activation.
