# SALO AI development tooling

Setup revision: a8429d368466e38e9a87b4934370220ca4dda91c plus this local
tooling-only batch. No production source, schema, historical migration, frozen
profile or checksum is changed. Local commits are now authorized; push, merge
and deployment remain prohibited without separate approval.

Current validation follow-up (2026-11-15): local commits `b54ff62` preserve the
Staff/configured-day booking fixes, `34e477f` repairs the service price input
contract, and `d940c39` repairs the remaining test fixture types. Full strict
isolated-client TypeScript now passes with zero diagnostics. Historical setup
limitations below are updated where superseded; no release blocker is waived.

## Skills and source of truth

The four supported repository skill directories contain SKILL.md with name and
description frontmatter:

| Skill | Responsibility |
| --- | --- |
| salo-project-expert | Architecture, role/workflow mapping, evidence and owner requirements |
| salo-bug-hunter | Reproduce, narrow root-cause fix, red/green regression evidence |
| salo-feature-developer | Approved vertical slices, authorization, localization and integration |
| salo-quality-gate | Safe validation, source scope, scans and honest failure reporting |

Read AGENTS.md first. Existing salo-development and salo-review skills remain
available and unchanged. The three SALO knowledge/status/backlog documents are
the living code-evidence map; the owner's requests define approved requirements.
File presence is not verification. Code evidence, passing fixtures, deployment
status and unresolved decisions must be described separately.

Run `node scripts/salo-checks.mjs skills` to validate the four skills and source
documents. Open this repository in Codex Cloud or VS Code's Codex client; reload
the client if needed. Request `$salo-project-expert` (or the exact skill name).
Filesystem/metadata validation is automated; this does not claim that every
client version has loaded the skills into its UI. If discovery is unavailable,
explicitly ask the agent to read the corresponding SKILL.md path.

No extensions, MCP server, editor settings, global tools or credentials are
installed. VS Code can discover the package.json npm scripts as tasks. Run them
from its integrated terminal; use npm.cmd on PowerShell if npm.ps1 is blocked.
The existing devcontainer post-start invokes dev-up.sh and may start services;
it is outside these safe checks. Do not invoke it for validation-only work.

## Development-system entrypoints (2026-11-16)

[AGENTS.md](../AGENTS.md) is the durable repository instruction entrypoint.
Use [owner requirements](SALO-PRODUCT-REQUIREMENTS.md),
[project knowledge](SALO-PROJECT-KNOWLEDGE.md),
[system integration](SALO-SYSTEM-INTEGRATION.md),
[feature status](SALO-FEATURE-STATUS.md) and the
[single backlog](SALO-ENGINEERING-BACKLOG.md) together. Keep implementation,
owner decisions, test evidence and historical batch records distinguishable.

The four existing Skills cover integration mapping (project-expert), approved
vertical slices (feature-developer), reproduced defects (bug-hunter) and safe
verification (quality-gate). No duplicate Skill system or extension is needed.
Most recent UI-batch evidence is 131 safe tests, strict isolated-client types
and eight intercepted browser suites; these are not deployment or DB proof.
Documentation-only changes use scoped gates, Skill metadata and local links;
they do not justify starting the API, connecting a database or rerunning live
browser/provider checks. Client UI discovery/reload remains client-dependent.

Consolidation validation on 2026-11-16 rechecked four Skill metadata contracts,
69 local documentation links, 131 safe tests, strict isolated-client types,
CI parsing and a 29-file bounded scan (no findings). Frozen integrity still
refuses CANONICAL_HASH_MISMATCH. No browser/provider/database execution was
needed for this documentation-only run; the earlier eight-suite evidence stays
historical. Local files have not been published to the source branch or proved
to be reloaded in every client.

## Fresh checkout prerequisites

