import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { salonRoutes } from "./salons.js";

const original = { user: prisma.user, salon: prisma.salon, service: prisma.service };
const mock = prisma as any;

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = "salon-service-route-test-secret";
});

afterEach(() => Object.assign(mock, original));

function authorization(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

test("salon service routes enforce ownership, roles, nested IDs, validation, and deactivation", async () => {
  const salons: Record<string, any> = {
    "salon-a": { id: "salon-a", ownerId: "owner-a" },
    "salon-b": { id: "salon-b", ownerId: "owner-b" },
  };
  const services: Record<string, any> = {
    "service-a": { id: "service-a", salonId: "salon-a", salon: { ownerId: "owner-a" }, name: "Cut", price: 32, durationMin: 30, isActive: true },
    "service-b": { id: "service-b", salonId: "salon-b", salon: { ownerId: "owner-b" }, name: "Shave", price: 24, durationMin: 30, isActive: true },
  };
  let createCount = 0;
  let deleteCount = 0;

  mock.user = {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      role: where.id === "admin" ? "ADMIN" : where.id === "customer" ? "CUSTOMER" : "OWNER",
      status: "ACTIVE",
    }),
  };
  mock.salon = {
    findUnique: async ({ where }: any) => salons[where.id] || null,
  };
  mock.service = {
    findMany: async ({ where }: any) => Object.values(services).filter((service: any) => service.salonId === where.salonId),
    findUnique: async ({ where }: any) => services[where.id] || null,
    create: async ({ data }: any) => {
      createCount += 1;
      const service = { id: `created-${createCount}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      services[service.id] = { ...service, salon: { ownerId: salons[service.salonId].ownerId } };
      return service;
    },
    update: async ({ where, data }: any) => {
      services[where.id] = { ...services[where.id], ...data, updatedAt: new Date() };
      return services[where.id];
    },
    delete: async ({ where }: any) => {
      deleteCount += 1;
      const service = services[where.id];
      delete services[where.id];
      return service;
    },
  };

  const app = Fastify();
  await salonRoutes(app);
  try {
    const ownerA = authorization("OWNER", "owner-a");
    const ownerB = authorization("OWNER", "owner-b");
    const customer = authorization("CUSTOMER", "customer");
    const admin = authorization("ADMIN", "admin");

    const ownRead = await app.inject({ method: "GET", url: "/api/v1/salons/salon-a/services", headers: ownerA });
    assert.equal(ownRead.statusCode, 200, ownRead.body);
    assert.equal(ownRead.json().services[0].price, 32);

    for (const response of [
      await app.inject({ method: "GET", url: "/api/v1/salons/salon-b/services", headers: ownerA }),
      await app.inject({ method: "POST", url: "/api/v1/salons/salon-b/services", headers: ownerA, payload: { name: "Blocked", price: 1 } }),
      await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-b/services/service-b", headers: ownerA, payload: { price: 1 } }),
      await app.inject({ method: "DELETE", url: "/api/v1/salons/salon-b/services/service-b", headers: ownerA }),
      await app.inject({ method: "POST", url: "/api/v1/salons/salon-a/services", headers: customer, payload: { name: "Blocked", price: 1 } }),
    ]) assert.equal(response.statusCode, 403, response.body);
    assert.equal(createCount, 0);
    assert.equal(deleteCount, 0);

    const unauthenticated = await app.inject({ method: "POST", url: "/api/v1/salons/salon-a/services", payload: { name: "Blocked", price: 1 } });
    assert.equal(unauthenticated.statusCode, 401);

    const partial = await app.inject({ method: "POST", url: "/api/v1/salons/salon-a/services", headers: ownerA, payload: { name: "Incomplete" } });
    assert.equal(partial.statusCode, 400);
    assert.equal(createCount, 0);

    const created = await app.inject({ method: "POST", url: "/api/v1/salons/salon-a/services", headers: ownerA, payload: { name: "Real Service", price: 41.5 } });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().service.name, "Real Service");
    assert.equal(created.json().service.price, 41.5);
    assert.equal(created.json().service.durationMin, 30);

    const mismatchedPatch = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-b/services/service-a", headers: ownerA, payload: { price: 10 } });
    const mismatchedDelete = await app.inject({ method: "DELETE", url: "/api/v1/salons/salon-b/services/service-a", headers: ownerA });
    assert.equal(mismatchedPatch.statusCode, 404);
    assert.equal(mismatchedDelete.statusCode, 404);
    assert.equal(services["service-a"].price, 32);
    assert.equal(deleteCount, 0);

    const deactivated = await app.inject({ method: "PATCH", url: "/api/v1/salons/salon-a/services/service-a", headers: ownerA, payload: { isActive: false } });
    assert.equal(deactivated.statusCode, 200, deactivated.body);
    assert.equal(deactivated.json().service.isActive, false);
    assert.equal(deactivated.json().service.name, "Cut");
    assert.equal(deactivated.json().service.price, 32);
    assert.equal(deleteCount, 0);
    assert.ok(services["service-a"]);

    const adminOverride = await app.inject({ method: "POST", url: "/api/v1/salons/salon-b/services", headers: admin, payload: { name: "Admin Service", price: 55 } });
    assert.equal(adminOverride.statusCode, 200, adminOverride.body);
    assert.equal(createCount, 2);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/salons/salon-b/services", headers: ownerB })).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("public salon responses request active services only", async () => {
  let publicInclude: any = null;
  mock.salon = {
    findMany: async (args: any) => {
      publicInclude = args.include;
      return [];
    },
  };
  const app = Fastify();
  await salonRoutes(app);
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/salons" });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(publicInclude.services, { where: { isActive: true } });
  } finally {
    await app.close();
  }
});
