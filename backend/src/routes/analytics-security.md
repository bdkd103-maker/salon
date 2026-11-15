# Analytics events: first-stage security boundary

`POST /api/v1/analytics/events` requires valid authentication and records the
authenticated user's ID. Missing, empty, whitespace-only or invalid `salonId`
values return 400; a nonexistent salon returns 404 before any event is created.
Authentication runs first, so unauthenticated requests return 401.

Authenticated customers may submit discovery events for any existing public
salon without ownership, booking history, favorites or staff membership.
This stage checks existence only; it does not add a salon visibility policy.
Existing event names, aliases, unknown-name normalization, source defaults,
metadata and successful response shape remain unchanged. Existing frontend
tracking supplies a bearer token; anonymous tracking now receives 401.

## Confirmed duplicate-reply cause

Previously, the route swallowed an authentication failure after the shared auth
helper had sent 401, continued to create an anonymous event, and returned another
response. A Fastify injection test reproduced `FST_ERR_REP_ALREADY_SENT` with an
invalid token. Authentication errors now stop processing, and the route's catch
returns an already-sent reply rather than sending a second response.

## Residual risk and separate follow-up

Authentication and salon existence checks do **not** prove an event occurred.
An authenticated client can forge, replay or repeatedly submit events for an
existing salon and inflate its analytics. Event types (including conversion-like
types), source and metadata remain client-controlled; the existing unknown-type
fallback is intentionally preserved. These events must not be treated as verified
conversions or payment/accounting evidence.

A separate follow-up should evaluate:

- Rate limits and abuse monitoring per account, IP and target salon.
- Event allowlists, per-event metadata validation, size limits and replay or
  duplicate controls, with an explicit compatibility plan.
- Server-side authoritative conversion tracking from validated booking,
  registration, referral and payment operations, separated from client-reported
  discovery signals.

Tests use Fastify injection, actual JWT verification with a test-only secret, and
mocked Prisma persistence. They do not access or alter a database.
