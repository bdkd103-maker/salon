import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { ownerTeamRoutes } from "./owner-team.js";

const mock = prisma as any;
const original = {
  user: prisma.user, salon: prisma.salon, staffMembership: prisma.staffMembership,
  staffPresenceLease: prisma.staffPresenceLease, queueEntry: prisma.queueEntry,
};
const originalSecret = process.env.JWT_ACCESS_SECRET;
const salonId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
let membership: any;
let lease: any;
let writes: number;

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "membership-reactivation-test-secret";
  membership = { id: membershipId, salonId, userId: "staff", status: "ACTIVE", revokedAt: null };
  lease = { staffMembershipId: membershipId, revokedAt: null };
  writes = 0;
  mock.user = { findUnique: async ({ where }: any) => ({
    id: where.id, role: ({ owner: "OWNER", other: "OWNER", staff: "STAFF", customer: "CUSTOMER", admin: "ADMIN" } as any)[where.id], status: "ACTIVE",
  }) };
  mock.salon = { findUnique: async ({ where }: any) => where.id === salonId ? { id: salonId, ownerId: "owner" } : null };
  mock.staffMembership = {
    findUnique: async ({ where }: any) => membership?.id === where.id ? { ...membership } : null,
    findFirst: async ({ where }: any) => membership && Object.entries(where).every(([key, value]) => membership[key] === value) ? { ...membership } : null,
    update: async ({ data }: any) => {
      writes++;
      Object.assign(membership, data);
      return { ...membership, user: { id: "staff" }, barber: null };
    },
  };
  mock.staffPresenceLease = { updateMany: async ({ where, data }: any) => {
    writes++;
    if (lease.staffMembershipId === where.staffMembershipId && lease.revokedAt === where.revokedAt) Object.assign(lease, data);
    return { count: 1 };
  } };
  mock.queueEntry = { findMany: async () => [] };
});

afterEach(() => {
  Object.assign(mock, original);
  if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = originalSecret;
});

async function request(userId: string, status?: string) {
  const roles: Record<string, string> = { owner: "OWNER", other: "OWNER", staff: "STAFF", customer: "CUSTOMER", admin: "ADMIN" };
  const app = Fastify();
  await ownerTeamRoutes(app);
  try {
    return await app.inject({
      method: status ? "PATCH" : "GET",
      url: `/api/v1/salons/${salonId}/${status ? `team/${membershipId}` : "queue"}`,
      headers: { authorization: `Bearer ${signAccessToken({ sub: userId, role: roles[userId] })}` },
      ...(status ? { payload: { status } } : {}),
    });
  } finally { await app.close(); }
}

test("suspend then reactivate restores staff access without restoring revoked presence leases", async () => {
  assert.equal((await request("staff")).statusCode, 200);
  assert.equal((await request("owner", "SUSPENDED")).statusCode, 200);
  assert.equal(membership.status, "SUSPENDED");
  assert.ok(membership.revokedAt instanceof Date);
  assert.ok(lease.revokedAt instanceof Date);
  const revokedLeaseAt = lease.revokedAt;
  assert.equal((await request("staff")).statusCode, 403);
  assert.equal((await request("owner", "ACTIVE")).statusCode, 200);
  assert.equal(membership.status, "ACTIVE");
  assert.equal(membership.revokedAt, null);
  assert.equal((await request("staff")).statusCode, 200);
  assert.equal(lease.revokedAt, revokedLeaseAt);
  assert.equal(writes, 3);
});

for (const userId of ["other", "staff", "customer"]) {
  test(`${userId} cannot reactivate membership`, async () => {
    membership.status = "SUSPENDED";
    membership.revokedAt = new Date();
    const before = structuredClone(membership);
    assert.equal((await request(userId, "ACTIVE")).statusCode, 403);
    assert.deepEqual(membership, before);
    assert.equal(writes, 0);
  });
}

for (const status of ["ACTIVE", "SUSPENDED"]) {
  test(`revoked membership cannot transition to ${status}`, async () => {
    membership.status = "REVOKED";
    membership.revokedAt = new Date();
    const before = structuredClone(membership);
    assert.equal((await request("owner", status)).statusCode, 409);
    assert.deepEqual(membership, before);
    assert.equal(writes, 0);
    assert.equal((await request("staff")).statusCode, 403);
  });
}

test("membership from another salon cannot be reactivated", async () => {
  membership.salonId = "33333333-3333-4333-8333-333333333333";
  assert.equal((await request("owner", "ACTIVE")).statusCode, 404);
  assert.equal(writes, 0);
});

test("missing membership cannot be recreated by reactivation", async () => {
  membership = null;
  assert.equal((await request("owner", "ACTIVE")).statusCode, 404);
  assert.equal(writes, 0);
});

test("existing admin override can reactivate suspended membership", async () => {
  membership.status = "SUSPENDED";
  membership.revokedAt = new Date();
  assert.equal((await request("admin", "ACTIVE")).statusCode, 200);
  assert.equal(membership.revokedAt, null);
});
