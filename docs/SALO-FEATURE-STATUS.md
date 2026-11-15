# SALO feature status

Reviewed 2026-11-15 at base `6d541047ca095c2c6f1acf0d399513c587df9b10`
plus local review changes. See [project knowledge](SALO-PROJECT-KNOWLEDGE.md)
and [engineering backlog](SALO-ENGINEERING-BACKLOG.md).

## Classification

- **Implemented**: traced executable code, not proof it works end to end.
- **Verified**: only the named behavior passed the stated safe test boundary.
- **Incomplete**: explicit missing path or dormant foundation.
- **Broken**: demonstrated defect or conflicting integrity/build requirement.
- **Unknown**: insufficient evidence; do not interpret as missing or working.

One subsystem may have multiple classifications. Owner-supplied requirements
are Germany, the four roles, existing major systems and architectural continuity.
Other commercial/scheduling assumptions below are observations or open questions.

| Feature | Classification and actual evidence | Limits / next evidence |
| --- | --- | --- |
| Customer discovery, women-only surface | Implemented; prior disposable runtime browser check displayed synthetic men/women salons from the real API | Complete filtering, responsive/mobile and signed-in account transitions remain unverified |
| Profiles and favorites | Implemented: profile and favorites routes, per-user filters, unique user/salon relation | Persistence and account/session browser transitions not rerun |
| Customer email registration/reset | Implemented: challenge, purpose/role checks, provider transport and route tests | Real email delivery unknown; no provider contacted |
| Login/refresh/auth status | Implemented; all four synthetic role logins and CORS verified against disposable runtime | Signed-in browser/refresh integration unknown; logout access-token lifetime policy unresolved |
| Global rate limiting | Verified locally R01: six tests, including in-memory Fastify 429 enforcement; fixed unsigned-sub bucket selection | Uses existing signature/expiry/claim verifier; no persisted-account authorization added to rate limiter |
| Bookings | Implemented; B03 read-only Staff membership scoping and B04 configured-day validation fixed locally; 29 isolated booking tests and 18 disposable-runtime HTTP assertions pass | Overlap race, holiday/timezone/overnight/cancellation policies and Staff mutation permissions remain; guest promise conflicts with authentication (B08) |
| Owner dashboard/salon configuration | Implemented; dashboard HTTP read and Saturday booking confirmation verified in disposable runtime | Full Owner browser flow and configuration writes remain unverified |
| Team management | Implemented: provision/list/update/revoke, salon access checks | Existing-user linking and verified-account creation need consent/security cutover |
| Staff invitation/recovery | Incomplete: dormant StaffInvitation/version/purpose foundation, documented no enabled invitation/acceptance routes | Migration/Prisma rollout, consent and recovery acceptance criteria required |
| Staff operations / SMART Core | Implemented: membership checks, lease-confirmed duty, service visits, occupancy; Staff booking reads now follow active/unrevoked membership | Full concurrency unknown; membership-based booking mutations remain undecided; signed-in browser flow unverified |
| SALO Ticket / live queue | Implemented: ticket reuse, walk-in, transition helper, visit start and mine/owner views | SQL partial indexes/transactions not exercised; migrations block clean install |
| SMART ETA | Implemented: pure engine and real-data adapter with unknown fallback | Capability mapping absent; unknown-duration walk-ins intentionally cannot promise ETA |
| Opening-state overnight schedule | Verified locally H01: nine new regression tests across backend/root/www; 18 existing hours tests passed previously | Retained uncommitted fix; no deployed validation |
| In-app notifications | Implemented: transactional eventKey deduplication, list/read and frontend UI | Read-state sync and concurrency not exercised in this task |
| Customer messages / availability watch | Implemented: authenticated routes and notification creation | Repeated watch/rearm deduplication semantics need review; external delivery unknown |
| Loyalty/rewards | Implemented: completion-backed ledger, row locking, unique transaction ids and redemption balance guards | No real database transaction/concurrency tests; do not rebuild ledger |
| Admin / security / salon lifecycle | Implemented: persisted role gates, platform settings, partner review, archive/retention/clearance/enforcement | Broad tenant regression evidence incomplete; destructive lifecycle not executed |
| Plans, boosts, shop/catalog/orders | Implemented routes/schema/UI and subscription metadata | Payment collection/settlement and plan entitlement acceptance unknown; do not infer billing from records |
| Localization/responsive UI | Implemented DE/EN/AR dictionaries, RTL and responsive CSS | Visual/mobile/keyboard coverage and translation completeness unknown; mock runner currently blocked |
| Capacitor Android/iOS | Implemented wrapper/config/native projects and push registration | Build/device/plugin compatibility, signing and store readiness unknown |
| Native push delivery | Incomplete/unknown: device-token API and client hooks exist; no demonstrated FCM/APNs send lifecycle | Needs separately authorized test provider/device validation |
| Canonical migration chain | Broken: QueueEntry FK precedes ServiceVisit creation | Separate clean-install baseline does not establish upgrade equivalence |
| TypeScript/build health | Broken validation: full-project tsc fails; generated Prisma types incomplete | Bundling is distinct; no full build or client regeneration performed |
| Audited validation runners | Verified locally V02: reviewed pins, checkout line-ending normalization, 10 workflow + 27 pure-unit tests pass; browser guard passes | Browser execution blocked by missing configured Edge (V03); no automatic fallback |

