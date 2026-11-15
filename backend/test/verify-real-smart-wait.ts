// Run from backend: node_modules/.bin/tsx test/verify-real-smart-wait.ts
// Opt-in standalone verification of the SMART Wait Engine against local PostgreSQL;
// never runs with the unit suite. Uses only unique fixtures and removes them again.
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

const WAIT_STATES = ["CLOSED", "WALK_IN_DISABLED", "STAFF_STATUS_UNCONFIRMED", "AVAILABLE_NOW", "ESTIMATED_WAIT", "WAIT_UNKNOWN"];

function assertWaitShape(wait: any, salonId: string, label: string) {
  assert.ok(wait, `${label}: wait object must be present`);
  assert.equal(wait.salonId, salonId, label);
  assert.ok(WAIT_STATES.includes(wait.state), `${label}: unexpected state ${wait.state}`);
  assert.equal(typeof wait.reliable, "boolean", label);
  assert.equal(typeof wait.queueAhead, "number", label);
  assert.equal(typeof wait.confirmedWorkingStaff, "number", label);
  assert.equal(typeof wait.availableStaff, "number", label);
  assert.equal(typeof wait.calculatedAt, "string", label);
  if (wait.state === "AVAILABLE_NOW") {
    assert.equal(wait.etaMinutes, 0, `${label}: AVAILABLE_NOW must render as 0, never a fabricated wait`);
    assert.equal(wait.reliable, true, label);
  } else if (wait.state === "ESTIMATED_WAIT") {
    assert.ok(Number.isInteger(wait.etaMinutes) && wait.etaMinutes >= 5, `${label}: ${wait.etaMinutes}`);
    assert.equal(wait.etaMinutes % 5, 0, `${label}: ETA must be rounded to 5 minute steps`);
    assert.equal(wait.reliable, true, label);
  } else {
    assert.equal(wait.etaMinutes, null, `${label}: ${wait.state} must never expose an ETA`);
    assert.equal(wait.reliable, false, label);
  }
}

