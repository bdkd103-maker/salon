import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonRoutes } from "./salons.js";

const originalPrisma = {
  user: prisma.user,
  salon: prisma.salon,
  booking: prisma.booking,
  review: prisma.review,
  $transaction: prisma.$transaction.bind(prisma),
};
const prismaMock = prisma as unknown as {
  user: any;
  salon: any;
  booking: any;
  review: any;
  $transaction: any;
};

function createApp() {
  return Fastify();
}

describe("salon review routes", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  afterEach(async () => {
    prismaMock.user = originalPrisma.user;
    prismaMock.salon = originalPrisma.salon;
    prismaMock.booking = originalPrisma.booking;
    prismaMock.review = originalPrisma.review;
    prismaMock.$transaction = originalPrisma.$transaction;
  });

  it("creates a real customer review only after a completed booking and refreshes salon aggregates", async () => {
    let upsertPayload: any = null;
    let aggregateRefreshed = false;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "customer-1") {
          return {
            id: "customer-1",
            role: "CUSTOMER",
            status: "ACTIVE",
            email: "customer@example.com",
            fullName: "Customer One",
          };
        }
        return null;
      },
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => {
        if (where?.id === "salon-1") {
          return { id: "salon-1", isActive: true };
        }
        return null;
      },
    } as any;
    prismaMock.booking = {
      ...originalPrisma.booking,
      findFirst: async () => ({ id: "booking-1" }),
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      review: {
        upsert: async ({ create, update }: any) => {
          upsertPayload = { create, update };
          return {
            id: "review-1",
            ...create,
            user: { fullName: "Customer One" },
            createdAt: new Date("2026-09-03T12:00:00.000Z"),
          };
        },
        aggregate: async () => ({
          _avg: { rating: 4.5 },
          _count: { rating: 2 },
        }),
      },
      salon: {
        update: async ({ data }: any) => {
          aggregateRefreshed = Number(data.rating) === 4.5 && Number(data.reviewCount) === 2;
          return { id: "salon-1", ...data };
        },
        findMany: async () => [{
          id: "salon-1",
          ownerId: "owner-1",
          name: "Rated Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
          isActive: true,
          classification: "PREMIUM",
          adminVip: false,
          rating: 4.5,
          reviewCount: 2,
          services: [],
          reviews: [{
            id: "review-1",
            salonId: "salon-1",
            userId: "customer-1",
            rating: 5,
            comment: "Excellent cut",
            createdAt: new Date("2026-09-03T12:00:00.000Z"),
            user: { fullName: "Customer One" },
          }],
          media: [],
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }],
      },
    })) as any;

    const app = createApp();
    await salonRoutes(app);

    const token = signAccessToken({ sub: "customer-1", role: "CUSTOMER" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/salons/salon-1/reviews",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rating: 5,
        comment: "Excellent cut",
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(upsertPayload.create.rating, 5);
    assert.equal(upsertPayload.create.comment, "Excellent cut");
    assert.equal(aggregateRefreshed, true);
    assert.equal(payload.review.name, "Customer One");
    assert.equal(payload.salon.rating, 4.5);
    assert.equal(payload.salon.reviewCount, 2);

    await app.close();
  });

  it("rejects reviews when the customer has no completed booking for the salon", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => where?.id === "customer-1"
        ? {
            id: "customer-1",
            role: "CUSTOMER",
            status: "ACTIVE",
            email: "customer@example.com",
            fullName: "Customer One",
          }
        : null,
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => where?.id === "salon-1" ? { id: "salon-1", isActive: true } : null,
    } as any;
    prismaMock.booking = {
      ...originalPrisma.booking,
      findFirst: async () => null,
    } as any;

    const app = createApp();
    await salonRoutes(app);

    const token = signAccessToken({ sub: "customer-1", role: "CUSTOMER" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/salons/salon-1/reviews",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        rating: 4,
        comment: "Nice",
      },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });
});
