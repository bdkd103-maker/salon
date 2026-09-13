import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonRoutes } from "./salons.js";

const db = prisma as any;
const original = { user: db.user, $transaction: db.$transaction, salon: db.salon };
const originalSecret = process.env.JWT_ACCESS_SECRET;
let tables: Record<string, any[]>;
let writes: string[];
let serial: number;
function delegate(model: string): any {
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  const rows = () => tables[model] ||= [];
  return {
    findUnique: async ({ where }: any) => structuredClone(rows().find(row => matches(row, where)) ?? null),
    findFirst: async ({ where }: any) => structuredClone(rows().filter(row => matches(row, where)).at(-1) ?? null),
    count: async ({ where }: any) => rows().filter(row => matches(row, where)).length,
    create: async ({ data }: any) => {
      writes.push(model);
      const row = { id: String(++serial), releasedAt: null, revokedAt: null, ...structuredClone(data) };
      rows().push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: any) => {
      const row = rows().find(row => matches(row, where));
      assert.ok(row);
      writes.push(model);
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      const matching = rows().filter(row => matches(row, where));
      for (const row of matching) Object.assign(row, structuredClone(data));
      writes.push(model);
      return { count: matching.length };
    },
  };
}
beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "retention-fixture-secret";
  serial = 0;
  writes = [];
  tables = {
    salon: [{ id: "target", isActive: true }, { id: "sibling", isActive: true }],
    salonArchive: [],
    salonRetentionHold: [],
    salonPurgeClearance: [],
  };
  db.user = { findUnique: async ({ where }: any) =>
    ["admin", "owner", "customer"].includes(where.id) ? { id: where.id, role: where.id.toUpperCase(), status: "ACTIVE" } : null };
  db.salon = delegate("salon");
  db.$transaction = async (run: any, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    const before = structuredClone(tables);
    try { return await run(new Proxy({}, { get: (_, name) => delegate(String(name)) })); }
    catch (error) { tables = before; throw error; }
  };
});
afterEach(() => {
  Object.assign(db, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = originalSecret;
});
async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  try { await salonRoutes(app); await run(app); } finally { await app.close(); }
}
function request(app: ReturnType<typeof Fastify>, path: string, payload: any = {}, role = "ADMIN") {
  return app.inject({ method: "POST", url: "/api/v1/salons/target/" + path,
    headers: { authorization: `Bearer ${signAccessToken({ sub: role.toLowerCase(), role })}` }, payload });
}
function archive(salonId = "target") {
  tables.salonArchive.push({ archiveId: "archive-1", salonId, archiveVersion: 1, payloadVersion: 1,
    finalizedAt: new Date("2026-01-01T00:00:00Z"), coverage: { categories: ["BOOKING"], emptyHistory: false },
    sourceState: { salonId, bookingIds: ["booking-1"], bookingContent: ['["booking-1","target","COMPLETED"]'] } });
}
test("ADMIN creates a persisted hold independent of salon active state", async () => withApp(async app => {
  const before = structuredClone(tables.salon);
  const response = await request(app, "retention-holds", { reason: "  Review pending  " });
  assert.equal(response.statusCode, 201);
  const hold = response.json().hold;
  assert.equal(hold.reason, "Review pending");
  assert.equal(hold.actorUserId, "admin");
  assert.equal(hold.salonId, "target");
  assert.equal(hold.releasedAt, null);
  assert.ok(Number.isFinite(Date.parse(hold.createdAt)));
  assert.deepEqual(tables.salon, before);
  tables.salon[0].isActive = false;
  assert.equal(tables.salonRetentionHold[0].reason, "Review pending");
}));
test("ADMIN releases a hold explicitly and it no longer blocks clearance", async () => withApp(async app => {
  archive();
  const created = await request(app, "retention-holds", { reason: "Review" });
  assert.equal(created.statusCode, 201);
  const id = created.json().hold.id;
  assert.equal((await request(app, "purge-clearance")).statusCode, 409);
  const released = await request(app, `retention-holds/${id}/release`, { reason: "Review complete" });
  assert.equal(released.statusCode, 200);
  assert.equal(released.json().hold.releasedByUserId, "admin");
  assert.equal(released.json().hold.releaseReason, "Review complete");
  assert.ok(Number.isFinite(Date.parse(released.json().hold.releasedAt)));
  assert.equal((await request(app, "purge-clearance")).statusCode, 201);
}));
for (const role of ["OWNER", "CUSTOMER"]) {
  for (const path of ["retention-holds", "retention-holds/hold-1/release", "purge-clearance"]) {
    test(`${role} cannot call ${path}`, async () => withApp(async app => {
      assert.equal((await request(app, path, path === "purge-clearance" ? {} : { reason: "Review" }, role)).statusCode, 403);
      assert.deepEqual(writes, []);
    }));
  }
}
for (const payload of [{}, { reason: " " }, { reason: "Review", actorUserId: "owner" }, { reason: "Review", releasedAt: "2026-01-01" }]) {
  test(`hold rejects invalid or spoofed payload ${JSON.stringify(payload)}`, async () => withApp(async app => {
    assert.equal((await request(app, "retention-holds", payload)).statusCode, 400);
    assert.deepEqual(writes, []);
  }));
}
test("clearance requires a finalized target-salon archive", async () => withApp(async app => {
  archive("sibling");
  assert.equal((await request(app, "purge-clearance")).statusCode, 409);
  assert.deepEqual(writes, []);
}));
test("active holds block clearance", async () => withApp(async app => {
  archive();
  tables.salonRetentionHold.push({ id: "h", salonId: "target", releasedAt: null });
  assert.equal((await request(app, "purge-clearance")).statusCode, 409);
  assert.deepEqual(writes, []);
}));
test("clearance records independent archive evidence without mutating salon or allowing DELETE", async () => withApp(async app => {
  archive();
  const before = structuredClone(tables.salon);
  const result = await request(app, "purge-clearance");
  assert.equal(result.statusCode, 201);
  const clearance = result.json().clearance;
  assert.equal(clearance.archiveId, "archive-1");
  assert.equal(clearance.actorUserId, "admin");
  assert.equal(clearance.salonId, "target");
  assert.equal(clearance.revokedAt, null);
  assert.ok(Number.isFinite(Date.parse(clearance.issuedAt)));
  assert.deepEqual(clearance.sourceState, tables.salonArchive[0].sourceState);
  assert.deepEqual(clearance.coverage, tables.salonArchive[0].coverage);
  assert.equal(clearance.archiveVersion, 1);
  assert.equal(clearance.payloadVersion, 1);
  assert.equal(clearance.archiveFinalizedAt, tables.salonArchive[0].finalizedAt.toISOString());
  tables.salonArchive[0].sourceState.bookingContent = ["changed"];
  assert.notDeepEqual(tables.salonPurgeClearance[0].sourceState, tables.salonArchive[0].sourceState);
  assert.deepEqual(tables.salon, before);
  const deletion = await app.inject({ method: "DELETE", url: "/api/v1/salons/target",
    headers: { authorization: `Bearer ${signAccessToken({ sub: "admin", role: "ADMIN" })}` } });
  assert.equal(deletion.statusCode, 409);
  assert.deepEqual(tables.salon, before);
  assert.deepEqual(writes, ["salonPurgeClearance"]);
}));
for (const flag of ["archiveSafe", "retentionSafe", "force", "confirmed", "actorUserId", "archiveId"]) {
  test(`clearance rejects client ${flag}`, async () => withApp(async app => {
    archive();
    assert.equal((await request(app, "purge-clearance", { [flag]: true })).statusCode, 400);
    assert.deepEqual(writes, []);
  }));
}
test("new hold revokes existing clearance and release cannot resurrect it", async () => withApp(async app => {
  archive();
  assert.equal((await request(app, "purge-clearance")).statusCode, 201);
  const hold = await request(app, "retention-holds", { reason: "New review" });
  assert.equal(hold.statusCode, 201);
  assert.ok(tables.salonPurgeClearance[0].revokedAt);
  assert.equal(tables.salonPurgeClearance[0].revokedByUserId, "admin");
  assert.equal((await request(app, `retention-holds/${hold.json().hold.id}/release`, { reason: "Resolved" })).statusCode, 200);
  assert.ok(tables.salonPurgeClearance[0].revokedAt);
}));
test("hold release cannot target a sibling salon hold", async () => withApp(async app => {
  tables.salonRetentionHold.push({ id: "other", salonId: "sibling", releasedAt: null });
  assert.equal((await request(app, "retention-holds/other/release", { reason: "Review complete" })).statusCode, 404);
  assert.deepEqual(writes, []);
}));
test("missing salon cannot receive a hold or clearance", async () => withApp(async app => {
  tables.salon = [];
  assert.equal((await request(app, "retention-holds", { reason: "Review" })).statusCode, 404);
  assert.equal((await request(app, "purge-clearance")).statusCode, 404);
  assert.deepEqual(writes, []);
}));
