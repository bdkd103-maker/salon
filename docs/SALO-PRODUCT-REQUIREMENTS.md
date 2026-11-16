# SALO owner-approved product requirements

This file records explicit owner decisions. Implementation details and test
results belong in the knowledge, feature-status and engineering-backlog files.
Do not infer additional business policy from marketing copy or current code.

Consolidated 2026-11-16. This is the owner-decision register, not a claim that
all requested features are complete. See [feature status](SALO-FEATURE-STATUS.md),
[system integration](SALO-SYSTEM-INTEGRATION.md),
[project knowledge](SALO-PROJECT-KNOWLEDGE.md) and the
[single backlog](SALO-ENGINEERING-BACKLOG.md) for implementation and evidence.

## P-CONTEXT-001 — Existing product scope

Source: the owner's ongoing-development and development-system tasks.

- SALO is a multi-salon booking and smart queue platform serving Germany.
- Customer, Salon Owner, Staff and Platform Admin are distinct roles.
- Existing scope includes discovery, booking, profiles/favorites, team and
  service operations, SALO Ticket/live queue, SMART Core/ETA, notifications,
  loyalty, global administration, DE/EN/AR responsive interfaces and Capacitor
  Android/iOS integration. Scope is not proof of implementation or correctness.
- Preserve completed features and the existing architecture. Reuse existing
  systems rather than rebuilding queues, authentication, rewards or panels.

## P-UI-001 — Design, localization and preservation

Source: the owner's UI/UX and Control Panel Consistency instructions.

- The existing standalone Admin Panel is the control-panel design reference;
  do not redesign Admin or introduce a different SALO visual identity.
- Preserve role-specific navigation, forms, actions, permissions and data flows.
- Maintain German, English, Arabic, Arabic RTL and root/www web/native parity.
- Presentation/translation work does not authorize changes to authentication,
  booking, filtering, database behavior or other business rules.

## P-ENGINEERING-001 — Evidence and safe development

Source: the owner's development-system task and earlier safety instructions.

- Verify the repository/development source and preserve tracked/untracked work.
  Leave changes for review; documentation work is not commit/push/merge approval.
- Keep one prioritized engineering backlog with dependencies, reproducible
  defects, missing features, evidence boundaries and decisions needing approval.
- Do not invent scheduling, capacity, guest, billing, onboarding consent,
  retention or communication requirements. Record uncertainty for the owner.
- No production data, real credentials, deployments or destructive operations.
  Do not rewrite historical migrations/frozen checksums or bypass release gates.

Owner-approved product behavior is recorded below. Operational walk-in intake
is documented as existing implementation in the integration map; it does not
create an exception to the no-guest-booking decision.

## P-BOOK-001 — Customer authentication before booking

Status: **approved by the product owner, 2026-11-15**.
Source: the owner's “Official Booking Authentication Policy” task.

- Customers must log in or register before confirming/submitting a booking.
  Guest bookings are not supported.
- Discovery and preparing booking selections remain available before login.
  The UI must explain the authentication requirement in German, English and
  Arabic before submission and when opening authentication from booking.
- Booking creation requires a valid existing session and a persisted, active
  CUSTOMER account. Local browser state, caller-supplied identity and JWT role
  claims alone cannot grant permission. Existing account/version checks remain.
- Authentication returns the customer to their prepared booking where the
  existing architecture supports it. It must not submit automatically: the
  customer reviews the form and explicitly submits after authentication.
- Retain valid selections in the existing page/form rather than introducing
  new persistent personal-data drafts. Reuse supported fields from the existing
  women's-page handoff; unknown service labels must not become API service IDs.

This decision does not change booking lifecycle statuses: creation still makes
a PENDING booking. Owner/Admin management, Staff read/mutation boundaries,
cancellation, overlap/capacity, timezone and holiday policies are separate.
It does not enable invitations, alter signup verification or approve a new
retention, guest-identity, payment or communication system.
