// Proves the full Create Salon chain: ADMIN auth → provision-owner → Zod validation →
// Prisma persistence mock → admin salon list read-back.
// Uses the established Fastify + mocked-Prisma architecture (same as auth-flow.test.ts).
// This test does NOT connect to PostgreSQL directly; real-database persistence is a separate concern.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Fastify from "fastify";

import { verifyPassword } from "../lib/auth.js";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { authRoutes } from "./auth.js";
import { salonRoutes } from "./salons.js";

const originalPrisma = {
  user: prisma.user,
  salon: prisma.salon,
  salonMedia: prisma.salonMedia,
  session: prisma.session,
  $transaction: prisma.$transaction.bind(prisma),
};
const prismaMock = prisma as unknown as {
  user: any;
  salon: any;
  salonMedia: any;
  session: any;
  $transaction: any;
};

function createApp() {
  return Fastify();
}

describe("admin salon create persistence", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "admin-salon-create-test-secret";
    process.env.JWT_REFRESH_SECRET = "admin-salon-create-refresh-secret";
  });

  afterEach(() => {
    prismaMock.user = originalPrisma.user;
    prismaMock.salon = originalPrisma.salon;
    prismaMock.salonMedia = originalPrisma.salonMedia;
    prismaMock.session = originalPrisma.session;
    prismaMock.$transaction = originalPrisma.$transaction;
  });

  it("provisions a salon with all fields and reads it back through the admin salon list", async () => {
    let createdOwner: any = null;
    let createdSalon: any = null;
    const createdMedia: any[] = [];
    const providedPassword = "AdminTestOwnerPass123";

    // --- Prisma mocks ---
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        // Admin auth lookup
        if (where?.id === "admin-1") {
          return { id: "admin-1", role: "ADMIN", status: "ACTIVE", email: "admin@example.com" };
        }
        // Email uniqueness check for new owner
        if (where?.email === "newowner@example.com") {
          return createdOwner || null;
        }
        return null;
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findUnique: async ({ where }: any) => {
        if (where?.slug) return null; // slug uniqueness check
        if (where?.id === "salon-new") {
          return createdSalon
            ? { ...createdSalon, media: createdMedia, bookings: [], services: [], barbers: [], reviews: [] }
            : null;
        }
        return null;
      },
      findMany: async ({ where, include }: any) => {
        // Admin salon list query
        if (where?.isActive === undefined || (createdSalon && where.isActive === createdSalon.isActive)) {
          return createdSalon
            ? [{ ...createdSalon, media: createdMedia, owner: createdOwner, bookings: [], services: [], barbers: [], offers: [], reviews: [] }]
            : [];
        }
        return [];
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => {
      const tx = {
        user: {
          create: async ({ data }: any) => {
            createdOwner = {
              id: "owner-new",
              createdAt: new Date(),
              updatedAt: new Date(),
              status: "ACTIVE",
              ...data,
            };
            return createdOwner;
          },
        },
        salon: {
          findUnique: async ({ where }: any) => {
            if (where?.slug) return null;
            if (where?.id === "salon-new") {
              return { ...createdSalon, media: createdMedia };
            }
            return null;
          },
          create: async ({ data }: any) => {
            createdSalon = {
              id: "salon-new",
              createdAt: new Date(),
              updatedAt: new Date(),
              isActive: true,
              status: "OPEN",
              rating: 0,
              reviewCount: 0,
              isVerified: false,
              ...data,
            };
            return createdSalon;
          },
        },
        salonMedia: {
          deleteMany: async () => ({ count: createdMedia.length }),
          create: async ({ data }: any) => {
            const record = { id: "media-new", createdAt: new Date(), ...data };
            createdMedia.push(record);
            return record;
          },
        },
      };
      return callback(tx);
    }) as any;

    // --- Build Fastify app with auth + salon routes ---
    const app = createApp();
    await authRoutes(app);
    await salonRoutes(app);

    try {
      // --- 1. Provision new owner + salon with ALL fields ---
      const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
      const provisionResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          owner: {
            fullName: "New Owner",
            email: "newowner@example.com",
            phone: "+491701234567",
            password: providedPassword,
          },
          salon: {
            name: "Full Field Salon",
            city: "Munich",
            address: "Marienplatz 10, 80331 Munich",
            phone: "+49891234567",
            email: "salon@example.com",
            website: "https://fullfield.example.com",
            description: "A salon for testing all fields",
            openingTime: "08:00",
            closingTime: "20:00",
            workingDays: ["mon", "tue", "wed", "thu", "fri"],
            timeZone: "Europe/Berlin",
            adminVip: true,
            isWomenOnly: true,
            classification: "PREMIUM",
            imageUrl: "https://cdn.example.com/salons/fullfield.jpg",
          },
        },
      });

      // --- 2. Verify provision response ---
      assert.equal(provisionResponse.statusCode, 200, `provision failed: ${provisionResponse.body}`);
      const provisionPayload = provisionResponse.json();
      assert.equal(provisionPayload.owner.role, "OWNER");

      // --- 3. Verify owner persistence (mock state) ---
      assert.ok(createdOwner, "owner must be created");
      assert.equal(createdOwner.fullName, "New Owner");
      assert.equal(createdOwner.email, "newowner@example.com");
      assert.equal(createdOwner.phone, "+491701234567");
      assert.equal(createdOwner.role, "OWNER");
      // Password is hashed, not stored in plaintext
      assert.ok(createdOwner.passwordHash, "password hash must be stored");
      assert.match(createdOwner.passwordHash, /^\$argon2/);
      assert.equal(await verifyPassword(createdOwner.passwordHash, providedPassword), true);

      // --- 4. Verify salon persistence (mock state) ---
      assert.ok(createdSalon, "salon must be created");
      assert.equal(createdSalon.name, "Full Field Salon");
      assert.equal(createdSalon.city, "Munich");
      assert.equal(createdSalon.address, "Marienplatz 10, 80331 Munich");
      assert.equal(createdSalon.phone, "+49891234567");
      assert.equal(createdSalon.email, "salon@example.com");
      assert.equal(createdSalon.website, "https://fullfield.example.com");
      assert.equal(createdSalon.description, "A salon for testing all fields");
      assert.equal(createdSalon.openingTime, "08:00");
      assert.equal(createdSalon.closingTime, "20:00");
      assert.deepEqual(createdSalon.workingDays, ["mon", "tue", "wed", "thu", "fri"]);
      assert.equal(createdSalon.timeZone, "Europe/Berlin");
      assert.equal(createdSalon.adminVip, true);
      assert.equal(createdSalon.isWomenOnly, true);
      assert.equal(createdSalon.classification, "PREMIUM");
      assert.equal(createdSalon.ownerId, "owner-new");

      // --- 5. Verify SalonMedia persistence (mock state) ---
      assert.equal(createdMedia.length, 1, "one media record must be created");
      assert.equal(createdMedia[0].kind, "image");
      assert.equal(createdMedia[0].url, "https://cdn.example.com/salons/fullfield.jpg");
      assert.equal(createdMedia[0].salonId, "salon-new");

      // --- 6. Verify no password leakage in response ---
      assert.equal("password" in provisionPayload.owner, false);
      assert.equal("passwordHash" in provisionPayload.owner, false);
      assert.equal(JSON.stringify(provisionPayload).includes(providedPassword), false);

      // --- 7. Read back through admin salon list endpoint ---
      const adminListResponse = await app.inject({
        method: "GET",
        url: "/api/v1/admin/salons",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminListResponse.statusCode, 200, `admin list failed: ${adminListResponse.body}`);
      const adminListPayload = adminListResponse.json();
      assert.ok(Array.isArray(adminListPayload.salons), "response must contain salons array");
      const readSalon = adminListPayload.salons.find((s: any) => s.id === "salon-new");
      assert.ok(readSalon, "provisioned salon must appear in admin list");

      // Verify read-back values
      assert.equal(readSalon.name, "Full Field Salon");
      assert.equal(readSalon.city, "Munich");
      assert.equal(readSalon.address, "Marienplatz 10, 80331 Munich");
      assert.equal(readSalon.phone, "+49891234567");
      assert.equal(readSalon.email, "salon@example.com");
      assert.equal(readSalon.website, "https://fullfield.example.com");
      assert.equal(readSalon.description, "A salon for testing all fields");
      assert.equal(readSalon.openingTime, "08:00");
      assert.equal(readSalon.closingTime, "20:00");
      assert.deepEqual(readSalon.workingDays, ["mon", "tue", "wed", "thu", "fri"]);
      assert.equal(readSalon.timeZone, "Europe/Berlin");
      assert.equal(readSalon.isWomenOnly, true);
      // Admin VIP / classification through serialization
      assert.equal(readSalon.adminVip, true);
      assert.equal(readSalon.isVip, true);
      assert.equal(readSalon.classification, "VIP");
      assert.equal(readSalon.baseClassification, "PREMIUM");
      // Owner info
      assert.equal(readSalon.owner.fullName, "New Owner");
      assert.equal(readSalon.owner.email, "newowner@example.com");
      // Media
      assert.ok(Array.isArray(readSalon.media), "read-back must include media array");
      assert.equal(readSalon.media.length, 1);
      assert.equal(readSalon.media[0].url, "https://cdn.example.com/salons/fullfield.jpg");
      assert.equal(readSalon.media[0].kind, "image");
    } finally {
      await app.close();
    }
  });

  it("rejects provision-owner for non-ADMIN users", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "owner-1") {
          return { id: "owner-1", role: "OWNER", status: "ACTIVE", email: "owner@example.com" };
        }
        if (where?.id === "customer-1") {
          return { id: "customer-1", role: "CUSTOMER", status: "ACTIVE", email: "customer@example.com" };
        }
        return null;
      },
    } as any;

    const app = createApp();
    await authRoutes(app);

    try {
      const payload = {
        owner: { fullName: "Test Owner", email: "test@example.com", password: "TestPass123" },
        salon: { name: "Test", city: "Berlin", address: "Teststr 1", phone: "+49123456789" },
      };

      // Unauthenticated → 401
      const unauthed = await app.inject({ method: "POST", url: "/api/v1/auth/admin/provision-owner", payload });
      assert.equal(unauthed.statusCode, 401);

      // OWNER → 403
      const ownerToken = signAccessToken({ sub: "owner-1", role: "OWNER" });
      const ownerResponse = await app.inject({
        method: "POST", url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${ownerToken}` }, payload,
      });
      assert.equal(ownerResponse.statusCode, 403);

      // CUSTOMER → 403
      const customerToken = signAccessToken({ sub: "customer-1", role: "CUSTOMER" });
      const customerResponse = await app.inject({
        method: "POST", url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${customerToken}` }, payload,
      });
      assert.equal(customerResponse.statusCode, 403);
    } finally {
      await app.close();
    }
  });

  it("rejects provision with missing required fields", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return { id: "admin-1", role: "ADMIN", status: "ACTIVE", email: "admin@example.com" };
        }
        return null;
      },
    } as any;
    prismaMock.session = { ...originalPrisma.session, create: async () => ({ id: "s1" }) } as any;

    const app = createApp();
    await authRoutes(app);

    try {
      const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });

      // Missing salon
      const noSalon = await app.inject({
        method: "POST", url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { owner: { fullName: "X", email: "x@x.com", password: "12345678" } },
      });
      assert.equal(noSalon.statusCode, 400);

      // Missing owner password for new owner
      const noPassword = await app.inject({
        method: "POST", url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          owner: { fullName: "X", email: "x@x.com" },
          salon: { name: "X", city: "X", address: "X long enough", phone: "+49123456789" },
        },
      });
      assert.equal(noPassword.statusCode, 400);

      // Invalid email
      const badEmail = await app.inject({
        method: "POST", url: "/api/v1/auth/admin/provision-owner",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          owner: { fullName: "X", email: "not-an-email", password: "12345678" },
          salon: { name: "X", city: "X", address: "X long enough", phone: "+49123456789" },
        },
      });
      assert.equal(badEmail.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});
