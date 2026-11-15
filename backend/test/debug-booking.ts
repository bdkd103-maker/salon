import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { signAccessToken } from "../src/lib/jwt.js";
import { prisma } from "../src/lib/prisma.js";
import { bookingRoutes } from "../src/routes/bookings.js";
import { authRoutes } from "../src/routes/auth.js";
import { dashboardRoutes } from "../src/routes/dashboard.js";
import { queueRoutes } from "../src/routes/queue.js";
import { staffStatusRoutes } from "../src/routes/staff-status.js";
import { ownerTeamRoutes } from "../src/routes/owner-team.js";

const m = prisma as any;
const O = "a1000000-0000-0000-0000-000000000001";
const S = "a2000000-0000-0000-0000-000000000002";
const C = "a3000000-0000-0000-0000-000000000003";
const SALON = "b1000000-0000-0000-0000-000000000001";

process.env.JWT_ACCESS_SECRET = "e2e-access";
process.env.JWT_REFRESH_SECRET = "e2e-refresh";

function hdr(role: string, uid: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: uid, role })}` };
}

describe("booking debug with all routes", () => {
  let app: any;

  it("setup", async () => {
    const USERS: Record<string, any> = {
      [O]: { id: O, email: "owner-e2e@test.local", fullName: "Owner", role: "OWNER", status: "ACTIVE", phone: "+1", passwordHash: "h", emailVerified: true },
      [C]: { id: C, email: "cust-e2e@test.local", fullName: "Customer", role: "CUSTOMER", status: "ACTIVE", phone: "+3", passwordHash: "h", emailVerified: true },
    };

    m.user = {
      findUnique: async ({ where }: any) => where.id ? USERS[where.id] || null : where.email ? Object.values(USERS).find((u: any) => u.email === where.email) || null : null,
      findFirst: async ({ where }: any) => where.email ? Object.values(USERS).find((u: any) => u.email === where.email) || null : null,
      create: async ({ data }: any) => {
        const id = "new-" + Date.now();
        const u = { id, ...data, status: data.status || "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        return u;
      },
      count: async () => 0,
    };

    m.salon = {
      findUnique: async ({ where, include }: any) => {
        if (where.id === SALON) {
          const base = { id: SALON, ownerId: O, name: "E2E", city: "Berlin", phone: "+1", address: "Test", status: "ACTIVE", isActive: true, bookingIntakeEnabled: true, timeZone: "Europe/Berlin", openingTime: "09:00", closingTime: "20:00", workingDays: ["mon","tue","wed","thu","fri","sat"], createdAt: new Date(), updatedAt: new Date() };
          if (include) return { ...base, services: [{ id: "svc-1", salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }], barbers: [] };
          return base;
        }
        return null;
      },
      findMany: async () => [{ id: SALON, ownerId: O, name: "E2E", city: "Berlin", phone: "+1", status: "ACTIVE", isActive: true, createdAt: new Date(), updatedAt: new Date() }],
      create: async ({ data }: any) => ({ id: SALON, ...data, status: "ACTIVE" }),
      update: async ({ data }: any) => ({ id: SALON, ...data }),
    };

    m.salonMedia = { findMany: async () => [], create: async ({ data }: any) => ({ id: "m1", ...data }) };
    m.session = { create: async ({ data }: any) => ({ id: "s1", ...data }), findUnique: async () => null, delete: async () => ({}), update: async ({ data }: any) => ({ id: "s1", ...data }) };
    m.$transaction = async (fn: any) => fn(m);
    m.$queryRaw = async () => [];

    m.service = {
      findMany: async () => [{ id: "svc-1", salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }],
      create: async ({ data }: any) => ({ id: "svc-1", ...data, isActive: true }),
      findUnique: async ({ where }: any) => ({ id: where.id, salonId: SALON, name: "Haircut", price: 25, durationMin: 30, isActive: true }),
    };

    m.booking = {
      create: async ({ data, include }: any) => {
        const bk = { id: "bk-" + Date.now(), ...data, status: "PENDING", createdAt: new Date(), version: 1 };
        if (include) return { ...bk, salon: { id: SALON, ownerId: O, name: "E2E" }, service: data.serviceId ? { id: data.serviceId, name: "Haircut" } : null, barber: data.barberId ? { id: data.barberId, name: "Hans" } : null };
        return bk;
      },
      findMany: async () => [],
      findUnique: async ({ where, include }: any) => {
        const bk = { id: where.id, salonId: SALON, userId: C, status: "PENDING", startAt: new Date(), endAt: new Date(), createdAt: new Date(), version: 1 };
        if (include) return { ...bk, salon: { id: SALON, ownerId: O, name: "E2E" }, service: null, barber: null };
        return bk;
      },
      update: async ({ data }: any) => data,
      count: async () => 0,
    };

    m.barber = {
      create: async ({ data }: any) => ({ id: "e1", ...data }),
      findFirst: async () => null,
      findUnique: async ({ where }: any) => ({ id: where.id, salonId: SALON, name: "Hans" }),
    };

    m.staffMembership = { create: async ({ data }: any) => ({ id: "d1", ...data, status: "ACTIVE", revokedAt: null }), findMany: async () => [], findFirst: async () => null, findUnique: async () => null, update: async ({ data }: any) => data, count: async () => 0 };
    m.staffPresence = { findUnique: async () => null, upsert: async ({ create }: any) => ({ staffMembershipId: "d1", dutyState: create.dutyState, generation: 1 }), update: async ({ data }: any) => data };
    m.staffPresenceLease = { create: async ({ data }: any) => ({ id: "l1", ...data, revokedAt: null }), updateMany: async () => ({ count: 0 }) };
    m.serviceVisit = { create: async ({ data }: any) => ({ id: "sv-1", ...data, status: "IN_SERVICE" }), findMany: async () => [], findFirst: async () => null, findUnique: async () => null, update: async ({ data }: any) => data, count: async () => 0 };
    m.queueEntry = { create: async ({ data }: any) => ({ id: "qe-1", ...data, status: "WAITING" }), findMany: async () => [], findUnique: async () => null, update: async ({ data }: any) => data, count: async () => 0 };

    app = Fastify();
    await authRoutes(app);
    await dashboardRoutes(app);
    await bookingRoutes(app);
    await queueRoutes(app);
    await staffStatusRoutes(app);
    await ownerTeamRoutes(app);
  });

  it("booking create with all routes", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/bookings", headers: hdr("CUSTOMER", C), payload: { salonId: SALON, serviceId: "svc-1", startAt: "2026-10-05T10:00:00", endAt: "2026-10-05T10:30:00" } });
    console.log("STATUS:", res.statusCode, "BODY:", res.body);
    assert.ok([200, 201].includes(res.statusCode), `status=${res.statusCode} body=${res.body}`);
  });

  it("cleanup", async () => {
    await app.close();
  });
});
