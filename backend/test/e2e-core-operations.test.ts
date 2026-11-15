import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { signAccessToken } from "../src/lib/jwt.js";
import { prisma } from "../src/lib/prisma.js";
import { authRoutes } from "../src/routes/auth.js";
import { dashboardRoutes } from "../src/routes/dashboard.js";
import { bookingRoutes } from "../src/routes/bookings.js";
import { queueRoutes } from "../src/routes/queue.js";
import { staffStatusRoutes } from "../src/routes/staff-status.js";
import { ownerTeamRoutes } from "../src/routes/owner-team.js";

const orig = { notification: prisma.notification, $transaction: prisma.$transaction, $queryRaw: prisma.$queryRaw, user: prisma.user, salon: prisma.salon, salonMedia: prisma.salonMedia, session: prisma.session, service: prisma.service, booking: prisma.booking, staffMembership: prisma.staffMembership, staffPresence: prisma.staffPresence, staffPresenceLease: prisma.staffPresenceLease, serviceVisit: prisma.serviceVisit, queueEntry: prisma.queueEntry, barber: prisma.barber, platformSettings: (prisma as any).platformSettings };
const m = prisma as any;

const O = "a1000000-0000-0000-0000-000000000001";
const S = "a2000000-0000-0000-0000-000000000002";
const C = "a3000000-0000-0000-0000-000000000003";
const SALON = "b1000000-0000-0000-0000-000000000001";
const MEM = "d1000000-0000-0000-0000-000000000001";
const BAR = "e1000000-0000-0000-0000-000000000001";

