# SALO engineering backlog

Consolidated 2026-11-16. Fetched development source `6d54104`; task branch
`salo-cloud-work` at `b0fec5d`, with existing uncommitted work preserved.
This documentation task grants no commit, push, main merge, deployment or
production-access approval. Earlier permissions/results are historical records,
not blanket authorization for future tasks.
See [knowledge](SALO-PROJECT-KNOWLEDGE.md) and
[feature status](SALO-FEATURE-STATUS.md).

Priority: P0 blocks reliable installation/security verification; P1 is high
security/business impact; P2 is bounded correctness/completion. Severity is not
authorization to migrate, deploy, access credentials or change product policy.

## Current ordered work — single authoritative queue

Only this table orders remaining work. Historical inventories/batch logs below
retain stable IDs and evidence; resolved rows there are not newly open defects.
An owner decision is not a confirmed bug, and blocked work does not authorize a
workaround. Select an independent approved task when a dependency is unavailable.
P0 release blockers do not prevent ordinary offline documentation/development.

| Order / ID | Priority and state | Impact, dependency and next acceptance evidence |
| --- | --- | --- |
| 1 / M01 | P0 release / confirmed dependency failure | Canonical QueueEntry FK precedes ServiceVisit creation. Obtain an approved installation/upgrade strategy, then separately authorize disposable PostgreSQL equivalence/constraint tests. Never reorder historical files silently. |
| 2 / M02 | P0 release / integrity blocked | Frozen Step 04 CANONICAL_HASH_MISMATCH and SubscriptionPlan ordering need source/hash/normalization root-cause review before approved correction. Preserve profile/baseline/history; no checksum rewrite, bypass or permanent apply mode. |
| 3 / A02 | P1 security / confirmed code debt | Remember-login saves a password locally. Next dedicated auth-storage change must preserve supported sessions/booking return and prove no plaintext password is persisted; do not read real saved values. No fix in this documentation task. |
| 4 / S01 | P1 security / owner cutover decision | Existing-user Staff linking/provisioning and verified-active creation need approved consent/recovery/onboarding rules, migration/client rollout and isolated denial tests. Dormant StaffInvitation data is not activation approval. |
| 5 / B02 | P1 correctness / confirmed race | Overlap check before write transaction can admit concurrent bookings. Owner capacity/concurrency model is prerequisite; prove prevention with separately authorized disposable DB concurrency tests, not only mocked counts. |
| 6 / V07 | P1 quality / coverage gap | Expand audited tenant/account/lifecycle/queue/loyalty regression mappings without running arbitrary DB-backed suites. Require explicit import/network review, negative-role/cross-salon/stale/idempotency evidence and preserved pins. Existing isolated cases are not broad integration certification. |
| 7 / B03 | P1 / Staff mutation decision | Staff booking reads are fixed by active membership. Define whether Staff may mutate bookings before changing PATCH/DELETE ownership behavior. Preserve the completed read fix. |
| 8 / B05 | P1 / cancellation decision | Status-only updates still encounter current schedule/overlap validation. Define cancellation/completion after configuration changes; then test old/new schedule boundaries without weakening ownership. |
| 9 / B04 | P1 / scheduling decisions | Preserve configured-day/Saturday fix. Define German state holidays, timezone/DST/overnight and missing-schedule policies before changing remaining behavior. |
| 10 / A01 | P1 / logout decision | Refresh revocation exists; immediate access-JWT invalidation is not established by logout. Define desired lifetime/revocation semantics before authVersion/session changes. |
| 11 / E01 | P2 / incomplete model | No Staff-service capability mapping; duration-less walk-ins intentionally produce unknown ETA. Define eligibility/duration requirements before adding relations or invented numbers. |
| 12 / N01 | P2 / notification decision | Define availability-watch rearm/event dedupe semantics, then test transactional/idempotent notification behavior and privacy with synthetic users. Real email/push delivery is separate. |
| 13 / U01 | P2 / partial UI verification | Preserve U01/U02 Admin-derived panel, localization and accessibility fixes. Complete Admin DE/AR localization and populated legacy-screen/keyboard/mobile coverage without redesign or permission changes. Fixtures do not certify every visual state. |
| 14 / W01 | P2 / discovery decisions | Preserve repaired classification/category/open-now/error handling. Clarify numeric price bands, morning/evening meaning and unisex versus women-only taxonomy before functional changes. Do not auto-map generic service labels to trusted booking IDs. |
| 15 / F01 | P2 / incomplete profile behavior | Password changes are unsupported here; city/service/notes remain local preferences. Require approved frontend/API/data/consent acceptance before implementation. Accurate U02 copy is not a feature implementation. |
| 16 / C01 | P2 / commercial requirements unknown | Plans, boosts, shop/orders and subscription metadata exist. Specify payment, entitlement, cancellation/settlement and provider test acceptance before enabling commercial behavior. No hosting/purchase/payment activation. |
| 17 / P01 | P2 / native delivery unverified | Verify Capacitor 8/push 7 compatibility, Android/iOS builds and synthetic device/provider transport in a separately authorized environment. Existing token registration is not delivery proof. |
| 18 / V06 | P2 / historical provider failure | Managed DOM tool previously failed on both SALO and a script-free control. Current provider state is not retested here. Use explicit intercepted Chromium mode for offline checks; no security/provider workaround or live E2E claim. |
| 19 / L01 | P2 / lifecycle verification gap | Validate retention/archive/clearance boundaries and classify any new model before lifecycle changes. Use isolated approved tests; do not infer legal retention policy or run real deletion/purge operations. |
| 20 / D01 | P2 / historical documentation conflict | Prototype mobile-production checklist still contains no-backend claims. Current source-of-truth index explicitly supersedes them; future maintenance must preserve dated history and avoid treating it as release certification. |

Recent completed local batches include R01, H01, B01/B06/B07, B03 reads, B04
configured days, B08/P-BOOK-001, V01–V05 and U01/U02/W01 selected UI defects.
They remain subject to their documented review/evidence limits. Current retained
evidence is 131 safe tests, full strict isolated-client types and eight intercepted
browser suites. Do not rebuild those features or promote mock success to release
readiness. Link new issues and decisions into this table rather than creating a
second roadmap or treating an unknown requirement as an approved feature.

## Historical inventory — preserved 2026-11-15

The following inventory and dated batch logs record the preceding work. Its
older counts, branch permissions and temporary tool failures are historical;
the current table above controls prioritization and current authorization.

