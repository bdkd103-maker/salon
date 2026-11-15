// Run from backend: node_modules/.bin/tsx test/verify-real-postgres-favorites.ts
// Opt-in standalone verification against the local PostgreSQL database; never runs with unit tests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import Fastify from "fastify";

function databaseGuard() {
  // Same dotenv defaults and environment precedence as src/server.ts.
  dotenv.config();
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL ?? ""); }
  catch {
    console.error("Database safety guard: REJECTED; missing or invalid configuration; zero writes");
    throw new Error("Unsafe configuration");
  }
  const host = target.hostname;
  const database = target.pathname.slice(1);
  const port = target.port || "5432";
  console.log("REAL DB SAFETY:", JSON.stringify({
    host: /^[a-z0-9.:[\]-]+$/i.test(host) ? host : "[unknown]",
    port, database: /^[a-z0-9_-]+$/i.test(database) ? database : "[unknown]",
  }));
  const environments = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "VERCEL_ENV"];
  const safeEnvironment = environments.every(key => !process.env[key]
    || /^(development|dev|test|testing|local)$/i.test(process.env[key]!));
  const safeName = database === "salon";
  const allowedParameters = new Set(["schema", "connection_limit", "connect_timeout", "pool_timeout"]);
  const safeParameters = [...target.searchParams].every(([key, value]) =>
    allowedParameters.has(key) && (key === "schema" ? value === "public" : /^\d+$/.test(value)));
  if (!["postgresql:", "postgres:"].includes(target.protocol)
      || !["localhost", "127.0.0.1"].includes(host) || port !== "5432"
      || !safeName || !safeEnvironment || !safeParameters || target.hash) {
    console.error("SAFE LOCAL TARGET = NO; requires localhost/127.0.0.1:5432/salon, safe environment and parameters; zero writes");
    throw new Error("Database safety guard rejected target; zero writes");
  }
  console.log("SAFE LOCAL TARGET = YES");
  return database;
}

