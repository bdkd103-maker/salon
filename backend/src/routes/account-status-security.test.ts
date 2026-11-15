import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import Fastify from "fastify";
import argon2 from "argon2";
import { prisma } from "../lib/prisma.js";
import { requireUserFromAuthHeader } from "../lib/auth.js";
import { signAccessToken, signRefreshToken } from "../lib/jwt.js";
import { authRoutes } from "./auth.js";
import { privacyRoutes } from "./privacy.js";
import { dashboardRoutes } from "./dashboard.js";
import { bookingRoutes } from "./bookings.js";
import { loyaltyRoutes } from "./loyalty.js";
import { queueRoutes } from "./queue.js";
import { staffStatusRoutes } from "./staff-status.js";
import { ownerTeamRoutes } from "./owner-team.js";

const mock = prisma as any;
const original = Object.fromEntries(["user", "session", "notification", "booking", "salon", "loyaltyCard", "$transaction"].map(key => [key, mock[key]]));
const secrets = { access: process.env.JWT_ACCESS_SECRET, refresh: process.env.JWT_REFRESH_SECRET };
let user: any;
let writes: string[];
let bookingReads: number;
let rosterRequested: boolean;
let refreshToken: string;
let session: any;

beforeEach(async () => {
  process.env.JWT_ACCESS_SECRET = "account-status-test-access";
  process.env.JWT_REFRESH_SECRET = "account-status-test-refresh";
  user = { id: "user-1", role: "CUSTOMER", status: "ACTIVE", email: "fixture@example.test", passwordHash: await argon2.hash("Password123!") };
  refreshToken = signRefreshToken({ sub: user.id, sid: "session-1", jti: "fixture" });
  session = { id: "session-1", userId: user.id, revokedAt: null, expiresAt: new Date(Date.now() + 60000), tokenHash: await argon2.hash(refreshToken) };
  writes = [];
  bookingReads = 0;
  rosterRequested = false;
  mock.user = {
    findUnique: async () => user && { ...user },
    update: async ({ where, data }: any) => { assert.equal(where.id, user.id); writes.push("user"); Object.assign(user, data); return user; },
  };
  mock.session = {
    findUnique: async () => session,
    create: async ({ data }: any) => { writes.push("session-create"); return data; },
    updateMany: async ({ where }: any) => { assert.equal(where.userId, user.id); writes.push("session-revoke"); return { count: 1 }; },
  };
  mock.$transaction = async (fn: any) => fn(mock);
  mock.notification = {
    findMany: async ({ where }: any) => { assert.equal(where.userId, user.id); return []; },
    create: async ({ data }: any) => { assert.equal(data.userId, user.id); assert.equal(data.metadata.consent, false); writes.push("consent"); return data; },
  };
  mock.booking = { findMany: async () => { bookingReads++; return []; } };
  mock.salon = { findUnique: async () => ({ ownerId: user?.id }) };
  mock.loyaltyCard = { findFirst: async ({ include }: any) => {
    rosterRequested = !!include.customers;
    return { id: "card", salonId: "salon", customers: include.customers ? [{ id: "protected-roster", customer: { fullName: "Private Person" } }] : [], stamps: [] };
  } };
});

