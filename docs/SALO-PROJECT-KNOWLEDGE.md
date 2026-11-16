# SALO project knowledge

Consolidated 2026-11-16 in Codex Cloud. Repository: `bdkd103-maker/salon`.
Base/source revision: `6d541047ca095c2c6f1acf0d399513c587df9b10` from
`origin/salo-cloud-development`; local review branch: `salo-cloud-work`.
Opening-hours changes from the preceding task are preserved in local commit
`c5cbf3e`; subsequent local batches are recorded below.

The development source was fetched again and verified at `6d54104`; current
task HEAD is `b0fec5de6142d2d42d8d013879fc67fc723cf762`, a descendant, with
23 pre-existing changed files preserved before consolidation. No branch switch,
merge or publication is implied. Historical batch results below remain dated
evidence; the current work queue is the first ordered table in the backlog.

Start with [owner requirements](SALO-PRODUCT-REQUIREMENTS.md), the
[cross-system integration map](SALO-SYSTEM-INTEGRATION.md),
[feature status](SALO-FEATURE-STATUS.md),
[one backlog](SALO-ENGINEERING-BACKLOG.md), [AGENTS.md](../AGENTS.md) and
[safe tooling](SALO-AI-TOOLING.md). The integration map connects every role to
Booking, Walk-in, QueueEntry, ServiceVisit, SMART Core/ETA and downstream effects.

## Current consolidation validation — 2026-11-16

This documentation/Skill task rechecked 131 safe tests, strict backend noEmit
with fresh engine-free Prisma generation, four Skill metadata contracts and
safe CI configuration. It checked 69 local Markdown links across the 11 scoped
files and found no issues. The bounded scan of 29 changed safe files found no
matches. No application code, existing test pins, database, .env, provider,
historical migration, frozen profile/hash, deployment or Git publication was
changed by this task. Skill metadata does not prove client reload/discovery.
The eight browser suites remain prior UI-batch evidence, not a new live run.
Frozen integrity was rechecked and remains BLOCKED: CANONICAL_HASH_MISMATCH.

## Evidence and scope

This is a code-based map, not production certification. Sources include
`AGENTS.md`, `.github/copilot-instructions.md`, local development/review skills,
package scripts, server registration and route families, runtime helpers,
frontend scripts, Prisma schema/migration SQL, existing tests and release docs.
The original source audit used no application server, database, mail provider
or real credentials. Later disposable runtime evidence is recorded below.
No complete visual, native, concurrency or end-to-end audit is claimed.

Owner requirements: SALO serves Germany with Customer, Owner, Staff and Admin
roles; preserve completed features and existing architecture; progressively
repair verified defects. New commercial, scheduling, consent and retention
rules require owner clarification. Code behavior below is not automatically
an approved product rule. Feature evidence is tracked in
[SALO-FEATURE-STATUS.md](SALO-FEATURE-STATUS.md), and work in
[SALO-ENGINEERING-BACKLOG.md](SALO-ENGINEERING-BACKLOG.md).

Owner-approved booking decision P-BOOK-001 now requires an authenticated
Customer before booking submission; guests cannot book. See
[product requirements](SALO-PRODUCT-REQUIREMENTS.md). This supersedes earlier
B08 guest-policy questions preserved in the historical batch records below.

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
  quality gates. Root `npm test` invokes the fixed reviewed safe suite through
  `scripts/salo-checks.mjs`; it is no longer the prototype placeholder. Backend
  `build` uses `tsup --clean`; it is not type checking or an offline safe check.

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
authorization must be verified route by route. Booking listing now uses active,
unrevoked StaffMembership for STAFF; booking mutations retain their earlier
owner-id check pending a separate permission decision.

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
Booking validation now honors a nonempty persisted workingDays list, including
configured Saturday/Sunday and closed weekdays. Missing/empty legacy schedules
retain weekday acceptance and weekend rejection. The fixed 2026 holiday list,
client/default Berlin timezone and overnight-configuration rejection remain;
these still differ from the full weekly schedule/live-status model.

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

## Verified runtime booking corrections (2026-11-15)

Starting checkout: clean `1f8f12e427261969a031fc9b508f54a0105e2ed8`,
`salo-cloud-work`, verified SALO origin and required snapshot ancestry.

- Owner request: investigate the three demonstrated runtime issues, repair
  clear contracts, preserve authentication when guest policy is unclear.
- Code contract for Staff reads: GET `/bookings` already admits STAFF;
  `owner-team.ts` queue reads use ACTIVE/unrevoked salon membership, and schema
  constraints bind membership user/salon/barber. The listing now uses that
  persisted membership predicate instead of requiring Staff to own the salon.
  It does not grant membership-based PATCH/DELETE permissions or add a Staff UI.
- Code contract for configured days: `salon-schedule.ts` accepts all seven day
  keys, Owner configuration persists them, and opening-state helpers use them.
  Booking validation now checks the explicit day list in the existing booking
  timezone. No holiday list, missing-schedule fallback, clock/DST/overnight rule,
  conflict strategy or cancellation rule was redefined.
