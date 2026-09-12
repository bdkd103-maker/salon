import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Fastify from "fastify";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { bookingRoutes } from "./bookings.js";

const original = { user: prisma.user, booking: prisma.booking };
const mock = prisma as unknown as { user: any; booking: any };
const salon = { id: "salon-1", ownerId: "owner-1", name: "Salon", openingTime: "09:00", closingTime: "20:00" };
const relatedUser = {
  id: "customer-1", fullName: "Customer", email: "customer@example.test", phone: "+4915123456789",
  passwordHash: "secret-hash", tokenHash: "secret-token", refreshToken: "secret-refresh",
  sessions: [{ tokenHash: "session-secret" }], passwordResets: [{ tokenHash: "reset-secret" }],
  emailVerified: true, phoneVerified: false, role: "CUSTOMER", status: "ACTIVE",
};

describe("booking security", () => {
  let actor: { id: string; role: string };
  let record: any;
  let updates: number;
  let app: ReturnType<typeof Fastify>;
  let previousSecret: string | undefined;

  beforeEach(async () => {
    previousSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = "booking-security-test-only";
    actor = { id: "owner-1", role: "OWNER" };
    updates = 0;
    record = {
      id: "booking-1", salonId: salon.id, userId: "customer-1", status: "PENDING",
      startAt: new Date("2026-09-08T08:00:00Z"), endAt: new Date("2026-09-08T09:00:00Z"),
      cancelledAt: null, cancellationReason: null, notes: null, serviceId: null, barberId: null,
      salon, service: null, barber: null,
    };
    // All database access in these routes is replaced; no database is contacted.
    mock.user = { findUnique: async ({ where }: any) => where.id === actor.id ? { ...actor, status: "ACTIVE" } : null };
    mock.booking = {
      findUnique: async ({ where, include }: any) => {
        assert.equal(where.id, record.id);
        assert.ok(include.salon, "authorization must fetch the persisted salon relationship");
        return { ...record };
      },
      count: async () => 0,
      update: async ({ where, data }: any) => {
        assert.equal(where.id, record.id);
        updates++;
        record = { ...record, ...data };
        return record;
      },
      findMany: async ({ include }: any) => {
        if (!include.user) return [{ ...record }];
        assert.deepEqual(include.user, { select: { id: true, fullName: true, email: true, phone: true } });
        const user = Object.fromEntries(Object.keys(include.user.select).map(key => [key, relatedUser[key as keyof typeof relatedUser]]));
        return [{ ...record, user }];
      },
    };
    app = Fastify();
    await bookingRoutes(app);
  });

  afterEach(async () => {
    await app.close();
    mock.user = original.user;
    mock.booking = original.booking;
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  function send(method: "PATCH" | "DELETE" | "GET", payload?: object, url = "/api/v1/bookings/booking-1") {
    return app.inject({ method, url, payload, headers: {
      // Deliberately claim ADMIN: authorization must use the persisted user role.
      authorization: `Bearer ${signAccessToken({ sub: actor.id, role: "ADMIN" })}`,
    } });
  }

  for (const method of ["PATCH", "DELETE"] as const) {
    for (const role of ["OWNER", "STAFF", "CUSTOMER"]) {
      it(`denies ${role} cross-tenant/customer ${method} without writing`, async () => {
        actor = { id: "outsider", role };
        const response = await send(method, method === "PATCH" ? { status: "CANCELLED", salonId: salon.id, ownerId: actor.id, userId: actor.id } : undefined);
        assert.equal(response.statusCode, 403, response.body);
        assert.equal(updates, 0);
      });
    }
    for (const role of ["OWNER", "STAFF", "ADMIN", "CUSTOMER"]) {
      it(`allows authorized ${role} ${method}`, async () => {
        actor = { id: role === "ADMIN" ? "admin-1" : role === "CUSTOMER" ? record.userId : salon.ownerId, role };
        const response = await send(method, method === "PATCH" ? { status: role === "CUSTOMER" ? "CANCELLED" : "CONFIRMED" } : undefined);
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(updates, 1);
        assert.equal("user" in response.json().booking, false);
      });
    }
  }

  it("does not grant STAFF access merely because they are the booking customer", async () => {
    actor = { id: record.userId, role: "STAFF" };
    assert.equal((await send("PATCH", { notes: "changed" })).statusCode, 403);
    assert.equal(updates, 0);
  });

  it("preserves customer editing of their own active booking", async () => {
    actor = { id: record.userId, role: "CUSTOMER" };
    assert.equal((await send("PATCH", { notes: "Please call" })).statusCode, 200);
    assert.equal(record.notes, "Please call");
  });

  for (const status of ["CONFIRMED", "COMPLETED", "NO_SHOW"]) {
    it(`denies customer self-assignment of ${status}`, async () => {
      actor = { id: record.userId, role: "CUSTOMER" };
      assert.equal((await send("PATCH", { status })).statusCode, 403);
      assert.equal(updates, 0);
    });
  }
  for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"]) {
    it(`denies customer reopening/editing/cancelling ${status} bookings`, async () => {
      actor = { id: record.userId, role: "CUSTOMER" };
      record.status = status;
      assert.equal((await send("PATCH", { status: "PENDING" })).statusCode, 403);
      assert.equal((await send("PATCH", { notes: "changed" })).statusCode, 403);
      assert.equal((await send("DELETE")).statusCode, 403);
      assert.equal(updates, 0);
    });
  }

  for (const role of ["OWNER", "STAFF", "ADMIN"]) {
    it(`selects only booking contact fields for ${role} listing`, async () => {
      actor.role = role;
      const response = await send("GET", undefined, "/api/v1/bookings");
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().bookings[0].user, {
        id: relatedUser.id, fullName: relatedUser.fullName, email: relatedUser.email, phone: relatedUser.phone,
      });
      assert.doesNotMatch(response.body, /passwordHash|tokenHash|refreshToken|sessions|passwordResets|emailVerified|phoneVerified|secret/);
    });
  }
  it("does not include related User records in customer booking history", async () => {
    actor = { id: record.userId, role: "CUSTOMER" };
    const response = await send("GET", undefined, "/api/v1/bookings/me");
    assert.equal(response.statusCode, 200, response.body);
    assert.equal("user" in response.json().bookings[0], false);
  });
});