| ID | Priority / state | Evidence, impact and acceptance / dependency |
| --- | --- | --- |
| R01 | P1 / fixed locally | server.ts formerly trusted decoded JWT sub. Now uses existing verifyAccessToken; signature/expiry/claims validated before selecting user bucket, invalid headers use IP. Six regression tests pass; see batch log. |
| M01 | P0 launch / blocked | 20260909231832 QueueEntry FK references ServiceVisit before 20260910130000 creates it. Requires approved migration strategy and disposable PostgreSQL install/upgrade validation; do not reorder history blindly. |
| V01 | Resolved locally | Isolated generation/type mapping and all 21 original source/test diagnostics repaired in scoped batches. Full strict noEmit now exits 0; no production archive/deletion behavior changed. Historical failure counts remain in prior records. |
| V02 | P1 / fixed locally | Four mismatched suites manually re-audited and explicitly pinned; byte-preserving CRLF normalization avoids checkout-only drift. Ten workflow and 27 audited pure-unit tests pass; browser guard passes. See V03 for browser execution. |
| V03 | P2 / Cloud mode verified | Explicit system-chromium mode now passes all six intercepted suites in current and fresh Cloud checkouts. Legacy Edge default is preserved and still requires Edge. No implicit fallback, suite-pin change or OS installation. |
| V04 | P2 / application type contract repaired locally | Service PATCH adapts persisted Decimal price before merging optional fields; explicit zero/string price and retained price are covered. Compiler regression red/green; full diagnostics fall from 21 to 20 test-only errors. No runtime price-loss defect demonstrated. |
| V05 | P2 / test typing repaired locally | Remaining 20 fixture/assertion/legacy-boundary diagnostics fixed without suppressions or weaker compiler options. All 171 affected tests pass with env/network/import guards; full tsc has zero diagnostics. |
| V06 | P2 / managed-browser environment blocker | DOM helper fails with the same requirements error on SALO and a script-free HTTP-200 control page. Inventory/native browser work. No safe repository fix demonstrated; restore managed browser service before claiming signed-in UI coverage. |
| B01 | P1 / fixed locally | booking-time.ts formerly compared only clock minutes; now requires same salon-local date for daytime intervals. Nine tests pass including existing helper tests and route validator coverage; overnight helper branch preserved. |
| B06 | P1 / fixed locally | Missing/unparseable timestamp components now return Invalid Date, reaching existing invalid-window validation. Twelve booking tests pass, including six in-memory POST requests returning 400 before overlap reads/writes. |
| B07 | P1 / fixed locally | Impossible calendar dates and out-of-range clock fields no longer normalize into a different booking date/time. Fourteen booking tests pass, including leap-day/month-end boundaries and in-memory POST rejection before booking access. |
| B02 | P1 / confirmed code race | bookings.ts checks overlaps before its creation/update transaction, with no matching exclusion constraint in schema/SQL. Concurrent writers can pass the count. Needs concurrency model, capacity rules and isolated DB evidence; not fixed by moving count alone. |
| S01 | P1 / blocked cutover | owner-team.ts creates ACTIVE staff with emailVerified true and links existing STAFF by email without consent. Dormant invitation foundation is not a fix. Define consent/linking/recovery policy, migration/client rollout and staged cutover tests. |
| B03 | P1 / read defect fixed locally; mutation decision open | GET already admits STAFF but filtered by salon ownership. Now scopes reads by persisted ACTIVE/unrevoked membership, matching queue access. Foreign/inactive/revoked membership excluded. No membership-based PATCH/DELETE access added; those permissions still require owner specification. |
| B04 | P1 / configured-day defect fixed locally; remaining policy open | Explicit nonempty workingDays now overrides blanket weekend rejection and excludes configured closed weekdays. Legacy empty/missing fallback and holiday rules preserved. German state holidays, authoritative timezone, overnight/DST and missing-schedule policy remain owner decisions. |
| B08 | P1 / approved policy implemented locally | Owner decision P-BOOK-001 requires Customer login/registration before booking; no guests. Correct DE/EN/AR main/women copy and context notices, retain in-page selections through auth, enforce persisted CUSTOMER creation. No automatic submission or auth bypass. |
| B05 | P1 / owner questions | PATCH status-only mutations still validate current schedule/overlaps; may block cancellation/completion after schedule changes. Define status-only acceptance and historical-booking policy before changing it. |
| A01 | P1 / owner question | Logout revokes refresh Sessions but not issued access JWTs (15-minute expiry). Define immediate logout invalidation requirement before adding DB writes/version changes. |
| A02 | P1 / confirmed existing frontend security debt | Main-page saveCustomerLogin writes email and password to meshwarCustomerAuth in localStorage when remember is selected. P-BOOK-001 does not introduce or approve this behavior. Handle in a separate credential-storage fix; no real stored values were read here. |
| E01 | P2 / incomplete by design | SMART ETA has no staff-service capability relation; walk-ins without assigned duration produce unknown ETA. Define requirements before adding models or invented durations. |
| N01 | P2 / investigate | Availability-watch notification dedupe is user/salon-wide; review whether rearming a fired watch should produce a new event. No business rule inferred. |
| U01 | P2 / partial fixes verified locally | Admin-derived non-Admin controls, Staff shell, reachable mobile Owner/Customer navigation, dialog stacking/close/focus and selected DE/EN/AR copy repaired. 390/768/1440 fixtures cover root/www. Complete populated-page translation/visual/device audit remains open. |
| W01 | P2 / verified defects fixed locally | Women price category regexes, normalized women aliases, unknown-hours open-now leak, profile close stacking and network error/retry/loading repaired. Numeric bands and evening/morning definitions require product clarification; no guessed rules. |
| P01 | P2 / unknown | Native push transport/build/plugin compatibility and actual delivery need approved synthetic provider/device setup. No real credentials here. |
| D01 | P2 / documented | Old mobile production checklist claims no API/database, contradicted by current code. New knowledge doc flags it; historical validation is not current readiness. |

## Batch H01 - preserved from preceding task

- Defect: overnight interval's early-morning portion incorrectly applied on its
  start day in backend and frontend.
- Fix: scope today's overnight interval to its evening portion; previous-day
  carryover remains valid. Files: `backend/src/lib/salon-hours.ts`, `index.html`,
  `www/index.html`, new `tests/salon-hours-regression.test.mjs`.
- Evidence: nine new tests passed (six failed before fix); 18 existing hours
  tests passed using isolated evaluation. Static/parity/scope checks passed.
- Limits: no DB/browser/native integration. No prior changes were discarded.

## Current task execution log

1. Verified origin identity, clean base ancestry and preserved H01 changes.
2. Read project guidance, core workflows, roles, API routes/helpers, schema,
   migration evidence, package scripts, frontend modules and relevant tests.
3. Created these three knowledge/status/backlog documents; R01/B01 selected for
   independently reviewable fixes. No new product features selected.
