// Run from backend: node_modules/.bin/tsx test/verify-live-profile-owner-fixes.ts
// Real browser verification for the two pre-existing regressions fixed before
// closing Favorites: (1) customer-profile.html responsiveness below 768px in
// DE/EN/AR (RTL), and (2) the customer Homepage must not call
// /api/v1/owner/dashboard with a CUSTOMER token while the Owner Dashboard keeps
// working. Opt-in standalone verification; never run with unit tests.
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
  const port = target.port || "5432";
  console.log("REAL DB SAFETY:", JSON.stringify({ host, port, database: target.pathname.slice(1) }));
  const environments = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "VERCEL_ENV"];
  const safeEnvironment = environments.every(key => !process.env[key]
    || /^(development|dev|test|testing|local)$/i.test(process.env[key]!));
  const allowedParameters = new Set(["schema", "connection_limit", "connect_timeout", "pool_timeout"]);
  const safeParameters = [...target.searchParams].every(([key, value]) =>
    allowedParameters.has(key) && (key === "schema" ? value === "public" : /^\d+$/.test(value)));
  if (!["postgresql:", "postgres:"].includes(target.protocol)
      || !["localhost", "127.0.0.1"].includes(host) || port !== "5432"
      || target.pathname !== "/salon" || !safeEnvironment || !safeParameters || target.hash) {
    console.error("SAFE LOCAL TARGET = NO; zero writes");
    throw new Error("Database safety guard rejected target; zero writes");
  }
  console.log("SAFE LOCAL TARGET = YES");
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
  const ownerId = `salo-own-${suffix}`;
  const customerId = `salo-cust-${suffix}`;
  const salonId = randomUUID();
  const ownerEmail = `salo-own-${suffix}@example.invalid`;
  const customerEmail = `salo-cust-${suffix}@example.invalid`;
  const salonName = `SALO OWN ${suffix}`;
  let browser: any;
  let stage = "preflight";
  const ownerDashboardHits: string[] = [];
  const ownerDashboardResponses: number[] = [];
  const pageErrors: string[] = [];

  try {
    assert.equal(await probe(api + "/health"), 200);
    assert.equal(await probe(site + "/index.html"), 200);
    assert.equal(await probe(site + "/customer-profile.html"), 200);

    stage = "fixtures";
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, customerId] } } }), 0);
    await prisma.user.create({ data: { id: ownerId, email: ownerEmail, fullName: "SALO OWN", role: "OWNER", emailVerified: true, passwordHash: await hashPassword(password) } });
    await prisma.user.create({ data: { id: customerId, email: customerEmail, fullName: "SALO CUST", role: "CUSTOMER", emailVerified: true, passwordHash: await hashPassword(password) } });
    await prisma.salon.create({ data: { id: salonId, ownerId, name: salonName, slug: `salo-own-${suffix}`, city: "Berlin", address: "Teststrasse 1", phone: "+4930111111", openingTime: "09:00", closingTime: "18:00", workingDays: ["mon", "tue", "wed", "thu", "fri"], timeZone: "Europe/Berlin", isActive: true } as any });

    browser = await chromium.launch({ headless: true, channel: "msedge" });
    const client = await browser.newContext({ viewport: { width: 768, height: 900 } });
    await client.addInitScript(() => {
      globalThis.__name = (fn) => fn;
      localStorage.setItem("salonkCookieConsent", "rejected");
      sessionStorage.setItem("meshwarEntryChoiceSeen", "true");
    });
    await client.route("**/*", route => {
      const u = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const page = await client.newPage();
    page.on("pageerror", error => { pageErrors.push(error.message); console.log("PAGE_ERROR", error.message); });
    page.on("request", request => {
      if (request.url().includes("/api/v1/owner/dashboard")) ownerDashboardHits.push(request.method() + " " + new URL(request.url()).pathname);
    });
    page.on("response", response => {
      if (response.url().includes("/api/v1/owner/dashboard")) ownerDashboardResponses.push(response.status());
    });

    stage = "customer login";
    await page.goto(site + "/index.html");
    await page.evaluate(() => openCustomerLogin());
    await page.locator("#customerLoginEmail").fill(customerEmail);
    await page.locator("#customerLoginPassword").fill(password);
    const [login] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login")),
      page.locator("#customerLoginSubmit").click(),
    ]);
    assert.equal(login.status(), 200);
    await page.waitForFunction(() => !document.querySelector("#customerLoginModal.show"), undefined, { timeout: 15000 });

    stage = "customer boot must not request owner dashboard";
    ownerDashboardHits.length = 0;
    await page.reload();
    await page.locator("#favoriteSalonsCard, #regularSalonGrid article").first().waitFor({ timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    assert.deepEqual(ownerDashboardHits, [], "customer context requested /api/v1/owner/dashboard");
    console.log("PASS customer boot issues no /api/v1/owner/dashboard request");

    stage = "profile responsiveness de/en/ar at 768/390/320";
    const expectations: Array<[string, string, string]> = [
      ["de", "ltr", "Deine Lieblingssalons"],
      ["en", "ltr", "Your favorite salons"],
      ["ar", "rtl", "صالوناتي المفضلة"],
    ];
    const widths = [768, 390, 320];
    const report: string[] = [];
    for (const [lang, direction, title] of expectations) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(site + "/customer-profile.html");
        await page.evaluate(code => localStorage.setItem("meshwarLang", code), lang);
        await page.reload();
        await page.locator("#favoriteSalonsCard").waitFor({ timeout: 25000 });
        await page.waitForFunction(expected => document.getElementById("favoriteSalonsTitle")?.textContent?.trim() === expected, title, { timeout: 15000 });
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => {
          const viewport = window.innerWidth;
          const offenders = [...document.querySelectorAll("body *")].filter(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if (el.closest(".sidebar-nav-shell")) return false;
            return rect.right > viewport + 1 || rect.left < -1;
          }).map(el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")
            + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""));
          const navShell = document.querySelector(".sidebar-nav-shell") as HTMLElement | null;
          const favoriteCard = document.getElementById("favoriteSalonsCard");
          return {
            viewport,
            scrollWidth: document.documentElement.scrollWidth,
            dir: document.documentElement.dir,
            lang: document.documentElement.lang,
            offenders: offenders.slice(0, 5),
            navScrollable: navShell ? navShell.scrollWidth > navShell.clientWidth : false,
            favoriteVisible: !!favoriteCard && favoriteCard.getBoundingClientRect().height > 0
          };
        });
        assert.ok(result.scrollWidth <= result.viewport + 1,
          `${lang} ${width}px horizontal overflow: scrollWidth=${result.scrollWidth}`);
        assert.deepEqual(result.offenders, [], `${lang} ${width}px elements outside viewport`);
        assert.equal(result.dir, direction, `${lang} direction`);
        assert.equal(result.lang, lang, `${lang} lang attribute`);
        assert.equal(result.favoriteVisible, true, `${lang} ${width} favorites card visible`);
        assert.equal(result.navScrollable, true, `${lang} ${width} sidebar nav stays usable`);
        report.push(`${lang}/${width}:${result.scrollWidth}`);
      }
    }
    console.log("PROFILE_SCROLLWIDTH", JSON.stringify(report));
    console.log("PASS profile responsive without horizontal overflow at 768/390/320 in DE/EN/AR (RTL)");

    stage = "owner dashboard still works";
    ownerDashboardHits.length = 0;
    ownerDashboardResponses.length = 0;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => localStorage.removeItem("meshwarLang"));
    await page.goto(site + "/index.html");
    await page.evaluate(() => { localStorage.removeItem("meshwarSession"); localStorage.removeItem("meshwarApiAuth"); });
    await page.reload();
    await page.evaluate(() => openCustomerLogin());
    await page.locator("#customerLoginEmail").fill(ownerEmail);
    await page.locator("#customerLoginPassword").fill(password);
    const [ownerLogin] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login")),
      page.locator("#customerLoginSubmit").click(),
    ]);
    assert.equal(ownerLogin.status(), 200);
    await page.waitForFunction(() => !document.querySelector("#customerLoginModal.show"), undefined, { timeout: 15000 });
    await page.waitForFunction(() => (document.getElementById("ownerName") as HTMLInputElement | null)?.value?.length > 0, undefined, { timeout: 30000 });
    assert.ok(ownerDashboardResponses.includes(200), "owner dashboard returned 200: " + JSON.stringify(ownerDashboardResponses));
    assert.ok(ownerDashboardHits.length > 0, "owner boot requested /api/v1/owner/dashboard");
    const ownerNameValue = await page.evaluate(() => (document.getElementById("ownerName") as HTMLInputElement | null)?.value || "");
    assert.equal(ownerNameValue, salonName, "owner panel populated from dashboard");
    console.log("PASS owner dashboard request=" + JSON.stringify(ownerDashboardHits) + " statuses=" + JSON.stringify(ownerDashboardResponses));
    await page.reload();
    await page.waitForFunction(() => (document.getElementById("ownerName") as HTMLInputElement | null)?.value?.length > 0, undefined, { timeout: 30000 });
    assert.ok(ownerDashboardResponses.filter(status => status === 200).length >= 2, "owner dashboard keeps working after reload");
    console.log("PASS owner dashboard still works normally");
    assert.deepEqual(pageErrors, [], "Unexpected page errors: " + pageErrors.join(" | "));
    console.log("OWNER_DASHBOARD_GATING = PASS");
    console.log("PROFILE_RESPONSIVE_DE_EN_AR = PASS");
  } catch (error) {
    console.error("FAIL stage=" + stage, error);
    throw error;
  } finally {
    await browser?.close();
    await prisma.salon.deleteMany({ where: { id: { in: [salonId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerId] } } });
    assert.equal(await prisma.salon.count({ where: { id: salonId } }), 0);
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, customerId] } } }), 0);
    await prisma.$disconnect();
    console.log("TEMPORARY_FIXTURE_CLEANUP = PASS");
  }
}

await main();