// Desktop visual capture: node_modules/.bin/tsx test/shot-desktop.ts (from backend).
// Requires static host on :8000 and API on :4000. Creates one temporary ADMIN,
// screenshots the served admin Settings page and homepage at 1366/1920, then removes it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { chromium } from "playwright";

function databaseGuard() {
  dotenv.config();
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL ?? ""); } catch {
    console.error("Database safety guard: REJECTED; zero writes");
    throw new Error("Unsafe configuration");
  }
  const safe = ["postgresql:", "postgres:"].includes(target.protocol)
    && ["localhost", "127.0.0.1"].includes(target.hostname)
    && (target.port || "5432") === "5432"
    && target.pathname === "/salon"
    && (!process.env.NODE_ENV || /^(development|dev|test|testing|local)$/i.test(process.env.NODE_ENV));
  if (!safe) { console.error("SAFE LOCAL TARGET = NO; zero writes"); throw new Error("guard"); }
  console.log("SAFE LOCAL TARGET = YES");
}

const api = "http://localhost:4000";
const site = "http://localhost:8000";

async function main() {
  databaseGuard();
  const { prisma } = await import("../src/lib/prisma.js");
  const { hashPassword } = await import("../src/lib/auth.js");
  const adminId = randomUUID();
  const password = randomUUID() + "Aa1!";
  const email = `salo-shot-${adminId}@example.invalid`;
  let browser: any;
  try {
    const hash = await hashPassword(password);
    await prisma.user.create({ data: { id: adminId, email, passwordHash: hash, role: "ADMIN", status: "ACTIVE", emailVerified: true, fullName: "SALO SHOT", phone: "+4917612345678" } });
    browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 15000, args: ["--no-proxy-server"] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 950 } });
    await context.route("**/*", (route: any) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.message));

    await page.goto(site + "/admin/", { waitUntil: "domcontentloaded" });
    await page.locator("#login-form input[name=email]").fill(email);
    await page.locator("#login-form input[name=password]").fill(password);
    await page.locator("#login-form button[type=submit]").click();
    await page.locator("#workspace").waitFor({ state: "visible" });
    await page.locator('nav a[href="#settings"]').click();
    await page.locator("#settings-form").waitFor();
    await page.screenshot({ path: "../.tmp-admin-settings-1366.png", fullPage: true, timeout: 15000 });
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.screenshot({ path: "../.tmp-admin-settings-1920.png", fullPage: true, timeout: 15000 });
    console.log("SHOT admin settings 1366 + 1920");

    await page.setViewportSize({ width: 1366, height: 950 });
    await page.goto(site + "/", { waitUntil: "domcontentloaded" });
    if (await page.locator("#cookieReject").isVisible()) await page.locator("#cookieReject").click();
    await page.locator("#languageSelect").selectOption("en");
    await page.waitForTimeout(600);
    await page.screenshot({ path: "../.tmp-home-1366-top.png", timeout: 15000 });
    await page.screenshot({ path: "../.tmp-home-1366-full.png", fullPage: true, timeout: 20000 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "../.tmp-home-1920-top.png", timeout: 15000 });
    console.log("SHOT homepage 1366 + 1920");
    assert.deepEqual(errors, [], "No page errors");
    console.log("SHOT_COMPLETE = YES");
  } finally {
    await browser?.close();
    await prisma.session.deleteMany({ where: { userId: adminId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
