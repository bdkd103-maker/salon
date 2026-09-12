import assert from "node:assert/strict";
import test from "node:test";

import { resolveEffectiveStaffPresence } from "./staff-presence.js";

const now = Date.parse("2026-09-09T12:00:00.000Z");
const membership = {
  id: "membership-1",
  status: "ACTIVE",
  revokedAt: null,
};
const validLease = {
  staffMembershipId: membership.id,
  generation: 3,
  evidenceSource: "STAFF_APP",
  producerKey: "app-session-1",
  observedAt: new Date(now - 30_000),
  validUntil: new Date(now + 30_000),
  revokedAt: null,
};
const onDutyPresence = {
  staffMembershipId: membership.id,
  dutyState: "ON_DUTY",
  generation: 3,
  leases: [validLease],
};

test("missing presence fails closed as OFF_DUTY", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, null, now), "OFF_DUTY");
});

test("explicit OFF_DUTY ignores otherwise valid evidence", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    dutyState: "OFF_DUTY",
  }, now), "OFF_DUTY");
});

test("ON_DUTY intent alone is STALE", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [],
  }, now), "STALE");
});

test("a current generation lease confirms ON_DUTY", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, onDutyPresence, now), "ON_DUTY_CONFIRMED");
});

test("a lease is stale at the exact expiry boundary", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [{ ...validLease, validUntil: new Date(now) }],
  }, now), "STALE");
});

test("an expired lease models app crash or disconnect as STALE", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [{ ...validLease, validUntil: new Date(now - 1) }],
  }, now), "STALE");
});

test("old-generation evidence cannot confirm current presence", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [{ ...validLease, generation: 2 }],
  }, now), "STALE");
});

test("revoked evidence cannot confirm current presence", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [{ ...validLease, revokedAt: new Date(now - 1) }],
  }, now), "STALE");
});

test("future or invalid evidence cannot confirm current presence", () => {
  for (const lease of [
    { ...validLease, observedAt: new Date(now + 1) },
    { ...validLease, observedAt: new Date(NaN) },
    { ...validLease, validUntil: new Date(NaN) },
    { ...validLease, observedAt: new Date(now + 10_000), validUntil: new Date(now + 10_000) },
  ]) {
    assert.equal(resolveEffectiveStaffPresence(membership, {
      ...onDutyPresence,
      leases: [lease],
    }, now), "STALE");
  }
});

test("one valid source confirms presence when other sources are stale or revoked", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    leases: [
      { ...validLease, validUntil: new Date(now) },
      { ...validLease, evidenceSource: "OWNER", producerKey: "owner-1", revokedAt: new Date(now - 1) },
      { ...validLease, evidenceSource: "SERVICE_EVENT", producerKey: "visit-1", staffMembershipId: "membership-2" },
      { ...validLease, evidenceSource: "SALO_STATION", producerKey: "station-1" },
    ],
  }, now), "ON_DUTY_CONFIRMED");
});

for (const status of ["SUSPENDED", "REVOKED"]) {
  test(`an inactive ${status.toLowerCase()} membership fails closed`, () => {
    assert.equal(resolveEffectiveStaffPresence({ ...membership, status }, onDutyPresence, now), "OFF_DUTY");
  });
}

test("a membership revocation timestamp fails closed", () => {
  assert.equal(resolveEffectiveStaffPresence({
    ...membership,
    revokedAt: new Date(now - 1),
  }, onDutyPresence, now), "OFF_DUTY");
});

test("presence for another membership fails closed", () => {
  assert.equal(resolveEffectiveStaffPresence(membership, {
    ...onDutyPresence,
    staffMembershipId: "membership-2",
  }, now), "OFF_DUTY");
});