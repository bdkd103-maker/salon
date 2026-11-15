# Staging Step 02: release snapshot and packaging

This prepares a **blocked source candidate**, not a deployment. Nothing in this
directory starts a service, applies migrations, sends mail, or publishes a URL.
Application/authentication/queue/reminder behavior is unchanged. Staff onboarding
remains inactive. Existing modified/untracked files must not be discarded.

## Files and review boundary

- `manifest.json`: current exact allowlist of 137 build-context inputs: 40 www files,
  60 backend runtime source files, four build inputs, schema plus 25 migration SQL
  files plus migration lock, and six packaging/preparation files. The original
  Step 02 snapshot had 134 inputs; Step 04 adds three preparation inputs.
- `../scripts/release-package.mjs`: built-in Node modules only. Validates source
  inventory, root/www bytes, literal HTML local references, literal backend
  imports, package/lock declarations, dependency sources, and structural DDL.
- `Dockerfile`: proposed multi-stage Linux build; not executed in this step.
- `context.dockerignore`: extra exclusions for the generated context.
- `../tests/release-package.test.mjs`: isolated packaging regression tests.
- `working-tree-inventory.json`: paths, classifications, Git status, source-file
  digests and migration audit only; no configuration values or file contents.

The original working tree had **53 modified + 568 untracked = 621 entries**.
The inventory identifies every required changed/missing-from-checkout file and
also retains classifications for excluded tests, docs, native tooling, temporary
diagnostics, and sensitive/credential tooling. No untracked file was deleted or
treated as disposable. Credential/bootstrap tools and environment files are
excluded without inspection. Source files whose names mention credentials or
password reset are application code, not automatically classified as secrets.

There are **67 pre-existing required untracked/ignored application/migration or
root-mirror paths**, plus three new packaging-context files, giving the tool's
70 required paths absent from a clean checkout. Root companions are inventoried
for parity, but only www copies enter the context. Examples include Admin assets,
Owner Team and Staff routes, onboarding/version helpers, loyalty/notification/
SMART WAIT helpers, reminder assets, legal pages, and the eight SQL files below.
The inventory also lists 33 required modified paths whose current contents would
be lost by building only the committed revision. See its exact path lists rather
than assuming a Git clone represents this working application.

## Safe local commands

Run from the repository root with Node 24:

```text
node scripts/release-package.mjs validate
node scripts/release-package.mjs prepare
node scripts/release-package.mjs build-local
node --test tests/release-package.test.mjs
```

`validate` is read-only. It currently returns exit code 1 for the confirmed
migration-order blocker, while reporting `manifestValid: true`. It must not be
interpreted as deployment approval.

`prepare` copies only exact allowlisted files into a fresh UUID directory under
`.verification-test-build/release-*/context`. It never overwrites or removes an
existing candidate. Adjacent `inventory.json` records input hashes and Git state.
The context contains no repository root checkout, node_modules, environment files,
tests, credential tools, temporary diagnostics, or local databases. A changed
file during copying is rejected; links and unsafe paths are rejected.

`build-local` additionally invokes already-installed tsup against that isolated
source context with a restricted process environment. It installs nothing,
never loads the application/Prisma client, and writes its log/result beside the
context. It is **not a clean dependency install or Linux build**, and it never
creates a deployable-runtime claim. No source maps or existing dist artifacts
are imported. Both candidate commands explicitly record deploymentReady=false.

Only public `www` may become the future web document root. `/app/backend`, source,
migrations, inventory and package files are never a web document root. A separate
protected gateway is still required; the recipe currently runs an API only.

## Runtime image design (future authorized build only)

Build Docker only with the generated context, **never `docker build .` from the
repository root**. The recipe installs lockfile-resolved dependencies inside a
clean Linux image, copies reviewed schema/source, generates a fresh Linux Prisma
client, and compiles the backend. Generation does not apply migrations or connect
to any database. It preserves the generated client before pruning dev dependencies.

The non-root runtime image contains www, dist, production dependencies, generated
Prisma client/engine, package metadata, schema and the full migration chain.
It excludes backend source/tests and build toolchain. It installs Linux OpenSSL/
CA support within the image; nothing is installed on the host by these files.
It contains no database URL, JWT/email keys or live credentials. No host
node_modules or stale Windows Prisma binaries are copied. Runtime startup is
only `node dist/server.js`, with onboarding disabled by default. EXPOSE is image
metadata, not a command publishing a port.

The image recipe is unverified. Node base-image tags and OS packages are mutable;
review/pin image digests before treating a build as reproducible. Dependency
downloads/install scripts and Linux native-library compatibility still require
an explicitly approved clean build environment. Do not run this recipe or start
a container as a side effect of packaging review.

## Migration inventory

All 25 directories are in the manifest, ordered by their Prisma directory names.
The first 17 are tracked; these eight SQL files are untracked and are included:

