// Run from backend: node_modules/.bin/tsx test/verify-real-postgres-create-salon.ts
// Opt-in standalone verification; never run automatically with unit tests.
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
  // Print only strictly sanitized identifiers, never URL/user/password/query.
  console.log("REAL DB SAFETY:", JSON.stringify({
    host: /^[a-z0-9.:[\]-]+$/i.test(host) ? host : "[unknown]",
    port, database: /^[a-z0-9_-]+$/i.test(database) ? database : "[unknown]",
  }));
  const environments = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "VERCEL_ENV"];
  const safeEnvironment = environments.every(key => !process.env[key]
    || /^(development|dev|test|testing|local)$/i.test(process.env[key]!));
  // Explicitly authorized local Docker development target; no overrides.
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
  const { hashPassword, verifyPassword } = await import("../src/lib/auth.js");
  const { authRoutes } = await import("../src/routes/auth.js");
  const { salonRoutes } = await import("../src/routes/salons.js");
  const app = Fastify({ logger: false });
  const suffix = randomUUID();
  const adminId = `pg-create-admin-${suffix}`;
  const adminEmail = `${adminId}@example.invalid`;
  const ownerEmail = `pg-create-owner-${suffix}@example.invalid`;
  const password = `Verify-${randomUUID()}`;
  const salonName = `PG Create ${suffix}`;
  const imageUrl = `https://example.invalid/${suffix}.jpg`;
  const ownerInput = { fullName: "PG Verification Owner", email: ownerEmail, phone: "+491701234567", password };
  const salonInput = {
    name: salonName, city: "Berlin", address: "Teststrasse 12, 10115 Berlin",
    phone: "+49301234567", email: `pg-salon-${suffix}@example.invalid`,
    website: "https://example.invalid", description: "Temporary PostgreSQL verification fixture",
    openingTime: "08:30", closingTime: "19:00", workingDays: ["mon", "wed", "fri"],
    timeZone: "Europe/Berlin", classification: "PREMIUM", isWomenOnly: true,
    adminVip: false, isVip: false, imageUrl,
  };
  let fixturesMayExist = false;
  let stage = "database connection and preflight";
  let failed = false;
  // Establish cleanup before any fixture write, including partially completed setup.
  try {
    const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(identity[0]?.name, database);
    assert.equal(await prisma.user.count({ where: { OR: [{ id: adminId }, { email: { in: [adminEmail, ownerEmail] } }] } }), 0);
    assert.equal(await prisma.salon.count({ where: { name: salonName } }), 0);
    assert.equal(await prisma.salonMedia.count({ where: { url: imageUrl } }), 0);
    // Process-local signing keys, used by the real login/token helpers; never logged.
    process.env.JWT_ACCESS_SECRET = randomUUID();
    process.env.JWT_REFRESH_SECRET = randomUUID();
    await authRoutes(app);
    await salonRoutes(app);
    await app.ready();
    stage = "ADMIN fixture and real login";
    const passwordHash = await hashPassword(password);
    fixturesMayExist = true;
    await prisma.user.create({ data: { id: adminId, email: adminEmail, fullName: "PG Verification Admin", passwordHash, role: "ADMIN", status: "ACTIVE" } });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password } });
    assert.equal(login.statusCode, 200);
    const auth = login.json();
    assert.equal(auth.user.id, adminId);
    assert.equal(auth.user.role, "ADMIN");
    assert.ok(auth.accessToken);
    const headers = { authorization: `Bearer ${auth.accessToken}` };
    console.log("Real ADMIN login: PASS");
    stage = "owner provisioning";
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/admin/provision-owner", headers, payload: { owner: ownerInput, salon: salonInput } });
    if (response.statusCode !== 200) {
      const sensitiveValues = [password, passwordHash, auth.accessToken, auth.refreshToken,
        ...Object.entries(process.env)
          .filter(([key]) => /password|secret|token|credential|database_url|api_?key/i.test(key))
          .map(([, value]) => value),
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
      const redactText = (value: string) => {
        let safe = value;
        for (const secret of sensitiveValues) safe = safe.split(secret).join("[REDACTED]");
        return safe.replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"<>]+/gi, "[REDACTED URL]")
          .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]");
      };
      let safeBody: string;
      try {
        safeBody = JSON.stringify(response.json(), (key, value) =>
          /password|secret|token|authorization|credential|database.?url|api.?key/i.test(key)
            ? "[REDACTED]" : typeof value === "string" ? redactText(value) : value);
      } catch { safeBody = redactText(response.body); }
      console.error(`POST provision-owner HTTP status: ${response.statusCode}`);
      console.error(`POST provision-owner safe response body: ${safeBody}`);
      console.error(`Failed assertion: assert.equal(response.statusCode, 200); actual=${response.statusCode}, expected=200`);
    }
    assert.equal(response.statusCode, 200, "POST provision-owner must return HTTP 200");
    const provisioned = response.json();
    console.log("POST provision-owner: PASS");
    stage = "direct PostgreSQL persistence";
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    assert.equal(owner.id, provisioned.owner.id);
    assert.equal(owner.role, "OWNER");
    assert.equal(owner.status, "ACTIVE");
    assert.equal(owner.fullName, ownerInput.fullName);
    assert.equal(owner.email, ownerEmail);
    assert.equal(owner.phone, ownerInput.phone);
    assert.ok(owner.passwordHash && await verifyPassword(owner.passwordHash, password));
    const salons = await prisma.salon.findMany({ where: { ownerId: owner.id }, include: { media: true } });
    assert.equal(salons.length, 1);
    const salon = salons[0];
    assert.equal(salon.id, provisioned.salon.id);
    assert.equal(salon.ownerId, owner.id);
    const { imageUrl: ignoredImage, ...storedFields } = salonInput;
    for (const [key, value] of Object.entries(storedFields)) {
      assert.deepEqual((salon as unknown as Record<string, unknown>)[key], value);
    }
    assert.equal(salon.media.length, 1);
    assert.equal(salon.media[0].salonId, salon.id);
    assert.equal(salon.media[0].kind, "image");
    assert.equal(salon.media[0].url, imageUrl);
    console.log("Owner, Salon, SalonMedia, schedule, timeZone, Women Salon and non-VIP classification persisted: PASS");
    stage = "ADMIN API read-back";
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/salons", headers });
    assert.equal(list.statusCode, 200);
    const readBack = list.json().salons.find((item: { id: string }) => item.id === salon.id);
    assert.ok(readBack);
    for (const key of Object.keys(storedFields)) {
      assert.deepEqual(readBack[key], (salon as unknown as Record<string, unknown>)[key]);
    }
    assert.equal(readBack.owner.id, owner.id);
    assert.equal(readBack.owner.email, owner.email);
    assert.equal(readBack.baseClassification, "PREMIUM");
    assert.equal(readBack.vipSource, "NONE");
    assert.equal(readBack.media.length, 1);
    assert.equal(readBack.media[0].id, salon.media[0].id);
    assert.equal(readBack.media[0].url, salon.media[0].url);
    assert.equal(readBack.media[0].kind, salon.media[0].kind);
    console.log("GET admin/salons read-back: PASS");
  } catch {
    // Never dump Prisma errors, response bodies, hashes, credentials or tokens.
    console.error(`Verification failed at: ${stage}`);
    failed = true;
  } finally {
    if (fixturesMayExist) {
      try {
        await prisma.$transaction(async tx => {
          // Exact run-specific identifiers also recover records if POST committed
          // but failed before returning its generated IDs to the caller.
          const owner = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
          if (owner) {
            const salons = await tx.salon.findMany({ where: { ownerId: owner.id, name: salonName }, select: { id: true } });
            for (const salon of salons) {
              await tx.salonMedia.deleteMany({ where: { salonId: salon.id, url: imageUrl } });
              await tx.salon.delete({ where: { id: salon.id } });
            }
            await tx.user.delete({ where: { id: owner.id } });
          }
          await tx.session.deleteMany({ where: { userId: adminId } });
          await tx.user.deleteMany({ where: { id: adminId, email: adminEmail } });
        });
        assert.equal(await prisma.user.count({ where: { OR: [{ id: adminId }, { email: { in: [adminEmail, ownerEmail] } }] } }), 0);
        assert.equal(await prisma.salon.count({ where: { name: salonName } }), 0);
        assert.equal(await prisma.salonMedia.count({ where: { url: imageUrl } }), 0);
        assert.equal(await prisma.session.count({ where: { userId: adminId } }), 0);
        console.log("Cleanup: PASS; ADMIN, Owner, Salon, SalonMedia and login session no longer exist");
      } catch {
        console.error(`Cleanup FAILED; inspect fixture suffix ${suffix}`);
        failed = true;
      }
    } else {
      console.log("Cleanup: no fixture writes attempted");
    }
    try { await app.close(); } catch { console.error("App close FAILED"); failed = true; }
    try { await prisma.$disconnect(); } catch { console.error("Database disconnect FAILED"); failed = true; }
  }
  if (failed) throw new Error("Verification or cleanup failed");
}

main().then(() => {
  console.log("REAL_POSTGRES_CREATE_SALON_VERIFIED = YES");
}).catch(() => {
  console.error("Verification aborted or failed; no success claimed.");
  console.log("REAL_POSTGRES_CREATE_SALON_VERIFIED = NO");
  process.exitCode = 1;
});