function hdr(role: string, uid: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: uid, role })}` };
}

const USERS: Record<string, any> = {
  [O]: { id: O, email: "owner-e2e@test.local", fullName: "Owner", role: "OWNER", status: "ACTIVE", phone: "+1", passwordHash: "h", emailVerified: true },
  [S]: { id: S, email: "staff-e2e@test.local", fullName: "Staff", role: "STAFF", status: "ACTIVE", phone: "+2", passwordHash: "h", emailVerified: true },
  [C]: { id: C, email: "cust-e2e@test.local", fullName: "Customer", role: "CUSTOMER", status: "ACTIVE", phone: "+3", passwordHash: "h", emailVerified: true },
};

const st: any = {
  memCreated: false,
  mem: null as any,
  duty: "OFF_DUTY",
  leases: [] as any[],
  visit: null as any,
  queue: null as any,
  bookings: new Map() as Map<string, any>,
};

function memBase() {
  if (!st.mem) return null;
  return { ...st.mem };
}

function memFull() {
  const b = memBase();
  if (!b) return null;
  return {
    ...b,
    salon: { id: SALON, name: "E2E", city: "Berlin", phone: "+1", address: "Test" },
    barber: { id: BAR, name: "Hans", specialty: null, isActive: true },
    user: { id: S, fullName: "Staff", email: "staff-e2e@test.local", phone: "+2", role: "STAFF", status: "ACTIVE" },
    presence: st.duty !== "OFF_DUTY" ? { staffMembershipId: MEM, dutyState: st.duty, generation: 1, leases: st.leases.filter((l: any) => !l.revokedAt) } : null,
    serviceVisits: st.visit?.status === "IN_SERVICE" ? [st.visit] : [],
  };
}

describe("E2E Core", () => {
  let app: any;

  it("setup", async () => {
    process.env.JWT_ACCESS_SECRET = "e2e-access";
    process.env.JWT_REFRESH_SECRET = "e2e-refresh";

    m.user = {
      findUnique: async ({ where }: any) => where.id ? USERS[where.id] || null : where.email ? Object.values(USERS).find((u: any) => u.email === where.email) || null : null,
      findFirst: async ({ where }: any) => where.email ? Object.values(USERS).find((u: any) => u.email === where.email) || null : null,
      create: async ({ data }: any) => {
        const id = data.email === "staff-e2e@test.local" ? S : "new-" + Date.now();
        const u = { id, ...data, status: data.status || "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        if (!USERS[id]) USERS[id] = u;
        return u;
      },
      count: async () => 0,
    };

    const salonRow = (id: string, name: string) => ({
      id, ownerId: id === SALON ? O : "other", name, city: "Berlin", phone: "+1", address: "Test",
      status: "ACTIVE", isActive: true, bookingIntakeEnabled: true,
      saloTicketIntakeEnabled: true, walkInIntakeEnabled: true,
      timeZone: "Europe/Berlin", openingTime: "09:00", closingTime: "20:00",
      workingDays: ["mon","tue","wed","thu","fri","sat","sun"], createdAt: new Date(), updatedAt: new Date(),
    });

    m.salon = {
      findUnique: async ({ where, include }: any) => {
        if (where.id === SALON) {
          const base = salonRow(SALON, "E2E");
          if (include) return { ...base, services: [{ id: "svc-1", salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }], barbers: [{ id: BAR, salonId: SALON, name: "Hans", isActive: true }] };
          return base;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id) => salonRow(id, id === SALON ? "E2E" : "Other salon"));
      },
      create: async ({ data }: any) => ({ id: SALON, ...data, status: "ACTIVE" }),
      update: async ({ data }: any) => ({ id: SALON, ...data }),
    };

    m.salonMedia = { findMany: async () => [], create: async ({ data }: any) => ({ id: "m1", ...data }) };
    m.session = { create: async ({ data }: any) => ({ id: "s1", ...data }), findUnique: async () => null, delete: async () => ({}), update: async ({ data }: any) => ({ id: "s1", ...data }) };
    m.$transaction = async (fn: any) => fn(m);
    m.notification = { upsert: async ({create}: any) => { assert.ok([C,O].includes(create.userId)); return create; } };
    m.$queryRaw = async () => [];

    m.service = {
      findMany: async () => [{ id: "svc-1", salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }],
      create: async ({ data }: any) => ({ id: "svc-1", ...data, isActive: true }),
      findUnique: async ({ where }: any) => ({ id: where.id, salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }),
    };

    m.booking = {
      create: async ({ data, include }: any) => {
        const bk = { id: "bk-" + Date.now(), ...data, status: data.status || "PENDING", createdAt: new Date(), version: 1 };
        st.bookings.set(bk.id, { ...bk });
        if (include) return { ...bk, salon: { id: SALON, ownerId: O, name: "E2E", openingTime: "09:00", closingTime: "20:00", timeZone: "Europe/Berlin" }, service: data.serviceId ? { id: data.serviceId, name: "Haircut", durationMin: 30 } : null, barber: data.barberId ? { id: data.barberId, name: "Hans" } : null };
        return bk;
      },
      findMany: async ({ where, include }: any) => {
        let results = Array.from(st.bookings.values());
        if (where?.salon?.ownerId) {
          results = results.filter((b: any) => b.salonId === SALON);
        }
        if (where?.userId) {
          results = results.filter((b: any) => b.userId === where.userId);
        }
        return results.map((b: any) => {
          const out: any = { ...b };
          if (include?.salon) out.salon = { id: SALON, ownerId: O, name: "E2E", openingTime: "09:00", closingTime: "20:00", timeZone: "Europe/Berlin" };
          if (include?.service && b.serviceId) out.service = { id: b.serviceId, name: "Haircut", durationMin: 30 };
          if (include?.barber && b.barberId) out.barber = { id: b.barberId, name: "Hans" };
          if (include?.user) out.user = { id: b.userId, fullName: USERS[b.userId]?.fullName || "Unknown", email: USERS[b.userId]?.email || "", phone: USERS[b.userId]?.phone || null };
          return out;
        });
      },
      findUnique: async ({ where, include }: any) => {
        const stored = st.bookings.get(where.id);
        const bk = stored || { id: where.id, salonId: SALON, userId: C, status: "PENDING", startAt: new Date(), endAt: new Date(), createdAt: new Date(), version: 1 };
        if (include) return { ...bk, salon: { id: SALON, ownerId: O, name: "E2E", openingTime: "09:00", closingTime: "20:00", timeZone: "Europe/Berlin" }, service: bk.serviceId ? { id: bk.serviceId, name: "Haircut", durationMin: 30 } : null, barber: bk.barberId ? { id: bk.barberId, name: "Hans" } : null };
        return bk;
      },
      update: async ({ where, data, include }: any) => {
        const stored = st.bookings.get(where.id);
        if (stored) Object.assign(stored, data);
        const bk = { ...(stored || { id: where.id }), ...data };
        if (include) {
          return {
            ...bk,
            salon: { id: SALON, ownerId: O, name: "E2E", openingTime: "09:00", closingTime: "20:00", timeZone: "Europe/Berlin" },
            service: bk.serviceId ? { id: bk.serviceId, name: "Haircut", durationMin: 30 } : null,
            barber: bk.barberId ? { id: bk.barberId, name: "Hans" } : null,
          };
        }
        return bk;
      },
      count: async () => 0,
    };

    m.barber = {
      create: async ({ data }: any) => ({ id: BAR, ...data }),
      findFirst: async () => null,
      findUnique: async ({ where }: any) => ({ id: where.id || BAR, salonId: SALON, name: "Hans" }),
    };

    m.staffMembership = {
      create: async ({ data, include }: any) => {
        st.memCreated = true;
        st.mem = { id: MEM, ...data, status: data.status || "ACTIVE", revokedAt: null, createdAt: new Date() };
        return include ? memFull() : memBase();
      },
      findMany: async ({ where, include }: any) => {
        if (!st.memCreated || !st.mem) return [];
        const mem = memBase();
        if (!mem) return [];
        const salonIds: string[] | undefined = where?.salonId?.in
          ?? (typeof where?.salonId === "string" ? [where.salonId] : undefined);
        const salonMatch = !salonIds || salonIds.includes(mem.salonId);
        const userMatch = where?.userId === undefined || where?.userId === mem.userId;
        const statusMatch = where?.status === undefined || where?.status === mem.status;
        const revokedMatch = where?.revokedAt === undefined || where?.revokedAt === mem.revokedAt;
        if (salonMatch && userMatch && statusMatch && revokedMatch) return include ? [memFull()] : [mem];
        return [];
      },
      findFirst: async ({ where, include }: any) => {
        if (!st.memCreated) return null;
        if (where?.userId === S && where?.salonId === SALON) return include ? memFull() : memBase();
        if (where?.id === MEM) return include ? memFull() : memBase();
        return null;
      },
      findUnique: async ({ where, include }: any) => {
        if (!st.memCreated) return null;
        if (where?.id === MEM) return include ? memFull() : memBase();
        if (where?.userId_salonId?.userId === S && where?.userId_salonId?.salonId === SALON) return include ? memFull() : memBase();
        return null;
      },
      update: async ({ where, data, include }: any) => {
        if (st.mem?.id === where.id) Object.assign(st.mem, data);
        return include ? memFull() : memBase();
      },
      count: async () => st.memCreated ? 1 : 0,
    };

    m.staffPresence = {
      findUnique: async ({ where }: any) => {
        if (where?.staffMembershipId === MEM && st.duty !== "OFF_DUTY") return { staffMembershipId: MEM, dutyState: st.duty, generation: 1, leases: st.leases.filter((l: any) => !l.revokedAt) };
        return null;
      },
      upsert: async ({ create }: any) => { st.duty = create.dutyState; return { staffMembershipId: MEM, dutyState: create.dutyState, generation: 1 }; },
      update: async ({ data }: any) => { if (data.dutyState) st.duty = data.dutyState; return { staffMembershipId: MEM, ...data }; },
    };

    m.staffPresenceLease = {
      create: async ({ data }: any) => { const l = { id: "lease-" + Date.now(), ...data, revokedAt: null }; st.leases.push(l); return l; },
      updateMany: async ({ data }: any) => { st.leases.forEach((l: any) => { if (data.revokedAt) l.revokedAt = data.revokedAt; }); return { count: st.leases.length }; },
    };

    m.serviceVisit = {
      create: async ({ data }: any) => { st.visit = { id: "sv-1", ...data, status: "IN_SERVICE", createdAt: new Date(), version: 1, salonId: SALON }; return st.visit; },
      findMany: async ({ where }: any) => { if (where?.staffMembershipId === MEM && st.visit?.status === "IN_SERVICE") return [st.visit]; return []; },
      findFirst: async ({ where }: any) => st.visit?.id === where?.id ? st.visit : null,
      findUnique: async ({ where, include }: any) => {
        if (st.visit?.id !== where?.id) return null;
        if (include?.staffMembership) return { ...st.visit, staffMembership: memBase() };
        return st.visit;
      },
      update: async ({ where, data }: any) => { if (st.visit?.id === where.id) Object.assign(st.visit, data); return st.visit; },
      count: async () => st.visit ? 1 : 0,
    };

    m.queueEntry = {
      create: async ({ data }: any) => { st.queue = { id: "qe-1", ...data, status: "WAITING", createdAt: new Date() }; return st.queue; },
      findMany: async () => st.queue ? [st.queue] : [],
      findUnique: async ({ where }: any) => st.queue?.id === where.id ? st.queue : null,
      update: async ({ where, data }: any) => { if (st.queue?.id === where.id) Object.assign(st.queue, data); return st.queue; },
      count: async () => 0,
      groupBy: async ({ where }: any) => {
        const rows = st.queue && ["WAITING", "CALLED"].includes(st.queue.status) ? [st.queue] : [];
        const scoped = rows.filter((row: any) => (where?.salonId?.in ?? []).includes(row.salonId));
        return scoped.length ? [{ salonId: scoped[0].salonId, _count: { _all: scoped.length } }] : [];
      },
    };

    m.platformSettings = {
      findUnique: async () => ({
        id: "platform", siteName: "SALO", supportEmail: "", defaultLocale: "ar",
        customerRegistrationEnabled: true, salonApplicationsEnabled: true, bookingGloballyEnabled: true,
        saloTicketGloballyEnabled: true, walkInGloballyEnabled: true, staffStatusLiveEnabled: true,
        createdAt: new Date(), updatedAt: new Date(),
      }),
      upsert: async ({ create }: any) => create,
    };

    app = Fastify();
    await authRoutes(app);
    await dashboardRoutes(app);
    await bookingRoutes(app);
    await queueRoutes(app);
    await staffStatusRoutes(app);
    await ownerTeamRoutes(app);
  });

  it("1. owner adds staff", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/salons/${SALON}/team`, headers: hdr("OWNER", O), payload: { email: "staff-e2e@test.local", fullName: "Staff Member", password: "TestPass123!", barberName: "Hans" } });
    assert.ok([200, 201].includes(res.statusCode), `status=${res.statusCode} body=${res.body}`);
    const d = res.json();
    assert.ok(d.membership?.id);
    assert.equal(d.membership?.status, "ACTIVE");
  });

  it("2. owner lists team", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/team`, headers: hdr("OWNER", O) });
    assert.equal(res.statusCode, 200, res.body);
    const d = res.json();
    assert.ok(d.team?.length >= 1);
  });

  it("3. staff self info", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/staff/me", headers: hdr("STAFF", S) });
    assert.equal(res.statusCode, 200, res.body);
    const d = res.json();
    assert.equal(d.user?.role, "STAFF");
  });

  it("4. staff ON_DUTY", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/salons/${SALON}/staff/${MEM}/duty`, headers: hdr("STAFF", S), payload: { dutyState: "ON_DUTY" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().dutyState, "ON_DUTY");
  });

  it("5. staff confirms presence", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/salons/${SALON}/staff/${MEM}/presence/confirm`, headers: hdr("STAFF", S) });
    assert.equal(res.statusCode, 200, res.body);
  });

  it("6. owner sees staff status", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/staff/status`, headers: hdr("OWNER", O) });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.json().staff?.length >= 1);
  });

  it("7. staff starts service", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/salons/${SALON}/service-visits`, headers: hdr("STAFF", S), payload: { staffMembershipId: MEM, source: "WALK_IN" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().serviceVisit?.status, "IN_SERVICE");
  });

  it("8. staff completes service", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/salons/${SALON}/service-visits/${st.visit.id}/complete`, headers: hdr("STAFF", S) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().serviceVisit?.status, "COMPLETED");
  });

  it("9. live-status returns real computed data", async () => {
    st.duty = "ON_DUTY";
    st.leases = [{ id: "lease-active", staffMembershipId: MEM, generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1", observedAt: new Date(Date.now() - 5000), validUntil: new Date(Date.now() + 300000), revokedAt: null }];
    st.visit = null;
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/live-status` });
    assert.equal(res.statusCode, 200, res.body);
    const d = res.json();
    assert.equal(d.salonId, SALON);
    assert.equal(d.computedFromRealData, true);
    assert.equal(typeof d.isOpen, "boolean");
    assert.ok(d.staffSummary);
    assert.equal(typeof d.staffSummary.total, "number");
    assert.equal(typeof d.staffSummary.available, "number");
    assert.equal(typeof d.staffSummary.busy, "number");
    assert.ok(Array.isArray(d.staff));
    assert.ok(d.wait, "live-status exposes the derived SMART wait state");
    assert.equal(d.wait.salonId, SALON);
    assert.ok(["CLOSED", "WALK_IN_DISABLED", "STAFF_STATUS_UNCONFIRMED", "AVAILABLE_NOW", "ESTIMATED_WAIT", "WAIT_UNKNOWN"].includes(d.wait.state));
    assert.equal(typeof d.wait.confirmedWorkingStaff, "number");
    assert.equal(typeof d.wait.queueLength, "number");
    assert.ok(!/customer|email|phone/i.test(JSON.stringify(d.wait)), "wait payload stays aggregate-only");
  });

  it("10. live-status shows available staff when on duty confirmed", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/live-status` });
    const d = res.json();
    assert.ok(d.staffSummary.available >= 1, `Should have at least 1 available staff, got: ${JSON.stringify(d.staffSummary)}`);
    const staffMember = d.staff.find((s: any) => s.barberName === "Hans");
    assert.ok(staffMember);
    assert.equal(staffMember.occupancy, "AVAILABLE");
  });

  it("11. live-status busy staff not shown as available", async () => {
    st.visit = { id: "sv-busy", staffMembershipId: MEM, status: "IN_SERVICE", createdAt: new Date(), version: 1, salonId: SALON };
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/live-status` });
    const d = res.json();
    const staffMember = d.staff.find((s: any) => s.barberName === "Hans");
    assert.equal(staffMember?.occupancy, "BUSY", "Staff with active visit should be BUSY");
    assert.equal(d.staffSummary.available, 0, "No staff should be available when busy");
    st.visit = null;
  });

  it("12. live-status off-duty staff not available", async () => {
    st.duty = "OFF_DUTY";
    st.leases = [];
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/live-status` });
    const d = res.json();
    const staffMember = d.staff.find((s: any) => s.barberName === "Hans");
    assert.ok(staffMember, "Staff member should still appear in live-status list");
    assert.notEqual(staffMember.occupancy, "AVAILABLE", "Off-duty staff should not be AVAILABLE");
  });

  it("13. live-status cross-salon isolation", async () => {
    const OTHER_SALON = "b2000000-0000-0000-0000-000000000002";
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${OTHER_SALON}/live-status` });
    assert.equal(res.statusCode, 200, res.body);
    const d = res.json();
    assert.equal(d.salonId, OTHER_SALON);
    assert.equal(d.staffSummary.total, 0, "Other salon should have no staff from our mock");
    assert.equal(d.wait.salonId, OTHER_SALON, "wait calculation is scoped to the requested salon");
    assert.equal(d.wait.queueLength, 0, "queue of another salon must never leak");

    const batch = await app.inject({ method: "GET", url: `/api/v1/salons/live-status?salonIds=${OTHER_SALON},${SALON}` });
    assert.equal(batch.statusCode, 200, batch.body);
    const bd = batch.json();
    assert.equal(bd.salons.length, 2);
    assert.deepEqual(bd.salons.map((s: any) => s.salonId), [OTHER_SALON, SALON], "batch preserves the requested order");
    assert.equal(bd.salons[0].staffSummary.total, 0, "isolation holds in the batch response");
    assert.equal(bd.salons[1].staffSummary.total, 1, "each salon keeps its own staff");
    assert.equal(bd.salons[1].wait.salonId, SALON);
  });

  it("14. owner suspends staff", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/salons/${SALON}/team/${MEM}`, headers: hdr("OWNER", O), payload: { status: "SUSPENDED" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().membership?.status, "SUSPENDED");
  });

  it("15. cross-salon blocked", async () => {
    const OTHER = "a4000000-0000-0000-0000-000000000004";
    USERS[OTHER] = { id: OTHER, email: "other@test.local", fullName: "Other", role: "OWNER", status: "ACTIVE", passwordHash: "h" };
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/team`, headers: hdr("OWNER", OTHER) });
    assert.equal(res.statusCode, 403, res.body);
  });

  it("16. owner re-activates staff for persistence test", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/salons/${SALON}/team/${MEM}`, headers: hdr("OWNER", O), payload: { status: "ACTIVE" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().membership?.status, "ACTIVE");
  });

  it("17. team F5 persistence: read-back after add", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/team`, headers: hdr("OWNER", O) });
    assert.equal(res.statusCode, 200);
    const d = res.json();
    const member = d.team.find((t: any) => t.membershipId === MEM);
    assert.ok(member, "Team member should persist after add");
    assert.equal(member.status, "ACTIVE");
    assert.equal(member.user?.id, S);
    assert.equal(member.barber?.id, BAR);
  });

  it("18. staff membership is DB source of truth", async () => {
    const mem = await m.staffMembership.findUnique({ where: { id: MEM } });
    assert.ok(mem, "Membership exists in DB");
    assert.equal(mem.salonId, SALON);
    assert.equal(mem.userId, S);
  });

  it("19. POST booking creation - first valid POST succeeds", async () => {
    const startAt = "2026-10-05T10:00:00";
    const endAt = "2026-10-05T10:30:00";
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: hdr("CUSTOMER", C),
      payload: { salonId: SALON, serviceId: "svc-1", startAt, endAt },
    });
    assert.equal(createRes.statusCode, 200, `First POST must succeed: ${createRes.body}`);
    const { booking } = createRes.json();
    assert.ok(booking.id, "Booking must have an id");
    assert.equal(booking.status, "PENDING");
    assert.equal(booking.salonId, SALON);
    assert.equal(booking.userId, C);
    assert.equal(booking.serviceId, "svc-1");
    assert.ok(booking.startAt, "Booking must have startAt");
    assert.ok(booking.endAt, "Booking must have endAt");
  });

  it("20. booking read-back by customer (GET /api/v1/bookings/me)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/bookings/me", headers: hdr("CUSTOMER", C) });
    assert.equal(res.statusCode, 200, res.body);
    const { bookings } = res.json();
    assert.ok(bookings.length >= 1, "Customer should see at least one booking");
    const bk = bookings.find((b: any) => b.salonId === SALON && b.serviceId === "svc-1");
    assert.ok(bk, "Customer should see the booking they just created");
    assert.equal(bk.status, "PENDING");
  });

  it("21. booking read-back by owner (GET /api/v1/bookings)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) });
    assert.equal(res.statusCode, 200, res.body);
    const { bookings } = res.json();
    assert.ok(bookings.length >= 1, "Owner should see at least one booking");
    const bk = bookings.find((b: any) => b.salonId === SALON && b.userId === C);
    assert.ok(bk, "Owner should see the customer booking");
    assert.equal(bk.status, "PENDING");
    assert.ok(bk.user, "Owner booking listing should include user info");
    assert.equal(bk.user.id, C);
  });

  it("22. booking confirm lifecycle (PENDING -> CONFIRMED)", async () => {
    const bookings = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const bk = bookings.find((b: any) => b.salonId === SALON && b.userId === C && b.status === "PENDING");
    assert.ok(bk, "Must find a PENDING booking to confirm");
    const confirmRes = await app.inject({ method: "PATCH", url: `/api/v1/bookings/${bk.id}`, headers: hdr("OWNER", O), payload: { status: "CONFIRMED" } });
    assert.equal(confirmRes.statusCode, 200, confirmRes.body);
    assert.equal(confirmRes.json().booking.status, "CONFIRMED");
    const readBack = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const confirmed = readBack.find((b: any) => b.id === bk.id);
    assert.equal(confirmed.status, "CONFIRMED", "PERSISTENCE: status must survive read-back after confirm");
  });

  it("23. booking complete lifecycle (CONFIRMED -> COMPLETED)", async () => {
    const bookings = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const bk = bookings.find((b: any) => b.salonId === SALON && b.userId === C && b.status === "CONFIRMED");
    assert.ok(bk, "Must find a CONFIRMED booking to complete");
    const completeRes = await app.inject({ method: "PATCH", url: `/api/v1/bookings/${bk.id}`, headers: hdr("OWNER", O), payload: { status: "COMPLETED" } });
    assert.equal(completeRes.statusCode, 200, completeRes.body);
    assert.equal(completeRes.json().booking.status, "COMPLETED");
    const readBack = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const completed = readBack.find((b: any) => b.id === bk.id);
    assert.equal(completed.status, "COMPLETED", "PERSISTENCE: status must survive read-back after complete");
  });

  it("24. booking invalid transition blocked (COMPLETED -> CONFIRMED rejected)", async () => {
    const bookings = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const bk = bookings.find((b: any) => b.salonId === SALON && b.userId === C && b.status === "COMPLETED");
    assert.ok(bk, "Must find a COMPLETED booking to test invalid transition");
    const res = await app.inject({ method: "PATCH", url: `/api/v1/bookings/${bk.id}`, headers: hdr("OWNER", O), payload: { status: "CONFIRMED" } });
    assert.notEqual(res.statusCode, 200, "COMPLETED -> CONFIRMED should be rejected");
    const readBack = (await app.inject({ method: "GET", url: "/api/v1/bookings", headers: hdr("OWNER", O) })).json().bookings;
    const still = readBack.find((b: any) => b.id === bk.id);
    assert.equal(still.status, "COMPLETED", "Status must remain COMPLETED after rejected transition");
  });

  it("25. booking cross-salon blocked (Owner B cannot mutate Salon A booking)", async () => {
    const OTHER = "a5000000-0000-0000-0000-000000000005";
    const OTHER_SALON = "b3000000-0000-0000-0000-000000000003";
    USERS[OTHER] = { id: OTHER, email: "other-owner@test.local", fullName: "OtherOwner", role: "OWNER", status: "ACTIVE", passwordHash: "h" };
    const origFindUnique = m.salon.findUnique;
    m.salon.findUnique = async ({ where, include }: any) => {
      if (where.id === SALON) return origFindUnique({ where, include });
      if (where.id === OTHER_SALON) return { id: OTHER_SALON, ownerId: OTHER, name: "Other", city: "Munich", phone: "+2", status: "ACTIVE", isActive: true, bookingIntakeEnabled: true, timeZone: "Europe/Berlin", openingTime: "09:00", closingTime: "20:00", workingDays: ["mon","tue","wed","thu","fri","sat"], services: [{ id: "svc-x", salonId: OTHER_SALON, name: "Shave", price: 10, durationMin: 30, isActive: true }], barbers: [], createdAt: new Date(), updatedAt: new Date() };
      return null;
    };
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: hdr("CUSTOMER", C),
      payload: { salonId: SALON, serviceId: "svc-1", startAt: "2026-10-06T12:00:00", endAt: "2026-10-06T12:30:00" },
    });
    assert.ok([200, 201].includes(createRes.statusCode), createRes.body);
    const booking = createRes.json().booking;
    assert.ok(booking.id);
    const res = await app.inject({ method: "PATCH", url: `/api/v1/bookings/${booking.id}`, headers: hdr("OWNER", OTHER), payload: { status: "CONFIRMED" } });
    assert.equal(res.statusCode, 403, res.body);
    m.salon.findUnique = origFindUnique;
  });

  it("26. live-status public: no customer PII leaked", async () => {
    st.duty = "ON_DUTY";
    st.visit = null;
    st.leases = [{ id: "lease-pii", staffMembershipId: MEM, generation: 1, evidenceSource: "STAFF_APP", producerKey: "app-1", observedAt: new Date(Date.now() - 5000), validUntil: new Date(Date.now() + 300000), revokedAt: null }];
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/live-status` });
    const d = res.json();
    const body = JSON.stringify(d);
    assert.ok(!body.includes("cust-e2e@test.local"), "Customer email should not appear in live-status");
    assert.ok(!body.includes("+3"), "Customer phone should not appear in live-status");
    assert.ok(!body.includes("Customer"), "Customer name should not appear in live-status");
  });

  it("27. owner queue list", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${SALON}/queue`, headers: hdr("OWNER", O) });
    assert.equal(res.statusCode, 200, res.body);
  });

  it("cleanup", async () => {
    await app.close();
    Object.assign(m, orig);
  });
});