async function main() {
  const database = databaseGuard();
  const { prisma } = await import("../src/lib/prisma.js");
  const { hashPassword } = await import("../src/lib/auth.js");
  const { authRoutes } = await import("../src/routes/auth.js");
  const { staffStatusRoutes } = await import("../src/routes/staff-status.js");
  const { queueRoutes } = await import("../src/routes/queue.js");

  const app = Fastify({ logger: false });
  const suffix = randomUUID();
  const ownerId = `wait-owner-${suffix}`;
  const staffId = `wait-staff-${suffix}`;
  const customerId = `wait-customer-${suffix}`;
  const userIds = [ownerId, staffId, customerId];
  const openSalonId = randomUUID();
  const disabledSalonId = randomUUID();
  const salonIds = [openSalonId, disabledSalonId];
  const emails = userIds.map(id => `${id}@example.invalid`);
  const password = `Verify-${randomUUID()}`;
  const slugs = salonIds.map(id => `wait-${id}`);
  let fixturesMayExist = false;
  let stage = "database connection and preflight";
  let membershipId = "";
  let bookingId = "";
  let visitId = "";
  let ticketId = "";

  const live = async (salonId: string) => {
    const res = await app.inject({ method: "GET", url: `/api/v1/salons/${salonId}/live-status` });
    assert.equal(res.statusCode, 200, `live-status ${salonId}: ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const mine = async (headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/api/v1/queue/tickets/mine", headers });
    assert.equal(res.statusCode, 200, `tickets/mine: ${res.statusCode} ${res.body}`);
    return res.json();
  };

  try {
    const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(identity[0]?.name, database);

    await prisma.queueEntry.deleteMany({ where: { salonId: { in: salonIds } } });
    await prisma.serviceVisit.deleteMany({ where: { salonId: { in: salonIds } } });
    await prisma.booking.deleteMany({ where: { salonId: { in: salonIds } } });
    await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: { in: salonIds } } }), 0);

    process.env.JWT_ACCESS_SECRET = randomUUID();
    process.env.JWT_REFRESH_SECRET = randomUUID();
    await authRoutes(app);
    await staffStatusRoutes(app);
    await queueRoutes(app);
    await app.ready();

    stage = "fixtures";
    const settings = await prisma.platformSettings.findUnique({ where: { id: "platform" } });
    assert.ok(settings, "platform settings row must exist");
    assert.ok(settings!.staffStatusLiveEnabled && settings!.saloTicketGloballyEnabled && settings!.walkInGloballyEnabled,
      "Local platform gates must be enabled; this verification never modifies shared platform settings");

    const passwordHash = await hashPassword(password);
    fixturesMayExist = true;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: emails[0], fullName: "WAIT Owner", passwordHash, role: "OWNER", status: "ACTIVE" },
        { id: staffId, email: emails[1], fullName: "WAIT Staff", passwordHash, role: "STAFF", status: "ACTIVE" },
        { id: customerId, email: emails[2], fullName: "WAIT Customer", passwordHash, role: "CUSTOMER", status: "ACTIVE" },
      ],
    });
    await prisma.salon.createMany({
      data: [
        { id: openSalonId, ownerId, name: `WAIT Open ${suffix}`, slug: slugs[0], city: "Berlin", address: "Waitstrasse 1", phone: "+4930111111", isActive: true, saloTicketIntakeEnabled: true, walkInIntakeEnabled: true, openingTime: "00:00", closingTime: "23:59", workingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], timeZone: "Europe/Berlin" },
        { id: disabledSalonId, ownerId, name: `WAIT Disabled ${suffix}`, slug: slugs[1], city: "Köln", address: "Waitstrasse 2", phone: "+4930222222", isActive: true, saloTicketIntakeEnabled: false, walkInIntakeEnabled: false, openingTime: "00:00", closingTime: "23:59", workingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], timeZone: "Europe/Berlin" },
      ],
    });
    const service = await prisma.service.create({ data: { salonId: openSalonId, name: "SMART Wait cut", durationMin: 30, price: 25, isActive: true } });
    const barber = await prisma.barber.create({ data: { salonId: openSalonId, name: "SMART Wait staff" } });
    const membership = await prisma.staffMembership.create({ data: { userId: staffId, salonId: openSalonId, barberId: barber.id } });
    membershipId = membership.id;
    console.log("Fixtures: PASS");

    const login = async (index: number) => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: emails[index], password } });
      assert.equal(res.statusCode, 200, `login ${index}: ${res.statusCode}`);
      return { authorization: `Bearer ${res.json().accessToken}` } as Record<string, string>;
    };
    const asOwner = await login(0);
    const asStaff = await login(1);
    const asCustomer = await login(2);

    stage = "unconfirmed staff status";
    let status = await live(openSalonId);
    assertWaitShape(status.wait, openSalonId, "unconfirmed");
    assert.equal(status.wait.state, "STAFF_STATUS_UNCONFIRMED");
    assert.equal(status.staffSummary.total, 1, "membership exists but is not confirmed on duty");
    assert.equal(status.staffSummary.available, 0);
    console.log("Unconfirmed staff -> STAFF_STATUS_UNCONFIRMED: PASS");

    stage = "confirmed duty makes the salon available";
    const duty = await app.inject({ method: "PATCH", url: `/api/v1/salons/${openSalonId}/staff/${membershipId}/duty`, headers: asOwner, payload: { dutyState: "ON_DUTY" } });
    assert.equal(duty.statusCode, 200, duty.body);
    const confirm = await app.inject({ method: "POST", url: `/api/v1/salons/${openSalonId}/staff/${membershipId}/presence/confirm`, headers: asOwner, payload: {} });
    assert.equal(confirm.statusCode, 200, confirm.body);

    status = await live(openSalonId);
    assertWaitShape(status.wait, openSalonId, "available now");
    assert.equal(status.wait.state, "AVAILABLE_NOW");
    assert.equal(status.wait.etaMinutes, 0, "an empty queue with a free confirmed lane is 0, rendered as AVAILABLE_NOW");
    assert.equal(status.wait.availableStaff, 1);
    assert.equal(status.wait.confirmedWorkingStaff, 1);
    assert.equal(status.wait.queueLength, 0);
    assert.equal(status.wait.serviceDurationMinutes, 30, "representative duration comes from the configured service");
    console.log("Free confirmed lane -> AVAILABLE_NOW: PASS");

    stage = "customer SALO Ticket joins the real queue";
    const created = await app.inject({ method: "POST", url: `/api/v1/salons/${openSalonId}/queue/tickets`, headers: asCustomer, payload: {} });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().created, true, created.body);
    ticketId = created.json().queueEntry.id;

    status = await live(openSalonId);
    assert.equal(status.wait.queueLength, 1, "the real queue length is observed, never guessed");
    let ticket = await mine(asCustomer);
    assert.equal(ticket.ticket.id, ticketId);
    assert.equal(ticket.ahead, 0, "nobody is ahead of the first ticket");
    assertWaitShape(ticket.wait, openSalonId, "ticket available now");
    assert.equal(ticket.wait.state, "AVAILABLE_NOW");
    assert.equal(ticket.wait.queueAhead, 0);
    assert.equal(ticket.wait.queueLength, null, "the customer view never discloses the salon queue length");
    console.log("Ticket wait state: PASS");

    stage = "in-service visit with a real service assignment bounds the ETA";
    const booking = await prisma.booking.create({
      data: { userId: customerId, salonId: openSalonId, barberId: barber.id, serviceId: service.id, startAt: new Date(), endAt: new Date(Date.now() + 30 * 60000), status: "CONFIRMED" },
    });
    bookingId = booking.id;
    const startVisit = await app.inject({
      method: "POST", url: `/api/v1/salons/${openSalonId}/service-visits`, headers: asStaff,
      payload: { staffMembershipId: membershipId, source: "BOOKING", bookingId },
    });
    assert.equal(startVisit.statusCode, 200, startVisit.body);
    visitId = startVisit.json().serviceVisit.id;

    status = await live(openSalonId);
    assertWaitShape(status.wait, openSalonId, "busy known remaining");
    assert.equal(status.wait.state, "ESTIMATED_WAIT");
    assert.equal(status.wait.etaMinutes, 60, "a new visitor waits for the active 30-minute service plus the existing queued customer");
    assert.equal(status.wait.busyStaff, 1);
    assert.equal(status.wait.availableStaff, 0);
    assert.equal(status.wait.serviceDurationMinutes, 30);
    ticket = await mine(asCustomer);
    assertWaitShape(ticket.wait, openSalonId, "ticket busy known remaining");
    assert.equal(ticket.wait.state, "ESTIMATED_WAIT");
    assert.equal(ticket.wait.etaMinutes, 30);
    console.log("Busy lane with known remaining -> ESTIMATED_WAIT: PASS");

    stage = "batch live-status keeps salons isolated";
    const batch = await app.inject({ method: "GET", url: `/api/v1/salons/live-status?salonIds=${disabledSalonId},${openSalonId}` });
    assert.equal(batch.statusCode, 200, batch.body);
    const batchBody = batch.json();
    assert.equal(batchBody.salons.length, 2, "batch returns exactly the requested salons");
    assert.deepEqual(batchBody.salons.map((s: any) => s.salonId), [disabledSalonId, openSalonId], "request order is preserved");
    const disabled = batchBody.salons[0];
    const open = batchBody.salons[1];
    assertWaitShape(disabled.wait, disabledSalonId, "batch disabled salon");
    assert.equal(disabled.wait.state, "WALK_IN_DISABLED", "salon intake switch wins over staff state");
    assert.equal(disabled.wait.walkInEnabled, false);
    assert.equal(disabled.staffSummary.total, 0, "staff of another salon never leaks");
    assert.equal(open.staffSummary.total, 1);
    assert.equal(open.wait.busyStaff, 1);
    console.log("Batch isolation: PASS");

    stage = "walk-in visit without a service assignment removes the lane";
    const complete = await app.inject({ method: "PATCH", url: `/api/v1/salons/${openSalonId}/service-visits/${visitId}/complete`, headers: asStaff, payload: {} });
    assert.equal(complete.statusCode, 200, complete.body);
    const walkIn = await app.inject({
      method: "POST", url: `/api/v1/salons/${openSalonId}/service-visits`, headers: asStaff,
      payload: { staffMembershipId: membershipId, source: "WALK_IN" },
    });
    assert.equal(walkIn.statusCode, 200, walkIn.body);
    visitId = walkIn.json().serviceVisit.id;

    status = await live(openSalonId);
    assertWaitShape(status.wait, openSalonId, "unknown remaining");
    assert.equal(status.wait.state, "WAIT_UNKNOWN", "a walk-in visit carries no service, so the remaining time is unknown");
    assert.equal(status.wait.etaMinutes, null, "no minutes may be invented for an unknown remaining time");
    assert.equal(status.wait.reliable, false);
    assert.equal(status.wait.busyStaff, 1);
    assert.equal(status.wait.queueLength, 1);
    ticket = await mine(asCustomer);
    assertWaitShape(ticket.wait, openSalonId, "ticket unknown remaining");
    assert.equal(ticket.wait.state, "WAIT_UNKNOWN");
    assert.equal(ticket.wait.etaMinutes, null);
    console.log("Unknown remaining -> WAIT_UNKNOWN: PASS");

    stage = "aggregate payload never exposes customer data";
    const serialized = JSON.stringify(status.wait) + JSON.stringify(ticket.wait);
    assert.ok(!/email|phone|customerId|fullName|customerName/i.test(serialized), "wait payloads stay aggregate-only");
    assert.equal(ticket.wait.queueLength, null, "the customer view stays scoped to the customer's own position");
    console.log("Aggregate-only privacy: PASS");

    stage = "cross-salon read";
    const foreign = await live(disabledSalonId);
    assert.equal(foreign.staffSummary.total, 0, "the open salon's staff never appears on another salon");
    assert.equal(foreign.wait.queueLength, 0, "the open salon's queue never appears on another salon");
    assert.equal(foreign.wait.salonId, disabledSalonId);
    console.log("Cross-salon isolation: PASS");

    console.log("SMART_WAIT_REAL_POSTGRES_E2E = PASS");
  } catch (error) {
    console.error("FAILED_STAGE=" + stage);
    throw error;
  } finally {
    if (fixturesMayExist) {
      await prisma.queueEntry.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.serviceVisit.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.booking.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(await prisma.salon.count({ where: { id: { in: salonIds } } }), 0);
      console.log("ISOLATED_FIXTURE_CLEANUP = PASS");
    }
    await prisma.$disconnect();
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
