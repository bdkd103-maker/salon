import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { salonRoutes } from "./salons.js";

const originalPrisma = {
  user: prisma.user,
  salon: prisma.salon,
  salonMedia: prisma.salonMedia,
  $transaction: prisma.$transaction.bind(prisma),
};
const prismaMock = prisma as unknown as {
  user: any;
  salon: any;
  salonMedia: any;
  $transaction: any;
};

function createApp() {
  return Fastify();
}

describe("salon media routes", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  afterEach(async () => {
    prismaMock.user = originalPrisma.user;
    prismaMock.salon = originalPrisma.salon;
    prismaMock.salonMedia = originalPrisma.salonMedia;
    prismaMock.$transaction = originalPrisma.$transaction;
  });

  it("returns salon media in the public salon listing", async () => {
    prismaMock.salon = {
      ...originalPrisma.salon,
      findMany: async () => [{
        id: "salon-1",
        ownerId: "owner-1",
        name: "Media Salon",
        slug: "media-salon",
        city: "Berlin",
        address: "Alexanderplatz 1",
        phone: "+49111111111",
        isActive: true,
        services: [],
        reviews: [],
        media: [{ id: "media-1", salonId: "salon-1", kind: "image", url: "https://cdn.example.com/salon.jpg", createdAt: new Date() }],
      }],
    } as any;

    const app = createApp();
    await salonRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/salons",
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.salons[0]?.media[0]?.url, "https://cdn.example.com/salon.jpg");

    await app.close();
  });

  it("creates a salon media record when a salon is created with imageUrl", async () => {
    const createdMedia: any[] = [];
    let createdSalon: any = null;

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
      findUnique: async ({ where }: any) => {
        if (where?.slug) return null;
        return null;
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      salon: {
        create: async ({ data }: any) => {
          createdSalon = {
            id: "salon-1",
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
            status: "OPEN",
            services: [],
            reviews: [],
            ...data,
          };
          return createdSalon;
        },
        findUnique: async ({ where }: any) => {
          if (where?.id === "salon-1") {
            return {
              ...createdSalon,
              media: createdMedia,
            };
          }
          if (where?.slug) return null;
          return null;
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
    await salonRoutes(app);

    const token = signAccessToken({ sub: "owner-1", role: "OWNER" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/salons",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Media Salon",
        city: "Berlin",
        address: "Alexanderplatz 1",
        phone: "+49111111111",
        imageUrl: "https://cdn.example.com/salon.jpg",
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(createdMedia.length, 1);
    assert.equal(createdMedia[0]?.url, "https://cdn.example.com/salon.jpg");
    assert.equal(payload.salon.media[0]?.url, "https://cdn.example.com/salon.jpg");

    await app.close();
  });

  it("removes the primary salon media when imageUrl is cleared", async () => {
    let deletedMedia = false;
    let createdMedia = false;
    const existingSalon = {
      id: "salon-1",
      ownerId: "owner-1",
      name: "Media Salon",
      city: "Berlin",
      address: "Alexanderplatz 1",
      phone: "+49111111111",
      services: [],
      reviews: [],
      media: [{ id: "media-1", salonId: "salon-1", kind: "image", url: "https://cdn.example.com/old.jpg", createdAt: new Date() }],
    };

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
      findUnique: async ({ where }: any) => {
        if (where?.id === "salon-1") {
          return {
            ...existingSalon,
            salon: { ownerId: "owner-1" },
          };
        }
        return null;
      },
    } as any;
    prismaMock.$transaction = (async (callback: any) => callback({
      salon: {
        update: async () => existingSalon,
        findUnique: async ({ where }: any) => {
          if (where?.id === "salon-1") {
            return {
              ...existingSalon,
              media: [],
            };
          }
          return null;
        },
      },
      salonMedia: {
        deleteMany: async () => {
          deletedMedia = true;
          return { count: 1 };
        },
        create: async () => {
          createdMedia = true;
          return null;
        },
      },
    })) as any;

    const app = createApp();
    await salonRoutes(app);

    const token = signAccessToken({ sub: "owner-1", role: "OWNER" });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/salons/salon-1",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        imageUrl: "",
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(deletedMedia, true);
    assert.equal(createdMedia, false);
    assert.deepEqual(payload.salon.media, []);

    await app.close();
  });
});
