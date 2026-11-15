import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { authRoutes } from "./auth.js";

const originalPrisma = {
  user: prisma.user,
  session: prisma.session,
};
const prismaMock = prisma as unknown as { user: any; session: any };

const NOW = new Date();
const FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
const PAST = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);

function buildSessionStore() {
  const sessions = new Map<string, any>();
  const origCreate = async ({ data }: any) => {
    const record = { id: data.id, ...data, revokedAt: null, createdAt: new Date() };
    sessions.set(data.id, record);
    return record;
  };
  const origFindUnique = async ({ where }: any) => sessions.get(where?.id) ?? null;
  const origUpdateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const s of sessions.values()) {
      let match = true;
      for (const [key, val] of Object.entries(where)) {
        const v = val as any;
        if (key === "expiresAt" && v && v.gt) {
          if (!(s.expiresAt > v.gt)) { match = false; break; }
        } else if (s[key] !== v) { match = false; break; }
      }
      if (match) { Object.assign(s, data); count += 1; }
    }
    return { count };
  };

  const store: any = {
    sessions,
    create: origCreate,
    findUnique: origFindUnique,
    updateMany: origUpdateMany,
  };

  store.$transaction = async (callback: any) => {
    const touched = new Map<string, Date | null>(); // id -> previous revokedAt
    const created = new Set<string>();
    const tx = {
      session: {
        create: async ({ data }: any) => {
          const record = await store.create({ data });
          created.add(data.id);
          return record;
        },
        findUnique: origFindUnique,
        updateMany: async ({ where, data }: any) => {
          for (const s of sessions.values()) {
            let match = true;
            for (const [key, val] of Object.entries(where)) {
              const v = val as any;
              if (key === "expiresAt" && v && v.gt) {
                if (!(s.expiresAt > v.gt)) { match = false; break; }
              } else if (s[key] !== v) { match = false; break; }
            }
            if (match && !touched.has(s.id)) {
              touched.set(s.id, s.revokedAt);
            }
          }
          return store.updateMany({ where, data });
        },
      },
    };
    try {
      return await callback(tx);
    } catch (error) {
      // Rollback: restore revokedAt for sessions touched by this transaction,
      // and remove sessions created by this transaction.
      for (const [id, prevRevokedAt] of touched) {
        const s = sessions.get(id);
        if (s) s.revokedAt = prevRevokedAt;
      }
      for (const id of created) sessions.delete(id);
      throw error;
    }
  };

  return store;
}

function createApp(sessionStore: ReturnType<typeof buildSessionStore>) {
  const app = Fastify();
  return app;
}