async function main() {
  const database = databaseGuard();
  const { prisma } = await import("../src/lib/prisma.js");
  const { hashPassword } = await import("../src/lib/auth.js");
  const { authRoutes } = await import("../src/routes/auth.js");
  const { favoriteRoutes } = await import("../src/routes/favorites.js");

  const app = Fastify({ logger: false });
  const suffix = randomUUID();
  const customerAId = `fav-customer-a-${suffix}`;
  const customerBId = `fav-customer-b-${suffix}`;
  const staffId = `fav-staff-${suffix}`;
  const ownerId = `fav-owner-${suffix}`;
  const userIds = [customerAId, customerBId, staffId, ownerId];
  const activeSalonId = `fav-active-salon-${suffix}`;
  const archivedSalonId = `fav-archived-salon-${suffix}`;
  const salonIds = [activeSalonId, archivedSalonId];
  const emails = userIds.map(id => `${id}@example.invalid`);
  const password = `Verify-${randomUUID()}`;
  let fixturesMayExist = false;
  let stage = "database connection and preflight";
  let failed = false;

  try {
    const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(identity[0]?.name, database);
    // Only this run's identifiers are ever touched, before and after every stage.
    await prisma.customerFavorite.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { salonId: { in: salonIds } }] } });
    await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: { in: salonIds } } }), 0);
    assert.equal(await prisma.customerFavorite.count({ where: { OR: [{ userId: { in: userIds } }, { salonId: { in: salonIds } }] } }), 0);

    // Process-local signing keys, used by the real login/token helpers; never logged.
    process.env.JWT_ACCESS_SECRET = randomUUID();
    process.env.JWT_REFRESH_SECRET = randomUUID();
    await authRoutes(app);
    await favoriteRoutes(app);
    await app.ready();

    stage = "customer fixtures and real login";
    const passwordHash = await hashPassword(password);
    fixturesMayExist = true;
    await prisma.user.createMany({
      data: [
        { id: customerAId, email: emails[0], fullName: "FAV Customer A", passwordHash, role: "CUSTOMER", status: "ACTIVE" },
        { id: customerBId, email: emails[1], fullName: "FAV Customer B", passwordHash, role: "CUSTOMER", status: "ACTIVE" },
        { id: staffId, email: emails[2], fullName: "FAV Staff", passwordHash, role: "STAFF", status: "ACTIVE" },
        { id: ownerId, email: emails[3], fullName: "FAV Owner", passwordHash, role: "OWNER", status: "ACTIVE" },
      ],
    });
    await prisma.salon.createMany({
      data: [
        { id: activeSalonId, ownerId, name: `FAV Active ${suffix}`, slug: `fav-active-${suffix}`, city: "Berlin", address: "Favoritstrasse 1", phone: "+4930111111", openingTime: "09:00", closingTime: "18:00", workingDays: ["mon", "tue", "wed", "thu", "fri"], timeZone: "Europe/Berlin", isActive: true },
        { id: archivedSalonId, ownerId, name: `FAV Archived ${suffix}`, slug: `fav-archived-${suffix}`, city: "Köln", address: "Archivstrasse 2", phone: "+4930222222", openingTime: "09:00", closingTime: "18:00", workingDays: ["mon"], timeZone: "Europe/Berlin", isActive: false },
      ],
    });
    const login = async (index: number) => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: emails[index], password } });
      assert.equal(res.statusCode, 200, `login ${index}: ${res.statusCode}`);
      const body = res.json();
      assert.equal(body.user.id, userIds[index]);
      return { authorization: `Bearer ${body.accessToken}` } as Record<string, string>;
    };
    const asA = await login(0);
    const asB = await login(1);
    const asStaff = await login(2);
    const asOwner = await login(3);
    console.log("Real customer login: PASS");
    stage = "authentication and role boundary";

    const anonymous = await app.inject({ method: "GET", url: "/api/v1/favorites" });
    assert.equal(anonymous.statusCode, 401, anonymous.body);
    const anonymousAdd = await app.inject({ method: "POST", url: `/api/v1/favorites/${activeSalonId}` });
    assert.equal(anonymousAdd.statusCode, 401, anonymousAdd.body);
    for (const [label, headers] of [["staff", asStaff], ["owner", asOwner]] as const) {
      const forbiddenList = await app.inject({ method: "GET", url: "/api/v1/favorites", headers });
      assert.equal(forbiddenList.statusCode, 403, `${label}: ${forbiddenList.body}`);
      const forbiddenAdd = await app.inject({ method: "POST", url: `/api/v1/favorites/${activeSalonId}`, headers });
      assert.equal(forbiddenAdd.statusCode, 403, `${label}: ${forbiddenAdd.body}`);
    }
    console.log("Authentication and role boundary: PASS");
    stage = "favorite, duplicate protection and database row";

    const add = await app.inject({ method: "POST", url: `/api/v1/favorites/${activeSalonId}`, headers: asA });
    assert.equal(add.statusCode, 200, add.body);
    assert.equal(add.json().favorite.salonId, activeSalonId);
    const duplicate = await app.inject({ method: "POST", url: `/api/v1/favorites/${activeSalonId}`, headers: asA });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(await prisma.customerFavorite.count({ where: { userId: customerAId, salonId: activeSalonId } }), 1);
    assert.equal(await prisma.customerFavorite.count({ where: { salonId: activeSalonId } }), 1);
    console.log("Favorite add and duplicate protection: PASS");
    stage = "list read-back, privacy and cross-customer isolation";

    const listA = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: asA });
    assert.equal(listA.statusCode, 200, listA.body);
    const listAPayload = listA.json();
    assert.equal(listAPayload.favorites.length, 1);
    const first = listAPayload.favorites[0];
    assert.equal(first.salonId, activeSalonId);
    assert.equal(first.salon.name, `FAV Active ${suffix}`);
    assert.equal(first.salon.isActive, true);
    assert.equal(first.salon.ownerId, undefined, "owner id must not be exposed");
    assert.equal(first.salon.email, undefined, "owner e-mail must not be exposed");
    const listB = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: asB });
    assert.equal(listB.statusCode, 200, listB.body);
    assert.equal(listB.json().favorites.length, 0, "customer B must not see customer A favorites");
    const statusB = await app.inject({ method: "GET", url: `/api/v1/favorites/${activeSalonId}`, headers: asB });
    assert.equal(statusB.statusCode, 200, statusB.body);
    assert.equal(statusB.json().favorited, false);
    const statusA = await app.inject({ method: "GET", url: `/api/v1/favorites/${activeSalonId}`, headers: asA });
    assert.equal(statusA.json().favorited, true);
    console.log("List read-back, privacy and isolation: PASS");
    stage = "persistence across sessions and unavailable salons";

    const relogin = await login(0);
    const persisted = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: relogin });
    assert.equal(persisted.statusCode, 200, persisted.body);
    assert.equal(persisted.json().favorites.length, 1, "favorite must survive a fresh login");
    const archivedAdd = await app.inject({ method: "POST", url: `/api/v1/favorites/${archivedSalonId}`, headers: asA });
    assert.equal(archivedAdd.statusCode, 404, archivedAdd.body);
    const missingAdd = await app.inject({ method: "POST", url: `/api/v1/favorites/fav-missing-${suffix}`, headers: asA });
    assert.equal(missingAdd.statusCode, 404, missingAdd.body);
    assert.equal(await prisma.customerFavorite.count({ where: { userId: customerAId } }), 1, "unavailable salons must not be stored");

    await prisma.customerFavorite.create({ data: { userId: customerAId, salonId: archivedSalonId } });
    const hidden = await app.inject({ method: "GET", url: "/api/v1/favorites", headers: asA });
    assert.equal(hidden.json().favorites.length, 1, "inactive salon favorites stay hidden from the list");
    console.log("Persistence and unavailable salon handling: PASS");
    stage = "removal and repeated removal";

    const removeArchived = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${archivedSalonId}`, headers: asA });
    assert.equal(removeArchived.statusCode, 200, removeArchived.body);
    assert.equal(removeArchived.json().removed, true);
    const remove = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${activeSalonId}`, headers: asA });
    assert.equal(remove.statusCode, 200, remove.body);
    assert.equal(remove.json().removed, true);
    const removeAgain = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${activeSalonId}`, headers: asA });
    assert.equal(removeAgain.statusCode, 200, removeAgain.body);
    assert.equal(removeAgain.json().removed, false, "repeated removal must stay safe and predictable");
    assert.equal(await prisma.customerFavorite.count({ where: { userId: customerAId } }), 0);
    const removeByB = await app.inject({ method: "DELETE", url: `/api/v1/favorites/${activeSalonId}`, headers: asB });
    assert.equal(removeByB.statusCode, 200, removeByB.body);
    assert.equal(removeByB.json().removed, false, "another customer cannot remove a row that is not theirs");
    console.log("Removal and repeated removal: PASS");
    console.log("FAVORITES_REAL_POSTGRES = PASS");
  } catch {
    // Never dump response bodies, hashes, credentials or tokens.
    console.error(`Verification failed at: ${stage}`);
    failed = true;
  } finally {
    if (fixturesMayExist) {
      try {
        await prisma.customerFavorite.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { salonId: { in: salonIds } }] } });
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        assert.equal(await prisma.customerFavorite.count({ where: { OR: [{ userId: { in: userIds } }, { salonId: { in: salonIds } }] } }), 0);
        assert.equal(await prisma.session.count({ where: { userId: { in: userIds } } }), 0);
        assert.equal(await prisma.salon.count({ where: { id: { in: salonIds } } }), 0);
        assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
        console.log("TEMPORARY_FIXTURE_CLEANUP = PASS");
      } catch {
        console.error(`Cleanup FAILED; inspect fixture suffix ${suffix}`);
        failed = true;
      }
    }
    await app.close();
    await prisma.$disconnect();
  }
  if (failed) process.exitCode = 1;
}

await main();
