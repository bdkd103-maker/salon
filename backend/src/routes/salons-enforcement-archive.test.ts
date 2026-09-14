// Run from backend: node --import tsx --test src/routes/salons-enforcement-archive.test.ts
// Proposed HTTP contract: POST /api/v1/salons/:id/enforcement { reason },
// returning { enforcement }; irreversible DELETE remains a separate operation.
// No archive model name, retention duration, cascade policy, payment integration,
// or positive purge-clearance policy is prescribed here. Fixtures have NO trusted
// purge clearance. These are route contracts, not real-DB foreign-key tests.
import assert from "node:assert/strict";
const finalize = (app: ReturnType<typeof Fastify>, id = "target", role = "ADMIN") =>
  app.inject({ method: "POST", url: `/api/v1/salons/${id}/archive/finalize`, headers: headers(role) });
const supportedCounts = ["bookings", "serviceVisits", "salonBoosts", "barbers", "reviews", "salonMedia", "services",
  "availability", "staffMemberships", "staffPresence", "staffPresenceLease", "queueEntries", "loyalty", "offers", "analyticsEvents", "liveStatus", "availabilitySubscriptions"];

test("finalization persists Booking content and detects a same-ID status change", async () => withApp(async app => {
  const first = await finalize(app);
  assert.equal(first.statusCode, 201);
  assert.deepEqual(first.json().archive.sourceState.bookingContent, [JSON.stringify(Object.values({ ...v2Booking, id: "booking-history" }))]);
  tables.booking[0].status = "CANCELLED";
  const second = await finalize(app);
  assert.equal(second.statusCode, 201);
  assert.notDeepEqual(first.json().archive.sourceState, second.json().archive.sourceState);
  assert.deepEqual(tables.salonArchive[0].sourceState, first.json().archive.sourceState);
}));

test("finalization queries every supported category even when empty", async () => withApp(async app => {
  const result = await finalize(app, "no-history");
  assert.equal(result.statusCode, 201);
  assert.deepEqual(Object.keys(result.json().archive.coverage.counts).sort(), [...supportedCounts].sort());
  for (const count of Object.values(result.json().archive.coverage.counts)) assert.equal(count, 0);
  assert.equal(result.json().archive.coverage.emptyHistory, true);
}));

test("finalization loads direct content and scopes presence and loyalty through target parents", async () => withApp(async app => {
  const date = new Date("2026-01-01T00:00:00Z");
  tables.barber = ["target", "sibling"].map(salonId => ({ id: salonId + "-barber", salonId, name: salonId, specialty: null, isActive: true, createdAt: date, updatedAt: date }));
  tables.staffMembership = ["target", "sibling"].map(salonId => ({ ...v2Membership, id: salonId + "-staff", salonId, userId: "owner", barberId: salonId + "-barber", status: "ACTIVE", revokedAt: null }));
  tables.staffPresence = ["target", "sibling"].map(id => ({ staffMembershipId: id + "-staff", dutyState: "ON_DUTY", generation: 1, changedAt: date, changedByUserId: "owner", changeSource: "OWNER", createdAt: date, updatedAt: date }));
  tables.staffPresenceLease = ["target", "sibling"].map(id => ({ id: id + "-lease", staffMembershipId: id + "-staff", generation: 1, evidenceSource: "DEVICE", producerKey: id + "-key", observedAt: date, validUntil: date, revokedAt: null, createdAt: date, updatedAt: date }));
  tables.loyaltyCard = ["target", "sibling"].map(salonId => ({ id: salonId + "-card", salonId, isActive: true, requiredStamps: 8, rewardType: "FREE_SERVICE", rewardTitle: "Cut", rewardText: "Cut", description: null, createdAt: date, updatedAt: date }));
  tables.loyaltyCustomer = ["target", "sibling"].map(id => ({ id: id + "-customer", cardId: id + "-card", customerId: "customer", currentStamps: 2, totalVisits: 3, lastStampedAt: null, rewardRedeemedAt: null, createdAt: date, updatedAt: date }));
  tables.loyaltyStamp = ["target", "sibling"].map(id => ({ id: id + "-stamp", cardId: id + "-card", customerId: "customer", barberId: null, transactionId: id + "-transaction", stampAt: date, isValid: true, verificationToken: null, createdAt: date }));
  tables.booking.push({ ...v2Booking, id: "sibling-booking", salonId: "sibling", status: "COMPLETED" });
  const before = structuredClone(tables);
  const result = await finalize(app);
  assert.equal(result.statusCode, 201);
  const state = result.json().archive.sourceState;
  assert.ok(state.barberContent?.[0].includes("target-barber"));
  assert.ok(state.staffPresenceContent?.[0].includes("target-staff"));
  assert.ok(state.loyaltyContent?.[0].includes("target-customer"));
  assert.ok(state.loyaltyContent?.[0].includes("target-stamp"));
  assert.equal(JSON.stringify(state).includes("sibling"), false);
  for (const [key, rows] of Object.entries(before)) assert.deepEqual(tables[key], rows);
  assert.deepEqual(writes, [{ model: "salonArchive", operation: "create" }]);
}));

