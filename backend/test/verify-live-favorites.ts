// Run from backend: node_modules/.bin/tsx test/verify-live-favorites.ts
// Requires the local servers: static host on :8000 and API on :4000.
// Real browser end-to-end for the authenticated customer favorites / Lieblingssalon
// system: homepage heart, women page heart, customer profile section, login gate,
// persistence across logout/login, empty and error states, responsive widths and
// DE/EN/AR (RTL) copy. Opt-in standalone verification; never run with unit tests.
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
  return target.pathname.slice(1);
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
  const ownerId = `salo-fav-owner-${suffix}`;
  const customerId = `salo-fav-customer-${suffix}`;
  const salonId = randomUUID();
  const womenSalonId = randomUUID();
  const ownerEmail = `salo-fav-owner-${suffix}@example.invalid`;
  const customerEmail = `salo-fav-customer-${suffix}@example.invalid`;
  const salonName = `SALO FAV ${suffix}`;
  const womenSalonName = `SALO FAV WOMEN ${suffix}`;
  const favoriteIds = [salonId, womenSalonId];
  let browser: any;
  let stage = "preflight";
  let client: any = null;
  const pageErrors: string[] = [];
    const apiLog: string[] = [];
    let lastRateLimitAt = 0;

  try {
    assert.equal(await probe(api + "/health"), 200);
    assert.equal(await probe(site + "/index.html"), 200);
    assert.equal(await probe(site + "/women.html"), 200);
    assert.equal(await probe(site + "/customer-profile.html"), 200);

    stage = "fixtures";
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, customerId] } } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: { in: favoriteIds } } }), 0);
    await prisma.customerFavorite.deleteMany({ where: { salonId: { in: favoriteIds } } });
    const passwordHash = await hashPassword(password);
    await prisma.user.createMany({ data: [
      { id: ownerId, email: ownerEmail, fullName: "FAV Owner", role: "OWNER", emailVerified: true, passwordHash },
      { id: customerId, email: customerEmail, fullName: "FAV Customer", role: "CUSTOMER", emailVerified: true, passwordHash },
    ]});
    await prisma.salon.create({ data: {
      id: salonId, ownerId, name: salonName, slug: `salo-fav-${suffix}`, city: "Berlin",
      address: "FAV Strasse 1, 10115 Berlin", phone: "+49302222222",
      openingTime: "09:00", closingTime: "18:00",
      workingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      timeZone: "Europe/Berlin",
    }});
    await prisma.salon.create({ data: {
      id: womenSalonId, ownerId, name: womenSalonName, slug: `salo-fav-w-${suffix}`, city: "Berlin",
      address: "FAV Frauenstrasse 2, 10115 Berlin", phone: "+49303333333",
      openingTime: "10:00", closingTime: "17:00",
      workingDays: ["mon", "tue", "wed", "thu", "fri"],
      timeZone: "Europe/Berlin", isWomenOnly: true,
    }});

    browser = await chromium.launch({ headless: true, channel: "msedge" });
    client = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await client.addInitScript(() => {
      if (!localStorage.getItem("meshwarLang")) localStorage.setItem("meshwarLang", "de");
      localStorage.setItem("salonkCookieConsent", "rejected");
      localStorage.setItem("meshwarSelectedExperience", "men");
      sessionStorage.setItem("meshwarEntryChoiceSeen", "true");
    });
    await client.route("**/*", route => {
      const u = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const page = await client.newPage();
    page.on("pageerror", error => { pageErrors.push(error.message); console.log("PAGE_ERROR", error.message); });
    page.on("dialog", async dialog => { pageErrors.push("dialog:" + dialog.message()); await dialog.dismiss(); });
    page.on("response", r => {
      if (!r.url().includes("/api/v1/")) return;
      const status = r.status();
      if (status >= 400) apiLog.push(status + " " + new URL(r.url()).pathname);
      if (status === 429) lastRateLimitAt = Date.now();
    });

    const favoriteCount = () => prisma.customerFavorite.count({ where: { salonId: { in: favoriteIds } } });

    // The API enforces a global 100 requests/minute budget for this host; the
    // suite is chatty, so back off whenever the window was hit instead of
    // treating a transient 429 as a product failure.
    const waitForRateWindow = async () => {
      if (!lastRateLimitAt) return;
      const wait = 61000 - (Date.now() - lastRateLimitAt);
      if (wait > 0) {
        console.log("WAIT rate-limit window " + Math.ceil(wait / 1000) + "s");
        await new Promise(resolve => setTimeout(resolve, wait));
      }
      lastRateLimitAt = 0;
    };

    stage = "unauthenticated homepage gate";
    await page.goto(site + "/index.html");
    const heart = page.locator(`[data-favorite="${salonId}"]`);
    await heart.waitFor({ timeout: 25000 });
    assert.equal(await heart.getAttribute("aria-pressed"), "false");
    await heart.click();
    await page.locator("#customerLoginModal.show").waitFor({ timeout: 10000 });
    assert.equal(await favoriteCount(), 0, "unauthenticated favorite attempt must not persist");
    await page.locator("#customerLoginModal .close").click();
    console.log("PASS unauthenticated heart opens the login gate and persists nothing");

    stage = "customer login on homepage";
    await page.evaluate(() => openCustomerLogin());
    await page.locator("#customerLoginEmail").fill(customerEmail);
    await page.locator("#customerLoginPassword").fill(password);
    const [login] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login")),
      page.locator("#customerLoginSubmit").click(),
    ]);
    assert.equal(login.status(), 200);
    await page.waitForFunction(() => !document.querySelector("#customerLoginModal.show"), undefined, { timeout: 15000 });
    console.log("PASS customer login");

    stage = "favorite on homepage";
    const addSeen = page.waitForResponse(r => r.url().includes("/api/v1/favorites") && r.request().method() === "POST" && r.status() === 200);
    await heart.click();
    await addSeen;
    await page.waitForFunction(id => document.querySelector(`[data-favorite="${id}"]`)?.getAttribute("aria-pressed") === "true",
      salonId, { timeout: 15000 });
    assert.equal(await prisma.customerFavorite.count({ where: { userId: customerId, salonId } }), 1, "single row after favorite");

    stage = "favorite state persists across reload";
    await page.reload();
    await page.locator(`[data-favorite="${salonId}"]`).waitFor({ timeout: 25000 });
    await page.waitForFunction(id => document.querySelector(`[data-favorite="${id}"]`)?.getAttribute("aria-pressed") === "true",
      salonId, { timeout: 20000 });
    console.log("PASS homepage favorite persists across a reload");

    stage = "favorite on women page";
    await page.goto(site + "/women.html");
    const womenHeart = page.locator(`[data-favorite-salon="${womenSalonId}"]`);
    await womenHeart.waitFor({ timeout: 25000 });
    assert.equal(await womenHeart.getAttribute("aria-pressed"), "false");
    const womenAddSeen = page.waitForResponse(r => r.url().includes("/api/v1/favorites") && r.request().method() === "POST" && r.status() === 200);
    await womenHeart.click();
    await womenAddSeen;
    await page.waitForFunction(id => document.querySelector(`[data-favorite-salon="${id}"]`)?.getAttribute("aria-pressed") === "true",
      womenSalonId, { timeout: 15000 });
    assert.equal(await prisma.customerFavorite.count({ where: { salonId: { in: favoriteIds } } }), 2, "both salons favorited");

    stage = "customer profile section";
    await page.goto(site + "/customer-profile.html");
    await page.locator("#favoriteSalonsCard").waitFor({ timeout: 25000 });
    await page.waitForFunction(() => document.getElementById("favoriteSalonsCount")?.textContent?.trim() === "2",
      undefined, { timeout: 25000 });
    assert.ok(await page.getByText(salonName, { exact: false }).count() >= 1, "profile lists the homepage salon");
    assert.ok(await page.getByText(womenSalonName, { exact: false }).count() >= 1, "profile lists the women salon");
    console.log("PASS profile section renders both favorites");

    stage = "profile remove favorite";
    const removeSeen = page.waitForResponse(r => r.url().includes("/api/v1/favorites/") && r.request().method() === "DELETE" && r.status() === 200);
    await page.locator(`[data-remove-favorite="${womenSalonId}"]`).click();
    await removeSeen;
    await page.waitForFunction(() => document.getElementById("favoriteSalonsCount")?.textContent?.trim() === "1",
      undefined, { timeout: 15000 });
    assert.equal(await prisma.customerFavorite.count({ where: { salonId: { in: favoriteIds } } }), 1, "removed row is gone from the database");

    stage = "profile open favorite deep link";
    await page.locator(`[data-open-favorite="${salonId}"]`).click();
    await page.waitForURL(new RegExp(`#salon-${salonId}$`), { timeout: 15000 });
    await page.locator("#salonProfileModal.show").waitFor({ timeout: 25000 });
    assert.ok((await page.locator("#salonProfileContent").textContent() || "").length > 0);
    console.log("PASS profile open action deep-links to the salon profile");

    stage = "logout and login persistence";
    await page.goto(site + "/index.html");
    await page.locator(`[data-favorite="${salonId}"]`).waitFor({ timeout: 25000 });
    await page.evaluate(() => logout("customer"));
    await page.waitForFunction(id => document.querySelector(`[data-favorite="${id}"]`)?.getAttribute("aria-pressed") !== "true",
      salonId, { timeout: 15000 });
    assert.equal(await prisma.customerFavorite.count({ where: { userId: customerId, salonId } }), 1, "logout must not delete favorites");
    await page.evaluate(() => openCustomerLogin());
    await page.locator("#customerLoginEmail").fill(customerEmail);
    await page.locator("#customerLoginPassword").fill(password);
    const [relogin] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login")),
      page.locator("#customerLoginSubmit").click(),
    ]);
    assert.equal(relogin.status(), 200);
    await page.waitForFunction(id => document.querySelector(`[data-favorite="${id}"]`)?.getAttribute("aria-pressed") === "true",
      salonId, { timeout: 25000 });
    console.log("PASS favorites survive logout and return after a fresh login");

    stage = "profile empty state";
    await page.goto(site + "/customer-profile.html");
    await page.locator(`[data-remove-favorite="${salonId}"]`).waitFor({ timeout: 25000 });
    const lastRemoveSeen = page.waitForResponse(r => r.url().includes("/api/v1/favorites/") && r.request().method() === "DELETE" && r.status() === 200);
    await page.locator(`[data-remove-favorite="${salonId}"]`).click();
    await lastRemoveSeen;
    await page.waitForFunction(() => document.getElementById("favoriteSalonsCount")?.textContent?.trim() === "0",
      undefined, { timeout: 15000 });
    const emptyText = (await page.locator("#favoriteSalonsList").textContent() || "").trim();
    assert.ok(emptyText.length > 0, "empty state shows copy");
    assert.equal(await favoriteCount(), 0);
    console.log("PASS profile empty state");

    stage = "profile error state";
    const errorPage = await client.newPage();
    errorPage.on("pageerror", error => pageErrors.push(error.message));
    await errorPage.route("**/api/v1/favorites", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
    await errorPage.goto(site + "/customer-profile.html");
    await errorPage.locator("#favoriteSalonsRetryButton").waitFor({ timeout: 30000 });
    const errorText = (await errorPage.locator("#favoriteSalonsList").textContent() || "").trim();
    assert.ok(errorText.length > 0, "error state shows copy");
    await errorPage.close();
    console.log("PASS profile error state with retry action");

    stage = "responsive widths";
    await waitForRateWindow();
    const widths = [1920, 1366, 768, 390, 320];
    const overflowLog: string[] = [];
    const measureOverflow = async (selector: string) => {
      const withCard = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      const withoutCard = await page.evaluate(sel => {
        const el = document.querySelector(sel) as HTMLElement | null;
        const previous = el ? el.style.display : "";
        if (el) el.style.display = "none";
        const value = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
        if (el) el.style.display = previous;
        return value;
      }, selector);
      return { withCard, withoutCard };
    };
    const sweepPage = async (path: string, label: string, heartSelector: string | null) => {
      await page.goto(site + path);
      await page.waitForTimeout(1200);
      if (heartSelector) {
        await page.locator(heartSelector).first().waitFor({ state: "attached", timeout: 25000 });
      } else {
        await page.locator("#favoriteSalonsCard").waitFor({ timeout: 25000 });
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(350);
        if (heartSelector && !(await page.locator(heartSelector).first().isVisible())) {
          throw new Error(`DIAG ${label} heartHidden at ${width}px grid=${await page.locator("#regularSalonGrid article").count()} api=${JSON.stringify(apiLog.slice(-6))}`);
        }
        const overflow = await measureOverflow(heartSelector ?? "#favoriteSalonsCard");
        assert.ok(overflow.withCard <= 2,
          `${label} horizontal overflow at ${width}px: ${overflow.withCard}px`);
        assert.ok(overflow.withCard <= overflow.withoutCard + 2,
          `${label} favorites add overflow at ${width}px: ${overflow.withCard} vs ${overflow.withoutCard}`);
        overflowLog.push(`${label} ${width}: ${overflow.withCard}/${overflow.withoutCard}`);
      }
    };
    await sweepPage("/index.html", "index", `[data-favorite="${salonId}"]`);
    await sweepPage("/women.html", "women", `[data-favorite-salon="${womenSalonId}"]`);
    await sweepPage("/customer-profile.html", "profile", null);
    await page.setViewportSize({ width: 1366, height: 900 });
    console.log("OVERFLOW_WITH/WITHOUT_FAVORITES", JSON.stringify(overflowLog));
    console.log("PASS favorites controls render without added horizontal overflow at 1920/1366/768/390/320");

    stage = "language switch de/en/ar";
    await waitForRateWindow();
    const languageExpectations: Array<[string, string, string]> = [
      ["de", "Deine Lieblingssalons", "ltr"],
      ["en", "Your favorite salons", "ltr"],
      ["ar", "صالوناتي المفضلة", "rtl"],
    ];
    for (const [lang, title, direction] of languageExpectations) {
      await page.goto(site + "/customer-profile.html");
      await page.evaluate(code => localStorage.setItem("meshwarLang", code), lang);
      await page.reload();
      try {
        await page.locator("#favoriteSalonsCard").waitFor({ timeout: 25000 });
      } catch (cardError) {
        const diag = {
          lang,
          url: page.url(),
          cardCount: await page.locator("#favoriteSalonsCard").count(),
          profilePageVisible: await page.locator("#customerProfilePage").isVisible().catch(() => false),
          loginWall: await page.locator("#customerLoginModal").isVisible().catch(() => false),
          api: apiLog.slice(-8),
          pageErrors: pageErrors.slice(-3),
          body: (await page.locator("body").innerText()).slice(0, 400).replace(/\s+/g, " ")
        };
        throw new Error(`DIAG language card=${JSON.stringify(diag)} caused=${String(cardError)}`);
      }
      await page.waitForFunction(expected => document.getElementById("favoriteSalonsTitle")?.textContent?.trim() === expected,
        title, { timeout: 15000 });
      assert.equal(await page.evaluate(() => document.documentElement.dir), direction, `direction for ${lang}`);
      assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
    }
    await page.evaluate(() => localStorage.setItem("meshwarLang", "de"));
    console.log("PASS profile favorites copy in DE/EN/AR with correct RTL direction");

    const favoriteFailures = apiLog.filter(entry => entry.includes("/api/v1/favorites") && !entry.startsWith("401"));
    assert.deepEqual(favoriteFailures, [], "Favorites request failed: " + favoriteFailures.join(" | "));
    assert.deepEqual(pageErrors, [], "Unexpected page errors: " + pageErrors.join(" | "));
    console.log("API_NON_2XX", JSON.stringify(apiLog));
    console.log("FAVORITES_REAL_BROWSER = PASS");
  } catch (error) {
    console.error("FAIL stage=" + stage, error);
    throw error;
  } finally {
    await browser?.close();
    await prisma.customerFavorite.deleteMany({ where: { OR: [{ userId: customerId }, { salonId: { in: favoriteIds } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: [ownerId, customerId] } } });
    await prisma.salon.deleteMany({ where: { id: { in: favoriteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerId] } } });
    assert.equal(await prisma.customerFavorite.count({ where: { OR: [{ userId: customerId }, { salonId: { in: favoriteIds } }] } }), 0);
    assert.equal(await prisma.salon.count({ where: { id: { in: favoriteIds } } }), 0);
    assert.equal(await prisma.user.count({ where: { id: { in: [ownerId, customerId] } } }), 0);
    await prisma.$disconnect();
    console.log("TEMPORARY_FIXTURE_CLEANUP = PASS");
  }
}

await main();
