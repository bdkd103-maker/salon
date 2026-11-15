// Run from backend: node_modules/.bin/tsx test/verify-live-women-staff.ts
// Requires the local servers: static host on :8000 and API on :4000.
// Real browser end-to-end: the women.html women-only surface, the men's homepage
// exclusion rule, and the STAFF panel duty/service flow against the real API.
// Opt-in standalone verification; never run automatically with unit tests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { chromium } from "playwright";

function databaseGuard() {
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
  console.log("REAL DB SAFETY:", JSON.stringify({ host, port, database }));
  const environments = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "VERCEL_ENV"];
  const safeEnvironment = environments.every(key => !process.env[key]
    || /^(development|dev|test|testing|local)$/i.test(process.env[key]!));
  const allowedParameters = new Set(["schema", "connection_limit", "connect_timeout", "pool_timeout"]);
  const safeParameters = [...target.searchParams].every(([key, value]) =>
    allowedParameters.has(key) && (key === "schema" ? value === "public" : /^\d+$/.test(value)));
  if (!["postgresql:", "postgres:"].includes(target.protocol)
      || !["localhost", "127.0.0.1"].includes(host) || port !== "5432"
      || database !== "salon" || !safeEnvironment || !safeParameters || target.hash) {
    console.error("SAFE LOCAL TARGET = NO; zero writes");
    throw new Error("Database safety guard rejected target; zero writes");
  }
  console.log("SAFE LOCAL TARGET = YES");
  return database;
}

const api = "http://localhost:4000";
const site = "http://localhost:8000";

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } finally { clearTimeout(timer); }
}

