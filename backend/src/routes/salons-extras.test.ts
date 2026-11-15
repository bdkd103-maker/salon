import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { SALON_EXTRAS_CATALOG, salonRoutes } from "./salons.js";

const original = {
  user: prisma.user,
  salon: prisma.salon,
  salonExtras: (prisma as any).salonExtras,
};
const mock = prisma as any;

const ownerSalons: Record<string, { id: string; ownerId: string }> = {
  "salon-a": { id: "salon-a", ownerId: "owner-a" },
  "salon-b": { id: "salon-b", ownerId: "owner-b" },
};
let extrasRows: Record<string, string[]>;
let upserts: any[];
let publicSalons: any[];

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "salon-extras-test-secret";
  extrasRows = {
    "salon-a": ["wifi", "coffee"],
    "salon-b": ["parking"],
  };
  upserts = [];
  publicSalons = [
    {
      id: "salon-a", ownerId: "owner-a", name: "Salon A", city: "Berlin", email: "business-a@example.invalid",
      isActive: true, services: [], media: [], reviews: [],
      salonExtras: { extras: ["wifi", "cashPayment"] },
    },
    {
      id: "salon-b", ownerId: "owner-b", name: "Salon B", city: "Köln", email: "business-b@example.invalid",
      isActive: true, services: [], media: [], reviews: [],
      salonExtras: { extras: ["applePay"] },
    },
  ];
  mock.user = {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      role: where.id === "admin" ? "ADMIN" : where.id === "customer" ? "CUSTOMER" : "OWNER",
      status: "ACTIVE",
    }),
  };
  mock.salon = {
    findUnique: async ({ where }: any) => ownerSalons[where.id] ?? null,
    findMany: async () => publicSalons,
  };
  mock.salonExtras = {
    findUnique: async ({ where }: any) => {
      const values = extrasRows[where.salonId];
      return values === undefined ? null : { salonId: where.salonId, extras: values, updatedAt: new Date() };
    },
    upsert: async (args: any) => {
      upserts.push(args);
      extrasRows[args.where.salonId] = args.create.extras;
      return { salonId: args.where.salonId, extras: args.create.extras, updatedAt: new Date() };
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
  test(`${role} reads salon extras for an authorized salon`, async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/salons/salon-a/extras",
        headers: authorization(role, role === "ADMIN" ? "admin" : "owner-a"),
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { extras: ["coffee", "wifi"] }); // canonical order
    });
  });
}

test("salon without a persisted extras row reads back as empty", async () => {
  delete extrasRows["salon-a"];
  await withApp(async (app) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { extras: [] });
  });
});

for (const method of ["GET", "PATCH"] as const) {
  for (const scenario of [
    { name: "another owner's salon", role: "OWNER", userId: "owner-a", salonId: "salon-b", status: 403 },
    { name: "customer", role: "CUSTOMER", userId: "customer", salonId: "salon-a", status: 403 },
    { name: "unauthenticated request", role: "", userId: "", salonId: "salon-a", status: 401 },
    { name: "missing salon", role: "OWNER", userId: "owner-a", salonId: "missing", status: 404 },
  ]) {
    test(`${method} salon extras rejects ${scenario.name}`, async () => {
      const before = JSON.parse(JSON.stringify(extrasRows));
      await withApp(async (app) => {
        const response = await app.inject({
          method,
          url: `/api/v1/salons/${scenario.salonId}/extras`,
          headers: scenario.role ? authorization(scenario.role, scenario.userId) : {},
          ...(method === "PATCH" ? { payload: { extras: ["parking"] } } : {}),
        });
        assert.equal(response.statusCode, scenario.status, response.body);
        assert.equal(upserts.length, 0);
        assert.deepEqual(extrasRows, before, "rejected requests must not change persisted extras");
      });
    });
  }
}

test("owner enables extras and the response is canonical, deduplicated and persisted", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
      payload: { extras: ["wheelchairAccess", "coffee", "coffee", "cardPayment"] },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { extras: ["coffee", "cardPayment", "wheelchairAccess"] });
    assert.deepEqual(upserts[0].where, { salonId: "salon-a" });
    assert.deepEqual(upserts[0].update, { extras: ["coffee", "cardPayment", "wheelchairAccess"] });
    assert.deepEqual(upserts[0].create, { salonId: "salon-a", extras: ["coffee", "cardPayment", "wheelchairAccess"] });
    assert.deepEqual(extrasRows["salon-a"], ["coffee", "cardPayment", "wheelchairAccess"]);

    const readBack = await app.inject({
      method: "GET",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
    });
    assert.deepEqual(readBack.json(), { extras: ["coffee", "cardPayment", "wheelchairAccess"] });
  });
});

