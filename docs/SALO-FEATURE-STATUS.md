# SALO feature status

Consolidated 2026-11-16 at source `6d541047ca095c2c6f1acf0d399513c587df9b10`
plus local review changes. See [project knowledge](SALO-PROJECT-KNOWLEDGE.md)
and [engineering backlog](SALO-ENGINEERING-BACKLOG.md).

Current task HEAD is `b0fec5d` plus preserved uncommitted work. See
[owner decisions](SALO-PRODUCT-REQUIREMENTS.md) and the
[integration map](SALO-SYSTEM-INTEGRATION.md). Most recent UI-batch evidence is
131 safe tests, strict offline-client TypeScript and eight intercepted browser
suites (108 viewport/panel checks in the expanded UI suite). Historical totals
below are not a new live E2E, database, delivery or device certification.

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
| Customer discovery, women-only surface | Implemented; U01/W01 intercepted root/www DE/EN/AR checks verify women classification, category price filters, empty reset, favorites rollback, keyboard profile and booking entry, translated error/retry | Numeric price bands, evening/morning semantics and full real API/account transitions remain unresolved or unverified |
| Profiles and favorites | Implemented: profile and favorites routes, per-user filters, unique user/salon relation | Persistence and account/session browser transitions not rerun |
| Customer email registration/reset | Implemented: challenge, purpose/role checks, provider transport and route tests | Real email delivery unknown; no provider contacted |
| Login/refresh/auth status | Implemented; all four synthetic role logins and CORS verified against disposable runtime | Signed-in browser/refresh integration unknown; logout access-token lifetime policy unresolved |
| Global rate limiting | Verified locally R01: six tests, including in-memory Fastify 429 enforcement; fixed unsigned-sub bucket selection | Uses existing signature/expiry/claim verifier; no persisted-account authorization added to rate limiter |
| Bookings | Implemented; B03/B04 fixes preserved; owner-approved P-BOOK-001 enforces Customer-only authenticated creation and localized auth/return flow (B08) | Overlap race, holiday/timezone/overnight/cancellation policies and Staff mutation permissions remain; full live signed-in E2E is not established by intercepted tests |
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
| Localization/responsive UI | Partially verified U01: Owner/Staff/Customer reuse unchanged Admin tokens/controls; 390/768/1440 DE/EN/AR intercepted layouts, reachable navigation/close/logout and focus checks; localized login errors, profile language label and Women close controls | Full translation completeness, Admin English-only UI, all populated role states and native-device layouts remain unverified |
| Capacitor Android/iOS | Implemented wrapper/config/native projects and push registration | Build/device/plugin compatibility, signing and store readiness unknown |
| Native push delivery | Incomplete/unknown: device-token API and client hooks exist; no demonstrated FCM/APNs send lifecycle | Needs separately authorized test provider/device validation |
| Canonical migration chain | Broken: QueueEntry FK precedes ServiceVisit creation | Separate clean-install baseline does not establish upgrade equivalence |
| TypeScript/build health | Verified: fresh engine-free Client and full strict noEmit check pass with zero diagnostics after service adapter and test fixture repairs | Bundling, deployment and full runtime behavior are distinct; scoped finish still flags unmapped backend behavior coverage |
| Audited validation runners | Verified locally: fixed safe test set, reviewed suite pins, isolated Prisma/types and eight intercepted suites using explicit system-chromium | Legacy Edge mode still requires Edge; no automatic browser fallback; fixtures do not certify real DB/E2E behavior |
| System development instructions | Implemented: AGENTS source-of-truth/impact rules, four improved repository Skills and code-linked integration map | Metadata/link validation is separate from editor reload/discovery and from application correctness |

## Verification updates