for (const role of ["OWNER", "CUSTOMER"]) {
  test(`${role} cannot finalize an archive`, async () => withApp(async app => {
    assert.equal((await finalize(app, "target", role)).statusCode, 403);
    assert.equal(writes.length, 0);
  }));
}
test("unauthenticated finalization is rejected without writes", async () => withApp(async app => {
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/salons/target/archive/finalize" })).statusCode, 401);
  assert.equal(writes.length, 0);
}));
test("finalization does not authorize DELETE", async () => withApp(async app => {
  assert.equal((await finalize(app)).statusCode, 201);
  const before = structuredClone(tables);
  assert.equal((await purge(app)).statusCode, 409);
  assert.deepEqual(tables, before);
}));
import { beforeEach, afterEach, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonRoutes } from "./salons.js";

const mock = prisma as any;
const names = ["user", "salon", "userSubscription", "booking", "serviceVisit", "salonBoost", "salonArchive"];
const original = Object.fromEntries([...names, "$transaction"].map(name => [name, mock[name]]));
const originalSecret = process.env.JWT_ACCESS_SECRET;
const reason = "Verified misleading salon identity; preserve evidence for review.";
let tables: Record<string, any[]>;
let writes: Array<{ model: string; operation: string }>;
let serial: number;

function salon(id: string) {
  return { id, ownerId: "owner", name: `Fixture ${id}`, slug: id, city: "Berlin",
    address: "Fixture Street 12", phone: "+49301234567", isActive: true,
    isVip: false, adminVip: false, classification: "REGULAR", description: "Original profile",
    services: [], reviews: [], media: [], barbers: [], offers: [] };
}

// An observable in-memory persistence boundary. Every mutation is recorded, no
// dependent rows are implicitly removed, and transaction failures roll back data.
// A transaction can use any evidence delegate name or nested salon data: this
// deliberately does not require a future Prisma archive table/relation name.
function delegate(model: string): any {
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
  const read = () => tables[model] || [];
  const note = (operation: string) => writes.push({ model, operation });
  return {
    findUnique: async ({ where }: any) => structuredClone(read().find(row => matches(row, where)) ?? null),
    findFirst: async ({ where }: any = {}) => structuredClone(read().find(row => matches(row, where)) ?? null),
    findMany: async ({ where, select }: any = {}) => structuredClone(read().filter(row => matches(row, where)).map(row =>
      select ? Object.fromEntries(Object.keys(select).filter(key => select[key] === true).map(key => [key, row[key]])) : row)),
    count: async ({ where }: any = {}) => read().filter(row => matches(row, where)).length,
  create: async ({ data }: any) => {
  note("create");
  const generatedId = `fixture-${++serial}`;
  const row = model === "salonArchive"
    ? { archiveId: generatedId, ...structuredClone(data) }
    : { id: generatedId, ...structuredClone(data) };
  (tables[model] ||= []).push(row);
  return structuredClone(row);
},
    update: async ({ where, data }: any) => {
      const row = read().find(row => matches(row, where));
      assert.ok(row, `fixture update target must exist (${model})`);
      note("update");
      Object.assign(row, structuredClone(Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))));
      return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => {
      const rows = read().filter(row => matches(row, where));
      note("updateMany");
      for (const row of rows) Object.assign(row, structuredClone(data));
      return { count: rows.length };
    },
    delete: async ({ where }: any) => {
      const row = read().find(row => matches(row, where));
      assert.ok(row, `fixture delete target must exist (${model})`);
      note("delete");
      tables[model] = read().filter(item => item !== row);
      return structuredClone(row);
    },
    deleteMany: async ({ where }: any = {}) => {
      const rows = read().filter(row => matches(row, where));
      note("deleteMany");
      tables[model] = read().filter(row => !rows.includes(row));
      return { count: rows.length };
    },
  };
}

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "enforcement-archive-fixture-secret";
  serial = 0;
  writes = [];
  tables = {
    user: [{ id: "admin", role: "ADMIN", status: "ACTIVE" }, { id: "owner", role: "OWNER", status: "ACTIVE" }, { id: "customer", role: "CUSTOMER", status: "ACTIVE" }],
    salon: [salon("target"), salon("sibling"), salon("no-history")],
    userSubscription: [{ id: "subscription", userId: "owner", plan: "SMART", status: "ACTIVE",
      startDate: new Date("2026-01-01T00:00:00Z"), renewalDate: new Date("2026-02-01T00:00:00Z"),
      monthlyPrice: "12.34", providerReference: "fixture-reference-not-payment-evidence" }],
    // These are history/evidence fixtures, not assertions that bookings are vouchers.
    booking: [{ ...v2Booking, id: "booking-history", salonId: "target", userId: "customer", status: "COMPLETED" }],
    serviceVisit: [{ ...v2Visit, id: "visit-history", salonId: "target", status: "COMPLETED" }],
    salonBoost: [{ id: "boost-history", salonId: "target", status: "EXPIRED" }],
    staffPresenceLease: [],
  };
  for (const name of names) mock[name] = delegate(name);
  mock.$transaction = async (run: any) => {
    const before = structuredClone(tables);
    const tx = new Proxy({}, { get: (_target, name) => delegate(String(name)) });
    try { return await run(tx); }
    catch (error) { tables = before; throw error; }
  };
});

afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = originalSecret;
});

function headers(role = "ADMIN") {
  return { authorization: `Bearer ${signAccessToken({ sub: role.toLowerCase(), role })}` };
}
async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  try { await salonRoutes(app); await run(app); }
  finally { await app.close(); }
}
const enforce = (app: ReturnType<typeof Fastify>, payload: any = { reason }, role = "ADMIN") =>
  app.inject({ method: "POST", url: "/api/v1/salons/target/enforcement", headers: headers(role), payload });
const purge = (app: ReturnType<typeof Fastify>, id = "target", payload?: any) =>
  app.inject({ method: "DELETE", url: `/api/v1/salons/${id}`, headers: headers(), ...(payload === undefined ? {} : { payload }) });
function success(response: { statusCode: number }) {
  assert.ok([200, 201].includes(response.statusCode), `enforcement must succeed; received HTTP ${response.statusCode}`);
}
function history() { return structuredClone({ booking: tables.booking, serviceVisit: tables.serviceVisit, salonBoost: tables.salonBoost }); }
function subscriptionUnchanged(before: any) {
  assert.deepEqual(tables.userSubscription, before);
  assert.equal(writes.some(write => write.model === "userSubscription"), false, "subscription must not be written, even to restore the same values");
}
function objects(value: any): any[] {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

test("fixture supports current salon listing and detail reads", async () => withApp(async app => {
  const list = await app.inject({ method: "GET", url: "/api/v1/salons" });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().salons.map((row: any) => row.id).sort(), ["no-history", "sibling", "target"]);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/salons/target" })).statusCode, 200);
}));

test("ADMIN enforcement accepts a required reason", async () => withApp(async app => {
  const response = await enforce(app);
  success(response);
  assert.equal(response.json().enforcement.reason, reason);
}));

test("enforcement persists inactivity and removes only the target from active listing", async () => withApp(async app => {
  success(await enforce(app));
  assert.equal((await prisma.salon.findUnique({ where: { id: "target" } }))?.isActive, false);
  const list = await app.inject({ method: "GET", url: "/api/v1/salons" });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().salons.map((row: any) => row.id).sort(), ["no-history", "sibling"]);
}));

test("enforcement preserves the Salon row rather than hard deleting it", async () => withApp(async app => {
  success(await enforce(app));
  assert.ok(await prisma.salon.findUnique({ where: { id: "target" } }));
  assert.equal(writes.some(write => write.model === "salon" && write.operation.startsWith("delete")), false);
}));

test("enforcement preserves business identity and Booking ServiceVisit SalonBoost history", async () => withApp(async app => {
  const before = structuredClone(tables.salon[0]);
  const historical = history();
  success(await enforce(app));
  const after = await prisma.salon.findUnique({ where: { id: "target" } }) as any;
  for (const key of Object.keys(before).filter(key => key !== "isActive")) assert.deepEqual(after[key], before[key], `preserve ${key}`);
  assert.deepEqual(history(), historical);
  assert.equal(writes.some(write => ["booking", "serviceVisit", "salonBoost"].includes(write.model)), false);
}));