afterEach(() => {
  Object.assign(mock, original);
  for (const [key, value] of [["JWT_ACCESS_SECRET", secrets.access], ["JWT_REFRESH_SECRET", secrets.refresh]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

async function withApp(run: (app: ReturnType<typeof Fastify>, headers: { authorization: string }) => Promise<void>) {
  const app = Fastify();
  await authRoutes(app);
  await privacyRoutes(app);
  await dashboardRoutes(app);
  await bookingRoutes(app);
  await loyaltyRoutes(app);
  await queueRoutes(app);
  await staffStatusRoutes(app);
  await ownerTeamRoutes(app);
  let sends = 0;
  let requests = 0;
  app.addHook("onRequest", async () => { requests++; });
  app.addHook("onSend", async () => { sends++; });
  try {
    await run(app, { authorization: `Bearer ${signAccessToken({ sub: "user-1", role: "ADMIN" })}` });
    assert.ok(sends > 0);
    assert.equal(sends, requests, "exactly one response per request");
  } finally { await app.close(); }
}

for (const status of ["ACTIVE", "INACTIVE", "SUSPENDED", "DELETED"]) {
  test(`${status}: operational and identity routes enforce persisted status for every role`, async () => {
    await withApp(async (app, headers) => {
      for (const role of ["CUSTOMER", "STAFF", "OWNER", "ADMIN"]) {
        user.role = role;
        user.status = status;
        for (const url of ["/api/v1/bookings/me", "/api/v1/auth/me", "/api/v1/profile/me"]) {
          const response = await app.inject({ url, headers });
          assert.equal(response.statusCode, status === "ACTIVE" ? 200 : 401, response.body);
          assert.equal(response.body.includes("passwordHash"), false);
        }
      }
      assert.equal(bookingReads, status === "ACTIVE" ? 4 : 0);
      assert.deepEqual(writes, []);
    });
  });

  test(`${status}: login and refresh issue sessions only for ACTIVE accounts`, async () => {
    user.status = status;
    await withApp(async (app) => {
      for (const [url, payload] of [
        ["/api/v1/auth/login", { email: user.email, password: "Password123!" }],
        ["/api/v1/auth/refresh", { refreshToken }],
      ] as const) {
        const response = await app.inject({ method: "POST", url, payload });
        assert.equal(response.statusCode, status === "ACTIVE" ? 200 : 401, response.body);
        assert.equal(typeof response.json().accessToken, status === "ACTIVE" ? "string" : "undefined");
        assert.equal(typeof response.json().refreshToken, status === "ACTIVE" ? "string" : "undefined");
      }
      assert.deepEqual(writes, status === "ACTIVE" ? ["session-create", "session-revoke", "session-create"] : []);
    });
  });

  test(`${status}: restricted exceptions preserve consent, logout and self-deletion`, async () => {
    user.status = status;
    await withApp(async (app, headers) => {
      for (const request of [
        { method: "GET", url: "/api/v1/privacy/consent" },
        { method: "POST", url: "/api/v1/privacy/consent", payload: { consent: false } },
        { method: "POST", url: "/api/v1/auth/logout" },
        { method: "DELETE", url: "/api/v1/auth/me" },
      ] as const) {
        const response = await app.inject({ ...request, headers });
        assert.equal(response.statusCode, status === "DELETED" ? 401 : 200, response.body);
      }
      assert.deepEqual(writes, status === "DELETED" ? [] : ["consent", "session-revoke", "user", "session-revoke"]);
      assert.equal(user.status, "DELETED");
      assert.equal((await app.inject({ url: "/api/v1/privacy/consent", headers })).statusCode, 401);
    });
  });

  test(`${status}: optional loyalty authentication never exposes non-ACTIVE rosters`, async () => {
    user.status = status;
    await withApp(async (app, headers) => {
      for (const role of ["OWNER", "ADMIN"]) {
        user.role = role;
        const response = await app.inject({ url: "/api/v1/loyalty/cards/salon", headers });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(rosterRequested, status === "ACTIVE");
        assert.equal(response.body.includes("protected-roster"), status === "ACTIVE");
        assert.equal(response.body.includes("Private Person"), status === "ACTIVE");
      }
    });
  });
}

test("a token issued before suspension loses operational access but retains explicit exceptions", async () => {
  await withApp(async (app, headers) => {
    assert.equal((await app.inject({ url: "/api/v1/bookings/me", headers })).statusCode, 200);
    user.status = "SUSPENDED";
    assert.equal((await app.inject({ url: "/api/v1/bookings/me", headers })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers })).statusCode, 200);
    assert.equal(bookingReads, 1);
  });
});

for (const status of ["INACTIVE", "SUSPENDED", "DELETED"]) {
  test(`${status}: operational writes, staff self and queue access fail before downstream persistence`, async () => {
    user.status = status;
    await withApp(async (app, headers) => {
      for (const role of ["CUSTOMER", "STAFF", "OWNER", "ADMIN"]) {
        user.role = role;
        for (const [method, url] of [
          ["POST", "/api/v1/bookings"],
          ["PATCH", "/api/v1/bookings/booking-1"],
          ["POST", "/api/v1/salons/salon-1/queue/tickets"],
          ["POST", "/api/v1/salons/salon-1/queue/walk-in"],
          ["POST", "/api/v1/salons/salon-1/queue/entry-1/start"],
          ["GET", "/api/v1/staff/me"],
          ["GET", "/api/v1/salons/salon-1/queue"],
          ["PATCH", "/api/v1/salons/salon-1/team/member-1"],
          ["POST", "/api/v1/salons/salon-1/service-visits"],
          ["PUT", "/api/v1/profile/me"],
        ] as const) {
          const response = await app.inject({ method, url, headers });
          assert.equal(response.statusCode, 401, `${method} ${url}: ${response.body}`);
        }
      }
      assert.deepEqual(writes, []);
      assert.equal(bookingReads, 0);
    });
  });
}

test("exceptions still require valid tokens; authentication helper sends exactly once per denial", async () => {
  let sends = 0;
  const reply = { code: (status: number) => { assert.equal(status, 401); return { send: () => { sends++; } }; } };
  for (const authorization of [undefined, "Bearer invalid"]) {
    const before = sends;
    await assert.rejects(requireUserFromAuthHeader({ headers: { authorization } }, reply, { allowRestrictedAccount: true }), /Unauthorized/);
    assert.equal(sends, before + 1);
  }
  const authorization = `Bearer ${signAccessToken({ sub: "user-1", role: "ADMIN" })}`;
  user = null;
  await assert.rejects(requireUserFromAuthHeader({ headers: { authorization } }, reply), /Unauthorized/);
  assert.equal(sends, 3);
  await withApp(async app => {
    for (const url of ["/api/v1/auth/logout", "/api/v1/privacy/consent"]) {
      assert.equal((await app.inject({ method: "POST", url, payload: { consent: false } })).statusCode, 401);
    }
  });
});

test("shared auth does not disguise database failures as authentication errors", async () => {
  const failure = new Error("fixture database unavailable");
  mock.user.findUnique = async () => { throw failure; };
  await assert.rejects(requireUserFromAuthHeader({ headers: { authorization: `Bearer ${signAccessToken({ sub: "user-1", role: "CUSTOMER" })}` } }, {} as any), error => error === failure);
});
