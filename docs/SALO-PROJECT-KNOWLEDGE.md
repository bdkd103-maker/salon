# SALO project knowledge

Reviewed 2026-11-15 in Codex Cloud. Repository: `bdkd103-maker/salon`.
Base/source revision: `6d541047ca095c2c6f1acf0d399513c587df9b10` from
`origin/salo-cloud-development`; local review branch: `salo-cloud-work`.
Opening-hours changes from the preceding task are preserved in local commit
`c5cbf3e`; subsequent local batches are recorded below.

## Evidence and scope

This is a code-based map, not production certification. Sources include
`AGENTS.md`, `.github/copilot-instructions.md`, local development/review skills,
package scripts, server registration and route families, runtime helpers,
frontend scripts, Prisma schema/migration SQL, existing tests and release docs.
No application server, database, mail provider or real credentials were used.
No complete visual, native, concurrency or end-to-end audit is claimed.

Owner requirements: SALO serves Germany with Customer, Owner, Staff and Admin
roles; preserve completed features and existing architecture; progressively
repair verified defects. New commercial, scheduling, consent and retention
rules require owner clarification. Code behavior below is not automatically
an approved product rule. Feature evidence is tracked in
[SALO-FEATURE-STATUS.md](SALO-FEATURE-STATUS.md), and work in
[SALO-ENGINEERING-BACKLOG.md](SALO-ENGINEERING-BACKLOG.md).

## Architecture and dependencies

- Web: `index.html` contains customer, owner and staff UI, translations,
  authentication bootstrap and API integration. `women.html` is a separate
  discovery surface; `customer-profile.html` handles customer account UI.
  `admin/index.html`, `admin/admin.js`, `admin/admin.css` form the admin workspace.
- Shared frontend behavior: `assets/smart-core.js`, `smart-busy-reminder.js`,
  `notifications.js`, `loyalty.js`, `salon-extras.js`. Root assets/pages have
  `www/` companions; byte parity matters for web/native consistency.
- Native: Capacitor 8 core/CLI/Android/iOS with push plugin 7 per package
  declarations. `capacitor.config.json` uses `www` and `com.salon.app`.
  Plugin compatibility, signing and device delivery are unverified here.
- API: Node ESM/TypeScript, Fastify 4, Zod validation, CORS, Helmet and global
  rate limiting. `backend/src/server.ts` registers routes and starts listening
  at module load; do not import it into an unisolated test.
- Storage: PostgreSQL, Prisma 5. Runtime routes import a shared Prisma client.
  SQL migrations contain extra checks/partial indexes not fully expressed in
  the Prisma schema. Schema and generated client are separate artifacts.
- Authentication: Argon2 password/refresh-token hashing, jsonwebtoken access
  and refresh JWTs. Email verification/reset delivery uses Resend through an
  injectable fetch transport. Inspecting configuration variable names does not
  establish provider configuration or authorize reading their values.
- Local tooling: TypeScript, tsup, tsx, Playwright, Node test runner and custom
  quality gates. Root `npm test` is an intentional failing placeholder, not a
  meaningful suite. Backend `build` uses `tsup --clean`; it is not type checking.

## Roles and trust boundaries

| Role | Code responsibilities | Important boundary |
| --- | --- | --- |
| CUSTOMER | Discovery, own bookings/tickets/profile/favorites, loyalty and notifications | Ownership comes from authenticated persisted user, not client ids |
| OWNER | Own salon, services, team, operations, analytics and subscriptions | Owner id must match salon.ownerId; admin exceptions are explicit |
| STAFF | Salon-specific duty/presence and service operations | Active, unrevoked StaffMembership links user, barber and salon |
| ADMIN | Platform settings, salons/enforcement/archive, legal, partner requests, catalog and orders | Role is reloaded from persisted user, rather than trusted from JWT alone |

`lib/auth.ts` verifies the access JWT, reloads User, checks account status and
auth version. ACTIVE is normally required; logout, consent and self-deletion
have restricted-account exceptions. `lib/staff-membership.ts` additionally
checks user/barber/salon consistency. Not every route uses the same helper;
authorization must be verified route by route. In particular, booking access
currently uses ownerId even for STAFF, unlike staff operations.