4. Before-edit scope capture:
   `.verification-test-build/quality-gate/127bde7a-aca4-46b0-b9a3-cf022179d994.json`.
   Scope: three docs, server.ts, rate-limit regression, booking-time.ts and
   booking-window regression. Capture includes H01's existing state.

## Safe validation and review protocol

### Batch R01 - verified JWT rate-limit identity

- Reproduction: `env -i PATH="$PATH" node --test tests/rate-limit-key-regression.test.mjs`
  initially failed five of six tests. Three forged subjects received 200/200/200
  from an in-memory max-two limiter, instead of 200/200/429. Duplicate-header
  input also threw because startsWith was called on an array.
- Root cause: server.ts decoded the payload without authenticating it.
- Fix: reuse `verifyAccessToken` and require a string Bearer header. Invalid
  tokens fall back to the existing IP bucket; valid tokens retain per-user keys.
- After fix: same command PASS, six tests. Covers forged/expired/future tokens,
  malformed claims/headers, stable valid-user keys, and actual plugin enforcement
  through Fastify inject. No server listen, database, network or real keys.
- Scope: `backend/src/server.ts`, new rate-limit regression and these docs.
  No new runtime file/dependency or packaging allowlist change needed.
- Limits: tests evaluate the actual key callback and shared JWT helper in an
  isolated VM plus fixture plugin, not the whole application. Rate limiting is
  not account authorization; persisted status/version checks remain in auth.ts.
- Interim fast gate reports BLOCKED because the next planned test file does not
  exist yet; final exact-scope gate will be rerun after B01. No hash updates.

### Batch B01 - daytime booking interval containment

- Reproduction: `env -i PATH="$PATH" node --test tests/booking-window-regression.test.mjs`
  failed four of nine tests before the fix. The actual route's pure validator
  returned null for Monday 17:00 -> Tuesday 10:00 at a 09:00-18:00 salon.
- Root cause: helper discarded both dates before comparing opening/closing.
- Fix: retain formatted local dates and require equality for daytime intervals.
  Clock boundaries and the existing overnight-helper branch are unchanged.
- After fix: nine tests PASS, including seven targeted tests and the two
  existing booking-time tests. Covers multi-day/month/year boundaries, local
  versus UTC day, valid opening/closing and the pure route validation contract.
- Combined with R01 and preserved H01: 24 tests PASS via
  `env -i PATH="$PATH" node --test tests/booking-window-regression.test.mjs tests/rate-limit-key-regression.test.mjs tests/salon-hours-regression.test.mjs`.
- Scope: booking-time.ts, new booking-window regression and these docs. No
  weekend/holiday/timezone/capacity/cancellation rules changed. This does not fix
  concurrent bookings or all overnight-helper containment limitations.

### Batch B06 - malformed booking timestamps

- Reproduction: date-only input threw TypeError; unparseable date/time components
  threw RangeError before the existing invalid-window check. New regression
  failed before the fix; existing valid-format tests stayed green.
- Root cause: parser split a missing time part and formatted Invalid Date using
  Intl before checking it. String-only route schemas allow nonempty bad input.
- Fix: return Invalid Date when date/time part is absent or Date.UTC is invalid.
  The existing validator returns `Invalid time window`; routes already map it
  to 400. No error masking or new global error handling was introduced.
- Added in-memory Fastify POST coverage using the actual selected route/schema,
  helper and context function with explicit fake account/settings/salon reads.
  Six malformed start/end requests return 400, with zero booking reads/writes.
- Current booking suite: 12 PASS (including existing two tests); original B01
  red/green evidence above remains historical. R01 six and H01 nine also pass.
- Limits: this is not a full date grammar/calendar validation or DST fix. JS
  date rollover, nonexistent/ambiguous local times, timezone ownership, explicit
  offset semantics and overnight booking policy still need separate coverage.
- No new files beyond the seven-file planned scope; earlier H01 bytes preserved.

Targeted test files read only explicitly named source; VM contexts evaluate
helpers/configuration or selected routes with fake dependencies, never server
startup/Prisma client/dotenv. New suites are manually
reviewed for isolation and invoked with `env -i PATH="$PATH" node --test ...`.
No pinned runner allowlist is expanded. Source extraction tests are narrower
than full module integration and fail if their expected source boundaries move.

Use `quality-gate.mjs` fast/finish/review with the captured baseline and exact
seven-file scope. Full-project tsc failures remain failures, even if the gate
labels them BLOCKED. Existing runner hash mismatches remain visible. Do not
install dependencies or substitute live diagnostics for blocked checks.

## Owner decisions and authorization boundaries

Open questions above are not assumed permissions or specifications. The latest
owner instruction authorizes local commits but not migration application,
production/customer data, provider calls, deployment, merge or push. Work may continue on independent
deterministic local fixes while those items remain blocked.

## Validation from the preceding development task

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Combined targeted regressions | PASS, 27 tests | `env -i PATH="$PATH" node --test tests/booking-window-regression.test.mjs tests/rate-limit-key-regression.test.mjs tests/salon-hours-regression.test.mjs` |
| Booking helper strict TypeScript | PASS, exit 0 | `env -i PATH="$PATH" node backend/node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node --typeRoots backend/node_modules/@types backend/src/lib/booking-time.ts` |
| Fast quality gate | PASS | Explicit seven-file scope; source fingerprints and new JS syntax. No outside-scope changes relative to task capture, so H01 source bytes are preserved. |
| Finish quality gate | BLOCKED | server.ts/booking-time.ts have no audited runner mapping; full-project compiler exits 2. Explicit targeted suites above provide narrower evidence without changing mappings. |
| Full-project TypeScript | FAIL | Existing Prisma dmmf/InputJsonValue/type-generation gaps, implicit-any and test errors. A gate BLOCKED label is not a compiler pass. No waivers/client regeneration. |
| Audited browser guard | BLOCKED | check() rejects `tests/admin-session.spec.js` hash; no browser suite launched |
| Audited pure-unit guard | BLOCKED | check() rejects `backend/src/lib/service-visit.test.ts` hash; no pinned suite launched |
| Diff / source review | PASS for scoped changes | Manual self-review plus quality:review scope check; not an independent reviewer or application certification |

Gate reports are local ignored diagnostics:
`.verification-test-build/salo-current-fast.json` and
`.verification-test-build/salo-current-finish.json`. Reproduce gates with
`node scripts/quality-gate.mjs --mode fast` (or `finish` / `review`),
`--baseline .verification-test-build/quality-gate/127bde7a-aca4-46b0-b9a3-cf022179d994.json`
and `--files docs/SALO-PROJECT-KNOWLEDGE.md docs/SALO-FEATURE-STATUS.md docs/SALO-ENGINEERING-BACKLOG.md backend/src/server.ts tests/rate-limit-key-regression.test.mjs backend/src/lib/booking-time.ts tests/booking-window-regression.test.mjs`.

