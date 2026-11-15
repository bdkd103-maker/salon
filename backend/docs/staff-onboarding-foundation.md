# Staff onboarding foundation (Phase 03B.1)

This phase adds dormant infrastructure. No invitation, acceptance, activation,
Staff password recovery, password replacement, tablet/PIN, or Owner UI route is
enabled. No mail is sent. Existing Owner Team provisioning remains unchanged;
its known unsafe linking/status/verification semantics still require a later
reviewed cutover. A feature flag does not secure the old provisioning flow.

## Unapplied migration and deployment gate

`prisma/migrations/20261114010000_staff_onboarding_foundation/migration.sql`
is additive and has **not been applied**. It adds:

- User.authVersion, integer default 0, nonnegative check.
- User.staffPasswordChangeRequired, boolean default false, not enforced or set.
- PasswordReset.purpose, default CUSTOMER_PASSWORD_RESET, constrained to Customer
  and Staff password-reset purposes. Existing rows retain Customer semantics.
- StaffInvitation, status/delivery enums, indexes, checks, and foreign keys.
  Invitations bind salon, initiator, normalized email, optional existing user,
  profile fields, SHA-256 digest of a high-entropy 32-byte secret, generation,
  expiry, delivery metadata, counters, and terminal/consumption timestamps.

A partial unique index on (salonId, destinationEmail) WHERE status=PENDING
arbitrates concurrent writers. Catch P2002 as a conflict, not a check-then-insert
lock. Expired PENDING rows intentionally still reserve the slot. A future resend
or expiry transaction must explicitly transition them before inserting again.
Different salons and historical terminal invitations may coexist. Existing
StaffMembership uniqueness is unchanged.

Before any application: review SQL against the actual deployment schema and
migration chain, PostgreSQL version, permissions, table size and DDL lock budget.
Defaults preserve existing users and pending Customer proofs, but ALTER TABLE
and index creation still need locks. No existing records are rewritten by an
application operation in this phase. The new empty table's uniqueness index
does not require a concurrent index migration.

Apply only through a separately authorized rollout. Regenerate Prisma Client
against this schema before deploying this backend; the current generated client
has deliberately not been regenerated through a CLI that loads environment
files. Old clients do not know PasswordReset.purpose or User.authVersion.
Deploy schema/client/application as a coordinated release; this source must not
be deployed with the old client. No real database constraint execution has been
verified here; mocked persistence and offline schema validation are not a
PostgreSQL integration test.

Invitation salon/initiator FKs RESTRICT physical deletion; optional intended and
accepting users SET NULL. The deletion-policy inventory explicitly classifies
invitations as independent consent history, never an operational cascade.
Before enabling persistence, design the retention/anonymization policy and
physical-deletion interaction. With the feature off and no invitation routes,
this phase creates no invitation records and changes no deletion data.

## Access-token version policy

New access tokens include integer `av` equal to persisted User.authVersion.
Shared required authentication and loyalty's optional authentication compare
it to the persisted account before granting access. Malformed, stale and future
versions fail closed. No increments are performed or exposed in this phase.
Account-status and persisted-role checks remain in force.

Legacy tokens without av are accepted **only when the account remains at 0**
and only until their existing signed expiration (normally 15 minutes after
issuance). There is no artificial extension or hardcoded calendar cutoff.
Old application instances may continue issuing legacy tokens during rollout;
upgrade every issuer and validator before enabling any increments. Missing
User.authVersion in old callers/fixtures is treated as zero solely for staged
compatibility, not a safe invalidation policy with an old generated client.

Refresh rotation and hash-only refresh storage are unchanged. On refresh, the
existing route reloads the user and issues the current version. A future password
change must atomically increment authVersion and revoke refresh sessions; a
version increment alone would not prevent an existing refresh session from
obtaining the new version. Deploy and verify all validators before that phase.
No Staff passwords are replaced and existing sessions are not invalidated now.
The remediation flag defaults false for all existing users and is not enforced.

## Credential proof purposes

The Customer reset service writes an explicit CUSTOMER_PASSWORD_RESET purpose,
checks it plus current ACTIVE CUSTOMER role at resend/confirm/complete, and
scopes invalidation/consumption to that purpose. A Staff-purpose proof cannot
enter the Customer flow. The old Customer HMAC namespaces, proof shape, expiry,
single-use atomic consume, replay protection and refresh revocation remain.
The migration default labels old Customer rows without invalidating their codes.
No Staff reset service/endpoints exist; a future implementation must use distinct
proof namespaces, explicit STAFF status checks and the Staff purpose. Registration
verification and invitation material are separate models and namespaces.

## Rollout controls and email preparation

`STAFF_ONBOARDING_ENABLED` is off unless exactly `true`. There is no route even
when set true. The internal persistence boundary cannot create users,
memberships, sessions, send mail or authorize an Owner. Future controllers must
check persisted actor role, salon ownership, intended user identity/status and
consent before calling it. New/inactive/suspended/deleted account policy is not
implemented here. Never return raw proof or digest in an Owner response.