1. 20260914120000_add_legal_content
2. 20260914130000_admin_features_expansion
3. 20260915120000_add_platform_settings
4. 20260926120000_notification_read_state
5. 20260927120000_add_customer_favorite
6. 20260929120000_loyalty_ledger
7. 20260930120000_add_salon_extras
8. 20261114010000_staff_onboarding_foundation

**Confirmed blocker:** 20260909231832_queue_entry_foundation adds
QueueEntry_serviceVisitId_fkey referencing ServiceVisit before
20260910130000_service_visit_foundation creates ServiceVisit. PostgreSQL cannot
apply that FK to an absent table in normal empty-database migration order.
No migration was edited, reordered or applied here. An additional later
compensating migration alone cannot repair failure in an earlier migration.
Review a fresh-install/history compatibility strategy separately; do not rewrite
possibly applied SQL or change existing checksums without that review.

Special data-change review:

- 20260903120000: updates Salon classification/VIP state.
- 20260915120000: inserts the singleton PlatformSettings row.
- 20260926120000: backfills Notification.readAt from createdAt.
- 20260929120000: ledger defaults/checks affect existing loyalty rows.
- 20261114010000: adds User version/remediation defaults and reset purpose,
  plus StaffInvitation CHECKs, FKs and partial pending uniqueness.

The static audit finds all current model scalar columns represented in SQL,
including authVersion, staffPasswordChangeRequired, reset purpose and invitation
fields. Offline Prisma schema/policy tests pass. This does **not** prove complete
type/default/index equivalence, SQL replay success, or applied-database checksum
compatibility. Existing database state was not inspected. Phase 03B.1 legacy
version-zero compatibility, false remediation default, Customer purpose default,
and invitation partial uniqueness remain unchanged. Existing generated Prisma
Client remains stale; no regeneration was performed against any database.

## Actual validation and remaining blockers

- Packaging regression tests: 9/9 passed.
- Complete manifest, literal local imports/links, lockfile sources/declarations,
  source-copy digests and 40/40 root/www parity: passed.
- Static migration validation: FAIL, one confirmed forward reference above.
- Backend guarded/mock suites: foundation 18, refresh 11, provisioning 24,
  account status 22, Staff status 13, schema/policy 47: **135/135 passed**.
- Frontend suites: Owner Team 36, Staff Authorization 42, Staff Logout 38,
  Admin Session 13, Reminder 27, Staff Localization 306: **462/462 passed**.
- Isolated Windows build: attempted twice, FAILED. tsup/esbuild reports access
  denied while scanning an ancestor directory and cannot resolve its entry point.
  Using explicit entry/tsconfig paths did not resolve it; permissions were not
  broadened. Logs remain in each unique ignored candidate workspace.
- Clean Linux build: NOT VERIFIED. Docker unavailable; WSL enumeration returned
  E_ACCESSDENIED. No tools were installed or host configuration changed.
- Node syntax checks for the new packaging script/tests passed. Whole-tree
  `git diff --check` reports pre-existing trailing whitespace in
  customer-profile.html:1282 and its www mirror; these were left unchanged.
- All ten declared runtime dependencies are present locally and represented in
  the lockfile. Clean Linux installation, generated engine, Argon2 loading and
  end-to-end runtime behavior remain unverified. No complete runtime image or
  successful backend build output was produced.

The package validator is deliberately narrower than a secret scanner: it rejects
sensitive paths and never reads environment/credential files, but cannot prove
that arbitrary reviewed application text contains no embedded sensitive value.
Generated local inventories are private review artifacts and are not web assets.

Next step: review this snapshot and approve a separate migration-history repair
design plus a disposable Linux build/empty-database verification plan. Preserve
existing records and migration checksums. Only after those pass should a separate
step implement the protected staging gateway, synthetic fixtures, secrets-manager
configuration and hosting deployment. No deployment, migration, email, onboarding
activation, database mutation, commit, push, reset, clean or stash occurred here.

## Step 04: offline clean-install preparation

New inputs are `clean-install/baseline.sql`, `clean-install/profile.json`, and
`../scripts/bootstrap-empty-staging.mjs`. The release manifest now includes these
three files explicitly. `../tests/bootstrap-empty-staging.test.mjs` covers their
integrity and guard behavior; it is a review/test input, not a runtime web asset.
The Step 02 working-tree inventory is preserved as a historical snapshot.

### Baseline derivation and completeness

The baseline contains every statement from all 25 canonical migration files,
normalized only for line endings/comments, and moves exactly one statement:
QueueEntry_serviceVisitId_fkey is installed after the ServiceVisit migration
instead of before it. No canonical SQL file was edited. A transaction and explicit
public search path wrap the baseline. The existing ALTER TYPE SMART addition
remains in the transaction; execution and enum semantics must be verified on
PostgreSQL 16 before any use. No database was contacted during preparation.

