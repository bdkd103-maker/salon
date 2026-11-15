import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { prisma } from "../lib/prisma.js";
import { staffStatusRoutes } from "./staff-status.js";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const original = {
  $transaction: (prisma as any).$transaction,
  $queryRaw: (prisma as any).$queryRaw,
  salon: (prisma as any).salon,
  staffMembership: (prisma as any).staffMembership,
  service: (prisma as any).service,
  queueEntry: (prisma as any).queueEntry,
  platformSettings: (prisma as any).platformSettings,
};
const mock = prisma as any;

beforeEach(() => {
  mock.$transaction = async (fn: any) => fn(mock);
  mock.$queryRaw = async () => [];
  mock.platformSettings = {
    findUnique: async () => ({
      id: "platform", saloTicketGloballyEnabled: true, walkInGloballyEnabled: true, staffStatusLiveEnabled: true,
    }),
    upsert: async ({ create }: any) => create,
  };
});
afterEach(() => Object.assign(mock, original));

const MINUTE = 60_000;

/** Always-open salon row: two intervals cover every minute of every day. */
function alwaysOpenSalon(id: string, overrides: Record<string, unknown> = {}) {
  const intervals = [{ open: "00:00", close: "23:59" }, { open: "23:59", close: "00:00" }];
  return {
    id,
    name: `Salon ${id}`,
    isActive: true,
    openingTime: "00:00",
    closingTime: "23:59",
    timeZone: "Europe/Berlin",
    workingDays: DAY_KEYS,
    weeklyOpeningHours: Object.fromEntries(DAY_KEYS.map((day) => [day, { intervals }])),
    saloTicketIntakeEnabled: true,
    walkInIntakeEnabled: true,
    ...overrides,
  };
}

function presence(serverNow: number) {
  return {
    staffMembershipId: "mem-1",
    dutyState: "ON_DUTY",
    generation: 1,
    leases: [{
      staffMembershipId: "mem-1",
      generation: 1,
      evidenceSource: "STAFF_APP",
      producerKey: "app-1",
      observedAt: new Date(serverNow - 10_000),
      validUntil: new Date(serverNow + 300_000),
      revokedAt: null,
    }],
  };
}

function membership(overrides: Record<string, unknown> = {}, serverNow = Date.now()) {
  return {
    id: "mem-1",
    userId: "staff-1",
    salonId: "salon-1",
    barberId: "barber-1",
    status: "ACTIVE",
    revokedAt: null,
    presence: presence(serverNow),
    barber: { name: "Alice" },
    serviceVisits: [],
    ...overrides,
  };
}

function configure(options: {
  salon?: Record<string, unknown>;
  staff?: any[];
  durations?: number[];
  queueCount?: number;
}) {
  const salon = alwaysOpenSalon("salon-1", options.salon);
  mock.salon = {
    findMany: async ({ where }: any) => (where?.id?.in ?? []).filter((id: string) => id === salon.id).map(() => salon),
    findUnique: async ({ where }: any) => (where.id === salon.id ? salon : null),
  };
  mock.staffMembership = { findMany: async () => options.staff ?? [], findUnique: async () => null };
  mock.service = {
    findMany: async () => (options.durations ?? []).map((durationMin) => ({ salonId: salon.id, durationMin })),
  };
  mock.queueEntry = {
    groupBy: async () => (options.queueCount ? [{ salonId: salon.id, _count: { _all: options.queueCount } }] : []),
  };
  return salon;
}