test("enforcement durably snapshots salon owner reason actor time and previous active state", async () => withApp(async app => {
  const started = Date.now();
  const response = await enforce(app);
  success(response);
  const evidence = response.json().enforcement;
  const expected = { salonId: "target", salonName: "Fixture target", ownerUserId: "owner", reason, actorUserId: "admin", previousIsActive: true };
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(evidence[key], value);
  const timestamp = new Date(evidence.enforcedAt).getTime();
  assert.ok(timestamp >= started && timestamp <= Date.now(), "server must assign the action time");
  // Search stored values, not a response cache or a particular archive table name.
  const stored = objects(tables).find(record => Object.entries(expected).every(([key, value]) => record[key] === value));
  assert.ok(stored, "returning evidence without persisting it is insufficient");
  assert.equal(new Date(stored.enforcedAt).getTime(), timestamp);
  tables.salon[0].name = "Later changed identity";
  assert.equal(stored.salonName, "Fixture target", "evidence must be a snapshot, not a live identity lookup");
}));

for (const [label, payload] of [["missing", {}], ["blank", { reason: "   " }]] as const) {
  test(`enforcement rejects ${label} reason without mutations`, async () => withApp(async app => {
    const before = structuredClone(tables);
    assert.equal((await enforce(app, payload)).statusCode, 400);
    assert.deepEqual(tables, before);
    assert.equal(writes.length, 0);
  }));
}
for (const role of ["OWNER", "CUSTOMER"]) {
  test(`${role} cannot perform enforcement`, async () => withApp(async app => {
    const before = structuredClone(tables);
    assert.equal((await enforce(app, { reason }, role)).statusCode, 403);
    assert.deepEqual(tables, before);
    assert.equal(writes.length, 0);
  }));
}

test("enforcement leaves the user-scoped subscription unchanged", async () => withApp(async app => {
  const before = structuredClone(tables.userSubscription);
  success(await enforce(app));
  subscriptionUnchanged(before);
}));

test("enforcement persists the available subscription snapshot without treating it as payment proof", async () => withApp(async app => {
  const before = structuredClone(tables.userSubscription[0]);
  const response = await enforce(app);
  success(response);
  const snapshot = response.json().enforcement.subscription;
  const assertSnapshot = (value: any) => {
    assert.ok(value);
    for (const key of ["plan", "status", "providerReference"]) assert.equal(value[key], before[key]);
    for (const key of ["startDate", "renewalDate"]) assert.equal(new Date(value[key]).getTime(), before[key].getTime());
    assert.equal(Number(value.monthlyPrice), Number(before.monthlyPrice));
  };
  assertSnapshot(snapshot);
  const stored = objects(tables).find(record => record.salonId === "target" && record.reason === reason && record.subscription);
  assert.ok(stored, "subscription context must be persisted with enforcement evidence");
  assertSnapshot(stored.subscription);
}));

test("enforcement without a subscription does not create or invent one", async () => withApp(async app => {
  tables.userSubscription = [];
  const response = await enforce(app);
  success(response);
  assert.equal(response.json().enforcement.subscription, null);
  subscriptionUnchanged([]);
}));

test("enforcement leaves the same owner's other salon unchanged", async () => withApp(async app => {
  const before = structuredClone(tables.salon.find(row => row.id === "sibling"));
  success(await enforce(app));
  assert.deepEqual(await prisma.salon.findUnique({ where: { id: "sibling" } }), before);
}));

test("purge refuses history without an archive retention-safe precondition", async () => withApp(async app => {
  const before = structuredClone(tables);
  assert.equal((await purge(app)).statusCode, 409, "existing history with no trusted clearance must block purge");
  assert.deepEqual(tables, before);
  assert.equal(writes.length, 0);
}));

test("absence of history alone is not explicit trusted purge clearance", async () => withApp(async app => {
  const before = structuredClone(tables);
  assert.equal((await purge(app, "no-history")).statusCode, 409);
  assert.deepEqual(tables, before);
  assert.equal(writes.length, 0);
}));

test("client archiveSafe claim cannot authorize irreversible purge", async () => withApp(async app => {
  const before = structuredClone(tables);
  const response = await purge(app, "target", { archiveSafe: true, retentionSafe: true });
  assert.ok([400, 409].includes(response.statusCode), `untrusted clearance must be rejected, received ${response.statusCode}`);
  assert.deepEqual(tables, before);
  assert.equal(writes.length, 0);
}));