Email content is pure DE/EN/AR text compatible with the existing transactional
email content shape. It requires an explicit HTTPS `STAFF_ACTIVATION_URL` with
no userinfo/query/fragment and the existing validated email configuration; no
production URL is invented. The future first-party activation page must clear
the URL fragment immediately, exclude third-party scripts, prevent referrer
leaks and POST the proof through redacted logging. No such page is created now.
Never log content, raw proof, digest, provider request, or provider responses.
The template is not connected to the sender. Delivery/resend/rate-limit/outbox,
single-use acceptance, concurrent acceptance and explicit account-holder consent
are later phases, not features completed by this foundation.

## Validation limits

Tests use mocked delegates and synthetic process-local credentials only. Offline
schema validation invokes the installed Prisma WASM schema engine without CLI,
dotenv, networking or DB access. The partial unique index is inspected, and
duplicate/concurrent insert handling is tested with a mock; real PostgreSQL DDL,
foreign-key, lifecycle and concurrent unique-index behavior still need an
explicitly authorized disposable database verification before rollout.

## Phase file manifest

Only these 17 files were added or edited for this phase (other working-tree
changes predate this work and were preserved):

1. prisma/schema.prisma
2. prisma/migrations/20261114010000_staff_onboarding_foundation/migration.sql
3. src/lib/auth-version.ts
4. src/lib/jwt.ts
5. src/lib/auth.ts
6. src/routes/loyalty.ts
7. src/lib/credential-proof-purpose.ts
8. src/lib/customer-password-reset.ts
9. src/lib/staff-onboarding.ts
10. src/lib/staff-invitation-email.ts
11. src/lib/verification-email.ts (export existing content type only)
12. src/lib/salon-deletion-policy.ts (register the new model only)
13. src/lib/salon-deletion-policy.test.ts (new FK inventory expectations)
14. src/lib/staff-onboarding-foundation.test.ts
15. test/staff-onboarding-schema.test.mjs
16. docs/staff-onboarding-foundation.md
17. test/run-foundation-tests.mjs

## Actual validation results

Final backend TypeScript suites ran separately using the project-local guarded
`node --experimental-transform-types test/run-foundation-tests.mjs <suite>` runner.
All delegates are mocked. The guard blocks environment-file loading and points
any accidental DB access to an unreachable process-local fixture. From backend,
the offline schema/policy command is
`node --experimental-transform-types test/run-foundation-tests.mjs --schema-policy`.
Its policy harness replaces only in-memory Prisma DMMF with validated current
schema metadata; it does not regenerate the actual client or execute SQL.

| Backend suite | Passed / failed |
| --- | --- |
| staff-onboarding-foundation | 18 / 0 |
| customer-password-reset (lib) | 6 / 0 |
| registration-verification | 7 / 0 |
| verification-email | 3 / 0 |
| customer-password-reset (routes) | 1 / 0 |
| auth-refresh | 11 / 0 |
| auth-flow | 14 / 0 |
| account-status-security | 22 / 0 |
| owner-team-provisioning | 24 / 0 |
| owner-team-reactivation | 9 / 0 |
| owner-team-queue-access | 7 / 0 |
| loyalty-security | 5 / 0 |
| staff-status | 13 / 0 |
| staff-busy-reminder | 4 / 0 |
| Offline schema + deletion-policy harness | 47 / 0 |

The ordinary deletion-policy suite initially passed 44/45 with the old generated
client: its inventory comparison failed because StaffInvitation was absent from
that client's DMMF. The current schema metadata harness passes all 45 policy tests
plus 2 schema tests. This is not a substitute for regeneration before deployment.
The schema test initially had a mistaken assertion about existing membership
key order; it was corrected to the unchanged [userId, salonId] order.

Frontend commands run from the repository root:

| Command | Passed checks |
| --- | --- |
| node tests/owner-team-authorization.spec.js | 36 |
| node tests/staff-authorization.spec.js | 42 |
| node tests/staff-logout.spec.js | 38 |
| node tests/admin-session.spec.js | 13 |
| node tests/smart-busy-reminder.spec.js | 27 |
| node tests/smart-busy-tabs.spec.js | 3 on retry |
| node tests/staff-localization.spec.js | 306 |

The multi-tab reminder suite timed out on its first execution, then passed all
three checks on a separate retry; no reminder code was changed. All other listed
frontend suites passed. index.html/www/index.html and admin/admin.js/www/admin/admin.js
are byte-identical and were not edited in this phase.

`node node_modules/typescript/bin/tsc --noEmit --pretty false` was also executed.
It fails on existing out-of-scope queue-entry, salon-archive, salon-deletion-policy,
staff-membership test typing and salons.ts price typing. No diagnostics name the
new foundation files or modified authentication/recovery files. Those unrelated
errors were not changed. Scoped `git diff --check` passed.

No environment-file contents, live credentials or hashes were inspected or
printed. The original existing test bootstrap constructs Prisma and may
automatically load .env; initial runs used that bootstrap. After identifying
this behavior, every backend suite listed above was rerun with environment-file
reads blocked by the process-local guard. No migration, database operation,
live email, session reset, commit or push was performed. No version increment or remediation
enforcement is active. No frontend, queue, ServiceVisit, loyalty lifecycle,
notification or reminder implementation was changed. loyalty.ts changes only
its existing optional authentication check.