- Evidence: 15 new isolated source/Fastify regression tests (8 red before the
  fix, all green after), 14 existing booking tests, and 18 passing real HTTP
  assertions against the patched backend with synthetic PostgreSQL data.
  Real checks include cross-salon Staff read isolation, Saturday creation,
  Owner confirmation, Customer cancellation and unchanged guest/Staff denials.
- Runtime boundary: original disposable PostgreSQL 16 cluster identity was
  reverified; network none, tmpfs data, no published ports or existing volumes,
  synthetic roles only. Backend uses an explicit disposable Unix-socket DSN,
  sanitized process environment and guards against .env/outbound Node access.
  A fresh source copy preserves the earlier runtime snapshot. Schema-derived
  initialization is not release-baseline or custom migration-constraint proof.
- Full safe suite: 101 tests pass. Six intercepted Chromium suites pass.
  Browser DOM automation still fails `Browser Use could not read requirements`;
  signed-in Customer/Owner/Staff/Admin UI flows remain unverified. API results
  and intercepted fixtures do not substitute for those end-to-end flows.
- Full isolated-client TypeScript still has 21 previously recorded diagnostics
  outside the changed booking route. Frozen preparation still requires its
  separate integrity gate; no historical SQL/schema/profile changed.

Historical B08 finding, superseded by P-BOOK-001: bookingTip promised no
registration while the submit handler required a Customer session and complete
profile. No authoritative guest policy was available to that earlier batch,
so it preserved copy/auth and requested an owner decision. The current approved
account-required policy and implementation are recorded below.

## TypeScript follow-up: service price adapter

Booking fixes are preserved in local commit `b54ff62`. The first compiler batch
converts the persisted Prisma Decimal price to Number before merging a partial
service update. Explicit request price, including zero, still wins; normalization
already converted prices with Number, so this repairs the declared input contract
without changing rounding, defaults or authorization. One compiler regression
failed before the patch; all four compiler/HTTP fixture tests pass afterward.
Full generated-client TypeScript drops from 21 to 20 diagnostics, all in test
files. No confirmed price-loss runtime defect is claimed.

## TypeScript completion and browser investigation

Service adapter commit: `34e477f`. All 21 original diagnostics are now resolved:
one application contract mismatch and 20 test-code errors. Full isolated-client
`node scripts/salo-checks.mjs typecheck` exits 0 with no diagnostics, unchanged
strictness, include/exclude configuration and production archive/deletion logic.
Test fixes derive fixture types from actual helper signatures, assert optional
archive content exists, and use explicit test-only runtime boundaries for V1
legacy boost input and deliberately untyped policy arguments. No assertions were
removed or suppressed; the V1 wrapper always selects versions 1/1.

The three affected suites pass before and after: archive 113, deletion policy 45,
Staff membership 13 (171 tests). Execution uses the existing offline preload,
a fresh engine-free generated Client only for Decimal/DMMF, and an import hook
restricted to the eight reviewed fixture/helper files. No PrismaClient is
constructed; source-loader database methods receive synthetic reader objects.
Guard receipts contain no network/env-file attempts. The task-local harness and
logs remain in ignored `.verification-test-build/typed-fixtures-*`; these suites
are not silently added to the default 105-test safe runner or its pinned groups.

Managed-browser investigation: inventory/native Chromium remain usable. After
the tool reported an inactivity kernel reset, handles were reinitialized using
its documented API. SALO DOM inspection still fails `Browser Use could not read
requirements`. A script-free HTML control served by the same isolated frontend
returns HTTP 200 and opens with the expected browser title, yet the identical
DOM request fails there too. No application scripts, auth or DB code run on that
control page. The error string is absent from application/tooling source.
This isolates the failure outside SALO page logic; the exact managed-service
dependency remains unknown. No safe repository correction is demonstrated.
The SALO preview was restored; signed-in browser flows remain unverified.

## P-BOOK-001 implementation

The main booking drawer and women's booking modal explain the account-required
policy in DE/EN/AR, with matching root/www pages. Booking-triggered login and
registration show the same requirement. Public discovery remains anonymous.

POST `/api/v1/bookings` now checks persisted CUSTOMER role immediately after
the existing signature/account/authVersion guard, before payload or booking
access. Owner/Staff/Admin accounts cannot create customer bookings by claiming
Customer in a token. Existing management routes and PENDING creation remain.

The existing in-page auth modals retain booking context and form fields in
memory. Successful Customer login/verified registration reopens the drawer;
no automatic booking submission or retry. Booking consent is reset on entering
auth. Failed login leaves the selections; API 401 opens the same return flow.
Language-driven service/barber rendering retains only still-valid option IDs.
The women's existing handoff restores supported date/time, notes and recognized
service options; its generic service labels still require a real service choice.
No new persistent draft, personal-data storage or authentication system was added.
Full reload and separate profile-edit navigation do not acquire draft persistence.
Explicitly cancelling the auth modal or logging out clears the continuation;
an ordinary later login must not reopen an old booking. Switching between
login/registration and completing authentication retains the continuation.

