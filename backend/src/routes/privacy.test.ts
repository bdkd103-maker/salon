import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { privacyRoutes } from "./privacy.js";

const originalPrisma = {
  user: prisma.user,
  notification: prisma.notification,
};
const prismaMock = prisma as unknown as { user: any; notification: any };

function buildStore() {
  const rows: any[] = [];
  return {
    rows,
    findUnique: async ({ where }: any) =>
      rows.find((r) => r.id === where?.id) ?? null,
    findMany: async ({ where, orderBy }: any) => {
      let result = rows.filter((r) => {
        if (where.userId !== undefined && r.userId !== where.userId) return false;
        if (where.type !== undefined && r.type !== where.type) return false;
        return true;
      });
      if (Array.isArray(orderBy)) {
        for (const clause of orderBy) {
          const [key, dir] = Object.entries(clause)[0] as [string, string];
          const desc = dir === "desc";
          result = result.sort((a, b) => {
            let va: any = a[key];
            let vb: any = b[key];
            if (key === "createdAt") {
              va = new Date(va).getTime();
              vb = new Date(vb).getTime();
            }
            if (va < vb) return desc ? 1 : -1;
            if (va > vb) return desc ? -1 : 1;
            return 0;
          });
        }
      }
      return result;
    },
    create: async ({ data }: any) => {
      const row = { id: `gdpr-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function createApp(store: ReturnType<typeof buildStore>) {
  const app = Fastify();
  return app;
}

describe("privacy consent", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
  });

  afterEach(async () => {
    prismaMock.user = originalPrisma.user;
    prismaMock.notification = originalPrisma.notification;
  });

  it("returns true when the latest gdpr decision is acceptance", async () => {
    const store = buildStore();
    store.rows.push({
      id: "gdpr-1",
      userId: "user-1",
      type: "gdpr",
      title: "GDPR consent",
      body: "User accepted GDPR processing consent",
      metadata: { consent: true, source: "account" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      isRead: false,
    });
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = {
      ...originalPrisma.notification,
      findMany: store.findMany,
    } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: true });

    await app.close();
  });

  it("returns false when the latest gdpr decision is rejection", async () => {
    const store = buildStore();
    store.rows.push({
      id: "gdpr-1",
      userId: "user-1",
      type: "gdpr",
      metadata: { consent: false, source: "account" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: false });

    await app.close();
  });

  it("returns false when no consent decision exists", async () => {
    const store = buildStore();
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: false });

    await app.close();
  });

  it("a later rejection overrides an earlier acceptance", async () => {
    const store = buildStore();
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");
    store.rows.push(
      { id: "gdpr-1", userId: "user-1", type: "gdpr", metadata: { consent: true, source: "account" }, createdAt: t1 },
      { id: "gdpr-2", userId: "user-1", type: "gdpr", metadata: { consent: false, source: "booking" }, createdAt: t2 },
    );
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: false });

    await app.close();
  });

  it("a later acceptance overrides an earlier rejection", async () => {
    const store = buildStore();
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");
    store.rows.push(
      { id: "gdpr-1", userId: "user-1", type: "gdpr", metadata: { consent: false, source: "account" }, createdAt: t1 },
      { id: "gdpr-2", userId: "user-1", type: "gdpr", metadata: { consent: true, source: "contact" }, createdAt: t2 },
    );
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: true });

    await app.close();
  });

  it("malformed legacy metadata does not count as consent", async () => {
    const store = buildStore();
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");
    store.rows.push(
      { id: "gdpr-1", userId: "user-1", type: "gdpr", metadata: null, createdAt: t2 },
      { id: "gdpr-2", userId: "user-1", type: "gdpr", metadata: { consent: true, source: "account" }, createdAt: t1 },
    );
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: true });

    await app.close();
  });

  it("legacy record without consent field is skipped", async () => {
    const store = buildStore();
    store.rows.push({
      id: "gdpr-1",
      userId: "user-1",
      type: "gdpr",
      metadata: { source: "account" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: false });

    await app.close();
  });

  it("deterministic tie-break by id when createdAt is equal", async () => {
    const store = buildStore();
    const same = new Date("2026-01-01T00:00:00Z");
    store.rows.push(
      { id: "gdpr-a", userId: "user-1", type: "gdpr", metadata: { consent: false, source: "account" }, createdAt: same },
      { id: "gdpr-z", userId: "user-1", type: "gdpr", metadata: { consent: true, source: "account" }, createdAt: same },
    );
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        where?.id === "user-1" ? { id: "user-1", role: "CUSTOMER", status: "ACTIVE" } : null,
    } as any;
    prismaMock.notification = { ...originalPrisma.notification, findMany: store.findMany } as any;

    const app = createApp(store);
    await privacyRoutes(app);

    const token = signAccessToken({ sub: "user-1", role: "CUSTOMER" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { consent: true });

    await app.close();
  });

  it("returns 401 without authentication", async () => {
    const app = createApp(buildStore());
    await privacyRoutes(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/privacy/consent",
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "Unauthorized");

    await app.close();
  });
});