describe("auth refresh security", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  afterEach(async () => {
    prismaMock.user = originalPrisma.user;
    prismaMock.session = originalPrisma.session;
  });

  it("rotates the session bound to the submitted token and returns new tokens", async () => {
    const store = buildSessionStore();
    const passwordHash = await argon2.hash("Password123");
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER", email: "u@example.com", passwordHash };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    prismaMock.session = { create: store.create, findUnique: store.findUnique, updateMany: store.updateMany } as any;
    (prismaMock as any).$transaction = store.$transaction;

    const app = createApp(store);
    await authRoutes(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "u@example.com", password: "Password123" },
    });
    assert.equal(login.statusCode, 200, login.body);
    const { accessToken, refreshToken } = login.json();
    assert.ok(accessToken);
    assert.ok(refreshToken);

    // The issued refresh token must bind to the created session.
    const payload = verifyRefreshToken(refreshToken);
    assert.equal(payload.sub, "user-1");
    assert.ok(payload.sid);
    assert.ok(payload.jti);
    assert.equal(payload.typ, "refresh");
    assert.ok(store.sessions.get(payload.sid));

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken },
    });
    assert.equal(refresh.statusCode, 200, refresh.body);
    const refreshed = refresh.json();
    assert.equal(refreshed.user.role, "CUSTOMER");
    assert.ok(refreshed.accessToken);
    assert.ok(refreshed.refreshToken);
    assert.notEqual(refreshed.refreshToken, refreshToken);

    const rotated = verifyRefreshToken(refreshed.refreshToken);
    assert.equal(rotated.sub, "user-1");
    assert.ok(store.sessions.get(rotated.sid));

    const oldSession = store.sessions.get(payload.sid);
    assert.equal(oldSession.revokedAt !== null, true);

    await app.close();
  });

  it("rejects a replayed refresh token after rotation", async () => {
    const store = buildSessionStore();
    const passwordHash = await argon2.hash("Password123");
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER", passwordHash };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    prismaMock.session = { create: store.create, findUnique: store.findUnique, updateMany: store.updateMany } as any;
    (prismaMock as any).$transaction = store.$transaction;

    const app = createApp(store);
    await authRoutes(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "u@example.com", password: "Password123" },
    });
    assert.equal(login.statusCode, 200);
    const refreshToken = login.json().refreshToken;

    await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken } });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken },
    });
    assert.equal(replay.statusCode, 401, replay.body);
    assert.equal(replay.json().error, "Session revoked");

    await app.close();
  });

  it("allows only one of two concurrent refreshes with the same token", async () => {
    const store = buildSessionStore();
    const passwordHash = await argon2.hash("Password123");
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER", passwordHash };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    prismaMock.session = { create: store.create, findUnique: store.findUnique, updateMany: store.updateMany } as any;
    (prismaMock as any).$transaction = store.$transaction;

    const app = createApp(store);
    await authRoutes(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "u@example.com", password: "Password123" },
    });
    assert.equal(login.statusCode, 200);
    const refreshToken = login.json().refreshToken;

    const results = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken } }),
      app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken } }),
    ]);

    const codes = results.map((r) => r.statusCode);
    assert.equal(codes.filter((c) => c === 200).length, 1);
    assert.equal(codes.filter((c) => c === 401).length, 1);
    assert.equal(results.map((r) => r.json().error).filter(Boolean).length, 1);

    await app.close();
  });

  it("does not permanently revoke the old session if replacement creation fails", async () => {
    const store = buildSessionStore();
    let createShouldFail = false;
    const origCreate = store.create;
    store.create = async ({ data }: any) => {
      if (createShouldFail) throw new Error("session creation failed");
      return origCreate({ data });
    };
    const passwordHash = await argon2.hash("Password123");
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER", email: "u@example.com", passwordHash };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    prismaMock.session = { create: store.create, findUnique: store.findUnique, updateMany: store.updateMany } as any;
    (prismaMock as any).$transaction = store.$transaction;

    const app = createApp(store);
    await authRoutes(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "u@example.com", password: "Password123" },
    });
    assert.equal(login.statusCode, 200);
    const refreshToken = login.json().refreshToken;
    const { sid } = verifyRefreshToken(refreshToken);
    const oldSession = store.sessions.get(sid);
    assert.ok(oldSession);
    assert.equal(oldSession.revokedAt, null);

    createShouldFail = true;
    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken },
    });
    assert.equal(refresh.statusCode, 401, refresh.body);

    // The old session must NOT be permanently revoked: transaction rolled back.
    const stillSession = store.sessions.get(sid);
    assert.equal(stillSession.revokedAt, null);

    await app.close();
  });

  it("rejects an expired session", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    const sid = "session-expired";
    const token = signRefreshToken({ sub: "user-1", sid, jti: "jti-1" });
    const tokenHash = await argon2.hash(token);
    prismaMock.session = {
      ...originalPrisma.session,
      findUnique: async ({ where }: any) =>
        where?.id === sid ? { id: sid, userId: "user-1", tokenHash, revokedAt: null, expiresAt: PAST } : null,
    } as any;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Session expired");

    await app.close();
  });

  it("rejects a revoked session", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    const sid = "session-revoked";
    const token = signRefreshToken({ sub: "user-1", sid, jti: "jti-1" });
    const tokenHash = await argon2.hash(token);
    prismaMock.session = {
      ...originalPrisma.session,
      findUnique: async ({ where }: any) =>
        where?.id === sid ? { id: sid, userId: "user-1", tokenHash, revokedAt: NOW, expiresAt: FUTURE } : null,
    } as any;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Session revoked");

    await app.close();
  });

  it("rejects a token bound to another user's session", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    const token = signRefreshToken({ sub: "user-1", sid: "session-other", jti: "jti-1" });
    const tokenHash = await argon2.hash(token);
    prismaMock.session = {
      ...originalPrisma.session,
      findUnique: async ({ where }: any) =>
        where?.id === "session-other"
          ? { id: "session-other", userId: "user-2", tokenHash, revokedAt: null, expiresAt: FUTURE }
          : null,
    } as any;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Invalid refresh token");

    await app.close();
  });

  it("rejects a legacy refresh token without sid/jti claims", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    // Legacy token: signed with the old shape (sub only), no sid/jti/typ.
    const legacyToken = jwt.sign({ sub: "user-1" }, process.env.JWT_REFRESH_SECRET!, {
      expiresIn: "7d",
    });

    prismaMock.session = originalPrisma.session;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: legacyToken },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Invalid refresh token");
    // Legacy tokens must never fall through to a "latest active session" lookup.

    await app.close();
  });

  it("rejects a forged refresh token signed with a different secret", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    const forged = jwt.sign({ sub: "user-1", sid: "session-x", jti: "jti-x", typ: "refresh" }, "wrong-secret", {
      expiresIn: "7d",
    });

    prismaMock.session = originalPrisma.session;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: forged },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Invalid refresh token");

    await app.close();
  });

  it("rejects a refresh token whose hash does not match the stored session", async () => {
    const user = { id: "user-1", status: "ACTIVE", role: "CUSTOMER" };
    prismaMock.user = {
      ...originalPrisma.user,
      findUnique: async ({ where }: any) =>
        (where?.id === "user-1" || where?.email === "u@example.com") ? { ...user } : null,
    } as any;
    const token = signRefreshToken({ sub: "user-1", sid: "session-1", jti: "jti-1" });
    const otherToken = signRefreshToken({ sub: "user-1", sid: "session-1", jti: "jti-2" });
    // Store hash of otherToken but present token.
    const tokenHash = await argon2.hash(otherToken);
    prismaMock.session = {
      ...originalPrisma.session,
      findUnique: async ({ where }: any) =>
        where?.id === "session-1"
          ? { id: "session-1", userId: "user-1", tokenHash, revokedAt: null, expiresAt: FUTURE }
          : null,
    } as any;

    const app = createApp(buildSessionStore());
    await authRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: token },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().error, "Invalid refresh token");

    await app.close();
  });

  it("keeps owner and admin login issuing binded refresh tokens", async () => {
    for (const [role, email, password] of [
      ["OWNER", "owner@example.com", "OwnerPass123"],
      ["ADMIN", "admin@example.com", "AdminPass123"],
    ] as const) {
      const store = buildSessionStore();
      const hash = await argon2.hash(password);
      prismaMock.user = {
        ...originalPrisma.user,
        findUnique: async ({ where }: any) =>
          where?.email === email ? { id: "u-1", status: "ACTIVE", role, email, passwordHash: hash } : null,
      } as any;
      prismaMock.session = { create: store.create, findUnique: store.findUnique, updateMany: store.updateMany } as any;
    (prismaMock as any).$transaction = store.$transaction;

      const app = createApp(store);
      await authRoutes(app);

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      assert.equal(login.statusCode, 200);
      const { refreshToken } = login.json();
      const payload = verifyRefreshToken(refreshToken);
      assert.equal(payload.sub, "u-1");
      assert.ok(payload.sid);
      assert.ok(payload.jti);
      assert.equal(payload.typ, "refresh");
      assert.ok(store.sessions.get(payload.sid));

      await app.close();
    }
  });
});