Review found no additional actionable regression in these patches. New tests
evaluate selected actual source, so whole-module bootstrap/dependency and
database integration remain gaps. Valid-form tests preserve existing offset
interpretation without declaring it the desired product rule.

Next work: separately audit V02 test isolation; resolve V01 compiler/client
baseline; design M01 safe migration strategy; specify and test B02 concurrency
and S01 consent cutover. Continue independent small fixes where evidence and
local safety are clear. These validation results precede the newly authorized
preservation commit; no database, provider or real credential access occurred.

## Preservation review - 2026-11-15

The owner requested review, a secret scan and a commit on the current task
branch. Origin and base ancestry were reverified. Scope is exactly the five
modified runtime/frontend files, three regression files and three knowledge
documents. Manual review found no additional actionable regression in this
batch; the known integration/compiler/test-runner limits above remain visible.
Only exact reviewed paths will be staged. No hooks, signing credentials, push
or merge are required. The 27-test regression suite passed again. A bounded
pattern scan of the full staged contents of all 11 files returned zero findings
(private keys, AWS/GitHub/provider token formats, signed JWTs, password-bearing
DB URLs and literal secret assignments). No dedicated scanner was installed.
This did not scan history or ignored files or prove the absence of all secrets.
Commit: `c5cbf3e8207b5e8376219caea5f1bf78c76b3e71`; working tree was clean
immediately afterward. Nothing was pushed or merged.

## Batch V02 - restore audited test execution

- Scope capture:
  `.verification-test-build/quality-gate/5c8cb3b8-549f-47f1-874e-99f2174db438.json`.
  Files: the two audited runners, workflow regression tests and these three docs.
- Reproduction: workflow suite failed one of eight tests at the stale service
  digest. Browser guard also rejected admin-session. Presence/loyalty pinned
  digests matched CRLF bytes but not this checkout's LF bytes.
- Manual isolation re-audit: service suite imports only node:test/assert/fs and
  its pure helper; fs reads one named migration SQL, never applies it. Presence
  and loyalty suites import only test/assert and pure helpers. Service's helper
  has only a type import. Admin-session imports test assertions/fs/path/Playwright;
  reads named static assets, uses fresh browser contexts and synthetic login
  fixtures, fulfills every API and aborts all other requests. The runner still
  blocks network fallthrough, WebSockets and service workers. No new imports or
  test groups were permitted and no application credentials were read.
- Explicitly updated only these four reviewed pins. Both runners now hash
  canonical LF bytes: only CR immediately before LF is removed. Lone CR,
  whitespace, code changes and distinct invalid UTF-8 bytes still hash differently.
- New regressions exercise line-ending portability, other-byte rejection and
  browser guard checks without browser launch. Existing network/DB/import denial,
  arbitrary-group and source-scope regressions remain intact.
- PASS: `env -i PATH="$PATH" node --test tests/development-workflow.test.mjs`
  (10 tests), and `env -i PATH="$PATH" node scripts/test-backend-unit.mjs`
  (service 10, presence 14, loyalty 3; 27 tests). Both allowlist checks pass.
- Browser execution is still BLOCKED by V03; no browser mode fallback or system
  install performed. Review of pins is a trusted-code audit, not an OS sandbox.
- Fast gate PASS; scope and workflow checks PASS. Finish gate FAIL because its
  six browser-suite launches report missing `msedge` at
  `/opt/microsoft/msedge/msedge`. No browser process reached test execution.
  This is the recorded environment blocker, not six demonstrated app failures.
  No suggested installation command was run.
- Reviewed six-file staged-source pattern scan: zero findings. Preserved in
  local commit `5d9850f4977e35a32d6662d33d49f174acca2850`; no push/merge.

## Batch B07 - reject booking calendar rollover

- Scope capture:
  `.verification-test-build/quality-gate/aa094388-533c-45b4-8829-0ce1768a496b.json`.
  Files: booking-time.ts, booking-window regression and these three docs.
- Reproduction: adding calendar/clock regression coverage produced two failing
  tests. Non-leap February 29 and September 31 became valid Date objects;
  out-of-range fields could normalize rather than fail input validation.
- Root cause: Date.UTC intentionally rolls numeric components into other dates,
  while the parser checked only NaN. That is inappropriate for booking input.
- Fix: require integer year/month/day/hour/minute, bound clock/month/day fields,
  and round-trip UTC month/day before applying the existing zone offset.
  Fractional seconds and existing explicit-offset interpretation are unchanged.
  No scheduling, holiday, staff/capacity, cancellation or DST policy was added.
- PASS: 14 booking tests; combined with rate-limit/opening-hours tests, 29 tests.
  In-memory POST fixture checks ten malformed start/end variants plus one
  pair of September-31 timestamps: 400 Invalid time window, zero overlap reads
  or booking writes. Real Prisma and databases are never imported/contacted.
- PASS: targeted strict booking-helper TypeScript (same command as above).
- Limits: full grammar, Date.UTC's legacy handling of years 0-99, DST gaps/folds,
  timezone ownership and ignored explicit offsets remain separate concerns.
  Previously recorded calendar-rollover limitations in B06 are resolved only
  to the scope described here. Full-project TypeScript remains non-passing.
- Fast gate and final scope review PASS. Finish gate BLOCKED because the helper
  has no audited behavior mapping and full-project TypeScript exits 2. The
  explicit 14-test booking suite and targeted strict type check pass; compiler
  failures elsewhere are not waived or silently repaired.

## Current preservation/development summary

- Commits on `salo-cloud-work`: `c5cbf3e` preserves H01/R01/B01/B06 and project
  documents; `5d9850f` restores reviewed suite pins and portable digest checks.
- Current independent pass counts: 29 application regressions, 27 audited pure
  unit tests and 10 workflow tests (66 tests total). Targeted strict booking
  helper type checking passes. Existing application fixes remain covered.
- Browser finish execution failed at missing configured Edge before any UI
  tests ran; no browser substitution/install. Full-project compiler still fails.
- Documentation is updated per batch. Scan scope is full staged content of only
  reviewed paths; scan output never includes possible secret values. History,
  ignored files and real credentials remain untouched. No dedicated scanner
  was available; this is bounded pattern evidence, not a complete secret audit.
- No production/database/provider access, deployment, push or merge occurred.
  M01 migration sequencing, V01 generated-client/type health, B02 concurrent
  booking enforcement, S01 consent cutover and owner policy questions remain.