async function main() {
  databaseGuard();
  const { prisma } = await import("../src/lib/prisma.js");
  const { hashPassword } = await import("../src/lib/auth.js");
  const suffix = randomUUID().slice(0, 8);
  const password = randomUUID() + "Aa1!";
  const ownerId = `salo-ws-owner-${suffix}`;
  const staffId = `salo-ws-staff-${suffix}`;
  const salonId = randomUUID();
  const salonSlug = `salo-ws-salon-${suffix}`;
  const membershipId = `salo-ws-member-${suffix}`;
  const salonName = `SALO WS ${suffix}`;
  const ownerEmail = `salo-ws-owner-${suffix}@example.invalid`;
  const staffEmail = `salo-ws-staff-${suffix}@example.invalid`;
  let browser: any;
  let stage = "preflight";
  try {
    assert.equal(await probe(api + "/health"), 200);
    assert.equal(await probe(site + "/index.html"), 200);
    assert.equal(await probe(site + "/women.html"), 200);

    stage = "fixtures";
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, staffId] } } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: salonId } }), 0);
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({ data: [
      { id: ownerId, email: ownerEmail, fullName: "WS Owner", role: "OWNER", emailVerified: true, passwordHash },
      { id: staffId, email: staffEmail, fullName: "WS Staff", role: "STAFF", emailVerified: true, passwordHash },
    ]});
    await prisma.salon.create({ data: {
      id: salonId, ownerId, name: salonName, slug: salonSlug, city: "Berlin",
      address: "WS Strasse 1, 10115 Berlin", phone: "+49301111111",
      openingTime: "09:00", closingTime: "18:00",
      workingDays: ["mon","tue","wed","thu","fri","sat","sun"],
      timeZone: "Europe/Berlin", isWomenOnly: true,
    }});
    const barber = await prisma.barber.create({ data: { salonId, name: "WS Barber" } });
    await prisma.staffMembership.create({ data: { id: membershipId, salonId, userId: staffId, barberId: barber.id } });

    browser = await chromium.launch({ headless: true, channel: "msedge" });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem("meshwarLang", "de");
      localStorage.setItem("salonkCookieConsent", "rejected");
      localStorage.setItem("meshwarSelectedExperience", "men");
    });
    await context.route("**/*", route => {
      const u = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const apiLog: string[] = [];
    page.on("pageerror", error => { pageErrors.push(error.message); console.log("PAGE_ERROR", error.message); });
    page.on("dialog", async dialog => { pageErrors.push("dialog:" + dialog.message()); await dialog.dismiss(); });
    page.on("response", r => {
      if (!r.url().includes("/api/v1/")) return;
      const status = r.status();
      if (status >= 400) apiLog.push(status + " " + new URL(r.url()).pathname);
    });

    stage = "women surface";
    await page.goto(site + "/women.html");
    await page.locator("#womenGrid").getByText(salonName, { exact: false }).first().waitFor({ timeout: 20000 });
    console.log("PASS women.html renders the women-only fixture");

    stage = "men homepage exclusion";
    await page.goto(site + "/index.html");
    await page.locator("#regularSalonGrid article").first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator("#regularSalonGrid").getByText(salonName, { exact: false }).count(), 0);
    console.log("PASS index.html excludes the women-only fixture from the public directory");

    stage = "staff login";
    await page.evaluate(() => openCustomerLogin());
    await page.locator("#customerLoginEmail").fill(staffEmail);
    await page.locator("#customerLoginPassword").fill(password);
    const [login] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login")),
      page.locator("#customerLoginSubmit").click(),
    ]);
    assert.equal(login.status(), 200);
    await page.locator("#staffModal.show").waitFor({ timeout: 20000 });
    assert.ok((await page.locator("[data-staff-salon-name]").textContent())?.includes(salonName));
    console.log("PASS staff login opens the staff panel for the fixture salon");

    stage = "staff duty";
    const dutySeen = page.waitForResponse(r => r.url().includes("/duty") && r.request().method() === "PATCH" && r.status() === 200);
    await page.locator("#staffDutyToggle").click();
    await dutySeen;
    assert.equal(await prisma.staffPresence.count({ where: { staffMembershipId: membershipId, dutyState: "ON_DUTY" } }), 1);

    stage = "staff presence confirm";
    const confirmSeen = page.waitForResponse(r => r.url().includes("/presence/confirm") && r.request().method() === "POST" && r.status() === 200);
    await page.locator("#staffConfirmPresence").click();
    await confirmSeen;
    await page.waitForFunction(() => (document.getElementById("staffDutyStatus")?.textContent || "").trim() === "Im Dienst",
      undefined, { timeout: 15000 });

    stage = "staff service start";
    const startSeen = page.waitForResponse(r => r.url().includes("/service-visits") && r.request().method() === "POST" && r.status() === 200);
    await page.locator("#staffStartService").click();
    await startSeen;
    await page.waitForFunction(() => (document.getElementById("staffActiveService")?.textContent || "").startsWith("Service in progress"),
      undefined, { timeout: 15000 });
    assert.equal(await prisma.serviceVisit.count({ where: { salonId, staffMembershipId: membershipId, status: "IN_SERVICE" } }), 1);

    stage = "staff service end";
    const endSeen = page.waitForResponse(r => r.url().includes("/complete") && r.request().method() === "PATCH" && r.status() === 200);
    await page.locator("#staffEndService").click();
    await endSeen;
    await page.waitForFunction(() => (document.getElementById("staffActiveService")?.textContent || "").trim() === "No active service",
      undefined, { timeout: 15000 });
    assert.equal(await prisma.serviceVisit.count({ where: { salonId, staffMembershipId: membershipId, status: "COMPLETED" } }), 1);

    stage = "staff queue and errors";
    assert.ok((await page.locator("#staffQueueList").textContent() || "").trim().length > 0);
    const queueFailures = apiLog.filter((entry) => entry.includes("/queue") && !entry.startsWith("401"));
    assert.deepEqual(queueFailures, [], "Staff queue request failed: " + queueFailures.join(" | "));
    assert.deepEqual(pageErrors, [], "Unexpected page errors: " + pageErrors.join(" | "));
    console.log("API_NON_2XX", JSON.stringify(apiLog));
    console.log("PASS staff duty, presence, service start/end, queue and error-free page");
    console.log("WOMEN_AND_STAFF_REAL_BROWSER = PASS");
  } catch (error) {
    console.error("FAIL stage=" + stage, error);
    throw error;
  } finally {
    await browser?.close();
    await prisma.serviceVisit.deleteMany({ where: { salonId } });
    await prisma.staffPresenceLease.deleteMany({ where: { staffMembershipId: membershipId } });
    await prisma.staffPresence.deleteMany({ where: { staffMembershipId: membershipId } });
    await prisma.staffMembership.deleteMany({ where: { id: membershipId } });
    await prisma.barber.deleteMany({ where: { salonId } });
    await prisma.salon.deleteMany({ where: { id: salonId } });
    await prisma.session.deleteMany({ where: { userId: { in: [ownerId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, staffId] } } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: salonId } }), 0);
    await prisma.$disconnect();
    console.log("TEMPORARY_FIXTURE_CLEANUP = PASS");
  }
}

await main();