Current owner decision: P-BOOK-001 in
[product requirements](SALO-PRODUCT-REQUIREMENTS.md) supersedes historical guest
policy uncertainty. Guest bookings are not supported. Root/www main and women's
surfaces explain Customer login/registration in DE/EN/AR; in-page auth returns
valid selections without automatic booking. Backend Customer role, account,
token signature/expiry and authVersion checks are regression-tested separately
from the intercepted browser UI. Existing management permissions are preserved.
Current evidence: 118 safe tests, 53 separately guarded existing booking-security
tests, seven intercepted browser suites (22 new booking-auth scenarios), and
full strict TypeScript pass. Explicit auth cancellation clears continuation;
successful login/verified registration returns selections without submitting.

Latest compiler evidence: all 21 original diagnostics resolved; full
isolated-client tsc exits 0. All 171 affected archive/deletion/membership tests
pass under explicit import/env/network guards. The normal safe suite has 105
passes; six intercepted Chromium suites pass. No compiler exclusions, production
archive-policy changes or frozen hash rewrites. The real-browser DOM error also
occurs on a script-free control page, so signed-in browser testing remains an
environment blocker, not a demonstrated SALO page defect.

Earlier compiler batch: service PATCH explicitly adapts its persisted
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

Historical B08 finding, superseded by P-BOOK-001: the booking UI promised no
registration but opened login on submission. The prior batch left copy/auth
unchanged pending an owner decision. The owner has since approved account-required
booking, implemented and verified in the current batch above.

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

## UI consistency and Women audit — 2026-11-15 (U01 / W01)

Owner instruction: `admin/admin.css` and `admin/index.html` are the design
reference. They and their www copies are unchanged. New scoped
`assets/control-panels.css` reuses their palette, body typography, cards,
buttons, input borders/radii and keyboard focus. Existing Owner structure is
retained; Staff's existing matching classes now receive a complete shell.
Customer account palette/controls align with Admin without replacing its forms,
bookings, favorites, security or navigation. Arabic font fallbacks and existing
role-specific content remain. Public discovery keeps its existing identity.

Verified and repaired: Staff lacked shell styles; Owner navigation was hidden
at <=900px with no menu trigger; public header/navigation covered dialogs;
Women profile content covered its close control. Account navigation now wraps
at smaller sizes instead of clipping its first items behind a wide label.
Close labels/focus and Owner dialog semantics were improved. Main login errors
and password placeholder use the existing language dictionary; profile language
selector and Women close buttons now have localized accessible names.

Women function defects repaired: category regexes used character classes,
normalization rejected its own hyphenated women aliases, and open-now accepted
unknown schedules. Existing numeric thresholds and operating-state rules are
preserved. Network failure now uses the existing translated error component;
retry actually refetches. Pending loads keep skeletons, and language/focus
rerenders preserve an error instead of presenting failure as an empty result.

Coverage is intercepted Chromium rendering and synthetic responses, not live
backend/persistence certification. Owner/Staff layout fixtures open existing
markup directly; separate unchanged authorization suites exercise role behavior.
External fonts/icon CDNs, notification delivery, populated long tables, every
modal and actual Android/iOS devices are not fully visually certified.

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

## U02 presentation-only follow-up — 2026-11-15

Subscription and Message Inbox share the unchanged Admin styling and have
localized close labels/heading associations. Customer profile now accurately
describes existing account deletion and saved fields, states its existing
password-change limitation, and does not wrongly require a password in the
missing-fields message. Arabic account terminology/back-arrow direction and
Women's Premium badge contrast are repaired. Existing actions and all Women
filtering/booking JavaScript are preserved. Regression evidence is isolated
fixtures and source comparison; live persistence/deletion is not exercised.
Unsupported profile password changes and local-only preference fields remain
functionality limitations, not newly implemented features.

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

## Development-system consolidation — 2026-11-16

Verified locally: source provenance, 11-file documentation/Skill scope, four
Skill metadata contracts, 69 local Markdown links, 131 safe tests, strict
isolated-client types and safe CI parsing. The current integration map and
ordered backlog separate owner decisions, implemented behavior and evidence.
No app/test-runner/pin or database changes; prior UI evidence is preserved.
Remote source publication and editor Skill reload are not established by local
file validation. Frozen release integrity remains a separate blocked gate.
