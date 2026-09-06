import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Fastify from "fastify";

import { verifyPassword } from "../lib/auth.js";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { salonRoutes } from "./salons.js";

const originalPrisma = {
  user: prisma.user,
  salon: prisma.salon,
  $transaction: prisma.$transaction.bind(prisma),
};
const prismaMock = prisma as unknown as {
  user: any;
  salon: any;
  $transaction: any;
};

const existingSalon = {
  id: "salon-1",
  ownerId: "owner-1",
  name: "Original Salon",
  slug: "original-salon",
  city: "Berlin",
  address: "Alexanderplatz 1",
  phone: "+49111111111",
  adminVip: false,
  isVip: false,
  classification: "REGULAR",
  isActive: true,
  media: [],
  services: [],
  reviews: [],
};

function createApp() {
  return Fastify();
}

describe("salon owner password updates", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "salon-owner-password-test-secret";
  });

  afterEach(() => {
    prismaMock.user = originalPrisma.user;
    prismaMock.salon = originalPrisma.salon;
    prismaMock.$transaction = originalPrisma.$transaction;
  });

  it("allows an ADMIN to reset the attached active OWNER password while editing the salon", async () => {
    const replacementPassword = "ReplacementPass123";
    let salonRecord = { ...existingSalon };
    let updatedPasswordHash = "";
    let transactionCount = 0;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => where?.id === "admin-1"
        ? { id: "admin-1", role: "ADMIN", status: "ACTIVE" }
        : null,
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => where?.id === salonRecord.id ? salonRecord : null,
    } as any;
    prismaMock.$transaction = (async (callback: any) => {
      transactionCount += 1;
      return callback({
        user: {
          findUnique: async ({ where }: any) => where?.id === "owner-1"
            ? { id: "owner-1", role: "OWNER", status: "ACTIVE" }
            : null,
          update: async ({ where, data }: any) => {
            assert.equal(where.id, "owner-1");
            updatedPasswordHash = data.passwordHash;
            return { id: "owner-1", role: "OWNER", status: "ACTIVE", ...data };
          },
        },
        salon: {
          update: async ({ where, data }: any) => {
            assert.equal(where.id, "salon-1");
            salonRecord = {
              ...salonRecord,
              ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
            };
            return salonRecord;
          },
          findUnique: async ({ where }: any) => where?.id === salonRecord.id ? salonRecord : null,
        },
      });
    }) as any;

    const app = createApp();
    await salonRoutes(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-1",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "admin-1", role: "ADMIN" })}` },
      payload: {
        name: "Updated Salon",
        ownerPassword: replacementPassword,
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(transactionCount, 1);
    assert.equal(salonRecord.name, "Updated Salon");
    assert.equal(await verifyPassword(updatedPasswordHash, replacementPassword), true);
    assert.equal("ownerPassword" in response.json().salon, false);
    assert.equal("passwordHash" in response.json().salon, false);

    await app.close();
  });

  it("does not allow an OWNER to reset a password through salon PATCH", async () => {
    let transactionCount = 0;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => where?.id === "owner-1"
        ? { id: "owner-1", role: "OWNER", status: "ACTIVE" }
        : null,
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => where?.id === "salon-1" ? existingSalon : null,
    } as any;
    prismaMock.$transaction = (async () => {
      transactionCount += 1;
      throw new Error("Password reset must be rejected before starting a transaction");
    }) as any;

    const app = createApp();
    await salonRoutes(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-1",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "owner-1", role: "OWNER" })}` },
      payload: { ownerPassword: "ReplacementPass123" },
    });

    assert.equal(response.statusCode, 403, response.body);
    assert.equal(transactionCount, 0);

    await app.close();
  });

  it("preserves salon-only PATCH behavior without modifying the owner password", async () => {
    let salonRecord = { ...existingSalon };
    let userCallCount = 0;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => where?.id === "admin-1"
        ? { id: "admin-1", role: "ADMIN", status: "ACTIVE" }
        : null,
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => where?.id === salonRecord.id ? salonRecord : null,
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        findUnique: async () => {
          userCallCount += 1;
          return null;
        },
        update: async () => {
          userCallCount += 1;
          return null;
        },
      },
      salon: {
        update: async ({ data }: any) => {
          salonRecord = {
            ...salonRecord,
            ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
          };
          return salonRecord;
        },
        findUnique: async ({ where }: any) => where?.id === salonRecord.id ? salonRecord : null,
      },
    })) as any;

    const app = createApp();
    await salonRoutes(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-1",
      headers: { authorization: `Bearer ${signAccessToken({ sub: "admin-1", role: "ADMIN" })}` },
      payload: { name: "Salon Only Update" },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().salon.name, "Salon Only Update");
    assert.equal(userCallCount, 0);

    await app.close();
  });
});