## Consolidated AI tooling setup (initial validation record)

Repository/revision and clean starting tree verified at a8429d3. Scope captured
before edits in `.verification-test-build/quality-gate/d5e152e3-ec88-43e8-94ef-f3e87e9502d9.json`.
All changes are tooling/configuration/documentation; production source, schema,
SQL migrations, frozen profile/baseline and existing commits remain unchanged.

Created four supported repository skills: salo-project-expert, salo-bug-hunter,
salo-feature-developer and salo-quality-gate. Existing development/review skills
remain unchanged. Metadata/source-doc checks pass; actual client UI discovery
may require reload and has not been represented as a tool-verified UI action.

Files created/changed in this batch:
- `.agents/skills/salo-project-expert/SKILL.md`
- `.agents/skills/salo-bug-hunter/SKILL.md`
- `.agents/skills/salo-feature-developer/SKILL.md`
- `.agents/skills/salo-quality-gate/SKILL.md`
- `scripts/salo-checks.mjs`, `scripts/test-browser-mock.mjs`
- `tests/ai-tooling.test.mjs`
- `.github/workflows/ci.yml`
- `package.json`, `package-lock.json` (only new dependency: pinned yaml parser)
- `docs/SALO-AI-TOOLING.md`, `docs/development-workflow.md`
- These three SALO knowledge/status/backlog documents

Safe PR checks use Node 24, locked ignore-scripts installs, read-only contents,
non-persisted checkout credentials and pinned official actions. Four independent
matrix checks cover safe tests, intercepted browser tests, full tsc and unchanged
frozen integrity. YAML/config and changed-source scan run first. No deployments,
services, credentials or database operations. No workflow was pushed/activated;
branch protection requires later explicit GitHub settings approval.

Validation:
- PASS: four skill metadata/path checks; real YAML parse and workflow safety
  contract tests; child environment stripping; explicit browser mode tests;
  redacted sensitive-pattern findings and invalid-command rejection.
- PASS: 72 tests (45 tooling/workflow/application + 27 audited pure units).
- PASS: all six browser suites on explicitly selected /usr/bin/chromium,
  including Admin session, Staff auth/logout/localization, Owner authorization
  and reminders. Existing guards and suite digests remain unchanged.
- PASS: fresh local clone at a8429d3 with only the 15 scoped setup files overlaid,
  no ignored environment files or existing node_modules copied. Fresh root and
  backend npm ci --ignore-scripts succeeded, then skills/config/safe tests and
  six Cloud browser suites passed. No commits were created in either checkout.
- PASS: bounded local changed-source scan reports zero findings; static syntax,
  parity and scoped review checks. This is not an exhaustive secret audit.
- FAIL: full backend tsc exits 2, including existing Prisma generated-type/test
  errors; the fresh ignore-scripts install has no generated Prisma client.
  No errors were waived or unrelated source fixed to make CI pass.
- BLOCKED: unchanged verifyPreparation returns CANONICAL_HASH_MISMATCH in both
  checkouts. Earlier root-cause review proves all twelve migration mismatches are
  EOL-only (admin migration has only a final CRLF); original schema bytes remain
  unresolved. No frozen checksums were rewritten or historical SQL changed.
- Legacy scoped finish still selects missing Edge; explicit standalone Cloud
  browser validation is the verified alternative, not a fabricated finish PASS.

Local diagnostic logs/copies remain under ignored .verification-test-build/.
The consolidated guide contains commands for Codex Cloud and VS Code, limits and
activation steps. No redundant editor extensions/global tools were installed.

Remaining essential green-CI blockers: authorize a separate offline generated
Prisma Client/type-health repair and recover/review the frozen schema/source
bytes for Step 04. Do not weaken these checks. Publishing/required-check settings
are deferred until owner approval; no push, deployment or DB access occurred.

## AI environment completion - current result

The owner authorized finishing tooling and local commits, without push/merge.
All prior modified/untracked tooling files were preserved and completed. HEAD
and ancestry were verified at a8429d3 before changes. Completion scope was
captured before edits and expanded before adding quality-gate integration and
valid disabled release placeholders. Final scope is recorded in the local
tooling-completion-scope.json diagnostic (22 reviewed paths).

### Completed tooling fixes

- Four valid SKILL.md files are linked explicitly from AGENTS.md and project
  guidance. Metadata, document paths and instruction references pass. Clients
  may need reload; executor's generic skill catalog is not a repository UI
  discovery probe, so no UI-load claim is made. Agents can discover/read every
  skill directly from AGENTS.md without global plugin/extension installation.
- New prisma-tooling.mjs uses pinned @prisma/internals 5.22.0 WASM parsing and
  the matching installed Client Generator API. No native query/schema engine
  or engine download is used. CLI/Client/SDK versions must match. Copied schema,
  private package boundary, client/config/logs stay in a new ignored directory.
- offline-tool-guard.cjs blocks environment-file reads/streams, TCP/TLS/HTTP/
  fetch/DNS, shell and non-Node execution. Child environments are constructed
  from platform basics, explicit flags and one synthetic datasource marker.
  Successful receipts show only guard installation, no blocked network/env
  attempts. Failed experiments stayed fail-closed and contacted no database.
- Normal CLI generation tried to download engines despite --no-engine; that
  attempt was blocked. The SDK getGenerators skipDownload path also tried
  checksum fetching and was rejected. Final WASM + direct Generator API avoids
  both paths, with empty engine maps/noEngine and no disabling of checksums.
- Fresh generated types eliminate the tooling's missing/stale Prisma errors.
  TypeScript uses only a temporary paths mapping; canonical schema/tsconfig and
  the existing runtime client are unchanged. Generated engine-free client is
  tooling-only and must never be deployed/copied into the backend runtime.
- Fixed the one extensionless queue-entry.test.ts import to .js for NodeNext.
  Its eight existing pure transition tests are manually audited and evaluated
  with only assert/test and the dependency-free helper. No routes/DB imported.
- Scoped quality gate now accepts explicit browser modes and uses isolated
  Prisma type generation for backend checks. Actual TS errors are FAIL, not
  BLOCKED merely because tsc exits 2. Missing browser binaries remain BLOCKED.
- PR checks are safe tests, intercepted browser and full type checking. Frozen
  integrity is separately enforced on manual workflow dispatch, not an ordinary
  PR prerequisite. The two previously empty release workflow files are valid
  manual placeholders with permanently skipped jobs and no deployment code.

### Current validation

- PASS: 86 tests (59 tooling/workflow/application/queue plus 27 audited units).
- PASS: all six intercepted system-Chromium suites, current and fresh checkout.
- PASS: fresh locked root/backend ignore-scripts installs, skill references,
  all three workflow YAML/safety contracts and real offline client generation.