Use Node 24 with npm, Git, and the existing root/backend lockfiles. Dependencies
are project-local and installation hooks are disabled:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix backend --ignore-scripts --no-audit --no-fund
node scripts/salo-checks.mjs prisma
node scripts/salo-checks.mjs skills
node scripts/salo-checks.mjs config
npm --ignore-scripts test
```

Use the configured registry/proxy and normal TLS verification. Do not copy
environment files or credentials into a checkout. No environment variable,
running API, database or mail account is needed for these checks. Disabling
installation hooks means native addons and Prisma generation are not implicitly
executed. Full backend type checking can therefore expose missing/stale generated
client artifacts. The safe Prisma command generates a separate engine-free
Client; typecheck maps imports to it using a temporary config. Neither modifies
the canonical schema/tsconfig or backend/node_modules/.prisma.

Added dependencies are pinned `yaml` for workflow parsing and version-matched
`@prisma/internals` 5.22.0 for offline WASM/schema and generator APIs. CLI, Client
and SDK version mismatch fails closed. Existing Playwright, TypeScript and unit
tooling are reused. No linter or unrelated extension is added.

## Fixed safe commands

| Command (repository root) | Behavior and boundary |
| --- | --- |
| `npm --ignore-scripts test` | Fixed tooling/workflow + booking/rate/opening regression entrypoints, then audited service/presence/loyalty groups. Child processes do not inherit application environment or NODE_OPTIONS. |
| `npm --ignore-scripts run test:tooling` | Tooling and workflow regressions only |
| `node scripts/salo-checks.mjs config` | YAML parser and safe CI contract validation; no GitHub call |
| `node scripts/salo-checks.mjs scan` | Local changed/untracked safe-source static/parity checks and bounded token/key patterns; blocked sensitive paths are not opened |
| `node scripts/salo-checks.mjs scan --base <40-character-SHA>` | Changed files from merge base to HEAD for PR checks; no arbitrary shell ref interpolation |
| `node scripts/salo-checks.mjs prisma` | Fresh isolated engine-free Client via WASM/generator APIs; no downloads, .env reads, native engine or database |
| `node scripts/salo-checks.mjs typecheck` | Isolated Client generation then full backend tsc noEmit via temporary import mapping; compiler failures stay nonzero |
| `node scripts/salo-checks.mjs integrity` | Unchanged verifyPreparation; returns BLOCKED on frozen input mismatch, never rewrites hashes or executes SQL |
| `node scripts/salo-checks.mjs browser --browser system-chromium` | Explicit /usr/bin/chromium for Cloud, intercepted API/asset fixtures only |
| `node scripts/salo-checks.mjs browser --browser chromium` | Explicit bundled Playwright Chromium for CI/local machines where already installed |
| `node scripts/test-browser-mock.mjs` | Retains legacy configured Edge mode; no automatic fallback |

No check installs packages, launches the API, loads dotenv, runs migrations or
contacts a real database/provider. Installed browser modes may need normal
browser OS dependencies; no system changes are performed by the runner.
Bundled Chromium may be installed separately in a disposable CI image using
`node node_modules/playwright/cli.js install chromium`, without --with-deps or
global/system installation. No local automatic download is performed.

The fixed test list is trusted reviewed code, not a sandbox for malicious source.
New test imports/side effects require isolation review. Existing suite pins and
network, WebSocket, service-worker and import guards remain in force. Browser
mode selection does not change suite bytes or pins.

The scan prints file/line/rule, never matched values. It covers common private
keys, provider tokens, signed JWTs and password-bearing database URLs. It is not
an exhaustive secret scan, credential check, history scan or permission to read
.env/private keys. A blocked path requires manual safety review, not exclusion
to make CI green. Sensitive application filenames may require separate review.

## Scoped development gates

Use the existing quality:capture before edits, then quality:fast, quality:finish
and quality:review with the same explicit file list/baseline. See
development-workflow.md. These preserve scope evidence; the new check entrypoint
does not replace them or grant permission to change outside scope. Source
extraction tests provide narrower evidence than real module/DB integration.
For Cloud, pass `--browser system-chromium` to quality:finish; bundled Chromium
uses `--browser chromium`. The default remains Edge. Backend finish checks use
the isolated Prisma/type command; actual compiler errors are FAIL.

## Isolated Prisma generation

Each run creates a new backend/.verification-test-build/offline-prisma-* folder
with a private package.json, schema copy and generated client. Only the copy
gets an output path. The SDK's WASM getConfig/getDMMF and Client Generator APIs
run under offline-tool-guard.cjs in fresh Node processes. Native engine maps are
empty and noEngine is true. The normal CLI is not used because this version
attempts native engine downloads even before handling --no-engine.

The environment contains only platform basics, explicit flags, the guard and a
synthetic nonfunctional datasource placeholder. The guard denies .env reads and
streams, TCP/TLS/HTTP/fetch/DNS, shells and non-Node processes. Successful runs
require receipts with no denied read/network attempts. This is a reviewed-code
guard, not an operating-system sandbox for hostile plugins. No application or
generated Client runtime is executed by type checking.

Artifacts remain in the ignored directory; no existing artifacts are deleted.
Engine-free output is for tooling only: never copy it into the running backend
or deploy it. Runtime/database validation needs separately approved disposable
infrastructure. Frozen hashes and canonical schema are unchanged.

## Pull-request automation

.github/workflows/ci.yml runs on pull requests to salo-cloud-development or
explicit workflow_dispatch. Read-only contents permission, non-persisted checkout
credentials, pinned official actions, Node 24, ignore-scripts installs and three
PR matrix checks: safe tests, browser fixtures and full isolated-client TypeScript.
Frozen integrity is a separate non-deploying job, only on workflow_dispatch;
it remains nonzero when blocked and is never waived. YAML/config and
changed-source checks run before each PR matrix check.
There are no services, secrets, deployment commands, write permissions,
pull_request_target or continue-on-error. Browser CI installs only the bundled
browser in the ephemeral runner; requests from fixture contexts are intercepted.

The formerly empty release-production/staging-release workflow files are now
valid manual placeholders with permanently false job conditions. They expose
no deployment implementation, credentials, checkout or database operations.
No workflow is published by this local setup. Actual Actions execution and branch
protection/required-check settings require a separately approved push and GitHub
settings review. Failing compiler/integrity checks are deliberately visible and
must not be waived to claim release readiness.

## Historical tooling validation and remaining blockers

The following setup/batch records preserve earlier totals and observations.
Use the current entrypoints above and latest feature/backlog evidence for current
commands and scope. The managed-browser provider failure below is historical;
this documentation consolidation does not retest its current service status.

Fresh Client generation resolves generated-type/tooling failures. The queue
test's extensionless import was fixed to .js for NodeNext, and its eight pure
transition tests run in isolation. All 21 subsequently recorded diagnostics
are repaired: service PATCH converts persisted Decimal before merging optional
input, and archive/deletion/membership fixtures retain their runtime assertions
with accurate types and explicit legacy/untyped boundaries. Full strict noEmit
passes; no exclusions, strictness relaxations or continue-on-error were added.
The default safe suite includes four compiler/HTTP service-price regressions.

All 171 affected archive/deletion/membership tests also pass in a separately
reviewed task-local harness with a fixed eight-file import graph, fresh
engine-free Client for Decimal/DMMF only, and offline-tool-guard.cjs. No Client
is constructed, readers are synthetic, and receipts show no env/network attempts.
Harness/log artifacts are ignored under `.verification-test-build/typed-fixtures-*`;
these suites are not part of the fixed default runner. The scoped finish gate
still reports unmapped backend behavior coverage as BLOCKED; explicit fixture
evidence is not a mapping waiver. Do not run arbitrary persistence suites unguarded.

Six intercepted system-Chromium suites pass. Managed real-browser DOM inspection
still fails `Browser Use could not read requirements` on SALO and a script-free
HTTP-200 control page. Native navigation and inventory work; documented
reinitialization after the tool's inactivity reset did not resolve it. This is
outside demonstrated SALO page logic; exact provider dependency is unknown.
No repository/security/configuration workaround is justified by this evidence.
Signed-in end-to-end browser workflows remain unverified.
Step 04 exact-byte integrity fails CANONICAL_HASH_MISMATCH: twelve migrations
are provably newline-only differences; schema raw bytes remain unresolved.
The frozen profile, baseline and historical migrations are not changed here.
SubscriptionPlan label sets match but PostgreSQL/Prisma declaration ordering
differs; no real PostgreSQL validation is claimed. See the engineering backlog
for owner approval dependencies and the setup validation record.

The approved P-BOOK-001 booking policy adds an isolated auth-route regression
suite and an intercepted DE/EN/AR auth-return browser suite. New suite imports,
traffic interception and synthetic verification responses were explicitly
reviewed before adding its pin; existing pins and release hashes are unchanged.
Use the same safe test/browser commands. The scoped browser-suite label and
workflow inventory test include the new seventh suite.

Ordinary cloud development is supported: four referenced skills, 118 safe tests,
seven intercepted browser suites, offline Client generation, passing full types,
scanning and scoped gates. This does not establish release/database readiness.