test("enforcement is separate from purge and does not itself grant purge clearance", async () => withApp(async app => {
  success(await enforce(app));
  const before = structuredClone(tables);
  assert.equal((await purge(app)).statusCode, 409);
  assert.deepEqual(tables, before);
}));

test("purge cannot silently report success for deactivation", async () => withApp(async app => {
  const before = structuredClone(tables);
  const response = await purge(app);
  assert.equal(response.statusCode, 409, "no trusted clearance: reject, do not return success after setting isActive=false");
  assert.deepEqual(tables, before);
  assert.equal(writes.length, 0);
}));

test("purge refusal preserves the Owner subscription and sibling salon", async () => withApp(async app => {
  const subscription = structuredClone(tables.userSubscription);
  const sibling = structuredClone(tables.salon.find(row => row.id === "sibling"));
  assert.equal((await purge(app)).statusCode, 409);
  subscriptionUnchanged(subscription);
  assert.deepEqual(await prisma.salon.findUnique({ where: { id: "sibling" } }), sibling);
}));
test("ADMIN can finalize a salon archive with independent identity and versioning", async () => withApp(async app => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/salons/target/archive/finalize",
    headers: headers(),
  });

  assert.equal(response.statusCode, 201);

  const archive = objects(tables).find(record =>
    record &&
    record.salonId === "target" &&
    record.archiveId &&
    record.archiveVersion &&
    record.payloadVersion &&
    record.finalizedAt &&
    record.source
  );

  assert.ok(archive, "trusted finalized archive must exist before purge can ever become eligible");
  assert.equal(archive.salonId, "target");
  assert.ok(typeof archive.archiveId === "string" && archive.archiveId.length > 0);
  assert.ok(typeof archive.archiveVersion === "string" || typeof archive.archiveVersion === "number");
  assert.ok(typeof archive.payloadVersion === "string" || typeof archive.payloadVersion === "number");
  assert.ok(new Date(archive.finalizedAt).getTime() > 0);
  assert.ok(archive.source, "archive finalization must record a trusted actor/system source");
}));
test("finalized archive requires explicit coverage including empty history", async () => withApp(async app => {
    const response = await app.inject({
    method: "POST",
    url: "/api/v1/salons/no-history/archive/finalize",
   headers: headers(),
  });

  assert.equal(response.statusCode, 201);
  const archive = objects(tables).find(record =>
    record &&
    record.salonId === "no-history" &&
    record.coverage
  );

  assert.ok(
    archive,
    "an empty salon still requires an explicit archive coverage result"
  );

  assert.ok(
    Array.isArray(archive.coverage.categories),
    "archive coverage must explicitly describe evaluated record categories"
  );

  assert.equal(
    archive.coverage.emptyHistory,
    true,
    "absence of history must be explicitly represented, not inferred"
  );

  assert.ok(
    archive.coverage.counts &&
      typeof archive.coverage.counts === "object",
    "archive coverage must include deterministic record counts"
  );
}));
test("finalized archive is bound to a deterministic source state", async () => withApp(async app => {
    const response = await app.inject({
    method: "POST",
    url: "/api/v1/salons/target/archive/finalize",
    headers: headers(),
  });

  assert.equal(response.statusCode, 201);
  const archive = objects(tables).find(record =>
    record &&
    record.salonId === "target" &&
    record.sourceState
  );

  assert.ok(
    archive,
    "finalized archive must be bound to the relevant source state"
  );

  assert.ok(
    archive.sourceState &&
      typeof archive.sourceState === "object",
    "source-state binding must be explicit and deterministic"
  );

  assert.ok(
    Object.keys(archive.sourceState).length > 0,
    "source-state binding cannot be an empty marker or boolean"
  );
}));

// Complete current V2 source fixtures; historical V1 fixtures remain explicit.
const v2Booking = {"id": "b", "salonId": "target", "userId": "customer", "barberId": null, "serviceId": null, "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-01-01T00:00:00.000Z", "status": "COMPLETED", "notes": null, "customerName": null, "customerPhone": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "cancelledAt": null, "cancellationReason": null};
const v2Visit = {"id": "v", "salonId": "target", "bookingId": null, "staffMembershipId": "m", "source": "WALK_IN", "status": "COMPLETED", "startedAt": "2026-01-01T00:00:00.000Z", "completedAt": null, "cancelledAt": null, "version": 1, "startedByUserId": null, "completedByUserId": null, "cancelledByUserId": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
const v2Membership = {"id": "m", "salonId": "target", "userId": "owner", "barberId": "barber", "status": "ACTIVE", "revokedAt": null, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"};
