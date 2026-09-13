import assert from "node:assert/strict";
import { buildSalonArchiveState } from "../lib/salon-archive.js";
import * as clearanceValidation from "../lib/salon-clearance-revalidation.js";

async function readiness() {
  const evaluate = Reflect.get(clearanceValidation, "evaluateSalonDeletionReadiness");
  assert.equal(typeof evaluate, "function", "transaction-local deletion-readiness helper must exist");
  return db.$transaction((tx: any) => evaluate(tx, "target", "admin"), { isolationLevel: "Serializable" });
}
test("readiness accepts unchanged nonempty evidence using only the supplied transaction", async () => withApp(async app => {
  tables.booking = [{ ...v2Booking, id: "b", salonId: "target", status: "COMPLETED" }];
  const id = await finalizedClearance(app);
  const before = structuredClone(tables.salon);
  const globalSalon = db.salon;
  const globalClearance = db.salonPurgeClearance;
  const forbidden = new Proxy({}, { get() { throw new Error("global database access is forbidden"); } });
  writes = [];
  try {
    db.salon = forbidden;
    db.salonPurgeClearance = forbidden;
    const result = await readiness();
    assert.equal(result.valid, true, "unchanged source evidence must still validate");
    assert.equal(result.ready, false, "unresolved deletion policy must block readiness");
    assert.ok(result.blockingModels.includes("Message"));
    assert.equal(result.clearanceId, id);
    assert.deepEqual(tables.salon, before);
    assert.deepEqual(writes, []);
  } finally {
    db.salon = globalSalon;
    db.salonPurgeClearance = globalClearance;
  }
}));
test("readiness accepts still-empty evaluated categories and ignores sibling source changes", async () => withApp(async app => {
  await finalizedClearance(app);
  tables.booking.push({ ...v2Booking, id: "sibling-b", salonId: "sibling", status: "COMPLETED" });
  const result = await readiness();
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.ok(result.blockingModels.includes("Message"));
}));
for (const mode of ["revoked", "hold", "sibling clearance", "missing salon", "partial", "old version", "archive identity", "archive evidence", "missing clearance"]) {
  test(`readiness refuses ${mode}`, async () => withApp(async app => {
    await finalizedClearance(app);
    const clearance = tables.salonPurgeClearance[0];
    if (mode === "revoked") clearance.revokedAt = new Date();
    if (mode === "hold") tables.salonRetentionHold.push({ id: "h", salonId: "target", releasedAt: null });
    if (mode === "sibling clearance") clearance.salonId = "sibling";
    if (mode === "missing salon") tables.salon = [];
    if (mode === "partial") clearance.coverage.categories = ["BOOKING"];
    if (mode === "old version") clearance.payloadVersion = 999;
    if (mode === "archive identity") clearance.archiveId = "missing";
    if (mode === "archive evidence") tables.salonArchive[0].sourceState.bookingIds = ["changed"];
    if (mode === "missing clearance") tables.salonPurgeClearance = [];
    const before = structuredClone(tables.salon);
    assert.equal((await readiness()).ready, false);
    assert.deepEqual(tables.salon, before);
  }));
}
for (const mutation of ["status", "insert", "remove"]) {
  test(`readiness reruns validation after successful preflight then ${mutation}`, async () => withApp(async app => {
    tables.booking = [{ ...v2Booking, id: "b", salonId: "target", status: "COMPLETED" }];
    const id = await finalizedClearance(app);
    assert.equal((await revalidate(app, id)).statusCode, 200);
    if (mutation === "status") tables.booking[0].status = "CANCELLED";
    if (mutation === "insert") tables.booking.push({ ...v2Booking, id: "new", salonId: "target", status: "COMPLETED" });
    if (mutation === "remove") tables.booking = [];
    assert.equal((await readiness()).ready, false);
    assert.ok(tables.salonPurgeClearance[0].revokedAt);
  }));
}
test("readiness does not fall back to older clearance after the latest was revoked", async () => withApp(async app => {
  await finalizedClearance(app);
  assert.equal((await request(app, "purge-clearance")).statusCode, 201);
  tables.salonPurgeClearance[1].revokedAt = new Date();
  assert.equal((await readiness()).ready, false);
}));
for (const flag of ["clearanceId", "archiveId", "sourceState", "coverage", "force", "retentionSafe", "archiveSafe", "confirmed"]) {
  test(`readiness cannot enable DELETE through client ${flag}`, async () => withApp(async app => {
    const id = await finalizedClearance(app);
    const resultBeforeDelete = await readiness();
    assert.equal(resultBeforeDelete.valid, true);
    assert.equal(resultBeforeDelete.ready, false);
    const before = structuredClone(tables.salon);
    const result = await app.inject({ method: "DELETE", url: "/api/v1/salons/target",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "admin", role: "ADMIN" })}` },
      payload: { [flag]: flag === "clearanceId" ? id : true } });
    assert.equal(result.statusCode, 409);
    assert.deepEqual(tables.salon, before);
  }));
}
async function finalizedClearance(app: ReturnType<typeof Fastify>) {
  const result = await request(app, "archive/finalize");
  assert.equal(result.statusCode, 201);
  const issued = await request(app, "purge-clearance");
  assert.equal(issued.statusCode, 201);
  return issued.json().clearance.id as string;
}
const revalidate = (app: ReturnType<typeof Fastify>, id: string, payload: any = {}, role = "ADMIN") =>
  request(app, `purge-clearance/${id}/revalidate`, payload, role);

test("revalidation accepts evaluated-empty current evidence without changing Salon or enabling DELETE", async () => withApp(async app => {
  const id = await finalizedClearance(app);
  const before = structuredClone(tables.salon);
  writes = [];
  const result = await revalidate(app, id);
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().valid, true);
  assert.deepEqual(writes, []);
  assert.deepEqual(tables.salon, before);
  const deleted = await app.inject({ method: "DELETE", url: "/api/v1/salons/target",
    headers: { authorization: `Bearer ${signAccessToken({ sub: "admin", role: "ADMIN" })}` } });
  assert.equal(deleted.statusCode, 409);
}));
for (const change of ["status", "addition", "removal"]) {
  test(`revalidation revokes clearance after Booking ${change}`, async () => withApp(async app => {
    tables.booking = [{ ...v2Booking, id: "b", salonId: "target", status: "COMPLETED" }];
    const id = await finalizedClearance(app);
    assert.equal((await revalidate(app, id)).statusCode, 200, "unchanged nonempty evidence must validate");
    if (change === "status") tables.booking[0].status = "CANCELLED";
    if (change === "addition") tables.booking.push({ ...v2Booking, id: "c", salonId: "target", status: "COMPLETED" });
    if (change === "removal") tables.booking = [];
    writes = [];
    const before = structuredClone(tables.salon);
    assert.equal((await revalidate(app, id)).statusCode, 409);
    assert.ok(tables.salonPurgeClearance[0].revokedAt);
    assert.equal(tables.salonPurgeClearance[0].revocationReason, "Source state changed");
    assert.deepEqual(writes, ["salonPurgeClearance"]);
    assert.deepEqual(tables.salon, before);
    assert.equal(tables.salonPurgeClearance.length, 1);
  }));
}
test("revalidation detects StaffPresence content change", async () => withApp(async app => {
  tables.staffMembership = [{ ...v2Membership, id: "m", salonId: "target", userId: "owner", barberId: "b", status: "ACTIVE", revokedAt: null }];
  tables.staffPresence = [{ staffMembershipId: "m", dutyState: "ON_DUTY", generation: 1, changedAt: new Date(), changedByUserId: null, changeSource: "STAFF" }];
  const id = await finalizedClearance(app);
  tables.staffPresence[0].dutyState = "OFF_DUTY";
  assert.equal((await revalidate(app, id)).statusCode, 409);
  assert.ok(tables.salonPurgeClearance[0].revokedAt);
}));
test("revalidation detects Loyalty child content change", async () => withApp(async app => {
  tables.loyaltyCard = [{ id: "card", salonId: "target", isActive: true, requiredStamps: 8, rewardType: "FREE_SERVICE", rewardTitle: "Cut", rewardText: "Cut", description: null, createdAt: new Date() }];
  tables.loyaltyCustomer = [{ id: "c", cardId: "card", customerId: "customer", currentStamps: 1, totalVisits: 1, lastStampedAt: null, rewardRedeemedAt: null }];
  const id = await finalizedClearance(app);
  tables.loyaltyCustomer[0].currentStamps = 2;
  assert.equal((await revalidate(app, id)).statusCode, 409);
}));
test("revalidation detects Analytics metadata change", async () => withApp(async app => {
  tables.analyticsEvent = [{ id: "e", salonId: "target", userId: null, eventType: "VIEW", source: "app", metadata: { count: 1 }, createdAt: new Date() }];
  const id = await finalizedClearance(app);
  tables.analyticsEvent[0].metadata.count = 2;
  assert.equal((await revalidate(app, id)).statusCode, 409);
}));
test("revalidation ignores sibling records and JSON object-key order", async () => withApp(async app => {
  const id = await finalizedClearance(app);
  tables.booking.push({ ...v2Booking, id: "sibling-booking", salonId: "sibling", status: "COMPLETED" });
  tables.staffMembership.push({ id: "sibling-member", salonId: "sibling" });
  (tables.staffPresence ||= []).push({ staffMembershipId: "sibling-member", dutyState: "OFF_DUTY" });
  tables.loyaltyCard.push({ id: "sibling-card", salonId: "sibling" });
  (tables.loyaltyCustomer ||= []).push({ id: "other", cardId: "sibling-card", currentStamps: 99 });
  const clearance = tables.salonPurgeClearance[0];
  clearance.sourceState = Object.fromEntries(Object.entries(clearance.sourceState).reverse());
  assert.equal((await revalidate(app, id)).statusCode, 200);
}));
test("revalidation refuses active hold and release does not resurrect revocation", async () => withApp(async app => {
  const id = await finalizedClearance(app);
  tables.salonRetentionHold.push({ id: "h", salonId: "target", releasedAt: null });
  assert.equal((await revalidate(app, id)).statusCode, 409);
  assert.ok(tables.salonPurgeClearance[0].revokedAt);
  tables.salonRetentionHold[0].releasedAt = new Date();
  assert.equal((await revalidate(app, id)).statusCode, 409);
}));
test("revalidation preserves an existing revocation", async () => withApp(async app => {
  const id = await finalizedClearance(app);
  tables.salonPurgeClearance[0].revokedAt = new Date();
  tables.salonPurgeClearance[0].revocationReason = "Existing reason";
  writes = [];
  assert.equal((await revalidate(app, id)).statusCode, 409);
  assert.equal(tables.salonPurgeClearance[0].revocationReason, "Existing reason");
  assert.deepEqual(writes, []);
}));
for (const kind of ["partial", "version", "archive mismatch", "missing content"]) {
  test(`revalidation refuses ${kind} evidence`, async () => withApp(async app => {
    const id = await finalizedClearance(app);
    const clearance = tables.salonPurgeClearance[0];
    const stored = tables.salonArchive[0];
    if (kind === "partial") {
      clearance.coverage.categories = stored.coverage.categories = ["BOOKING"];
    } else if (kind === "version") {
      clearance.archiveVersion = stored.archiveVersion = 999;
    } else if (kind === "missing content") {
      delete clearance.sourceState.bookingContent;
      delete stored.sourceState.bookingContent;
    } else stored.sourceState.bookingIds = ["tampered"];
    assert.equal((await revalidate(app, id)).statusCode, 409);
    assert.ok(tables.salonPurgeClearance[0].revokedAt);
  }));
}
for (const flag of ["sourceState", "coverage", "archiveId", "currentState", "hash", "retentionSafe", "archiveSafe", "force", "confirmed"]) {
  test(`revalidation rejects client ${flag}`, async () => withApp(async app => {
    const id = await finalizedClearance(app);
    writes = [];
    assert.equal((await revalidate(app, id, { [flag]: true })).statusCode, 400);
    assert.deepEqual(writes, []);
  }));
}
for (const role of ["OWNER", "CUSTOMER"]) {
  test(`${role} cannot invoke revalidation`, async () => withApp(async app => {
    const id = await finalizedClearance(app);
    writes = [];
    assert.equal((await revalidate(app, id, {}, role)).statusCode, 403);
    assert.deepEqual(writes, []);
  }));
}
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
    findMany: async ({ where, select }: any = {}) => structuredClone(rows().filter(row => matches(row, where)).map(row =>
      select ? Object.fromEntries(Object.keys(select).filter(key => select[key] === true).map(key => [key, row[key]])) : row)),
    findUnique: async ({ where }: any) => structuredClone(rows().find(row => matches(row, where)) ?? null),
    findFirst: async ({ where }: any) => structuredClone(rows().filter(row => matches(row, where)).at(-1) ?? null),
    count: async ({ where }: any) => rows().filter(row => matches(row, where)).length,
    create: async ({ data }: any) => {
      writes.push(model);
      const row = { id: String(++serial), releasedAt: null, revokedAt: null, ...structuredClone(data) };
      if (model === "salonArchive") (row as any).archiveId = row.id;
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
// Current V3 fixture for issuance and hold tests.
function archive(salonId = "target") {
  tables.salonArchive.push({ archiveId: "archive-1", salonId,
    finalizedAt: new Date("2026-01-01T00:00:00Z"), ...buildSalonArchiveState({
      salonId, bookingIds: [], serviceVisitIds: [], salonBoostIds: [], bookings: [], serviceVisits: [], salonBoosts: [],
      barbers: [], reviews: [], salonMedia: [], services: [], availability: [], staffMemberships: [], staffPresence: [],
      queueEntries: [], loyalty: [], offers: [], analyticsEvents: [], liveStatus: [], availabilitySubscriptions: [],
    }) });
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
  assert.equal(clearance.archiveVersion, 3);
  assert.equal(clearance.payloadVersion, 3);
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

// Complete source fixtures (V2 shapes unchanged in V3); historical V1 fixtures remain explicit.
const v2Booking = {"id": "b", "salonId": "target", "userId": "customer", "barberId": null, "serviceId": null, "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-01-01T00:00:00.000Z", "status": "COMPLETED", "notes": null, "customerName": null, "customerPhone": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "cancelledAt": null, "cancellationReason": null};
const v2Visit = {"id": "v", "salonId": "target", "bookingId": null, "staffMembershipId": "m", "source": "WALK_IN", "status": "COMPLETED", "startedAt": "2026-01-01T00:00:00.000Z", "completedAt": null, "cancelledAt": null, "version": 1, "startedByUserId": null, "completedByUserId": null, "cancelledByUserId": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const v2Membership = {"id": "m", "salonId": "target", "userId": "owner", "barberId": "barber", "status": "ACTIVE", "revokedAt": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};

for (const [model, fixture, field, changed] of [
  ["booking", v2Booking, "customerName", "Changed name"],
  ["serviceVisit", v2Visit, "startedByUserId", "another-actor"],
  ["staffMembership", v2Membership, "updatedAt", "2026-02-01T00:00:00.000Z"],
] as const) {
  test(`V3 ${model} loaded persisted history change invalidates clearance`, async () => withApp(async app => {
    tables[model] = [structuredClone(fixture)];
    const before = structuredClone(tables.salon);
    const id = await finalizedClearance(app);
    assert.equal((await revalidate(app, id)).statusCode, 200);
    tables[model][0][field] = changed;
    assert.equal((await revalidate(app, id)).statusCode, 409);
    assert.equal(tables.salonPurgeClearance[0].revocationReason, "Source state changed");
    assert.deepEqual(tables.salon, before);
  }));
}
for (const [av, pv] of [[1, 1], [2, 2], [999, 3], [3, 999], [1, 2], [2, 1], [2, 3], [3, 2]]) {
  test(`clearance rejects historical/unsupported contract ${av}/${pv} without changing evidence`, async () => withApp(async app => {
    await request(app, "archive/finalize");
    const old = tables.salonArchive[0];
    old.archiveVersion = av; old.payloadVersion = pv;
    if (av === 1 && pv === 1) old.sourceState.bookingContent = ['["old","target","COMPLETED"]'];
    const before = structuredClone(tables);
    writes = [];
    assert.equal((await request(app, "purge-clearance")).statusCode, 409);
    assert.deepEqual(tables, before);
    assert.deepEqual(writes, []);
  }));
  test(`readiness and revalidation refuse contract ${av}/${pv} without backfilling archive`, async () => withApp(async app => {
    const id = await finalizedClearance(app);
    tables.salonArchive[0].archiveVersion = tables.salonPurgeClearance[0].archiveVersion = av;
    tables.salonArchive[0].payloadVersion = tables.salonPurgeClearance[0].payloadVersion = pv;
    const old = structuredClone(tables.salonArchive);
    const result = await readiness();
    assert.equal(result.valid, false);
    assert.equal(result.ready, false);
    assert.equal((await revalidate(app, id)).statusCode, 409);
    assert.deepEqual(tables.salonArchive, old);
  }));
}
test("V3 finalization creates distinct evidence and never upgrades historical V1 rows", async () => withApp(async app => {
  const historical = { archiveId: "historical", salonId: "target", archiveVersion: 1, payloadVersion: 1,
    sourceState: { bookingContent: ['["b","target","COMPLETED"]'], serviceVisitContent: ['["v","target","COMPLETED"]'], staffMembershipContent: ['["m","target","owner","barber","ACTIVE",null]'] } };
  tables.salonArchive.push(structuredClone(historical));
  tables.booking = [structuredClone(v2Booking)];
  const response = await request(app, "archive/finalize");
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().archive.archiveVersion, 3);
  assert.equal(response.json().archive.payloadVersion, 3);
  assert.notEqual(response.json().archive.archiveId, historical.archiveId);
  assert.deepEqual(tables.salonArchive[0], historical);
}));
for (const path of ["archive/finalize", "purge-clearance"]) {
  for (const field of ["archiveVersion", "payloadVersion", "archiveId", "sourceState", "coverage", "force", "archiveSafe", "retentionSafe"]) {
    test(`${path} rejects client trust field ${field}`, async () => withApp(async app => {
      writes = [];
      assert.equal((await request(app, path, { [field]: 2 })).statusCode, 400);
      assert.deepEqual(writes, []);
    }));
  }
}

const v3QueueEntry = {"id": "q", "salonId": "target", "customerId": null, "serviceVisitId": null, "source": "SALO_TICKET", "status": "WAITING", "joinedAt": "2026-01-01T00:00:00.000Z", "calledAt": null, "startedAt": null, "cancelledAt": null, "expiredAt": null, "noShowAt": null, "version": 1, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
for (const change of ["createdAt", "updatedAt", "insert", "remove"]) {
  test(`V3 QueueEntry ${change} makes current evidence stale`, async () => withApp(async app => {
    tables.queueEntry = [structuredClone(v3QueueEntry)];
    const id = await finalizedClearance(app);
    const oldArchive = structuredClone(tables.salonArchive);
    const oldState = structuredClone(tables.salonPurgeClearance[0].sourceState);
    assert.equal((await revalidate(app, id)).statusCode, 200);
    if (change === "insert") tables.queueEntry.push({ ...v3QueueEntry, id: "new" });
    else if (change === "remove") tables.queueEntry = [];
    else tables.queueEntry[0][change] = "2026-02-01T00:00:00.000Z";
    assert.equal((await revalidate(app, id)).statusCode, 409);
    assert.equal(tables.salonPurgeClearance[0].revocationReason, "Source state changed");
    assert.deepEqual(tables.salonArchive, oldArchive);
    assert.deepEqual(tables.salonPurgeClearance[0].sourceState, oldState);
  }));
}
test("V3 QueueEntry finalization is target-scoped and leaves historical V2 evidence untouched", async () => withApp(async app => {
  const { createdAt, updatedAt, ...oldQueue } = v3QueueEntry;
  const historical = { archiveId: "old-v2", salonId: "target", archiveVersion: 2, payloadVersion: 2, sourceState: { queueEntryContent: [JSON.stringify(Object.values(oldQueue))] } };
  tables.salonArchive.push(structuredClone(historical));
  tables.queueEntry = [structuredClone(v3QueueEntry), { ...v3QueueEntry, id: "sibling-q", salonId: "sibling" }];
  const id = await finalizedClearance(app);
  const current = tables.salonArchive[1];
  assert.equal(current.archiveVersion, 3);
  assert.equal(current.payloadVersion, 3);
  assert.deepEqual(current.sourceState.queueEntryContent, [JSON.stringify(Object.values(v3QueueEntry))]);
  assert.deepEqual(tables.salonArchive[0], historical);
  assert.notEqual(current.archiveId, historical.archiveId);
  tables.queueEntry[1].updatedAt = "2026-03-01T00:00:00.000Z";
  assert.equal((await revalidate(app, id)).statusCode, 200);
  const result = await readiness();
  assert.equal(result.ready, false);
  assert.ok(result.blockingModels.length > 0, "readiness must remain blocked after source state change");
}));

test("cross-salon Direction A: target QueueEntry → sibling ServiceVisit must block purge readiness", async () => withApp(async app => {
  // A QueueEntry owned by the target salon references a ServiceVisit owned by a sibling salon.
  // The archive will include this QueueEntry. Readiness must refuse specifically because the
  // serviceVisitId crosses salon boundaries — the DB has no composite FK to enforce same-salon.
  tables.queueEntry = [{
    ...v3QueueEntry,
    salonId: "target",
    serviceVisitId: "sibling-service-visit",
  }];
  const id = await finalizedClearance(app);
  const before = structuredClone(tables.salon);
  const result = await readiness();
  assert.equal(result.ready, false,
    "readiness must refuse when a target-salon QueueEntry references a sibling-salon ServiceVisit");
  // The refusal must be specifically about the cross-salon QueueEntry→ServiceVisit dependency,
  // not just generic "Deletion policy incomplete". Production code currently lacks this check.
  assert.notEqual(result.error, "Deletion policy incomplete",
    "refusal reason must be cross-salon QueueEntry→ServiceVisit, not generic policy incompleteness");
  assert.deepEqual(tables.salon, before);
}));

test("cross-salon Direction B: sibling QueueEntry → target ServiceVisit must block purge readiness", async () => withApp(async app => {
  // A QueueEntry owned by a sibling salon references a ServiceVisit owned by the target salon.
  // The archive only loads target-salon QueueEntries, so this sibling record is invisible to
  // archive evidence. Readiness must still refuse: deleting the target salon would cascade-delete
  // the ServiceVisit, but the sibling QueueEntry's Restrict FK would block it at the DB level.
  tables.queueEntry = [{
    ...v3QueueEntry,
    salonId: "sibling",
    serviceVisitId: "target-service-visit",
  }];
  const id = await finalizedClearance(app);
  const before = structuredClone(tables.salon);
  const result = await readiness();
  assert.equal(result.ready, false,
    "readiness must refuse when a sibling-salon QueueEntry references a target-salon ServiceVisit");
  // The refusal must be specifically about the cross-salon QueueEntry→ServiceVisit dependency,
  // not just generic "Deletion policy incomplete". Production code currently lacks this check.
  assert.notEqual(result.error, "Deletion policy incomplete",
    "refusal reason must be cross-salon QueueEntry→ServiceVisit, not generic policy incompleteness");
  assert.deepEqual(tables.salon, before);
}));