test("owner disables every extra and the empty list is the persisted truth", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
      payload: { extras: [] },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { extras: [] });
    assert.deepEqual(extrasRows["salon-a"], []);

    const readBack = await app.inject({
      method: "GET",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
    });
    assert.deepEqual(readBack.json(), { extras: [] });
  });
});

test("one salon's extras never leak into another salon's read", async () => {
  await withApp(async (app) => {
    const first = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
      payload: { extras: ["coffee"] },
    });
    assert.equal(first.statusCode, 200, first.body);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/salons/salon-b/extras",
      headers: authorization("OWNER", "owner-b"),
    });
    assert.deepEqual(other.json(), { extras: ["parking"] });
    assert.deepEqual(extrasRows["salon-b"], ["parking"], "salon B must stay untouched");
  });
});

test("admin can update any salon extras", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-b/extras",
      headers: authorization("ADMIN", "admin"),
      payload: { extras: ["googlePay", "wifi"] },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { extras: ["wifi", "googlePay"] });
    assert.deepEqual(extrasRows["salon-b"], ["wifi", "googlePay"]);
  });
});

for (const [name, payload] of [
  ["empty payload", {}],
  ["unknown extra key", { extras: ["coffee", "jetpack"] }],
  ["string instead of array", { extras: "wifi" }],
  ["array of non-strings", { extras: [1, 2] }],
  ["null extras", { extras: null }],
  ["extra top-level key", { extras: ["wifi"], enabled: true }],
] as const) {
  test(`extras PATCH rejects ${name}`, async () => {
    const before = JSON.parse(JSON.stringify(extrasRows));
    await withApp(async (app) => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/salons/salon-a/extras",
        headers: authorization("OWNER", "owner-a"),
        payload,
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error, "Invalid payload");
      assert.ok(response.json().details);
      assert.equal(upserts.length, 0);
      assert.deepEqual(extrasRows, before);
    });
  });
}

test("public salon detail exposes only that salon's enabled extras", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/v1/salons/salon-a" });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().salon.extras, ["wifi", "cashPayment"]);
    assert.equal(response.json().salon.salonExtras, undefined, "raw relation must not leak");

    const other = await app.inject({ method: "GET", url: "/api/v1/salons/salon-b" });
    assert.deepEqual(other.json().salon.extras, ["applePay"]);
  });
});

test("public directory still works without an extras include", async () => {
  publicSalons = publicSalons.map(({ salonExtras, ...salon }: any) => salon);
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/v1/salons" });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().salons.length, 2);
    assert.equal(response.json().salons[0].extras, undefined);
  });
});

test("supported extras catalog stays the initial nine keys", () => {
  assert.deepEqual([...SALON_EXTRAS_CATALOG], [
    "coffee", "otherDrinks", "wifi", "parking", "cashPayment",
    "cardPayment", "applePay", "googlePay", "wheelchairAccess",
  ]);
});

for (const method of ["GET", "PATCH"] as const) {
  test(`${method} salon extras returns 500 for a salon lookup failure`, async () => {
    mock.salon.findUnique = async () => { throw new Error("Database unavailable"); };
    await withApp(async (app) => {
      const response = await app.inject({
        method,
        url: "/api/v1/salons/salon-a/extras",
        headers: authorization("OWNER", "owner-a"),
        ...(method === "PATCH" ? { payload: { extras: ["wifi"] } } : {}),
      });
      assert.equal(response.statusCode, 500, response.body);
      assert.deepEqual(response.json(), { error: "Internal server error" });
    });
  });
}

test("extras PATCH returns 500 for an update failure", async () => {
  mock.salonExtras.upsert = async () => { throw new Error("Database unavailable"); };
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
      payload: { extras: ["wifi"] },
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(response.json(), { error: "Internal server error" });
  });
});

test("extras GET returns 500 for a read failure", async () => {
  mock.salonExtras.findUnique = async () => { throw new Error("Database unavailable"); };
  await withApp(async (app) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/salons/salon-a/extras",
      headers: authorization("OWNER", "owner-a"),
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(response.json(), { error: "Internal server error" });
  });
});
