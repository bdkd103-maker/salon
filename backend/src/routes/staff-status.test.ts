import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { staffStatusRoutes } from "./staff-status.js";

const original = { $transaction: prisma.$transaction, $queryRaw: prisma.$queryRaw, staffMembership: prisma.staffMembership, salon: prisma.salon, staffPresence: prisma.staffPresence, staffPresenceLease: prisma.staffPresenceLease, serviceVisit: prisma.serviceVisit, user: prisma.user, booking: prisma.booking, service: (prisma as any).service, queueEntry: (prisma as any).queueEntry, platformSettings: (prisma as any).platformSettings };
const mock = prisma as any;

beforeEach(() => { mock.queueEntry={findUnique:async()=>null}; process.env.JWT_ACCESS_SECRET = "staff-status-route-test-secret"; mock.$transaction = async (fn: any) => fn(mock); mock.$queryRaw = async () => [];
  // Keep existing route tests isolated now that operational routes load gates.
  mock.platformSettings = { findUnique: async () => ({ staffStatusLiveEnabled: true, walkInGloballyEnabled: true, saloTicketGloballyEnabled: true }) };
});
afterEach(() => Object.assign(mock, original));

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

test("GET staff/status returns derived occupancy from real data", async () => {
  const serverNow = Date.now();
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.staffMembership = {
    findMany: async ({ where }: any) => {
      if (where.salonId !== "salon-1") return [];
      return [{
        id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1",
        status: "ACTIVE", revokedAt: null,
        presence: {
          staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 1,
          leases: [{ staffMembershipId: "mem-1", generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1",
            observedAt: new Date(serverNow - 10_000), validUntil: new Date(serverNow + 250_000), revokedAt: null }],
        },
        barber: { id: "barber-1", name: "Alice" },
        user: { id: "staff-1", fullName: "Alice Staff" },
        serviceVisits: [],
      }];
    },
    findUnique: async () => null,
  };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: where.id === "owner-1" ? "OWNER" : "STAFF", status: "ACTIVE" }) };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/salon-1/staff/status", headers: auth("OWNER", "owner-1") });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.staff.length, 1);
    assert.equal(data.staff[0].barberName, "Alice");
    assert.equal(data.staff[0].occupancy, "AVAILABLE");
    assert.equal(data.staff[0].presenceState, "ON_DUTY_CONFIRMED");
    assert.equal(data.staff[0].hasActiveVisit, false);
  } finally { await app.close(); }
});

test("PATCH duty ON_DUTY creates presence with lease through Prisma", async () => {
  let createdPresence: any = null;
  let createdLease: any = null;
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: createdPresence ? { ...createdPresence, leases: createdLease ? [ { ...createdLease, revokedAt: null } ] : [] } : null, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" }, serviceVisits: [] };
      return null;
    },
  };
  mock.staffPresence = {
    findUnique: async ({ where }: any) => null,
    upsert: async ({ create }: any) => { createdPresence = { ...create }; return create; },
    update: async ({ data }: any) => { createdPresence = { ...data }; return data; },
  };
  mock.staffPresenceLease = {
    create: async ({ data }: any) => { createdLease = { ...data }; return data; },
    updateMany: async ({ data }: any) => { return { count: 1 }; },
  };
  mock.serviceVisit = { findMany: async () => [] };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1/staff/mem-1/duty", headers: auth("OWNER", "owner-1"), payload: { dutyState: "ON_DUTY" } });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.dutyState, "ON_DUTY");
    assert.equal(data.presenceState, "ON_DUTY_CONFIRMED");
    assert.equal(data.occupancy, "AVAILABLE");
    assert.ok(createdPresence);
    assert.equal(createdPresence.dutyState, "ON_DUTY");
    assert.ok(createdLease);
    assert.equal(createdLease.staffMembershipId, "mem-1");
    assert.ok(createdLease.validUntil > new Date());
  } finally { await app.close(); }
});

