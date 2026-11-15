# Development snapshot security review

Scope: current development snapshot on `salo-cloud-development`. No live
credentials, environment files, databases or live verification scripts were
used to validate authentication. No credential values are reproduced here.

The initial local content scan was conservative. Each of its 19 flagged paths
was reviewed for the value's source and use, rather than trusting a test filename.

| Path | Classification and evidence |
| --- | --- |
| backend/.env.example | Uncertain database connection example, sanitized to explicit replacement markers. Real local environment files were not changed. |
| backend/src/lib/staff-onboarding-foundation.test.ts | Harmless fixture: email configuration passed to the email builder; invitation persistence uses an injected in-memory store. |
| backend/src/lib/verification-email.test.ts | Harmless fixture: synthetic provider configuration with an injected fetch stub and an assertion on the mock authorization header. |
| backend/src/routes/account-status-security.test.ts | Harmless fixture: login password corresponds to a hash generated inside the test; Prisma methods are replaced with in-memory functions. |
| backend/src/routes/admin-salon-create-persistence.test.ts | Harmless fixtures: mocked provisioning payloads, mocked persistence and Fastify injection; hash verification uses the test's own input. |
| backend/src/routes/auth-flow.test.ts | Harmless fixtures: mocked Prisma login/provisioning accounts and locally generated test hashes. |
| backend/src/routes/auth-refresh.test.ts | Harmless fixtures: test passwords are hashed locally and supplied to Fastify injection against a mocked session/user store. |
| backend/src/routes/customer-password-reset.test.ts | Harmless fixtures: injected verificationTestDatabase and Fastify requests; no imported account password. |
| backend/src/routes/messages-security.test.ts | Harmless synthetic serialization data: incomplete hash-shaped strings in mocked sender/receiver objects, used to assert sensitive fields are omitted; not usable password hashes. |
| backend/src/routes/owner-team-provisioning.test.ts | Harmless fixtures: in-memory mocked transaction/user/membership store; password verification compares the newly generated hash with the same test payload. |
| backend/src/routes/registration-verification.test.ts | Harmless fixture: injected verificationTestDatabase, stubbed email delivery and Fastify injection. |
| backend/test/e2e-core-operations.test.ts | Harmless fixture: provisioning request against mocked Prisma methods and Fastify injection, not a live account. |
| backend/test/run-foundation-tests.mjs | Harmless connection stub: harness blocks environment-file reads and explicitly assigns a dummy database URL. This review does not authorize arbitrary tests through that harness. |
| backend/test/verify-real-postgres-create-salon.ts | Harmless generated test credential: template includes a runtime random UUID suffix, used for newly created disposable accounts. Script can modify a database and was not run. |
| backend/test/verify-real-postgres-favorites.ts | Harmless generated test credential: runtime random UUID suffix and newly created disposable accounts. Script was not run. |
| backend/test/verify-real-smart-wait.ts | Harmless generated test credential: runtime random UUID suffix and newly created disposable accounts. Script was not run. |
| index.html | Noncredential false positive: DE/EN/AR translation labels in extraTranslations, not authentication input. |
| tests/customer-password-reset.spec.js | Harmless fixture: legacy localStorage input in a browser context whose application/API requests are fulfilled by route mocks. |
| www/index.html | Same noncredential translation labels as the root frontend. |

Temporary captures, logs, caches, local database artifacts, private-key files
and local-only credential diagnostics are excluded. Existing source files and
local diagnostic files are preserved. A scan of the exact staged tree is still
required before commit; this document is not a blanket secret-scan exemption,
an exhaustive history scan, or proof of application correctness.