- PASS: offline guard negative regressions, generator-version/output boundaries,
  explicit browser selection, bounded scan, whitespace and source-scope review.
- FAIL (unrelated application/test debt): full generated-client tsc has 21
  diagnostics: salon-archive.test.ts (18), salon-deletion-policy.test.ts (1),
  staff-membership.test.ts (1), routes/salons.ts:942 (1). The route passes a
  string-or-number duration to ServiceInput; fixture errors include nullability,
  missing fields, array shapes and an outdated function call. No strictness
  relaxation, error waiver or production logic repair was made in this task.
- Scoped finish likewise reports these real compiler errors rather than a
  fabricated overall PASS. The explicit browser check passes within finish.
- BLOCKED (release-only): unchanged verifyPreparation refuses
  CANONICAL_HASH_MISMATCH. No hash rewrite, SQL alteration, bypass, migration
  history marking or real PostgreSQL validation. Enum ordering remains a
  separate database/Prisma compatibility decision.

Fresh validation used a new local clone, with only explicit setup paths overlaid,
no ignored .env/client/modules copied, then locked installs. SDK generation
works there without native engines, not just against a cached local client.
GitHub workflow execution remains untested until separately approved publishing;
configurations are locally validated and ready for review, with expected type
debt reported by CI. No production settings, data or deployment were accessed.

Additional completion paths beyond the initial setup manifest: AGENTS.md,
scripts/prisma-tooling.mjs, scripts/offline-tool-guard.cjs,
scripts/quality-gate.mjs, backend/src/lib/queue-entry.test.ts, and the two
disabled release workflows. All previous 15 setup paths remain included.
Ordinary offline cloud application development is supported; release readiness
is not asserted. Local preservation commits are authorized, never push/merge.

## Runtime defect batch B03/B04/B08 (2026-11-15)

- Verified clean SALO checkout `1f8f12e` on `salo-cloud-work`, origin and required
  ancestry before editing. Scope capture:
  `.verification-test-build/quality-gate/6dd3198f-10ea-4637-be27-6220be18f55b.json`.
  Scope: booking route, new runtime-regression suite, safe suite entrypoint and
  these three knowledge documents. No frontend/schema/migration/profile changes.
- Reproduction: `env -i PATH="$PATH" node --test tests/booking-runtime-regression.test.mjs`
  produced 8 failures / 7 passes before implementation. Source is evaluated
  without app imports; in-memory Fastify inject, Zod and a synthetic relational
  store only. No Prisma, dotenv, socket listener, provider or environment read.
- B03 root cause: OWNER and STAFF shared salon.ownerId predicate. GET now uses
  active/unrevoked StaffMembership for Staff, retaining OWNER and ADMIN scopes
  and contact-only related User selection. No write permissions are broadened.
- B04 root cause: validator ignored workingDays and rejected Sat/Sun globally.
  The persisted seven-day schedule contract now governs explicit nonempty
  configurations; absent/empty schedules retain the previous fallback. Existing
  holiday, duration, clock, timezone, overlap and mutation logic is preserved.
- B08 reproduced by prior browser submission and traced through bookingTip,
  index.html bookingForm gate and authenticated POST. No approved guest rule
  exists in reviewed requirements. No copy/auth change; the owner decision is
  recorded above instead of treating marketing text as authorization policy.
- PASS: 15 new tests, 14 prior booking tests, 101 total safe tests via
  `env -i PATH="$PATH" node scripts/salo-checks.mjs test`. The new suite was
  manually reviewed for isolation and explicitly added to the fixed safe list;
  no existing suite hashes or guards were rewritten.
- PASS: `env -i PATH="$PATH" node scripts/salo-checks.mjs browser --browser system-chromium`:
  six intercepted browser suites. These are fixtures, not live signed-in UI.
- PASS: 18 real HTTP/content assertions after restarting only the identified
  task-owned backend from a fresh patched source copy. Original disposable PG16
  identity/system id and isolation reverified before connection. Includes all
  four logins/CORS, Staff own/foreign salon booking reads, Saturday create,
  Owner confirm, Customer cancel, overlap rejection and preserved guest/Staff
  write denials. Only synthetic data in the task-created cluster was used.
- BLOCKED: signed-in browser automation still reports
  `Browser Use could not read requirements`; no full UI success claimed.
- FAIL: full isolated-client tsc exits 2 with the same 21 documented diagnostics
  in salon-archive.test.ts (18), salon-deletion-policy.test.ts (1),
  staff-membership.test.ts (1), salons.ts (1); none names bookings.ts.
- Release-only blocker: CANONICAL_HASH_MISMATCH remains separate; no baseline,
  canonical SQL, schema, frozen hashes or permanent executor changed.
- PASS: scoped fast gate, whitespace/syntax checks and bounded changed-source
  secret scan (zero findings). Scoped finish exits 1: the known 21 full-project
  TypeScript errors are FAIL, and automatic booking-route coverage mapping is
  BLOCKED. The explicit 29 booking regressions and 18 disposable HTTP checks
  supply narrower evidence; no runner mapping or failing gate was waived.
- Next safe work after review: owner decision on B08; separately specify Staff
  booking mutations and the remaining B04 schedule/holiday rules; resume real
  signed-in UI checks once browser automation is available. B02 concurrency
  remains unresolved and is not fixed by these read/day-validation patches.

## Compiler batch V04: service price contract

- Local preservation: `b54ff62` contains the six reviewed booking-fix files;
  101 safe tests passed again, bounded source scan zero findings, no push.
- Capture `.verification-test-build/quality-gate/022e3df9-9b59-4018-a997-e8764ae5ab24.json`;
  scope salons.ts, new service-price regression, safe suite entrypoint and
  three knowledge documents. The normalizer and Prisma/schema remain unchanged.
- Reproduction: service-price regression's in-memory TypeScript program fails
  TS2345 before the adapter; three runtime fixtures already pass. Afterward all
  four pass. No test assertions or compiler options were weakened.
- Expected behavior: partial updates retain persisted price, explicit zero or
  valid string price overrides it, and existing normalization stays identical.
  The one-line Decimal-to-Number adapter preserves those behaviors.
- Full `node scripts/salo-checks.mjs typecheck` now has 20 test-only diagnostics;
  the application diagnostic in salons.ts is resolved. No database access.

## Compiler batch V05 and browser investigation V06

- Capture `.verification-test-build/quality-gate/b8ff0182-5f76-470b-89ee-b2c6bf4d00ba.json`:
  three affected test files and these three documents. No production source,
  tsconfig, schema, historical SQL, integrity code or suite pins changed.