test("PATCH duty OFF_DUTY revokes all leases", async () => {
  let updatedDuty: any = null;
  let revokedLeases = false;
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: { staffMembershipId: "mem-1", dutyState: updatedDuty?.dutyState || "ON_DUTY", generation: 1, leases: [] }, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" }, serviceVisits: [] };
      return null;
    },
  };
  mock.staffPresence = {
    findUnique: async () => ({ staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 1 }),
    update: async ({ data }: any) => { updatedDuty = data; return data; },
  };
  mock.staffPresenceLease = {
    updateMany: async ({ where, data }: any) => { revokedLeases = true; return { count: 3 }; },
  };
  mock.serviceVisit = { findMany: async () => [] };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1/staff/mem-1/duty", headers: auth("OWNER", "owner-1"), payload: { dutyState: "OFF_DUTY" } });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.dutyState, "OFF_DUTY");
    assert.equal(data.presenceState, "OFF_DUTY");
    assert.equal(data.occupancy, "NOT_AVAILABLE");
    assert.ok(updatedDuty);
    assert.equal(updatedDuty.dutyState, "OFF_DUTY");
    assert.ok(revokedLeases);
  } finally { await app.close(); }
});

test("POST presence/confirm creates new lease for heartbeat", async () => {
  let createdLease: any = null;
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "STAFF", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1" && !where.userId) return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: { staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 2, leases: createdLease ? [{ ...createdLease, revokedAt: null }] : [] }, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" }, serviceVisits: [] };
      if (where.userId_salonId?.userId === "staff-1" && where.userId_salonId?.salonId === "salon-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", status: "ACTIVE", revokedAt: null };
      return null;
    },
  };
  mock.staffPresence = {
    findUnique: async () => ({ staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 2 }),
  };
  mock.staffPresenceLease = {
    create: async ({ data }: any) => { createdLease = { ...data }; return data; },
  };
  mock.serviceVisit = { findMany: async () => [] };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "POST", url: "/api/v1/salons/salon-1/staff/mem-1/presence/confirm", headers: auth("STAFF", "staff-1") });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.presenceState, "ON_DUTY_CONFIRMED");
    assert.equal(data.occupancy, "AVAILABLE");
    assert.ok(createdLease);
    assert.equal(createdLease.generation, 2);
    assert.ok(createdLease.validUntil > new Date());
  } finally { await app.close(); }
});

test("POST service-visits requires ON_DUTY_CONFIRMED presence", async () => {
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: null, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" } };
      return null;
    },
  };
  mock.serviceVisit = { create: async ({ data }: any) => ({ id: "visit-1", ...data, version: 1, createdAt: new Date(), updatedAt: new Date() }) };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "POST", url: "/api/v1/salons/salon-1/service-visits", headers: auth("OWNER", "owner-1"), payload: { staffMembershipId: "mem-1", source: "WALK_IN" } });
    assert.equal(res.statusCode, 409, res.body);
    assert.ok(res.json().error.includes("not available"));
  } finally { await app.close(); }
});

test("POST service-visits succeeds with ON_DUTY_CONFIRMED presence", async () => {
  const serverNow = Date.now();
  let createdVisit: any = null;
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1", walkInIntakeEnabled: true } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: { staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 1, leases: [{ staffMembershipId: "mem-1", generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1", observedAt: new Date(serverNow - 10_000), validUntil: new Date(serverNow + 250_000), revokedAt: null }] }, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" } };
      return null;
    },
  };
  mock.serviceVisit = {
    create: async ({ data }: any) => { createdVisit = { id: "visit-1", ...data, version: 1, createdAt: new Date(), updatedAt: new Date() }; return createdVisit; },
  };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "POST", url: "/api/v1/salons/salon-1/service-visits", headers: auth("OWNER", "owner-1"), payload: { staffMembershipId: "mem-1", source: "WALK_IN" } });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.serviceVisit.status, "IN_SERVICE");
    assert.equal(data.serviceVisit.staffMembershipId, "mem-1");
    assert.ok(createdVisit);
    assert.equal(createdVisit.source, "WALK_IN");
  } finally { await app.close(); }
});

test("POST service-visits rejects WALK_IN when walk-in intake is disabled", async () => {
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1", walkInIntakeEnabled: false } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-1") return { id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: null, barber: { id: "barber-1", name: "Alice" }, user: { id: "staff-1" } };
      return null;
    },
  };
  mock.serviceVisit = { create: async () => { throw new Error("serviceVisit.create must not be reached when walk-in intake is disabled"); } };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "POST", url: "/api/v1/salons/salon-1/service-visits", headers: auth("OWNER", "owner-1"), payload: { staffMembershipId: "mem-1", source: "WALK_IN" } });
    assert.equal(res.statusCode, 409, res.body);
    assert.deepEqual(res.json(), { error: "Walk-in intake is currently disabled" });
  } finally { await app.close(); }
});

