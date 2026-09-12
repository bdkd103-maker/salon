import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { salonRoutes } from "./salons.js";

const original = {
  user: prisma.user,
  salon: prisma.salon,
  userSubscription: prisma.userSubscription,
};
const mock = prisma as any;
const flags = { bookingIntakeEnabled: true, saloTicketIntakeEnabled: false, walkInIntakeEnabled: true };
let salons: Record<string, any>;
let updates: any[];
let reads: any[];

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "salon-intake-controls-test-secret";
  salons = {
    "salon-a": { id: "salon-a", ownerId: "owner-a", ...flags },
    "salon-b": { id: "salon-b", ownerId: "owner-b", ...flags },
  };
  updates = [];
  reads = [];
  mock.user = {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      role: where.id === "admin" ? "ADMIN" : where.id === "customer" ? "CUSTOMER" : "OWNER",
      status: "ACTIVE",
    }),
  };
  mock.userSubscription = {
  findUnique: async ({ where }: any) => ({
    id: `sub-${where.userId}`,
    userId: where.userId,
    plan: "SMART",
    status: "ACTIVE",
    providerReference: "provider-smart",
  }),
};
  mock.salon = {
    findUnique: async (args: any) => {
      reads.push(args);
      return salons[args.where.id] ?? null;
    },
    update: async (args: any) => {
      updates.push(args);
      salons[args.where.id] = { ...salons[args.where.id], ...args.data };
      return salons[args.where.id];
    },
  };
});

afterEach(() => Object.assign(mock, original));

function authorization(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  try {
    await salonRoutes(app);
    await run(app);
  } finally {
    await app.close();
  }
}

for (const role of ["OWNER", "ADMIN"]) {
  test(`${role} reads authorized salon intake controls`, async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/salons/salon-a/intake-controls",
        headers: authorization(role, role === "ADMIN" ? "admin" : "owner-a"),
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { intakeControls: flags });
      assert.deepEqual(reads[0], {
        where: { id: "salon-a" },
        select: { id: true, ownerId: true, bookingIntakeEnabled: true, saloTicketIntakeEnabled: true, walkInIntakeEnabled: true },
      });
    });
  });
}

for (const method of ["GET", "PATCH"] as const) {
  for (const scenario of [
    { name: "another owner's salon", role: "OWNER", userId: "owner-a", salonId: "salon-b", status: 403 },
    { name: "customer", role: "CUSTOMER", userId: "customer", salonId: "salon-a", status: 403 },
    { name: "unauthenticated request", role: "", userId: "", salonId: "salon-a", status: 401 },
    { name: "missing salon", role: "OWNER", userId: "owner-a", salonId: "missing", status: 404 },
  ]) {
    test(`${method} intake controls rejects ${scenario.name}`, async () => {
      await withApp(async (app) => {
        const response = await app.inject({
          method,
          url: `/api/v1/salons/${scenario.salonId}/intake-controls`,
          headers: scenario.role ? authorization(scenario.role, scenario.userId) : {},
          ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
        });
        assert.equal(response.statusCode, scenario.status, response.body);
        assert.equal(updates.length, 0);
      });
    });
  }
}

test("owner patches one intake control and preserves omitted flags", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/intake-controls",
      headers: authorization("OWNER", "owner-a"),
      payload: { bookingIntakeEnabled: false },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(updates[0].data, { bookingIntakeEnabled: false });
    assert.deepEqual(response.json(), { intakeControls: { ...flags, bookingIntakeEnabled: false } });
    assert.equal(salons["salon-a"].saloTicketIntakeEnabled, false);
    assert.equal(salons["salon-a"].walkInIntakeEnabled, true);
  });
});

test("admin patches any salon intake controls", async () => {
  await withApp(async (app) => {
    const intakeControls = { bookingIntakeEnabled: false, saloTicketIntakeEnabled: true, walkInIntakeEnabled: false };
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-b/intake-controls",
      headers: authorization("ADMIN", "admin"),
      payload: intakeControls,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(updates[0].data, intakeControls);
    assert.deepEqual(response.json(), { intakeControls });
  });
});

for (const [name, payload] of [
  ["empty payload", {}],
  ["unknown key", { bookingIntakeEnabled: false, name: "Changed" }],
  ["string boolean", { bookingIntakeEnabled: "false" }],
  ["numeric boolean", { saloTicketIntakeEnabled: 0 }],
  ["null boolean", { walkInIntakeEnabled: null }],
] as const) {
  test(`intake controls PATCH rejects ${name}`, async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/salons/salon-a/intake-controls",
        headers: authorization("OWNER", "owner-a"),
        payload,
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error, "Invalid payload");
      assert.ok(response.json().details);
      assert.equal(updates.length, 0);
      assert.deepEqual(salons["salon-a"], { id: "salon-a", ownerId: "owner-a", ...flags });
    });
  });
}

for (const method of ["GET", "PATCH"] as const) {
  test(`${method} intake controls returns 500 for a salon lookup failure`, async () => {
    mock.salon.findUnique = async () => { throw new Error("Database unavailable"); };
    await withApp(async (app) => {
      const response = await app.inject({
        method,
        url: "/api/v1/salons/salon-a/intake-controls",
        headers: authorization("OWNER", "owner-a"),
        ...(method === "PATCH" ? { payload: { bookingIntakeEnabled: false } } : {}),
      });
      assert.equal(response.statusCode, 500, response.body);
      assert.deepEqual(response.json(), { error: "Internal server error" });
    });
  });
}

test("intake controls PATCH returns 500 for an update failure", async () => {
  mock.salon.update = async () => { throw new Error("Database unavailable"); };
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/intake-controls",
      headers: authorization("OWNER", "owner-a"),
      payload: { walkInIntakeEnabled: false },
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(response.json(), { error: "Internal server error" });
  });
});
