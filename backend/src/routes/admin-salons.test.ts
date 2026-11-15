import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonRoutes } from "./salons.js";

test("Admin listing protects persisted role, includes inactive salons, and keeps public filtering", async () => {
  const mock = prisma as any;
  const original = { user: mock.user, salon: mock.salon };
  const secret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = "admin-list-test-secret";
  const calls: any[] = [];
  mock.user = { findUnique: async ({ where }: any) => ({ id: where.id, role: where.id, status: "ACTIVE" }) };
  mock.salon = { findMany: async (query: any) => {
    calls.push(query);
    return [true, false].filter(active => query.where?.isActive === undefined || query.where.isActive === active)
      .map((isActive, i) => ({ id: String(i), name: "Test", isActive, services: [], reviews: [], media: [] }));
  } };
  const app = Fastify();
  try {
    await app.register(salonRoutes);
    assert.equal((await app.inject({ url: "/api/v1/admin/salons" })).statusCode, 401);
    for (const role of ["OWNER", "CUSTOMER", "STAFF"]) {
      const response = await app.inject({ url: "/api/v1/admin/salons", headers: { authorization: `Bearer ${signAccessToken({ sub: role, role: "ADMIN" })}` } });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(calls.length, 0);
    const response = await app.inject({ url: "/api/v1/admin/salons", headers: { authorization: `Bearer ${signAccessToken({ sub: "ADMIN", role: "ADMIN" })}` } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().salons.map((s: any) => s.isActive), [true, false]);
    assert.deepEqual(calls[0].include.owner.select, { id: true, fullName: true, email: true });
    const publicResponse = await app.inject({ url: "/api/v1/salons" });
    assert.equal(publicResponse.json().salons.length, 1);
    assert.equal(calls.at(-1).where.isActive, true);
  } finally {
    await app.close(); Object.assign(mock, original);
    if (secret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = secret;
  }
});