async function readLiveStatus(salonId = "salon-1") {
  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${salonId}/live-status` });
    return { statusCode: res.statusCode, body: res.body, data: res.statusCode === 200 ? res.json() : null };
  } finally {
    await app.close();
  }
}

test("no confirmed staff -> STAFF_STATUS_UNCONFIRMED, never a number", async () => {
  configure({ staff: [], durations: [30] });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "STAFF_STATUS_UNCONFIRMED");
  assert.equal(data.wait.reliable, false);
  assert.equal(data.wait.etaMinutes, null);
  assert.equal(data.wait.confirmedWorkingStaff, 0);
});

test("closed salon -> CLOSED before anything else", async () => {
  configure({
    salon: { workingDays: [], weeklyOpeningHours: null, openingTime: null, closingTime: null },
    staff: [membership()],
    durations: [30],
  });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "CLOSED");
  assert.equal(data.wait.etaMinutes, null);
  assert.equal(data.wait.reliable, false);
});

test("walk-in intake disabled -> WALK_IN_DISABLED", async () => {
  configure({
    salon: { saloTicketIntakeEnabled: false, walkInIntakeEnabled: true },
    staff: [membership()],
    durations: [30],
  });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "WALK_IN_DISABLED");
  assert.equal(data.wait.walkInEnabled, false);
  assert.equal(data.wait.etaMinutes, null);
});

test("every confirmed staff busy with unknown remaining -> WAIT_UNKNOWN", async () => {
  const now = Date.now();
  configure({
    staff: [membership({
      serviceVisits: [{
        id: "visit-1",
        startedAt: new Date(now - 5 * MINUTE),
        booking: null,
      }],
    }, now)],
    durations: [30],
    queueCount: 1,
  });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "WAIT_UNKNOWN");
  assert.equal(data.wait.etaMinutes, null, "no minutes may be invented for an unknown remaining time");
  assert.equal(data.wait.reliable, false);
  assert.equal(data.wait.busyStaff, 1);
  assert.equal(data.wait.availableStaff, 0);
  assert.equal(data.wait.queueLength, 1);
});

test("busy staff with a real service assignment -> bounded ESTIMATED_WAIT", async () => {
  const now = Date.now();
  configure({
    staff: [membership({
      serviceVisits: [{
        id: "visit-1",
        startedAt: new Date(now - 10 * MINUTE),
        booking: { service: { durationMin: 30 } },
      }],
    }, now)],
    durations: [30],
  });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "ESTIMATED_WAIT");
  assert.equal(data.wait.etaMinutes, 20, "30 minute service started 10 minutes ago");
  assert.equal(data.wait.reliable, true);
  assert.equal(data.wait.serviceDurationMinutes, 30);
  assert.equal(data.wait.busyStaff, 1);
});

test("free confirmed staff with an empty queue -> AVAILABLE_NOW, never \"0 Min.\"", async () => {
  configure({ staff: [membership()], durations: [30] });
  const { statusCode, data } = await readLiveStatus();
  assert.equal(statusCode, 200);
  assert.equal(data.wait.state, "AVAILABLE_NOW");
  assert.equal(data.wait.etaMinutes, 0);
  assert.equal(data.wait.reliable, true);
  assert.equal(data.wait.availableStaff, 1);
});

test("live-status wait payload stays aggregate-only", async () => {
  const now = Date.now();
  configure({
    staff: [membership({ serviceVisits: [{ id: "visit-1", startedAt: new Date(now - MINUTE), booking: null }] }, now)],
    queueCount: 3,
  });
  const { data } = await readLiveStatus();
  const serialized = JSON.stringify(data.wait);
  assert.ok(!/customer|email|phone|customerId|fullName/i.test(serialized));
  assert.equal(data.wait.queueLength, 3);
  assert.equal(data.wait.salonId, "salon-1");
});

test("batch live-status reports unknown salons without inventing data", async () => {
  configure({ staff: [membership()], durations: [30] });
  const app = Fastify();
  await staffStatusRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/live-status?salonIds=salon-1,does-not-exist" });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.salons.length, 1);
    assert.deepEqual(body.notFound, ["does-not-exist"]);
    assert.equal(body.salons[0].wait.state, "AVAILABLE_NOW");

    const duplicate = await app.inject({ method: "GET", url: "/api/v1/salons/live-status?salonIds=salon-1,salon-1" });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().salons.length, 1, "duplicate ids are collapsed");
  } finally {
    await app.close();
  }
});

test('public pre-ticket wait includes every waiting customer',async()=>{
 configure({staff:[membership()],durations:[30],queueCount:2});const {data}=await readLiveStatus();
 assert.equal(data.wait.queueAhead,2);assert.equal(data.wait.state,'ESTIMATED_WAIT');assert.equal(data.wait.etaMinutes,60);
});
