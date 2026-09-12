// Run from backend: node --import tsx --test src/routes/salons-lifecycle.test.ts
// Route contract tests using the existing Prisma-double / Fastify inject pattern.
// DELETE success uses a salon with no dependent records. These tests do not model,
// approve, or verify any foreign-key/cascade policy; that requires a later DB test.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { salonRoutes } from "./salons.js";

const original = { user: prisma.user, salon: prisma.salon, $transaction: prisma.$transaction };
const originalSecret = process.env.JWT_ACCESS_SECRET;
const mock = prisma as any;
let rows: Map<string, any>;
let updates: any[];
let deletions: string[];

function fixture(id: string, isActive = true) {
  return {
    id, ownerId: "owner-a", name: "Lifecycle Salon", slug: id, city: "Berlin",
    address: "Teststrasse 10", phone: "+49301234567", description: "Preserve this profile",
    isActive, isVip: false, adminVip: false, classification: "REGULAR",
    openingTime: "09:00", closingTime: "18:00", workingDays: ["mon", "wed"],
    timeZone: "Europe/Berlin", createdAt: new Date("2026-01-01T00:00:00Z"),
    services: [], reviews: [], media: [], barbers: [], offers: [],
  };
}

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "salon-lifecycle-test-secret";
  rows = new Map([
    ["salon-a", fixture("salon-a")],
    ["inactive", fixture("inactive", false)],
    ["empty-salon", fixture("empty-salon")],
  ]);
  updates = [];
  deletions = [];
  mock.user = {
    findUnique: async ({ where }: any) => {
      const role = ({ admin: "ADMIN", "owner-a": "OWNER", "owner-b": "OWNER", customer: "CUSTOMER" } as Record<string, string>)[where.id];
      return role ? { id: where.id, role, status: "ACTIVE" } : null;
    },
  };
  mock.salon = {
    findUnique: async ({ where }: any) => structuredClone(rows.get(where.id) ?? null),
    findMany: async ({ where = {} }: any = {}) => structuredClone([...rows.values()].filter(row =>
      (where.isActive === undefined || row.isActive === where.isActive)
      && (where.id === undefined || row.id === where.id))),
    update: async ({ where, data }: any) => {
      assert.ok(rows.has(where.id), "update must target an existing fixture");
      // Prisma ignores undefined update properties; omitted fields retain their values.
      const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      updates.push({ id: where.id, data: structuredClone(changes) });
      rows.set(where.id, { ...rows.get(where.id), ...structuredClone(changes) });
      return structuredClone(rows.get(where.id));
    },
    delete: async ({ where }: any) => {
      // Only the dependency-free fixture may be deleted. No cascade is simulated.
      assert.equal(where.id, "empty-salon", "dependent-record deletion policy is outside this test");
      assert.ok(rows.has(where.id));
      const row = rows.get(where.id);
      rows.delete(where.id);
      deletions.push(where.id);
      return structuredClone(row);
    },
  };
  mock.$transaction = async (run: any) => {
    const before = structuredClone(rows);
    try { return await run({ salon: mock.salon, user: mock.user }); }
    catch (error) { rows = before; throw error; }
  };
});

afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = originalSecret;
});

function headers(userId: string, role: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  try { await salonRoutes(app); await run(app); }
  finally { await app.close(); }
}

async function setActive(app: ReturnType<typeof Fastify>, id: string, isActive: boolean, userId = "admin", role = "ADMIN") {
  return app.inject({ method: "PATCH", url: `/api/v1/salons/${id}`, headers: headers(userId, role), payload: { isActive } });
}

// A1–A2: separate initial states ensure a no-op cannot pass reactivation.
test("ADMIN persists deactivation", async () => withApp(async app => {
  const response = await setActive(app, "salon-a", false);
  assert.equal(response.statusCode, 200);
  assert.equal((await prisma.salon.findUnique({ where: { id: "salon-a" } }))?.isActive, false, "isActive=false must reach persistence");
}));

test("ADMIN persists reactivation of an inactive salon", async () => withApp(async app => {
  const response = await setActive(app, "inactive", true);
  assert.equal(response.statusCode, 200);
  assert.equal((await prisma.salon.findUnique({ where: { id: "inactive" } }))?.isActive, true, "isActive=true must reach persistence");
}));