test("PATCH service-visits complete transitions IN_SERVICE to COMPLETED", async () => {
  let updatedVisit: any = null;
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "OWNER", status: "ACTIVE" }) };
  mock.serviceVisit = {
    findUnique: async ({ where }: any) => {
      if (where.id === "visit-1") return { id: "visit-1", salonId: "salon-1", staffMembershipId: "mem-1", status: "IN_SERVICE", version: 1, startedAt: new Date(), completedAt: null, cancelledAt: null, staffMembership: { id: "mem-1" } };
      return null;
    },
    update: async ({ where, data }: any) => { updatedVisit = { ...data }; return { id: where.id, ...data, version: 2 }; },
  };
  mock.staffMembership = { findUnique: async () => ({ id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1", status: "ACTIVE", revokedAt: null, presence: null, barber: { name: "Alice" }, user: { id: "staff-1" }, serviceVisits: [] }) };
  mock.staffPresence = { findUnique: async () => null };
  mock.serviceVisit.findMany = async () => [];

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1/service-visits/visit-1/complete", headers: auth("OWNER", "owner-1") });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.ok, true);
    assert.equal(data.serviceVisit.status, "COMPLETED");
    assert.ok(data.serviceVisit.completedAt);
    assert.ok(updatedVisit);
    assert.equal(updatedVisit.status, "COMPLETED");
  } finally { await app.close(); }
});

test("GET live-status returns real computed salon status", async () => {
  const serverNow = Date.now();
  const salonRow = {
    id: "salon-1", name: "Test Salon", openingTime: "09:00", closingTime: "18:00", timeZone: "Europe/Berlin", isActive: true,
    workingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    saloTicketIntakeEnabled: true, walkInIntakeEnabled: true,
  };
  mock.salon = {
    findMany: async ({ where }: any) => (where.id.in || []).includes("salon-1") ? [salonRow] : [],
    findUnique: async ({ where }: any) => where.id === "salon-1" ? salonRow : null,
  };
  mock.service = { findMany: async () => [{ salonId: "salon-1", durationMin: 30 }, { salonId: "salon-1", durationMin: 45 }] };
  mock.queueEntry = { groupBy: async () => [] };
  mock.platformSettings = { findUnique: async () => ({ id: "platform", saloTicketGloballyEnabled: true, walkInGloballyEnabled: true, staffStatusLiveEnabled: true }) };
  mock.staffMembership = {
    findMany: async () => [{
      id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1",
      status: "ACTIVE", revokedAt: null,
      presence: {
        staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 1,
        leases: [{ staffMembershipId: "mem-1", generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1",
          observedAt: new Date(serverNow - 10_000), validUntil: new Date(serverNow + 250_000), revokedAt: null }],
      },
      barber: { name: "Alice" },
      serviceVisits: [],
    }],
  };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/salon-1/live-status" });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.computedFromRealData, true);
    assert.equal(data.salonName, "Test Salon");
    assert.ok(data.salonStatus === "OPEN" || data.salonStatus === "CLOSED");
    assert.equal(data.staffSummary.total, 1);
    assert.equal(data.staffSummary.available, 1);
    assert.equal(data.staff[0].barberName, "Alice");
    assert.equal(data.staff[0].occupancy, "AVAILABLE");
    assert.equal(data.staff[0].presenceState, "ON_DUTY_CONFIRMED");

    assert.ok(data.wait, "live-status must expose the derived SMART wait state");
    assert.equal(data.wait.salonId, "salon-1");
    assert.equal(data.wait.queueLength, 0);
    assert.equal(data.wait.confirmedWorkingStaff, 1);
    assert.equal(data.wait.availableStaff, 1);
    assert.equal(data.wait.serviceDurationMinutes, 30);
    assert.equal(typeof data.wait.calculatedAt, "string");
    assert.ok(["AVAILABLE_NOW", "ESTIMATED_WAIT", "WAIT_UNKNOWN", "STAFF_STATUS_UNCONFIRMED", "CLOSED", "WALK_IN_DISABLED"].includes(data.wait.state));
    if (data.wait.state === "AVAILABLE_NOW") assert.equal(data.wait.etaMinutes, 0);
    else assert.equal(data.wait.etaMinutes, null);
    assert.ok(!/"customer|"email|"phone|"customerId/i.test(JSON.stringify(data.wait)), "wait payload must stay aggregate-only");
  } finally { await app.close(); }
});