Offline checks inventory 44 tables, 22 enums, 44 primary keys, 57 foreign keys,
14 CHECK constraints and 64 explicit indexes, including all three partial unique
indexes. Column SQL definitions retain types, nullability and defaults. All three
historical data statements remain: VIP backfill, platform-settings singleton
insertion and notification read-state backfill. On a fresh database, the two
backfills have no existing rows to change. No fixture accounts are inserted.

The profile freezes raw SHA-256 digests of all 25 SQL files, the canonical schema,
migration lock and baseline. It includes the detailed object inventory and the
required real-database verification checklist. Raw-byte hashing is intentionally
stricter than Prisma's LF/CRLF-compatible checksum matching: a changed checkout
line ending fails closed and requires review, never automatic profile rewriting.
The generated packaging context preserves the exact original file bytes.

One pre-existing schema alignment difference is explicitly recorded:
SubscriptionPlan is FREE, SMART, PRO, PREMIUM in canonical PostgreSQL history,
but FREE, SMART, PREMIUM, PRO in schema.prisma. The baseline preserves canonical
database ordering, not a silent behavior change. All Prisma model scalar fields
and enum values are represented; full type/default/index/catalog equivalence is
not claimed. Resolve or approve this ordering difference before asserting such
equivalence or enabling an executor. A schema-only baseline would also lose
handwritten CHECKs/partial indexes, so it must not replace this reviewed SQL.

### Guarded command: dry-run only, no database connector

The command requires explicit disposable-staging selection and identity metadata:
`--disposable-staging`, `--host`, `--port`, `--database`, `--user`, `--cluster-id`,
and `--database-oid`. It accepts no URL, password, connection-string file, profile
path override or environment-derived target. No arguments means refusal, not
fallback to a developer database. Database/user names must use the dedicated
`salo_staging_disposable_` and `salo_staging_bootstrap_` prefixes with an 8–24
character lowercase/digit suffix. Schema is fixed to public.

An explicitly selected target produces only an offline dry-run plan. Target
details are not logged: output contains a deterministic identity fingerprint,
baseline digest and counts, with databaseInspected=false and
databaseEmptinessVerified=false. The command imports only Node fs/path/crypto/url;
it never reads process.env, loads dotenv/Prisma, opens a network socket, starts a
subprocess, applies SQL, or records migration history. --apply and
--approve-execution are unconditionally refused. Approval flags alone cannot
enable database operations. No executor exists in this phase.

The exported inspection boundary is used with mocks only. It rejects mismatching
host/port/database/user/schema/cluster system identifier/database OID, non-PG16,
superuser or non-owner roles, extra schemas/extensions, any user relations/types/
routines/events/publications/subscriptions/foreign servers/default privileges,
large objects, or any existing Prisma history table—even an empty one. Missing
catalog evidence fails closed. Only public and the standard plpgsql extension
are accepted. Success indicates eligibility for future review, never permission
to write. Real adapters and catalog queries are deliberately not implemented.

A future approved executor must validate the provisioner's identity receipt,
use an isolated disposable target with exclusive access, verify catalog coverage
(including objects outside public), and recheck on the same guarded connection/
transaction before writes. Advisory locks alone do not exclude uncooperative
clients. Concurrent creation, target substitution and interrupted history
reconciliation require real tests. No automatic destructive cleanup is provided.

### Release/tooling separation and actual tests

Dockerfile has a separately selected `migration-tools` target with unpruned pinned
Prisma tooling and these preparation files. Building it does not run the command.
Its entrypoint can only dry-run/refuse. The final ordinary runtime image excludes
the baseline and bootstrap command; startup remains node dist/server.js, with
Staff onboarding disabled. No image was built or run in Step 04.

Run offline tests from the repository root:

```text
node --test tests/bootstrap-empty-staging.test.mjs tests/release-package.test.mjs
node scripts/release-package.mjs validate
```

Actual result: **21/21 tests passed**, with no database access. Tests cover exact
statement preservation, all 25 original digests against Step 02, object inventory,
Prisma field/enum coverage, tampered inputs, target/catalog refusals, dry-run,
apply refusal, no target inference/environment-file loading or database startup,
and release/runtime separation. Syntax checks passed. Packaging validation shows
137 complete inputs and verified offline preparation, but still returns exit 1
for the unchanged canonical forward-reference defect. It reports
canonicalReplayRemainsBroken=true, postgresqlVerified=false and
deploymentReady=false; these failures/limitations must not be hidden.

### Next validation step (requires separate approval)

Use fresh isolated PostgreSQL 16 instances only, with no developer environment
files or existing volumes. Verify original replay failure, a corrected disposable
reference replay, this baseline transaction, and complete catalog equivalence.
Test the enum-order finding and every handwritten constraint/index invariant,
plus identity/emptiness/concurrency/crash guards. Independently verify schema
equivalence before approving any future marking of historical migrations as
satisfied. Real execution, history reconciliation, production upgrades and
destructive cleanup remain unimplemented. Canonical replay and shadow replay
remain broken; clean Linux build and staging access protection remain unresolved.
