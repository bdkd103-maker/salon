import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { hashPassword, verifyPassword } from "../lib/auth.js";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { authRoutes } from "./auth.js";
import { dashboardRoutes } from "./dashboard.js";

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
  const app = Fastify();
  return app;
}

describe("unified auth flow", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  afterEach(async () => {
    prismaMock.user = originalPrisma.user;
    prismaMock.salon = originalPrisma.salon;
    prismaMock.salonMedia = originalPrisma.salonMedia;
    prismaMock.session = originalPrisma.session;
    prismaMock.$transaction = originalPrisma.$transaction;
  });

  it("rejects public registration without server email verification", async () => {
    let createdUserPayload: any = null;
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.email) return null;
        return null;
      },
      create: async ({ data }: any) => {
        createdUserPayload = data;
        return {
          id: "customer-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "ACTIVE",
          ...data,
        };
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;

    const app = createApp();
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Customer One",
        email: "customer@example.com",
        password: "password123",
        phone: "+49123456789",
        role: "OWNER",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(createdUserPayload, null);

    await app.close();
  });

  it("rejects owner provisioning without an authenticated admin", async () => {
    const app = createApp();
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      payload: {
        owner: { fullName: "Owner One", email: "owner@example.com" },
        salon: {
          name: "Owner Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
        },
      },
    });

    assert.equal(response.statusCode, 401);

    await app.close();
  });

  it("rejects owner provisioning for non-admin users", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "customer-1") {
          return {
            id: "customer-1",
            role: "CUSTOMER",
            status: "ACTIVE",
            email: "customer@example.com",
          };
        }
        return null;
      },
    } as any;

    const app = createApp();
    await authRoutes(app);

    const token = signAccessToken({ sub: "customer-1", role: "CUSTOMER" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        owner: { fullName: "Owner One", email: "owner@example.com" },
        salon: {
          name: "Owner Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
        },
      },
    });

    assert.equal(response.statusCode, 403);

    await app.close();
  });

  it("provisions a new OWNER with an explicit password and allows the normal owner login/dashboard flow", async () => {
    let createdOwner: any = null;
    let createdSalon: any = null;
    const createdMedia: any[] = [];
    const providedPassword = "AdminSetOwnerPass123";

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
          };
        }
        if (where?.email === "owner@example.com") {
          return createdOwner || null;
        }
        if (where?.id === "owner-1") {
          return createdOwner;
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
        if (where?.slug) return null;
        if (where?.id === "salon-1") {
          return createdSalon
            ? { ...createdSalon, media: createdMedia, bookings: [], services: [], barbers: [], reviews: [] }
            : null;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        assert.deepEqual(where, { ownerId: "owner-1" });
        return createdSalon
          ? [{ ...createdSalon, media: createdMedia, bookings: [], services: [], barbers: [], reviews: [] }]
          : [];
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        create: async ({ data }: any) => {
          createdOwner = {
            id: "owner-1",
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
          if (where?.id === "salon-1") {
            return {
              ...createdSalon,
              media: createdMedia,
            };
          }
          return null;
        },
        create: async ({ data }: any) => {
          createdSalon = {
            id: "salon-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
            status: "OPEN",
            ...data,
          };
          return createdSalon;
        },
      },
      salonMedia: {
        deleteMany: async () => ({ count: createdMedia.length }),
        create: async ({ data }: any) => {
          const mediaRecord = {
            id: "media-1",
            createdAt: new Date(),
            ...data,
          };
          createdMedia.push(mediaRecord);
          return mediaRecord;
        },
      },
    })) as any;

    const app = createApp();
    await authRoutes(app);
    await dashboardRoutes(app);

    const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
    const provisionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        owner: {
          fullName: "Owner One",
          email: "owner@example.com",
          phone: "+49111111111",
          password: providedPassword,
        },
        salon: {
          name: "Owner Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
          email: "owner@example.com",
          imageUrl: "https://cdn.example.com/salons/owner-salon.jpg",
          openingTime: "09:00",
          closingTime: "21:00",
          workingDays: ["mon", "fri"],
          timeZone: "America/New_York",
        },
      },
    });

    assert.equal(provisionResponse.statusCode, 200);
    const provisionPayload = provisionResponse.json();
    assert.equal(provisionPayload.owner.role, "OWNER");
    assert.equal(createdOwner.role, "OWNER");
    assert.ok(createdOwner.passwordHash);
    assert.match(createdOwner.passwordHash, /^\$argon2/i);
    assert.equal(await verifyPassword(createdOwner.passwordHash, providedPassword), true);
    assert.equal("credentials" in provisionPayload, false);
    assert.equal("password" in provisionPayload, false);
    assert.equal(JSON.stringify(provisionPayload).includes("password"), false);
    assert.equal(createdSalon.ownerId, "owner-1");
    assert.deepEqual(createdSalon.workingDays, ["mon", "fri"]);
    assert.equal(createdSalon.timeZone, "America/New_York");
    assert.equal(provisionPayload.salon.closingTime, "21:00");
    assert.deepEqual(provisionPayload.salon.workingDays, ["mon", "fri"]);
    assert.equal(provisionPayload.salon.timeZone, "America/New_York");
    assert.equal(Array.isArray(provisionPayload.salon.media), true);
    assert.equal(provisionPayload.salon.media[0]?.url, "https://cdn.example.com/salons/owner-salon.jpg");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: providedPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const loginPayload = loginResponse.json();
    assert.equal(loginPayload.user.role, "OWNER");

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { authorization: `Bearer ${loginPayload.accessToken}` },
    });

    assert.equal(dashboardResponse.statusCode, 200);
    const dashboardPayload = dashboardResponse.json();
    assert.equal(dashboardPayload.salons.length, 1);
    assert.equal(dashboardPayload.salons[0].id, "salon-1");
    assert.equal(dashboardPayload.salons[0].ownerId, "owner-1");
    assert.equal(dashboardPayload.salons[0].name, "Owner Salon");
    assert.deepEqual(dashboardPayload.salons[0].workingDays, ["mon", "fri"]);
    assert.equal(dashboardPayload.salons[0].timeZone, "America/New_York");

    await app.close();
  });

  it("accepts an admin-provided owner password, stores only the hash, and preserves owner login", async () => {
    let createdOwner: any = null;
    const providedPassword = "AdminSetOwnerPass123";

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
          };
        }
        if (where?.email === "owner@example.com") {
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
        if (where?.slug) return null;
        return null;
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        create: async ({ data }: any) => {
          createdOwner = {
            id: "owner-1",
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
          return null;
        },
        create: async ({ data }: any) => ({
          id: "salon-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true,
          status: "OPEN",
          ...data,
        }),
      },
      salonMedia: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => ({ id: "media-1", createdAt: new Date(), ...data }),
      },
    })) as any;

    const app = createApp();
    await authRoutes(app);

    const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
    const provisionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        owner: {
          fullName: "Owner One",
          email: "owner@example.com",
          phone: "+49111111111",
          password: providedPassword,
        },
        salon: {
          name: "Owner Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
          email: "owner@example.com",
          imageUrl: "https://cdn.example.com/salons/owner-salon.jpg",
        },
      },
    });

    assert.equal(provisionResponse.statusCode, 200);
    const provisionPayload = provisionResponse.json();
    assert.equal(createdOwner.passwordHash.startsWith("$argon2"), true);
    assert.equal("password" in provisionPayload.owner, false);
    assert.equal("passwordHash" in provisionPayload.owner, false);
    assert.equal(JSON.stringify(provisionPayload).includes(providedPassword), false);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: providedPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.json().user.role, "OWNER");
    assert.equal(await verifyPassword(createdOwner.passwordHash, providedPassword), true);

    await app.close();
  });

  it("rejects provisioning a new OWNER without an explicit password", async () => {
    let createUserCalls = 0;
    let createSalonCalls = 0;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
          };
        }
        return null;
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        create: async () => {
          createUserCalls += 1;
          throw new Error("Expected request to be rejected before creating a user");
        },
      },
      salon: {
        create: async () => {
          createSalonCalls += 1;
          throw new Error("Expected request to be rejected before creating a salon");
        },
      },
      salonMedia: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => ({ id: "media-2", createdAt: new Date(), ...data }),
      },
    })) as any;

    const app = createApp();
    await authRoutes(app);

    const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        owner: {
          fullName: "Owner Two",
          email: "owner-two@example.com",
          phone: "+49999999999",
          password: "",
        },
        salon: {
          name: "Owner Salon Two",
          city: "Berlin",
          address: "Alexanderplatz 2",
          phone: "+49999999999",
          email: "owner-two@example.com",
        },
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "Owner password is required for new owner provisioning");
    assert.equal(createUserCalls, 0);
    assert.equal(createSalonCalls, 0);

    await app.close();
  });

  it("keeps customer authentication unchanged for direct login", async () => {
    const customerPassword = "CustomerPass123";
    const customerPasswordHash = await hashPassword(customerPassword);

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.email === "customer@example.com") {
          return {
            id: "customer-1",
            role: "CUSTOMER",
            status: "ACTIVE",
            email: "customer@example.com",
            fullName: "Customer One",
            passwordHash: customerPasswordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;

    const app = createApp();
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "customer@example.com",
        password: customerPassword,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.role, "CUSTOMER");
    assert.equal(await verifyPassword(customerPasswordHash, customerPassword), true);

    await app.close();
  });

  it("returns a safe 503 when the database is unavailable during login", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async () => {
        throw Object.assign(new Error("Can't reach database server at `localhost:5432`"), { code: "P1001" });
      },
    } as any;

    const app = createApp();
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123",
      },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "The server is temporarily unavailable. Please try again later.");

    await app.close();
  });

  it("allows an ADMIN account to authenticate through the normal login endpoint", async () => {
    const adminPassword = "AdminPass123";
    const adminPasswordHash = await hashPassword(adminPassword);

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.email === "admin@example.com") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
            fullName: "Admin One",
            passwordHash: adminPasswordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;

    const app = createApp();
    await authRoutes(app);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "admin@example.com",
        password: adminPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const loginPayload = loginResponse.json();
    assert.equal(loginPayload.user.role, "ADMIN");
    assert.ok(loginPayload.accessToken);
    assert.ok(loginPayload.refreshToken);
    assert.equal(await verifyPassword(adminPasswordHash, adminPassword), true);

    await app.close();
  });

  it("allows an OWNER account to authenticate through the normal login endpoint", async () => {
    const ownerPassword = "OwnerPass123";
    const ownerPasswordHash = await hashPassword(ownerPassword);

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.email === "owner@example.com") {
          return {
            id: "owner-1",
            role: "OWNER",
            status: "ACTIVE",
            email: "owner@example.com",
            fullName: "Owner One",
            passwordHash: ownerPasswordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      },
    } as any;
    prismaMock.session = {
      ...originalPrisma.session,
      create: async () => ({ id: "session-1" }),
    } as any;

    const app = createApp();
    await authRoutes(app);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: ownerPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const loginPayload = loginResponse.json();
    assert.equal(loginPayload.user.role, "OWNER");
    assert.ok(loginPayload.accessToken);
    assert.ok(loginPayload.refreshToken);
    assert.equal(await verifyPassword(ownerPasswordHash, ownerPassword), true);

    await app.close();
  });

  it("reattaches an existing OWNER without salons and resolves the owner dashboard through the normal login", async () => {
    const ownerPassword = "OwnerPass123";
    const ownerPasswordHash = await hashPassword(ownerPassword);
    let persistedOwner: any = {
      id: "owner-1",
      role: "OWNER",
      status: "ACTIVE",
      email: "owner@example.com",
      fullName: "Owner One",
      phone: "+49111111111",
      passwordHash: ownerPasswordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let updatedOwnerPayload: any = null;
    let attachedSalon: any = null;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
          };
        }
        if (where?.email === "owner@example.com") {
          return {
            ...persistedOwner,
            ownedSalons: [],
          };
        }
        if (where?.id === "owner-1") {
          return persistedOwner;
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
        if (where?.slug) return null;
        if (where?.id === "salon-1") {
          return attachedSalon
            ? { ...attachedSalon, bookings: [], services: [], barbers: [], reviews: [], media: [] }
            : null;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        assert.deepEqual(where, { ownerId: "owner-1" });
        return attachedSalon
          ? [{ ...attachedSalon, bookings: [], services: [], barbers: [], reviews: [], media: [] }]
          : [];
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        create: async () => {
          throw new Error("Expected existing owner account to be reused");
        },
        update: async ({ where, data }: any) => {
          assert.equal(where.id, "owner-1");
          updatedOwnerPayload = data;
          persistedOwner = {
            ...persistedOwner,
            ...data,
            updatedAt: new Date(),
          };
          return persistedOwner;
        },
      },
      salon: {
        findUnique: async ({ where }: any) => {
          if (where?.slug) return null;
          if (where?.id === "salon-1") {
            return attachedSalon
              ? { ...attachedSalon, bookings: [], services: [], barbers: [], reviews: [], media: [] }
              : null;
          }
          return null;
        },
        create: async ({ data }: any) => {
          attachedSalon = {
            id: "salon-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
            status: "OPEN",
            rating: 0,
            reviewCount: 0,
            adminVip: false,
            isVip: false,
            classification: "REGULAR",
            ...data,
          };
          return attachedSalon;
        },
      },
      salonMedia: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => ({ id: "media-1", createdAt: new Date(), ...data }),
      },
    })) as any;

    const app = createApp();
    await authRoutes(app);
    await dashboardRoutes(app);

    const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
    const provisionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        owner: {
          fullName: "Owner One",
          email: "owner@example.com",
          phone: "+49111111111",
        },
        salon: {
          name: "Owner Salon",
          city: "Berlin",
          address: "Alexanderplatz 1",
          phone: "+49111111111",
          email: "owner@example.com",
        },
      },
    });

    assert.equal(provisionResponse.statusCode, 200);
    assert.equal(updatedOwnerPayload.passwordHash, ownerPasswordHash);
    assert.equal(provisionResponse.json().owner.id, "owner-1");
    assert.equal(provisionResponse.json().salon.ownerId, "owner-1");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: ownerPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const loginPayload = loginResponse.json();
    assert.equal(loginPayload.user.role, "OWNER");

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { authorization: `Bearer ${loginPayload.accessToken}` },
    });

    assert.equal(dashboardResponse.statusCode, 200);
    const dashboardPayload = dashboardResponse.json();
    assert.equal(dashboardPayload.salons.length, 1);
    assert.equal(dashboardPayload.salons[0].id, "salon-1");
    assert.equal(dashboardPayload.salons[0].ownerId, "owner-1");

    await app.close();
  });

  it("resets an existing OWNER password without changing the linked salon relationship", async () => {
    const originalOwnerPasswordHash = await hashPassword("OriginalPass123");
    const replacementPassword = "ResetOwnerPass123";
    let persistedOwner: any = {
      id: "owner-1",
      role: "OWNER",
      status: "ACTIVE",
      email: "owner@example.com",
      fullName: "Owner One",
      phone: "+49111111111",
      passwordHash: originalOwnerPasswordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const attachedSalon = {
      id: "salon-1",
      ownerId: "owner-1",
      name: "Test Salon",
      email: "owner@example.com",
      city: "Berlin",
      address: "Alexanderplatz 1",
      phone: "+49111111111",
      isActive: true,
      status: "OPEN",
      rating: 0,
      reviewCount: 0,
      adminVip: false,
      isVip: false,
      classification: "REGULAR",
      createdAt: new Date(),
      updatedAt: new Date(),
      media: [],
      bookings: [],
      services: [],
      barbers: [],
      reviews: [],
    };
    let updatedOwnerPayload: any = null;
    let createUserCallCount = 0;
    let createSalonCallCount = 0;

    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "admin-1") {
          return {
            id: "admin-1",
            role: "ADMIN",
            status: "ACTIVE",
            email: "admin@example.com",
          };
        }
        if (where?.email === "owner@example.com") {
          return {
            ...persistedOwner,
            ownedSalons: [{ id: "salon-1" }],
          };
        }
        if (where?.id === "owner-1") {
          return persistedOwner;
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
        if (where?.id === "salon-1") {
          return attachedSalon;
        }
        if (where?.slug) return null;
        return null;
      },
      findMany: async ({ where }: any) => {
        assert.deepEqual(where, { ownerId: "owner-1" });
        return [attachedSalon];
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      user: {
        create: async () => {
          createUserCallCount += 1;
          throw new Error("Expected existing owner password reset to reuse the existing account");
        },
        update: async ({ where, data }: any) => {
          assert.equal(where.id, "owner-1");
          updatedOwnerPayload = data;
          persistedOwner = {
            ...persistedOwner,
            ...data,
            updatedAt: new Date(),
          };
          return persistedOwner;
        },
      },
      salon: {
        create: async () => {
          createSalonCallCount += 1;
          throw new Error("Expected existing salon relationship to be preserved");
        },
        update: async () => {
          throw new Error("Expected password reset not to update salon data");
        },
        findUnique: async ({ where }: any) => {
          if (where?.id === "salon-1") {
            return attachedSalon;
          }
          if (where?.slug) return null;
          return null;
        },
      },
      salonMedia: {
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => ({ id: "media-1", createdAt: new Date(), ...data }),
      },
    })) as any;

    const app = createApp();
    await authRoutes(app);
    await dashboardRoutes(app);

    const adminToken = signAccessToken({ sub: "admin-1", role: "ADMIN" });
    const provisionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/provision-owner",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        owner: {
          fullName: "Owner One",
          email: "owner@example.com",
          phone: "+49111111111",
          password: replacementPassword,
        },
        salon: {
          name: "Changed Name Should Be Ignored",
          city: "Hamburg",
          address: "Changed Address 9",
          phone: "+49222222222",
          email: "owner@example.com",
        },
      },
    });

    assert.equal(provisionResponse.statusCode, 200);
    assert.equal(createUserCallCount, 0);
    assert.equal(createSalonCallCount, 0);
    assert.deepEqual(Object.keys(updatedOwnerPayload), ["passwordHash"]);
    assert.equal(await verifyPassword(updatedOwnerPayload.passwordHash, replacementPassword), true);
    assert.equal(provisionResponse.json().owner.id, "owner-1");
    assert.equal(provisionResponse.json().owner.email, "owner@example.com");
    assert.equal(provisionResponse.json().salon.id, "salon-1");
    assert.equal(provisionResponse.json().salon.ownerId, "owner-1");
    assert.equal(provisionResponse.json().salon.name, "Test Salon");
    assert.equal("password" in provisionResponse.json().owner, false);
    assert.equal("passwordHash" in provisionResponse.json().owner, false);
    assert.equal(JSON.stringify(provisionResponse.json()).includes(replacementPassword), false);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: replacementPassword,
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const loginPayload = loginResponse.json();
    assert.equal(loginPayload.user.role, "OWNER");

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { authorization: `Bearer ${loginPayload.accessToken}` },
    });

    assert.equal(dashboardResponse.statusCode, 200);
    const dashboardPayload = dashboardResponse.json();
    assert.equal(dashboardPayload.salons.length, 1);
    assert.equal(dashboardPayload.salons[0].id, "salon-1");
    assert.equal(dashboardPayload.salons[0].ownerId, "owner-1");
    assert.equal(dashboardPayload.salons[0].name, "Test Salon");

    await app.close();
  });

  it("keeps backend guards preventing CUSTOMER/OWNER escalation", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "customer-1") {
          return {
            id: "customer-1",
            role: "CUSTOMER",
            status: "ACTIVE",
            email: "customer@example.com",
          };
        }
        if (where?.id === "owner-1") {
          return {
            id: "owner-1",
            role: "OWNER",
            status: "ACTIVE",
            email: "owner@example.com",
          };
        }
        return null;
      },
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findMany: async () => [],
    } as any;

    const app = createApp();
    await dashboardRoutes(app);

    const customerToken = signAccessToken({ sub: "customer-1", role: "CUSTOMER" });
    const ownerToken = signAccessToken({ sub: "owner-1", role: "OWNER" });

    const ownerDashboardAsCustomer = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { authorization: `Bearer ${customerToken}` },
    });
    assert.equal(ownerDashboardAsCustomer.statusCode, 403);

    const adminDashboardAsOwner = await app.inject({
      method: "GET",
      url: "/api/v1/admin/dashboard",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(adminDashboardAsOwner.statusCode, 403);

    await app.close();
  });

  it("does not downgrade owner dashboard server failures into 401 responses", async () => {
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) => {
        if (where?.id === "owner-1") {
          return {
            id: "owner-1",
            role: "OWNER",
            status: "ACTIVE",
            email: "owner@example.com",
          };
        }
        return null;
      },
    } as any;
    prismaMock.salon = {
      ...originalPrisma.salon,
      findMany: async () => {
        throw new Error("owner dashboard query failed");
      },
    } as any;

    const app = createApp();
    await dashboardRoutes(app);

    const ownerToken = signAccessToken({ sub: "owner-1", role: "OWNER" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/owner/dashboard",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    assert.equal(response.statusCode, 500);

    await app.close();
  });
});