## Database relationships and integrity

- User owns many Salons, Bookings, Sessions, favorites, notification records,
  subscriptions and memberships. Salon owns services, barbers, availability,
  bookings, queue entries, media, loyalty cards and operational state.
- StaffMembership binds User + Salon + Barber; composite relations prevent
  cross-salon booking/visit/membership references. StaffPresence has a generation
  and multiple producer leases; revocation/expiry affect effective availability.
- Booking optionally references Service and Barber and has one ServiceVisit.
  Visit links a staff membership and records IN_SERVICE/COMPLETED/CANCELLED,
  actor ids and version. SQL enforces one active visit per staff member.
- QueueEntry is SALO_TICKET or MANUAL_WALK_IN and optionally links a customer
  and a unique ServiceVisit. Active-ticket uniqueness is a SQL partial index.
- LoyaltyCard -> LoyaltyCustomer balance and LoyaltyStamp ledger. Unique
  transaction ids, card-row locks and conditional balance updates support
  idempotent earning/redemption. Notifications use unique eventKey deduplication.
- SalonEnforcement, SalonArchive, retention holds and purge clearances retain
  scalar evidence independently of the live salon. Deletion is policy gated;
  new models must be classified. StaffInvitation uses restrictive history FKs.
- Registration challenges exist before User creation; PasswordReset and Session
  support account recovery and refresh rotation. Invitation data is a dormant
  foundation, not a completed consent/onboarding workflow.
- PlatformSettings/LegalContent/GlobalOffer and shop Brand/Product/Order tables
  are platform scope, not salon-owned operational cascades.

## Workflows and API map

All paths below are under `/api/v1` unless stated otherwise.