- Reproduced the 20 remaining diagnostics after V04. Fixed overly broad object
  fixture types, nullable revocation timestamps, optional archive-content
  assertions, and explicit test-only legacy/untyped call boundaries. V1 boost
  fixtures keep their minimal historical content, without fabricated billing data
  or changes to the strict current production input contract.
- PASS: full guarded Client generation plus strict noEmit: exit 0, zero errors.
- PASS: 113 archive, 45 deletion-policy and 13 membership tests before and after.
  Task-local loader maps Prisma to the freshly generated engine-free Client for
  Decimal/schema metadata, permits only the eight reviewed source/test files and
  four required Node builtins, and runs with offline-tool-guard.cjs. No Client
  instance/DB transport; injected transaction readers are synthetic. Guard logs
  show no env-file or network attempts. Existing default suite mappings/pins are
  unchanged. Harness location is in `.verification-test-build/typed-fixtures-current.txt`.
- V06: documented browser troubleshooting followed; tool inactivity reset was
  handled by reinitialization, not environment modification. Inventory and native
  navigation work. DOM inspection fails on SALO and a script-free control page
  with the same `Browser Use could not read requirements` error. The control
  returns HTTP 200 and has the expected browser title; no SALO JS/auth/DB code.
  Application/tooling source does not contain that error. Exact provider cause
  unknown; no repository workaround, security bypass or dependency reinstall.
- Remaining: B08 guest-booking decision, Staff mutation permissions, B02 booking
  conflict race, remaining holiday/timezone/overnight policies, managed-browser
  restoration and frozen release integrity. Zero TypeScript diagnostics do not
  certify these independent behaviors or staging readiness.
- Final PASS: 105 default safe tests, six intercepted Chromium suites, four skill
  metadata/reference checks, CI YAML/safety checks, bounded source secret scan
  with zero findings, and scoped fast/review gates. Scoped finish is BLOCKED
  only by unmapped backend behavior coverage; its full TypeScript check passes.
  The 171 separately guarded fixture tests are additional evidence, not a runner
  mapping waiver. Frozen integrity still exits 2 CANONICAL_HASH_MISMATCH.

## B08 / P-BOOK-001 — approved booking authentication policy

- Owner decision (2026-11-15): authenticated Customers only; guest booking is
  unsupported. [Product requirements](SALO-PRODUCT-REQUIREMENTS.md) supersedes
  earlier B08 questions without inventing a guest policy.
- Starting checkout: clean `b0fec5d`, verified SALO origin/snapshot ancestry.
  Initial capture `.verification-test-build/quality-gate/b3440d8c-c749-4dc7-89dd-d18a5d9e8908.json`.
  Scope expanded before changing the workflow test/quality-gate suite label to
  integrate the new audited browser suite; expanded capture
  `.verification-test-build/quality-gate/0e9934e8-75cd-4d81-8e3b-bc8f04bb1efe.json`.
- Root cause: main bookingTip falsely promised no registration; the frontend
  hid the prepared drawer for login without reopening it. POST authenticated
  accounts but did not restrict creation to persisted CUSTOMER role.
- Fix: localized main/women policy notices; context-specific login/register
  notices; reopen the unchanged in-memory form after successful Customer auth;
  valid option retention, API-401 reauth and supported women handoff restoration.
  No automatic POST/retry, new persistent draft or registration system.
- Backend: retain actual JWT/account/version checks and reject non-Customer
  persisted roles before booking access. One older creation-security test now
  uses its intended Customer actor so its foreign-barber assertion stays reachable.
- Reproduction: 3 of 13 new auth-route tests failed before the role guard;
  all 13 pass afterward. Actual auth/JWT/version/booking source, real synthetic
  token signatures and fake persistence are evaluated without app/DB imports.
- New browser suite is explicitly reviewed: fresh contexts, all HTTP fulfilled
  from fixed local pages/assets or synthetic APIs; all other traffic aborted;
  WebSockets denied, no live email or persistent profile. Only its new digest is
  added; existing suite pins and release integrity hashes remain untouched.
- Retention limits: main in-page auth retains service/barber/date/time/notes;
  full reload/profile-page navigation does not persist a new draft. Existing
  women's service labels are not authoritative API IDs and are not auto-mapped.
- Remaining independent decisions: Staff booking mutations, scheduling policies
  and B02 concurrency model. Managed-browser and frozen-release blockers remain
  separate; P-BOOK-001 resolves the guest-policy question.
- Review correction: explicitly closing the login/register modal or logging out
  clears the pending booking return. Programmatic switches and successful auth
  retain it. This prevents an ordinary later login from reopening a cancelled
  booking; two additional browser scenarios cover the cancellation path.
- PASS: 118 default safe tests (13 new auth-policy tests); 53 existing booking
  security tests under a task-local fixed import graph, inert Prisma mock and
  offline network/env guard; seven intercepted browser suites including 22 new
  root/www DE/EN/AR scenarios. Synthetic registration requests are intercepted;
  no real provider/email or database is contacted. TypeScript noEmit passes.
- A pre-existing synthetic signing-key literal in the edited legacy security
  suite initially triggered the bounded scan. It is now an explicit test fixture
  constant with identical bytes; no scanner suppression or real credential used.
- Full reload/profile navigation remains outside in-page selection retention.
  Unknown women's service labels require an actual service selection; they are
  not silently converted into trusted IDs. No new persistent personal draft.
- Existing remember-login password storage was observed in source and recorded
  as A02; no credential values were accessed and its behavior was not expanded.
- Final validation: 118 safe tests, 53 guarded existing booking-security tests,
  all seven intercepted browser suites (22 new policy scenarios), and strict
  isolated-client TypeScript pass. Root/www parity, syntax, scope, skill/config
  checks and bounded scan pass. Scoped finish remains BLOCKED only by unmapped
  backend behavior coverage; explicit route tests do not waive that limitation.
  Frozen integrity still refuses CANONICAL_HASH_MISMATCH. No schema/history/hash
  edits, production data/provider access, commits, pushes or deployments.

## Batch U01 / W01 — Admin consistency and Women recovery

- Starting checkout: origin `bdkd103-maker/salon`, branch `salo-cloud-work`,
  HEAD `b0fec5de6142d2d42d8d013879fc67fc723cf762`; approved a8429d3 ancestry
  verified. Existing 17-file booking-policy work was copied byte-for-byte into
  an ignored preservation directory before edits; no stash/reset/cleanup.
- Root causes: Owner-only selectors left Staff's shared shell classes unstyled;
  mobile Owner sidebar was hidden without a toggle; modal stacking was below
  public navigation. Profile navigation used wide implicit horizontal columns.
  Reused Admin tokens and existing components; no Admin redesign or role changes.