Validation: 118 default safe tests pass, including 13 new actual JWT/auth/route
fixtures; 53 existing booking-security tests pass with Prisma replaced by an
inert mock and network/env guards. All seven intercepted browser suites pass;
the new suite covers 22 root/www DE/EN/AR scenarios, including login/verified
registration return, cancel, wrong-role/failed login, API-401 reauth and supported
women handoff. Strict isolated-client TypeScript passes without diagnostics.
This is intercepted frontend plus isolated route evidence, not live full-stack
database/browser certification. Existing release and managed-browser blockers
are unchanged.

## Admin design reference and UI boundaries — 2026-11-15

Owner-approved task requirement: the existing standalone Admin Panel is the
official reference for other control panels; it is not being redesigned.
`admin/admin.css` defines Segoe UI/Arial, gold #e5bc70, border #353839, muted
#a7aaae, dark surface #111416, 9px controls and 10px cards. The scoped shared
`assets/control-panels.css` applies these to existing Owner/Staff dialogs and
Customer account controls; its www copy is identical. Public discovery retains
its existing styling; only dialog stacking/focus is shared there. Owner already
had a largely Admin-derived structure; Staff used those classes without the
Owner-only rules. Role layouts and existing API/authorization contracts remain.

Root/www Women use their existing dictionaries, boolean classifier, price
classifier and operating-state helper. Corrected literal category matching and
normalized supported aliases; open-now now requires a known open schedule.
`womenApiLoaded` plus an explicit failure flag preserve existing skeleton/error
components across rendering. Retry calls the existing live salon loader; a
failed load is no longer presented as a genuine empty directory. Existing
Customer authentication policy P-BOOK-001 and form handoff remain unchanged.

Evidence boundary: isolated Chromium fixtures serve actual pages/styles with
all HTTP fulfilled locally or aborted, WebSockets denied, nonpersistent contexts
and synthetic accounts. Tests compare computed values with the unchanged Admin
stylesheet and exercise keyboard/pointer reachability at 390/768/1440 in all
three languages and both copies. These are not real DB/API end-to-end tests.
External CDN font/icon availability, populated data extremes, every legacy
management surface, real notifications and native devices remain unverified.
Admin's English-only UI and ambiguous Women evening/morning/price-band and
unisex-classification language remain backlog questions, not invented policy.

Validation for U01/W01: 127 safe tests pass (100 root regressions plus 27
audited backend units); strict backend TypeScript passes with fresh engine-free
Prisma generation, no environment-file reads and no DB access. All eight
intercepted browser suites pass, including the new 72 role/viewport checks and
six Women DE/EN/AR root/www scenarios. Booking-policy continuation (22 scenarios)
and Staff localization (306 checks) remain green. Scoped fast/finish gates pass;
all four touched root/www UI pairs match. CI/skill metadata validation passes;
bounded scan of 23 changed safe files reports no findings. These are scoped
checks, not an exhaustive security/translation or live E2E certification.
Frozen release integrity remains BLOCKED: CANONICAL_HASH_MISMATCH, unchanged.
No commits, pushes, migrations, deployments, providers or databases were used.

Screenshot follow-up: Women's SMART availability note inherited the light
page's dark body color outside card-content (measured 1.04:1 on the dark card).
It now uses the existing card secondary color, with a >=4.5:1 browser regression
assertion. Missing-photo placeholder was already implemented correctly; the
fixture's SVG response content type was repaired and actual image decoding is
asserted. No new photo or brand asset was introduced. Login now has its own
translated Enter-password placeholder rather than registration's Choose-password
wording. DE/EN/AR Women viewport screenshots were also captured for review.

## Presentation-only continuation (U02) — 2026-11-15

Existing Subscription and Message Inbox dialogs now join Owner/Staff/Customer
in the scoped Admin-derived controls. No Admin redesign or navigation/action
removal. They retain their existing IDs, dynamic renderers and handlers.
Customer profile copy was stale: its deletion invokes the server account API;
its normal save sends name/phone/email, while city/service/notes remain local
preferences and new password input produces the existing unsupported notice.
Copy corrections do not change those contracts or implement missing features.
Arabic account labels/back navigation and Women's Premium badge contrast were
corrected using existing locale/style architecture. Current batch preserves
all filtering and booking JS, including the prior task's reviewed-but-uncommitted
work. Browser evidence uses synthetic intercepted APIs, never real customer
accounts, providers or databases.

U02 evidence: 131 safe tests and strict isolated-client TypeScript pass. The
expanded Chromium fixtures exercise 108 panel/viewport render checks and six
root/www Women scenarios across DE/EN/AR at 390/768/1440 pixels, including
search/button/reset and existing favorites/booking entry. Account confirmation
cancellation and missing-field validation send no mutation requests. All
original IDs, literal links and close-action targets are preserved. Evidence
is scoped to synthetic intercepted APIs; real deletion/billing/messages, native
devices, all populated legacy states and complete translation coverage remain
unverified. Frozen release integrity and owner-dependent feature decisions are
unchanged.

Registration phone accessible names in main/Women now follow DE/EN/AR through
the existing locale dictionaries. Country prefix, phone input/normalization and
authentication behavior are unchanged. Added source-copy and DOM regressions;
this fixes language metadata without claiming full screen-reader certification.