| Workflow | API family and implementation |
| --- | --- |
| Register / recover | `/auth/verification/*`, `/auth/register`, `/auth/password-reset/*`; purpose-bound challenges, rate buckets, delivery states and consumption |
| Session | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/logout`; access expiry 15 minutes, refresh expiry seven days, hashed Session token, conditional transactional rotation |
| Discover / salon profile | `/salons`, `/salons/:id`, services/media/reviews/extras; public projection helper excludes internal owner fields |
| Book / manage | `/bookings`, `/bookings/me`, `/bookings/:id`; service/barber ownership checks, opening validation, overlap query, business transaction plus notifications |
| Ticket / queue | `/salons/:salonId/queue/*`, `/queue/tickets/mine`, owner-team queue reads; state-machine transitions and optimistic/transactional guards |
| Team / operations | `/salons/:salonId/team`, `/staff/me`, duty/presence endpoints, service-visit start/complete; membership and salon checks |
| SMART | Single and batch salon live-status endpoints; backend derives occupancy and ETA, shared frontend displays expiring snapshots |
| Loyalty | `/loyalty/*`; completion-backed earning, reward availability, redemption and activity |
| Communication | `/messages`, `/notifications`, `/notifications/read`, `/device-tokens`, availability-watch endpoints |
| Account / owner | `/profile/me`, `/owner/dashboard`, `/subscriptions/me`, `/analytics/*`, `/favorites/*` |
| Administration | `/admin/dashboard`, `/admin/salons`, platform settings, legal, verification, partner requests, global offers, brands/products/orders |

Refresh reloads the persisted account, checks stored hash/expiry/revocation,
revokes the old Session conditionally and creates its replacement in one
transaction. Logout revokes refresh sessions; current access JWT invalidation
at logout is not implemented by that route. Auth-version increments and staff
password remediation are not enabled by the onboarding foundation.

Booking status code permits PENDING -> CONFIRMED/CANCELLED and CONFIRMED ->
COMPLETED/CANCELLED/NO_SHOW, with admin bypass. Customer mutations are limited
to their own PENDING/CONFIRMED bookings and cancellation/current status.
PATCH performs scheduling validation even for status-only updates; whether this
should block cancellation/completion after schedule changes needs clarification.
Current booking validation rejects all weekends and a fixed 2026 holiday list,
uses client/default Berlin timezone, and rejects overnight salon configuration.
Those rules differ from the weekly schedule/live-status model.

Queue active states are WAITING/CALLED. Starting links a visit; terminal queue
states do not imply completed service. ServiceVisit completion and booking
completion feed the existing loyalty ledger rather than a second rewards system.

SMART availability requires current lease evidence and no active visit.
`smart-wait-data.ts` loads real salon-scoped configuration, queue lengths,
memberships and service durations. The pure engine returns CLOSED,
WALK_IN_DISABLED, STAFF_STATUS_UNCONFIRMED, AVAILABLE_NOW, ESTIMATED_WAIT or
WAIT_UNKNOWN. Unknown active-visit duration is not invented; unassigned walk-ins
can therefore have unknown ETA. Staff capability mapping is absent; eligible
staff are treated as interchangeable lanes. Snapshots expire within 15 seconds
and may expire sooner with a lease. Frontend caches and polls batch requests.

## Frontend, communication and localization limits

Frontend uses localStorage for language/session/bootstrap/cached application
state alongside real API calls. Older meshwar names remain internal storage keys.
Client state is not an authorization boundary. DE/EN/AR translations and RTL
behavior exist in several independently maintained surfaces; responsive layouts
and translation completeness have not been visually verified in this task.
Device-token storage and native notification registration are implemented;
an operational FCM/APNs delivery path is not established by those files.

## Known conflicts in documentation and release evidence

`docs/mobile-production-checklist.md` still says there is no backend/database;
that is contradicted by current routes and schema. Treat its old validation and
prototype claims as historical, not current evidence. README/mobile build
instructions are not authorization to run signing, installs or deployments.

`release/README.md` documents the canonical migration order failure: QueueEntry
references ServiceVisit before the latter's migration creates it. A separate
clean-install baseline exists; equivalence to upgrades is not proven here.
No canonical migration was edited or applied. The staff-onboarding document
also calls out an unapplied migration and stale generated-client limitations;
actual deployment schema is unknown because no database was inspected.

## Validation boundary and progress

Use the local SALO development/review skills and `docs/development-workflow.md`.
Capture safe-source scope before edits. The gates inspect scope/parity and run
only audited tests; never automatically refresh changed suite hashes.
The new targeted regressions evaluate selected source in VM contexts, without
importing server startup or Prisma. Rate-limit and booking POST fixtures also
use Fastify inject, with a synthetic key or explicit fake persistence reads.
They are trusted-code tests, not a sandbox
for malicious source, and do not prove database or deployed behavior.

Preserved batch H01: overnight opening-day fix, nine new cross-implementation
tests and 18 existing hours tests passed in the preceding task. Full-project
TypeScript failed before those edits; browser/pure-unit runners were blocked by
existing pinned-suite mismatches. Current-task batches and exact check evidence
are maintained in the backlog, including unsuccessful checks.

Batch R01: global rate-limit identity now uses the shared access-token verifier,
not unsigned payload decoding. Six isolated tests pass, including Fastify inject
rate enforcement against rotating forged subjects. This verifies the rate-key
boundary only; route authorization still checks persisted account data.

Batch B01: daytime booking containment now compares full salon-local dates,
preventing bookings across closed nights even when both clock times fit.
Nine tests pass, including the existing two time-helper tests and the actual
route's pure validation function. Together H01/R01/B01 pass 24 tests locally.

Batch B06: missing/unparseable date components now reach existing invalid-window
validation rather than throwing before it. The booking suite now has 12 passing
tests, including POST 400 responses and zero booking access in a fake-store
fixture. Calendar rollover and DST/offset edge cases are not resolved by this.

## Systematic audit coverage

| Area | Evidence reviewed / demonstrated | What is still unverified |
| --- | --- | --- |
| Runtime/build | Full-project tsc fails; B06 reproduced parser exceptions and tests corrected invalid-input handling | Complete build and runtime initialization; native build |
| Auth/session | Persisted-role/status/version checks, JWT/refresh/session code traced; R01 forged-key bypass reproduced and fixed | All login/reset/logout race and browser scenarios |
| Tenant isolation | Ownership/membership helpers and route filters traced; booking STAFF discrepancy recorded | Exhaustive role x endpoint x cross-tenant API matrix |
| Booking/conflicts/cancellation | B01/B06 red/green tests; count-before-transaction race and status-only validation recorded | Database conflict enforcement, capacity/cancellation policy |
| Queue consistency | Transition helper/routes and SQL partial/composite constraints reviewed | Concurrent transitions, rollback and actual SQL constraints |
| SMART/ETA | Pure engine and real-data adapter traced; H01 retained and tested | Full engine/property/persistence suite, device live-state rendering |
| Migrations | Ordered SQL and release audit identify forward FK dependency | Clean install/upgrade equivalence and actual deployed schema |
| Frontend/API | Page/shared-module route usage and root/www mirrors reviewed | Real backend browser contract, delayed requests/session changes |
| Responsive/localization | DE/EN/AR, RTL, responsive assets and browser tests present | Viewport/keyboard/device execution; audited runner hash mismatch blocks suite |
| Regression coverage | New isolated red/green rate/booking tests and preserved opening-hours suite | Full-project type checking and audited full-suite results remain non-passing |

Final local evidence: 27 targeted tests and strict booking-helper TypeScript
checking pass. Fast scope/syntax and review checks pass; the finish gate is
BLOCKED and full-project TypeScript fails. Existing browser/pure-unit hash
mismatches are confirmed with guard checks only. The backlog records commands,
red/green counts, current limits and next dependencies for each completed batch.

## Preservation and validation follow-up

The owner subsequently authorized local commits only. Reviewed fixes/docs/tests
were preserved in `c5cbf3e8207b5e8376219caea5f1bf78c76b3e71` after 27 passing
regressions and zero findings in an 11-file staged-source pattern scan. Ignored
files/history were excluded; this was not an exhaustive secret audit.

V02 isolation review found genuine stale service/admin-session pins and
CRLF-dependent presence/loyalty pins. Reviewed versions are explicitly repinned;
only CRLF is canonicalized for hashing, without decoding/altering other bytes.
Ten workflow and 27 audited pure-unit tests now pass. Browser guard checks pass,
but actual suites configure headless Microsoft Edge, absent here; no fallback
to available system Chromium was performed. Full-project tsc still fails.

V02 was preserved in local commit `5d9850f`. B07 subsequently adds numeric-range
and calendar month/day round-trip checks before timezone conversion, preventing
Date.UTC rollover from silently changing a requested booking. Fourteen booking
tests pass (29 application regressions total), including malformed-input HTTP
400 coverage with fake persistence and zero booking access. Legacy year 0-99,
full grammar and DST/offset behavior are not solved by these checks.

## AI development tooling source of truth

See [SALO-AI-TOOLING.md](SALO-AI-TOOLING.md) for the four new repository-scoped
skills, fixed safe commands, installation policy, browser modes and PR checks.
Root npm test now invokes the safe suite rather than the old placeholder.
VS Code can use these npm scripts without new extensions; Codex clients may
need reload to discover SKILL.md files. Existing two skills remain unchanged.

The safe suite passes 72 tests and six intercepted browser suites pass in
explicit system Chromium mode, including in a fresh local clone with locked
ignore-scripts installs. The workflow parses as YAML and enforces read-only,
non-deploying jobs. TypeScript and frozen preparation remain non-passing and
are separate visible CI checks. No source/schema/SQL/profile integrity rewrite
is part of tooling setup. GitHub execution/branch protection is not activated
without a separately approved push/settings change.

The environment completion adds AGENTS skill links, real offline Prisma Client
generation via version-matched WASM/Generator APIs, and explicit browser support
in the scoped gate. Copied schema/client/type config stay in ignored disposable
folders; env reads/network/native engine execution are denied. The canonical
schema, migrations, profile, runtime client and backend tsconfig are unchanged.
One test-only NodeNext import was corrected. Eight existing pure queue tests
are included in isolation, bringing the safe suite to 86 passing tests.

Fresh generated types resolve the tooling defect; 21 genuine source/test type
errors remain documented in the backlog. The frozen preparation refusal stays
enforced as a separate release gate. All three workflows are now syntactically
valid: ordinary read-only PR checks and permanently disabled manual release
placeholders. Local config is ready for publication review, not yet pushed.
