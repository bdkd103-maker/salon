# SALO engineering backlog

Updated 2026-11-15. Base `6d541047ca095c2c6f1acf0d399513c587df9b10`;
branch `salo-cloud-work`. The owner has now explicitly authorized local commits
to preserve completed work; push, main merge and deployment remain prohibited.
See [knowledge](SALO-PROJECT-KNOWLEDGE.md) and
[feature status](SALO-FEATURE-STATUS.md).

Priority: P0 blocks reliable installation/security verification; P1 is high
security/business impact; P2 is bounded correctness/completion. Severity is not
authorization to migrate, deploy, access credentials or change product policy.

## Ordered work

| ID | Priority / state | Evidence, impact and acceptance / dependency |
| --- | --- | --- |
| R01 | P1 / fixed locally | server.ts formerly trusted decoded JWT sub. Now uses existing verifyAccessToken; signature/expiry/claims validated before selecting user bucket, invalid headers use IP. Six regression tests pass; see batch log. |
| M01 | P0 launch / blocked | 20260909231832 QueueEntry FK references ServiceVisit before 20260910130000 creates it. Requires approved migration strategy and disposable PostgreSQL install/upgrade validation; do not reorder history blindly. |
| V01 | P0 verification / blocked | Full-project tsc fails, including generated Prisma type gaps and unrelated existing errors. Establish migrated-schema/client compatibility locally through separately scoped generation review, then repair real remaining compiler failures. |
| V02 | P1 / fixed locally | Four mismatched suites manually re-audited and explicitly pinned; byte-preserving CRLF normalization avoids checkout-only drift. Ten workflow and 27 audited pure-unit tests pass; browser guard passes. See V03 for browser execution. |
| V03 | P2 / environment blocked | The six browser suites configure headless Microsoft Edge; Edge is absent in this Cloud image. System Chromium exists but is not silently substituted. No browser installation or configured-mode change performed. |
| B01 | P1 / fixed locally | booking-time.ts formerly compared only clock minutes; now requires same salon-local date for daytime intervals. Nine tests pass including existing helper tests and route validator coverage; overnight helper branch preserved. |
| B06 | P1 / fixed locally | Missing/unparseable timestamp components now return Invalid Date, reaching existing invalid-window validation. Twelve booking tests pass, including six in-memory POST requests returning 400 before overlap reads/writes. |
| B07 | P1 / fixed locally | Impossible calendar dates and out-of-range clock fields no longer normalize into a different booking date/time. Fourteen booking tests pass, including leap-day/month-end boundaries and in-memory POST rejection before booking access. |
| B02 | P1 / confirmed code race | bookings.ts checks overlaps before its creation/update transaction, with no matching exclusion constraint in schema/SQL. Concurrent writers can pass the count. Needs concurrency model, capacity rules and isolated DB evidence; not fixed by moving count alone. |
| S01 | P1 / blocked cutover | owner-team.ts creates ACTIVE staff with emailVerified true and links existing STAFF by email without consent. Dormant invitation foundation is not a fix. Define consent/linking/recovery policy, migration/client rollout and staged cutover tests. |
| B03 | P1 / owner questions | Booking STAFF access uses salon.ownerId=user.id, despite active-membership-based operations elsewhere. Which booking operations may STAFF perform? Avoid granting access until specified. |
| B04 | P1 / owner questions | Booking validation hardcodes weekends, 2026 holidays, client/default timezone and rejects overnight configs. Weekly schedules support other days/timezones. Define authoritative schedule, German state holidays and overnight/DST policy. |
| B05 | P1 / owner questions | PATCH status-only mutations still validate current schedule/overlaps; may block cancellation/completion after schedule changes. Define status-only acceptance and historical-booking policy before changing it. |
| A01 | P1 / owner question | Logout revokes refresh Sessions but not issued access JWTs (15-minute expiry). Define immediate logout invalidation requirement before adding DB writes/version changes. |
| E01 | P2 / incomplete by design | SMART ETA has no staff-service capability relation; walk-ins without assigned duration produce unknown ETA. Define requirements before adding models or invented durations. |
| N01 | P2 / investigate | Availability-watch notification dedupe is user/salon-wide; review whether rearming a fired watch should produce a new event. No business rule inferred. |
| U01 | P2 / unknown | Responsive UI, AR RTL and DE/EN/AR completeness need intercepted viewport/keyboard suites after V02; device behavior remains separate. |
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