## Verification updates

Current compiler follow-up: service PATCH explicitly adapts its persisted
Decimal price to the existing normalizer contract. Four focused compiler and
in-memory HTTP regressions pass; full isolated-client TypeScript now has 20
test-only diagnostics (previously 21 including salons.ts). Earlier counts below
remain historical evidence. Booking fixes were committed locally as `b54ff62`.

Latest runtime-fix batch (2026-11-15, starting HEAD `1f8f12e`): all 101 safe
tests and six intercepted system-Chromium suites pass. A reverified disposable
PostgreSQL 16 cluster passes 18 post-fix real HTTP assertions, including Staff
read isolation, configured Saturday booking/confirmation/cancellation and
unchanged authorization denials. This validates the named API behavior, not
complete Owner/Staff/Admin/Customer browser workflows. Browser DOM automation
still returns `Browser Use could not read requirements`. The 21 existing full
TypeScript errors and frozen release integrity blocker remain. Historical
source-only and tooling-only results below describe their respective batches.

B08 remains **broken copy / unknown product requirement**: the booking UI
promises no registration but opens login on submission. Owner must decide
account-required booking with corrected localized copy/entry flow versus a
specified guest workflow. Authentication and existing copy are preserved.

R01 completed: five of six tests failed at base, all six pass after the scoped
server fix. Invalid/expired/forged tokens use IP fallback; legitimate tokens
retain per-user buckets. B01 completed: four of nine tests failed before the fix;
all nine now pass, including the existing helper tests and pure route validator.
After B06, the booking suite passes 12 tests, including in-memory malformed-input
POST requests returning 400 before booking access. H01 has nine and R01 six tests;
the final combined count is 27. Prior H01 evidence is preserved.
Passing source/helper tests never upgrades an entire feature to production-ready.

Final static scope/syntax checks and targeted strict booking-helper TypeScript
checking pass. Full-project TypeScript still fails; finish gate reports BLOCKED
and both audited suite guards reject their existing mismatched hashes. No
browser/native/database suite success is claimed. Exact commands and gaps are
recorded in the engineering backlog.

Preservation/update: prior fixes and these documents were reviewed, scanned
(zero bounded staged-source findings) and committed locally as `c5cbf3e`.
V02's subsequent isolation re-audit restores the allowlist guards and pure-unit
runner; historical hash-blocked results above remain previous-task evidence.
Full-project compiler failures remain unresolved. No database/native/browser
execution success is inferred from the restored guards.

V02 is preserved in local commit `5d9850f`. B07 rejects Date.UTC calendar/clock
rollover while retaining valid leap days/month ends. All 29 application
regressions and targeted booking-helper TypeScript pass. The restored audited
runner separately passes 27 pure-unit tests, and workflow tests pass 10.

## Consolidated tooling follow-up

The four repository AI skills, safe command entrypoint, YAML/config/security
checks and PR workflow are implemented locally. The safe suite now passes 72
tests. Explicit Cloud Chromium mode passes all six intercepted browser suites;
the same results were reproduced after locked ignore-scripts installs in a
fresh local clone with the proposed setup overlaid.

Full TypeScript remains FAIL and Step 04 frozen integrity remains BLOCKED.
Neither was waived. New PR automation has not run on GitHub because no push was
authorized. Metadata validation does not prove every editor's UI discovery.
Application behavior and historical migrations were not changed for tooling.
See SALO-AI-TOOLING.md and the backlog for exact files, commands and next actions.

## Completed ordinary-development environment

Four skills are valid, referenced by AGENTS.md and directly discoverable through
repository guidance (client UI reload remains client-dependent). Safe commands,
explicit browser modes, YAML/security and scoped checks are implemented. Fresh
offline engine-free Prisma generation removes the generated-client tooling
blocker; current and fresh safe suites pass 86 tests and six browser suites.

Full tsc intentionally retains 21 unrelated application/test diagnostics. Frozen
database integrity remains an isolated, enforced release-only blocker. The
ordinary PR checks do not run migrations or require production credentials;
the two release workflow placeholders are permanently skipped. No production
feature was implemented here. Ordinary safe development is supported; no
database/deployment readiness or remotely executed Actions result is claimed.