test("GET batched live-status returns one payload per requested salon", async () => {
  const serverNow = Date.now();
  const salonRow = (id: string) => ({
    id, name: `Salon ${id}`, openingTime: "09:00", closingTime: "18:00", timeZone: "Europe/Berlin", isActive: true,
    workingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    saloTicketIntakeEnabled: true, walkInIntakeEnabled: true,
  });
  mock.salon = {
    findMany: async ({ where }: any) => where.id.in.map(salonRow),
    findUnique: async () => null,
  };
  mock.service = { findMany: async () => [{ salonId: "salon-1", durationMin: 20 }] };
  mock.queueEntry = { groupBy: async () => [{ salonId: "salon-1", _count: { _all: 2 } }] };
  mock.platformSettings = { findUnique: async () => ({ saloTicketGloballyEnabled: true, walkInGloballyEnabled: true }) };
  mock.staffMembership = {
    findMany: async () => [{
      id: "mem-1", userId: "staff-1", salonId: "salon-1", barberId: "barber-1",
      status: "ACTIVE", revokedAt: null,
      presence: {
        staffMembershipId: "mem-1", dutyState: "ON_DUTY", generation: 1,
        leases: [{ staffMembershipId: "mem-1", generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1",
          observedAt: new Date(serverNow - 10_000), validUntil: new Date(serverNow + 250_000), revokedAt: null }],
      },
      barber: { name: "Alice" },
      serviceVisits: [],
    }],
  };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/live-status?salonIds=salon-1,salon-2" });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json();
    assert.equal(data.salons.length, 2);
    const first = data.salons.find((s: any) => s.salonId === "salon-1");
    const second = data.salons.find((s: any) => s.salonId === "salon-2");
    assert.ok(first && second, "one payload per requested salon");
    assert.equal(first.wait.queueLength, 2);
    assert.equal(second.wait.queueLength, 0, "salon-2 has no queue of its own");
    assert.equal(second.staffSummary.total, 0, "salon-1 staff must not leak into salon-2");
    assert.equal(first.staffSummary.total, 1);

    const tooMany = await app.inject({ method: "GET", url: `/api/v1/salons/live-status?salonIds=${Array.from({ length: 25 }, (_, i) => `s${i}`).join(",")}` });
    assert.equal(tooMany.statusCode, 400);
    const empty = await app.inject({ method: "GET", url: "/api/v1/salons/live-status?salonIds=" });
    assert.equal(empty.statusCode, 400);
  } finally { await app.close(); }
});

test("unauthenticated requests are rejected", async () => {
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async () => null };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/salon-1/staff/status" });
    assert.equal(res.statusCode, 401);
  } finally { await app.close(); }
});

test("STAFF cannot toggle another staff member's duty", async () => {
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "STAFF", status: "ACTIVE" }) };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => {
      if (where.id === "mem-2") return { id: "mem-2", userId: "other-staff", salonId: "salon-1", barberId: "barber-2", status: "ACTIVE", revokedAt: null, presence: null, barber: { name: "Bob" }, user: { id: "other-staff" }, serviceVisits: [] };
      return null;
    },
  };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1/staff/mem-2/duty", headers: auth("STAFF", "staff-1"), payload: { dutyState: "ON_DUTY" } });
    assert.equal(res.statusCode, 403, res.body);
  } finally { await app.close(); }
});

test("STAFF can only complete their own service visits", async () => {
  mock.salon = { findUnique: async ({ where }: any) => where.id === "salon-1" ? { id: "salon-1", ownerId: "owner-1" } : null };
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: "STAFF", status: "ACTIVE" }) };
  mock.serviceVisit = {
    findUnique: async ({ where }: any) => {
      if (where.id === "visit-1") return { id: "visit-1", salonId: "salon-1", staffMembershipId: "mem-other", status: "IN_SERVICE", version: 1, startedAt: new Date(), completedAt: null, cancelledAt: null, staffMembership: { id: "mem-other" } };
      return null;
    },
  };
  mock.staffMembership = { findUnique: async ({ where }: any) => where.userId_salonId?.userId === "staff-1" ? { id: "mem-1", userId: "staff-1", salonId: "salon-1", status: "ACTIVE", revokedAt: null } : null };

  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-1/service-visits/visit-1/complete", headers: auth("STAFF", "staff-1") });
    assert.equal(res.statusCode, 403, res.body);
  } finally { await app.close(); }
});
