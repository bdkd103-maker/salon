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
| Customer discovery, women-only surface | Implemented: index/women pages, public salon projection, filters, services/media/reviews | API/browser integration, geolocation denial and responsive rendering unknown in this task |
| Profiles and favorites | Implemented: profile and favorites routes, per-user filters, unique user/salon relation | Persistence and account/session browser transitions not rerun |
| Customer email registration/reset | Implemented: challenge, purpose/role checks, provider transport and route tests | Real email delivery unknown; no provider contacted |
| Login/refresh/auth status | Implemented: Argon2, signed tokens, persisted status/role/authVersion checks and conditional refresh rotation | Session integration unknown; logout access-token lifetime policy unresolved |
| Global rate limiting | Verified locally R01: six tests, including in-memory Fastify 429 enforcement; fixed unsigned-sub bucket selection | Uses existing signature/expiry/claim verifier; no persisted-account authorization added to rate limiter |
| Bookings | Implemented: creation/update/cancellation/statuses and overlap checks; daytime containment and malformed-input rejection verified locally B01/B06 (12 booking tests) | Race between overlap count and write; weekend/holiday/timezone/cancellation policy questions; parser calendar/DST edge cases remain |
| Owner dashboard/salon configuration | Implemented: dashboard, services/media/extras/intake controls/schedule routes and UI | No full owner browser flow or persisted API contract validation here |
| Team management | Implemented: provision/list/update/revoke, salon access checks | Existing-user linking and verified-account creation need consent/security cutover |
| Staff invitation/recovery | Incomplete: dormant StaffInvitation/version/purpose foundation, documented no enabled invitation/acceptance routes | Migration/Prisma rollout, consent and recovery acceptance criteria required |
| Staff operations / SMART Core | Implemented: membership checks, lease-confirmed duty, service visits, occupancy | Full concurrency/persistence unknown; booking STAFF access differs from operations |
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
| Audited validation runners | Blocked: admin-session and service-visit suites differ from pinned hashes | Re-audit isolation; never blindly replace hashes |

## Verification updates

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