- Reproduced red/green: Staff shell computed `block` instead of `grid`; Women
  premium returned budget; women-only aliases returned false; login validation
  was hardcoded Arabic. Browser interaction tests also caught covered close
  controls. Added pure tests plus an explicitly reviewed/pinned intercepted
  browser suite; old seven suite digests remain unchanged.
- Women loading/error/retry now distinguishes failed requests from empty data,
  uses existing translated components and refetches on retry. Existing open-now
  operating helper remains authoritative. No changes to numeric price bands,
  schedule business rules, permissions or booking authentication.
- Product clarification: evening/morning filters have weak/inconsistent existing
  predicates; define their intended availability windows before rewriting them.
  Germany price-band thresholds and classification of unisex salons as women
  versus women-only need owner criteria. Existing generic Women service labels
  still require an authoritative service choice at booking handoff (B08).
- Remaining UI work: Admin portal is currently English-only (no existing locale
  dictionary); legacy inline Admin, subscription/partner/message management,
  populated long tables, full validation/server-error translation and real
  notification delivery need separate targeted coverage. No complete UI audit
  or live authenticated E2E claim. Existing V06 and frozen release integrity
  blockers remain isolated; no browser-provider configuration or hashes changed.

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

Final review: scoped fast/finish gates PASS on the completed UI changes; all
eight browser suites remain green including contrast, localized close/error
labels and successful decoding of the existing SVG fallback. Static navigation
inspection found all six literal local Women link/anchor targets in each copy
resolve. External maps/telephone destinations were not contacted. Selected
refreshed Women and control-panel screenshots were inspected; this does not
certify all populated application states or external font/icon availability.

## Batch U02 — presentation-only follow-up (2026-11-15)

- Preserved all 23 pre-existing changed safe files in an ignored byte-copy
  snapshot before implementation. Verified origin and b0fec5d ancestry. This
  batch changes no filtering, booking, auth, database or permission behavior.
- Subscription and Message Inbox now reuse the existing Admin palette, fonts,
  controls, card borders and responsive columns. All existing actions remain.
  Their close buttons have translated accessible names and dialog headings.
  Admin itself and the legacy inline Admin design remain unchanged.
- Customer profile translations incorrectly claimed deletion affected only the
  device and that the page never contacted the server. Read-only route/handler
  tracing shows DELETE /auth/me marks the account DELETED and revokes sessions;
  PUT /profile/me sends name/phone/email. Copy now describes these existing
  actions without promising erasure of every retained record. No deletion was
  executed against a server. Password change is already unsupported here;
  misleading intro/required-password messages were corrected, not implemented.
- Arabic account deletion label now matches the existing Delete-account action;
  the shared Customer area label is generic, and its back arrow mirrors in RTL.
- Women's Premium badge contrast reproduced at 1.76:1 over the existing dark
  card; existing ink/gold-soft tokens on an opaque badge give 13.61:1. A real
  isolated Chromium CSS comparison uses before/after source without scripts
  or network. No Premium qualification/filter logic was changed.
- Regression additions: accurate DE/EN/AR account warnings/validation, native
  confirmation cancellation sends no DELETE, required-field rejection sends no
  PUT, Arabic arrow direction, auxiliary panel sizing/focus/close reachability,
  and Premium badge >=4.5:1 contrast. All old browser-suite pins remain fixed;
  only the explicitly re-reviewed UI suite's own digest changes.
- Source comparison: Women's behavior JS is unchanged; only its locale
  dictionary is extended. Customer changes only the translations object.
  Main-page JS changes only locale copy and render helpers to set accessible
  close and registration-phone labels.
  Existing event handlers, IDs, request payloads and data flows remain.
- Open product work skipped: implementing profile password changes, server
  persistence of city/service/notes, altering Women morning/evening/price bands
  or unisex classification. These need approved functionality requirements.
  Admin full DE/AR localization and all populated legacy screens remain outside
  this bounded verification; no claim of full UI or live E2E certification.

U02 verification: 131 safe tests pass (104 root regressions and 27 audited
backend units), including two new locale-copy cases. Strict TypeScript passes
with a fresh engine-free Prisma Client and no .env/database access. The expanded
intercepted UI suite passes 108 viewport/panel render checks and six root/www
DE/EN/AR Women scenarios, now including actual search typing/button/reset,
favorites rollback and booking entry. Original literal links, IDs and close
action targets are preserved on all three touched pages; all six static local
Women link/anchor targets resolve in each copy. Successful account deletion,
password changes, live billing, real message persistence, notification delivery
and native devices are not certified. No filtering/booking changes in U02.

Final localization follow-up: registration phone country/national-number
accessible names were English-only in both public pages. Added DE/EN/AR labels
through the existing dictionaries and rendering hooks, with pure red/green
tests and actual DOM checks in both copies. +49 display, input values,
normalization, validation, requests and authentication handlers are unchanged.

U02 final finish gate PASS: all eight audited intercepted browser suites pass
on the completed source, including the extended 108 viewport/panel checks,
search/reset, localized registration metadata, required-field and confirmation
cancellation scenarios. 131 safe tests, strict TypeScript, byte parity, syntax
and scoped checks pass. Bounded scan covers 23 changed safe files with no
findings. Fourteen paths changed in this task; nine non-overlapping existing
changed files remain byte-identical. No backend, Admin, database schema/history,
release hashes, permissions, authentication or booking behavior changed here.

## Development-system consolidation — 2026-11-16

- Verified origin; fetched only salo-cloud-development at 6d54104; task HEAD
  b0fec5d descends from it. Preserved all 23 existing changed safe files before
  work. Eighteen non-overlapping pre-existing files remain byte-identical; five
  existing source documents were deliberately consolidated in scope.
- Expanded AGENTS and the four existing Skills; added the code-linked system
  integration map, consolidated owner decisions and corrected stale npm-test/
  browser summaries. Kept this file's one current prioritized queue and all
  historical issue IDs/batch evidence. No product feature implementation.
- PASS: four Skill metadata contracts, 69 local Markdown links, 131 safe tests,
  strict offline-client noEmit, safe CI configuration and bounded scan of 29
  changed safe files with no findings. Frozen integrity remains BLOCKED.
- Remaining: owner decisions/dependencies in the current queue, reviewer approval
  and publication of local work, client reload/discovery, real DB/concurrency/
  device/provider evidence. No commit, push, merge, deployment or credential use.
- Immediate execution was completed directly in the Cloud workspace after the
  saved automation run-now endpoint returned 404 before invocation. No duplicate
  background run was started and the original saved schedule was not modified.
