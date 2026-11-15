import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { ownerTeamRoutes } from "./owner-team.js";

const original = {
  user: prisma.user,
  salon: prisma.salon,
  staffMembership: prisma.staffMembership,
  queueEntry: prisma.queueEntry,
};
const mock = prisma as any;

const SALON_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "owner-team-queue-access-test-secret";
  mock.user = {
    findUnique: async ({ where }: any) =>
      where.id === "missing-user" ? null : { id: where.id, role: mock.__role, status: "ACTIVE" },
  };
  mock.salon = {
    findUnique: async ({ where }: any) =>
      where.id === SALON_ID ? { id: SALON_ID, ownerId: "owner-1", name: "Queue Test Salon" } : null,
  };
  mock.staffMembership = {
    findFirst: async ({ where }: any) =>
      where.salonId === SALON_ID && where.userId === "staff-1" &&
      where.status === "ACTIVE" && where.revokedAt === null
        ? { salonId: SALON_ID }
        : null,
  };
  mock.queueEntry = {
    findMany: async () => [{
      id: "qe-1", source: "WALK_IN", status: "WAITING", joinedAt: new Date("2026-01-01T10:00:00Z"),
      calledAt: null, startedAt: null, version: 1,
      customer: { id: "customer-1", fullName: "Kunde", phone: "+491701234567" },
      serviceVisit: null,
    }],
  };
});
afterEach(() => Object.assign(mock, original));

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

async function injectQueue(headers: Record<string, string>) {
  const app = Fastify();
  await ownerTeamRoutes(app);
  try {
    return await app.inject({ method: "GET", url: `/api/v1/salons/${SALON_ID}/queue`, headers });
  } finally {
    await app.close();
  }
}

test("active staff member can read their own salon queue", async () => {
  mock.__role = "STAFF";
  const res = await injectQueue(auth("STAFF", "staff-1"));
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json();
  assert.equal(data.queue.length, 1);
  assert.equal(data.queue[0].id, "qe-1");
  assert.equal(data.queue[0].customer.name, "Kunde");
});

test("staff user without an active membership is forbidden", async () => {
  mock.__role = "STAFF";
  const res = await injectQueue(auth("STAFF", "staff-2"));
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error, "Forbidden");
});

test("owner of the salon keeps queue access", async () => {
  mock.__role = "OWNER";
  const res = await injectQueue(auth("OWNER", "owner-1"));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().queue.length, 1);
});

test("another owner is forbidden from reading the queue", async () => {
  mock.__role = "OWNER";
  const res = await injectQueue(auth("OWNER", "owner-2"));
  assert.equal(res.statusCode, 403, res.body);
});

test("customer role is forbidden from reading the queue", async () => {
  mock.__role = "CUSTOMER";
  const res = await injectQueue(auth("CUSTOMER", "customer-1"));
  assert.equal(res.statusCode, 403, res.body);
});

test("unknown user is rejected before any salon lookup", async () => {
  mock.__role = "STAFF";
  const res = await injectQueue(auth("STAFF", "missing-user"));
  assert.equal(res.statusCode, 401, res.body);
});

test("non-uuid salon id is rejected with 400", async () => {
  mock.__role = "STAFF";
  const app = Fastify();
  await ownerTeamRoutes(app);
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/salons/not-a-uuid/queue", headers: auth("STAFF", "staff-1") });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error, "Invalid salon id");
  } finally {
    await app.close();
  }
});