test("OWNER cannot deactivate another owner's salon", async () => withApp(async app => {
  const before = structuredClone(rows);
  const response = await setActive(app, "salon-a", false, "owner-b", "OWNER");
  assert.equal(response.statusCode, 403);
  assert.deepEqual(rows, before);
  assert.equal(updates.length, 0);
  assert.equal(deletions.length, 0);
}));

for (const isActive of [false, true]) {
  test(`CUSTOMER cannot set isActive=${isActive}`, async () => withApp(async app => {
    const before = structuredClone(rows);
    const response = await setActive(app, isActive ? "inactive" : "salon-a", isActive, "customer", "CUSTOMER");
    assert.equal(response.statusCode, 403);
    assert.deepEqual(rows, before);
    assert.equal(updates.length, 0);
    assert.equal(deletions.length, 0);
  }));
}

test("deactivation retains the Salon row", async () => withApp(async app => {
  const response = await setActive(app, "salon-a", false);
  assert.equal(response.statusCode, 200);
  assert.ok(await prisma.salon.findUnique({ where: { id: "salon-a" } }), "deactivation must not remove the row");
  assert.equal(deletions.length, 0);
}));

test("deactivate/reactivate preserves profile and existing related history", async () => withApp(async app => {
  rows.get("salon-a").reviews = [{ id: "historical-review", salonId: "salon-a", rating: 4, comment: "Existing history" }];
  const before = structuredClone(rows.get("salon-a"));
  for (const isActive of [false, true]) {
    const response = await setActive(app, "salon-a", isActive);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(await prisma.salon.findUnique({ where: { id: "salon-a" } }), { ...before, isActive }, "only isActive may change in this fixture");
  }
  assert.equal(deletions.length, 0);
}));

test("active listing excludes a persisted inactive salon without deleting it", async () => withApp(async app => {
  const response = await app.inject({ method: "GET", url: "/api/v1/salons" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().salons.map((row: any) => row.id).sort(), ["empty-salon", "salon-a"]);
  assert.ok(await prisma.salon.findUnique({ where: { id: "inactive" } }));
}));

// B: proposed permanent-delete contract is DELETE /api/v1/salons/:id,
// separate from the reversible PATCH { isActive } operation.
test("ADMIN has a separate successful permanent DELETE operation", async () => withApp(async app => {
  const response = await app.inject({ method: "DELETE", url: "/api/v1/salons/empty-salon", headers: headers("admin", "ADMIN") });
  assert.ok([200, 204].includes(response.statusCode), `expected successful permanent DELETE, received ${response.statusCode}`);
}));

for (const [role, userId] of [["OWNER", "owner-a"], ["CUSTOMER", "customer"]]) {
  test(`${role} cannot use permanent DELETE`, async () => withApp(async app => {
    const before = structuredClone(rows);
    const response = await app.inject({ method: "DELETE", url: "/api/v1/salons/empty-salon", headers: headers(userId, role) });
    assert.equal(response.statusCode, 403, "an existing Admin operation must reject this role");
    assert.deepEqual(rows, before);
    assert.equal(updates.length, 0);
    assert.equal(deletions.length, 0);
  }));
}

test("successful permanent DELETE removes the row from persistence and detail API", async () => withApp(async app => {
  const before = await app.inject({ method: "GET", url: "/api/v1/salons/empty-salon" });
  assert.equal(before.statusCode, 200, "fixture must be retrievable before deletion");
  const response = await app.inject({ method: "DELETE", url: "/api/v1/salons/empty-salon", headers: headers("admin", "ADMIN") });
  assert.ok([200, 204].includes(response.statusCode), `expected successful permanent DELETE, received ${response.statusCode}`);
  assert.equal(await prisma.salon.findUnique({ where: { id: "empty-salon" } }), null, "API absence alone could conceal soft deletion");
  const after = await app.inject({ method: "GET", url: "/api/v1/salons/empty-salon" });
  assert.equal(after.statusCode, 404);
}));

test("permanent DELETE cannot silently become isActive=false", async () => withApp(async app => {
  const response = await app.inject({ method: "DELETE", url: "/api/v1/salons/empty-salon", headers: headers("admin", "ADMIN") });
  assert.ok([200, 204].includes(response.statusCode), `expected successful permanent DELETE, received ${response.statusCode}`);
  assert.deepEqual(deletions, ["empty-salon"], "permanent deletion must remove the row through persistence");
  assert.equal(rows.has("empty-salon"), false);
  assert.equal(updates.some(update => update.id === "empty-salon" && update.data.isActive === false), false, "permanent deletion is not deactivation");
}));
