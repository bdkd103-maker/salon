import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Fastify from "fastify";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { bookingRoutes } from "./bookings.js";

const original = { user: prisma.user, booking: prisma.booking, notification: prisma.notification, $transaction: prisma.$transaction,
  service: prisma.service, barber: prisma.barber, salon: prisma.salon, platformSettings: prisma.platformSettings };
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
  let transactions: number;
  let app: ReturnType<typeof Fastify>;
  let previousSecret: string | undefined;

  beforeEach(async () => {
    previousSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = "booking-security-test-only";
    actor = { id: "owner-1", role: "OWNER" };
    updates = 0;
    transactions = 0;
    (mock as any).barber = { findUnique: async ({ where }: any) => where.id === "missing-barber" ? null
      : { id: where.id, salonId: where.id === "foreign-barber" ? "salon-2" : salon.id } };
    (mock as any).$transaction = async (fn: any) => { transactions++; return fn(mock); };
    (mock as any).service = { findUnique: async ({ where }: any) => {
      if (where.id === "missing") return null;
      return { id: where.id, salonId: where.id === "foreign-service" ? "salon-2" : salon.id,
        durationMin: where.id === "long-service" ? 120 : 30 };
    } };
    (mock as any).platformSettings = { findUnique: async () => ({ bookingGloballyEnabled: true }) };
    (mock as any).salon = { findUnique: async () => ({ ...salon, isActive: true, bookingIntakeEnabled: true,
      services: [{ id: "same-service", salonId: salon.id, durationMin: 30 }], barbers: [] }) };
    (mock as any).notification = { upsert: async ({ create }: any) => { assert.ok(["customer-1", "owner-1"].includes(create.userId)); return create; } };
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
    Object.assign(mock, original);
    mock.user = original.user;
    mock.booking = original.booking;
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  function send(method: "PATCH" | "DELETE" | "GET" | "POST", payload?: object, url = "/api/v1/bookings/booking-1") {
    return app.inject({ method, url, payload, headers: {
      // Deliberately claim ADMIN: authorization must use the persisted user role.
      authorization: `Bearer ${signAccessToken({ sub: actor.id, role: "ADMIN" })}`,
    } });
  }

  for (const role of ["CUSTOMER", "OWNER", "STAFF", "ADMIN"]) {
    it(`rejects foreign-salon barber reassignment by authorized ${role} before any writes`, async () => {
      actor = { id: role === "CUSTOMER" ? record.userId : role === "ADMIN" ? "admin-1" : salon.ownerId, role };
      record.barberId = "original-barber";
      const before = structuredClone(record);
      const response = await send("PATCH", { barberId: "foreign-barber", notes: "must not persist", status: "CANCELLED" });
      assert.equal(response.statusCode, 400, response.body);
      assert.deepEqual(record, before);
      assert.equal(updates, 0);
      assert.equal(transactions, 0);
    });
    it(`allows same-salon barber reassignment by authorized ${role}`, async () => {
      actor = { id: role === "CUSTOMER" ? record.userId : role === "ADMIN" ? "admin-1" : salon.ownerId, role };
      record.barberId = "original-barber";
      const response = await send("PATCH", { barberId: " same-barber " });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(record.barberId, "same-barber");
      assert.equal(record.salonId, salon.id);
      assert.equal(record.status, "PENDING");
      assert.equal(updates, 1);
    });
    it(`rejects cross-salon service reassignment by authorized ${role} without changing any booking data`, async () => {
      actor = { id: role === "CUSTOMER" ? record.userId : role === "ADMIN" ? "admin-1" : salon.ownerId, role };
      record.serviceId = "original-service";
      record.service = { id: record.serviceId, salonId: salon.id, durationMin: 30 };
      const before = structuredClone(record);
      const response = await send("PATCH", { serviceId: "foreign-service", notes: "must not persist", status: "CANCELLED" });
      assert.equal(response.statusCode, 400, response.body);
      assert.deepEqual(record, before);
      assert.equal(updates, 0);
      assert.equal(transactions, 0, "no write, notification or loyalty transaction may start");
    });
    it(`preserves same-salon service reassignment by authorized ${role}`, async () => {
      actor = { id: role === "CUSTOMER" ? record.userId : role === "ADMIN" ? "admin-1" : salon.ownerId, role };
      record.serviceId = "original-service";
      const response = await send("PATCH", { serviceId: "same-service" });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(record.serviceId, "same-service");
      assert.equal(record.salonId, salon.id);
      assert.equal(record.status, "PENDING");
      assert.equal(updates, 1);
    });
  }

  for (const originalBarber of [null, "original-barber"]) {
    for (const payload of [{ notes: "Edited" }, { barberId: "", notes: "Edited" }]) {
      it(`preserves ${originalBarber ?? "unassigned"} barber when barberId is ${"barberId" in payload ? "empty" : "omitted"}`, async () => {
        record.barberId = originalBarber;
        const response = await send("PATCH", payload);
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(record.barberId, originalBarber);
        assert.equal(record.notes, "Edited");
      });
    }
  }
  it("preserves null-barber payload rejection", async () => {
    assert.equal((await send("PATCH", { barberId: null })).statusCode, 400);
    assert.equal(updates, 0); assert.equal(transactions, 0);
  });
  it("allows assigning a same-salon barber to an unassigned booking", async () => {
    const response = await send("PATCH", { barberId: "same-barber" });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(record.barberId, "same-barber");
  });
  it("rejects a nonexistent barber without writes", async () => {
    const before = structuredClone(record);
    assert.equal((await send("PATCH", { barberId: "missing-barber" })).statusCode, 404);
    assert.deepEqual(record, before); assert.equal(transactions, 0);
  });
  it("retains overlap prevention for the newly selected same-salon barber", async () => {
    const before = structuredClone(record);
    mock.booking.count = async ({ where }: any) => {
      assert.equal(where.barberId, "same-barber");
      assert.equal(where.salonId, salon.id);
      assert.equal(where.id.not, record.id);
      assert.deepEqual(where.status.in, ["PENDING", "CONFIRMED"]);
      return 1;
    };
    assert.equal((await send("PATCH", { barberId: "same-barber" })).statusCode, 409);
    assert.deepEqual(record, before); assert.equal(transactions, 0);
  });
  it("creation already rejects a barber outside the selected salon", async () => {
    const response = await send("POST", { salonId: salon.id, serviceId: "same-service", barberId: "foreign-barber",
      startAt: "2026-09-08T10:00:00", endAt: "2026-09-08T11:00:00", timeZone: "Europe/Berlin" }, "/api/v1/bookings");
    assert.equal(response.statusCode, 404, response.body);
    assert.deepEqual(response.json(), { error: "Barber not found" });
    assert.equal(transactions, 0);
  });

  it("preserves missing-service, duration and overlap rejection", async () => {
    const before = structuredClone(record);
    assert.equal((await send("PATCH", { serviceId: "missing" })).statusCode, 404);
    assert.equal((await send("PATCH", { serviceId: "long-service" })).statusCode, 400);
    mock.booking.count = async ({ where }: any) => {
      assert.equal(where.salonId, salon.id);
      assert.equal(where.id.not, record.id);
      return 1;
    };
    assert.equal((await send("PATCH", { serviceId: "same-service" })).statusCode, 409);
    assert.equal(updates, 0);
    assert.deepEqual(record, before);
  });

  it("creation already rejects services outside the selected salon", async () => {
    actor = { id: record.userId, role: "CUSTOMER" };
    const before = structuredClone(record);
    const response = await send("POST", { salonId: salon.id, serviceId: "foreign-service",
      startAt: "2026-09-08T10:00:00", endAt: "2026-09-08T11:00:00", timeZone: "Europe/Berlin" }, "/api/v1/bookings");
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(transactions, 0);
    assert.deepEqual(record, before);
  });

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
