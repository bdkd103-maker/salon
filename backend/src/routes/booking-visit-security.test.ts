import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { staffStatusRoutes } from "./staff-status.js";

// Route contracts with actual JWT checks and isolated Prisma doubles; no DB access.
const mock = prisma as any;
const keys = ["user", "salon", "staffMembership", "booking", "serviceVisit", "platformSettings", "loyaltyCard", "loyaltyStamp", "$transaction", "$queryRaw"];
const original = Object.fromEntries(keys.map(key => [key, mock[key]]));
const originalSecret = process.env.JWT_ACCESS_SECRET;
let actor: any, membership: any, booking: any, visits: any[], reads: string[], loyaltyCalls: number, conflict: string | null;
beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "booking-visit-test-only";
  actor = { id: "staff-1", role: "STAFF", status: "ACTIVE" };
  membership = { id: "member-1", salonId: "salon-1", userId: "staff-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null,
    presence: { staffMembershipId: "member-1", dutyState: "ON_DUTY", generation: 1,
      leases: [{ staffMembershipId: "member-1", generation: 1, revokedAt: null,
        observedAt: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 300000) }] } };
  booking = { id: "booking-1", salonId: "salon-1", barberId: "barber-1", status: "CONFIRMED" };
  visits = []; reads = []; loyaltyCalls = 0; conflict = null;
  mock.user = { findUnique: async () => actor };
  mock.salon = { findUnique: async () => ({ id: "salon-1", ownerId: "owner-1", walkInIntakeEnabled: true }) };
  mock.staffMembership = { findUnique: async () => structuredClone(membership) };
  mock.platformSettings = { findUnique: async () => ({ walkInGloballyEnabled: true }) };
  mock.booking = { findUnique: async () => { reads.push("booking"); return structuredClone(booking); } };
  mock.$queryRaw = async (parts: TemplateStringsArray, ...values: any[]) => {
    assert.match(parts.join("?"), /SELECT.*Booking.*FOR UPDATE/);
    assert.ok(values.includes("booking-1")); assert.ok(values.includes("salon-1"));
    reads.push("lock"); return [];
  };
  mock.serviceVisit = { create: async ({ data }: any) => {
    reads.push("create");
    if (conflict) throw Object.assign(new Error("Fixture conflict"), { code: conflict });
    const visit = { id: "visit-1", ...data }; visits.push(visit); return visit;
  } };
  const unexpectedLoyalty = async () => { loyaltyCalls++; throw new Error("Start must not earn loyalty"); };
  mock.loyaltyCard = { findFirst: unexpectedLoyalty };
  mock.loyaltyStamp = { createMany: unexpectedLoyalty };
  mock.$transaction = async (run: any) => run(mock);
});
afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = originalSecret;
});
async function start(payload: any = { staffMembershipId: "member-1", source: "BOOKING", bookingId: "booking-1" }) {
  const app = Fastify(); await app.register(staffStatusRoutes);
  try {
    return await app.inject({ method: "POST", url: "/api/v1/salons/salon-1/service-visits",
      headers: { authorization: `Bearer ${signAccessToken({ sub: actor.id, role: actor.role })}` }, payload });
  } finally { await app.close(); }
}
function noEffects() { assert.deepEqual(visits, []); assert.equal(loyaltyCalls, 0); }
for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW", "UNKNOWN"]) {
  test(`rejects ${status} booking without creating visit or earning loyalty`, async () => {
    booking.status = status; const before = structuredClone(booking);
    const response = await start(); assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(booking, before); noEffects();
  });
}
for (const role of ["STAFF", "OWNER", "ADMIN"]) {
  test(`${role} cannot start a booking using a membership for the wrong assigned barber`, async () => {
    actor = { ...actor, role, id: role === "STAFF" ? "staff-1" : role === "OWNER" ? "owner-1" : "admin-1" };
    booking.barberId = "barber-2";
    const response = await start(); assert.equal(response.statusCode, 403, response.body); noEffects();
  });
  for (const status of ["PENDING", "CONFIRMED"]) {
    for (const assigned of [true, false]) {
      test(`${role} can start ${status} ${assigned ? "correctly assigned" : "unassigned"} booking`, async () => {
        actor = { ...actor, role, id: role === "STAFF" ? "staff-1" : role === "OWNER" ? "owner-1" : "admin-1" };
        booking.status = status; booking.barberId = assigned ? "barber-1" : null;
        const before = structuredClone(booking);
        const response = await start(); assert.equal(response.statusCode, 200, response.body);
        assert.equal(visits.length, 1); assert.equal(visits[0].staffMembershipId, membership.id);
        assert.equal(visits[0].bookingId, booking.id); assert.equal(visits[0].status, "IN_SERVICE");
        assert.equal(loyaltyCalls, 0); assert.deepEqual(booking, before);
        assert.deepEqual(reads, ["lock", "booking", "create"]);
      });
    }
  }
}
for (const missing of [false, true]) {
  test(`rejects ${missing ? "missing" : "foreign-salon"} booking`, async () => {
    if (missing) booking = null; else booking.salonId = "salon-2";
    assert.equal((await start()).statusCode, 409); noEffects();
  });
}
for (const issue of ["suspended", "revoked", "foreign-salon", "stale", "off-duty", "another-staff"]) {
  test(`retains ${issue} membership/presence rejection`, async () => {
    // OWNER passes the actor salon check; the execution membership must still be eligible.
    actor = { id: "owner-1", role: "OWNER", status: "ACTIVE" };
    if (issue === "suspended") membership.status = "SUSPENDED";
    if (issue === "revoked") membership.revokedAt = new Date();
    if (issue === "foreign-salon") membership.salonId = "salon-2";
    if (issue === "stale") membership.presence.leases = [];
    if (issue === "off-duty") membership.presence.dutyState = "OFF_DUTY";
    if (issue === "another-staff") actor = { id: "other-staff", role: "STAFF", status: "ACTIVE" };
    const response = await start(); assert.ok([403, 404, 409].includes(response.statusCode), response.body); noEffects();
  });
}
test("preserves immediate WALK_IN start without booking lookup", async () => {
  assert.equal((await start({ staffMembershipId: "member-1", source: "WALK_IN" })).statusCode, 200);
  assert.deepEqual(reads, ["create"]); assert.equal(visits[0].bookingId, null); assert.equal(loyaltyCalls, 0);
});
test("validates the fresh status after acquiring the booking lock", async () => {
  mock.$queryRaw = async () => { booking.status = "CANCELLED"; reads.push("lock"); return []; };
  assert.equal((await start()).statusCode, 409);
  assert.deepEqual(reads, ["lock", "booking"]); noEffects();
});
test("validates the fresh assignment after acquiring the booking lock", async () => {
  mock.$queryRaw = async () => { booking.barberId = "barber-2"; reads.push("lock"); return []; };
  assert.equal((await start()).statusCode, 403);
  assert.deepEqual(reads, ["lock", "booking"]); noEffects();
});
for (const code of ["P2002", "P2025"]) {
  test(`preserves conflict response for ${code}`, async () => {
    conflict = code; assert.equal((await start()).statusCode, 409); noEffects();
  });
}
