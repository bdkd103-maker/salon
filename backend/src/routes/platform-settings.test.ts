import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import Fastify from "fastify";

import { signAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { platformSettingsRoutes } from "./platform-settings.js";

process.env.JWT_ACCESS_SECRET = "platform-settings-test-secret";

const mock = prisma as any;
const original = {
  platformSettings: mock.platformSettings,
  user: mock.user,
  $queryRaw: mock.$queryRaw,
};

const defaultRow = () => ({
  id: "platform",
  siteName: "SALO",
  supportEmail: "",
  defaultLocale: "ar",
  customerRegistrationEnabled: true,
  salonApplicationsEnabled: true,
  bookingGloballyEnabled: true,
  saloTicketGloballyEnabled: true,
  walkInGloballyEnabled: true,
  staffStatusLiveEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

function auth(role: string, userId: string) {
  return { authorization: `Bearer ${signAccessToken({ sub: userId, role })}` };
}

beforeEach(() => {
  mock.user = {
    findUnique: async ({ where }: any) => ({ id: where.id, role: where.id.startsWith("admin") ? "ADMIN" : "CUSTOMER", status: "ACTIVE" }),
  };
  mock.$queryRaw = async () => [{ "?column?": 1 }];
  let row = defaultRow();
  mock.platformSettings = {
    findUnique: async () => row,
    create: async ({ data }: any) => { row = { ...defaultRow(), ...data }; return row; },
    update: async ({ data }: any) => { row = { ...row, ...data, updatedAt: new Date() }; return row; },
    upsert: async ({ create, update }: any) => { row = { ...defaultRow(), ...create, ...update }; return row; },
  };
});

afterEach(() => Object.assign(mock, original));

test("platform settings require ADMIN on GET and PATCH", async () => {
  const app = Fastify();
  await platformSettingsRoutes(app);
  try {
    assert.equal((await app.inject({ url: "/api/v1/admin/platform-settings" })).statusCode, 401);
    assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/platform-settings", payload: { siteName: "X" } })).statusCode, 401);
    for (const role of ["OWNER", "CUSTOMER", "STAFF"]) {
      assert.equal((await app.inject({ url: "/api/v1/admin/platform-settings", headers: auth(role, `${role.toLowerCase()}-1`) })).statusCode, 403);
      assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/platform-settings", headers: auth(role, `${role.toLowerCase()}-1`), payload: { siteName: "X" } })).statusCode, 403);
    }
  } finally {
    await app.close();
  }
});

test("GET returns settings plus safe system/security info without secrets", async () => {
  const app = Fastify();
  await platformSettingsRoutes(app);
  try {
    const response = await app.inject({ url: "/api/v1/admin/platform-settings", headers: auth("ADMIN", "admin-1") });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.settings.id, "platform");
    assert.equal(body.settings.salonApplicationsEnabled, true);
    assert.equal(typeof body.settings.updatedAt, "string");
    assert.equal(body.system.apiVersion, "v1");
    assert.equal(typeof body.system.nodeVersion, "string");
    assert.equal(typeof body.system.databaseConnected, "boolean");
    assert.equal(body.security.secretsExposed, false);
    assert.equal(response.body.includes("JWT_ACCESS_SECRET"), false);
    assert.equal(response.body.includes('"passwordHash"'), false);
    assert.equal(body.security.passwordHashing, "Argon2id");
    assert.equal(body.security.secretsExposed, false);
    assert.equal(response.body.includes("DATABASE_URL"), false);
  } finally {
    await app.close();
  }
});

test("PATCH persists validated platform settings for later enforcement reads", async () => {
  const app = Fastify();
  await platformSettingsRoutes(app);
  try {
    const invalid = await app.inject({ method: "PATCH", url: "/api/v1/admin/platform-settings", headers: auth("ADMIN", "admin-1"), payload: { unknownFlag: true } });
    assert.equal(invalid.statusCode, 400);
    const empty = await app.inject({ method: "PATCH", url: "/api/v1/admin/platform-settings", headers: auth("ADMIN", "admin-1"), payload: {} });
    assert.equal(empty.statusCode, 400);

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/platform-settings",
      headers: auth("ADMIN", "admin-1"),
      payload: {
        siteName: "SALO Platform",
        supportEmail: "support@example.test",
        defaultLocale: "en",
        customerRegistrationEnabled: false,
        salonApplicationsEnabled: false,
        bookingGloballyEnabled: false,
        saloTicketGloballyEnabled: false,
        walkInGloballyEnabled: false,
        staffStatusLiveEnabled: false,
      },
    });
    assert.equal(patched.statusCode, 200);
    const saved = patched.json().settings;
    assert.equal(saved.siteName, "SALO Platform");
    assert.equal(saved.salonApplicationsEnabled, false);
    assert.equal(saved.bookingGloballyEnabled, false);

    const reread = await app.inject({ url: "/api/v1/admin/platform-settings", headers: auth("ADMIN", "admin-1") });
    assert.equal(reread.json().settings.salonApplicationsEnabled, false);
    assert.equal(reread.json().settings.bookingGloballyEnabled, false);
    assert.equal(reread.json().settings.staffStatusLiveEnabled, false);
  } finally {
    await app.close();
  }
});

test("PATCH falls back to upsert when the singleton row is missing", async () => {
  let row: any = null;
  mock.platformSettings = {
    findUnique: async () => row,
    create: async ({ data }: any) => { row = { ...defaultRow(), ...data }; return row; },
    update: async () => { throw new Error("Record to update not found."); },
    upsert: async ({ create, update }: any) => { row = { ...defaultRow(), ...create, ...update }; return row; },
  };
  const app = Fastify();
  await platformSettingsRoutes(app);
  try {
    const response = await app.inject({ method: "PATCH", url: "/api/v1/admin/platform-settings", headers: auth("ADMIN", "admin-1"), payload: { siteName: "Restored" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().settings.siteName, "Restored");
    assert.ok(row);
  } finally {
    await app.close();
  }
});

 test("settings fail closed when PostgreSQL cannot read the policy", async () => {
  mock.platformSettings = { findUnique: async () => { throw new Error("Database unavailable"); } };
  const app = Fastify(); await platformSettingsRoutes(app);
  try {
    const result = await app.inject({ url: "/api/v1/platform-settings" });
    assert.equal(result.statusCode, 500);
    assert.equal(result.json().settings, undefined);
  } finally { await app.close(); }
});
