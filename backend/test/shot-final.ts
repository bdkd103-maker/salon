// Final visual capture: node_modules/.bin/tsx test/shot-final.ts (from backend).
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();
const site = "http://localhost:8000";
const out = "../shotcheck";

async function main() {
  const { prisma } = await import("../src/lib/prisma.js");
  const { hashPassword } = await import("../src/lib/auth.js");
  const adminId = randomUUID();
  const password = randomUUID() + "Aa1!";
  const email = `salo-final-${adminId}@example.invalid`;
  let browser: any;
  try {
    await prisma.user.create({ data: { id: adminId, email, passwordHash: await hashPassword(password), role: "ADMIN", status: "ACTIVE", emailVerified: true, fullName: "SALO FINAL", phone: "+4917612345678" } });
    browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 15000, args: ["--no-proxy-server"] });
    const context = await browser.newContext({ viewport: { width: 768, height: 1000 } });
    await context.route("**/*", (r: any) => ["localhost", "127.0.0.1"].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.message));

    await page.goto(site + "/admin/", { waitUntil: "domcontentloaded" });
    await page.locator("#login-form input[name=email]").fill(email);
    await page.locator("#login-form input[name=password]").fill(password);
    await page.locator("#login-form button[type=submit]").click();
    await page.locator("#workspace").waitFor({ state: "visible" });
    const nav = page.locator('nav a[href="#settings"]');
    const toggle = page.locator("#menu-toggle");
    const openSettings = async () => {
      if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await nav.click();
      await page.locator("#settings-form").waitFor();
    };
    await openSettings();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/admin-settings-768-v2.png`, timeout: 15000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await openSettings();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/admin-settings-390-v2.png`, timeout: 15000 });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(site + "/", { waitUntil: "domcontentloaded" });
    if (await page.locator("#cookieReject").isVisible()) await page.locator("#cookieReject").click();
    await page.locator("#languageSelect").selectOption("en");
    await page.waitForSelector("#regularSalonGrid article", { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/home-1920-v2.png`, timeout: 15000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/home-390-v2.png`, timeout: 15000 });

    console.log("errors=" + JSON.stringify(errors));
    console.log("FINAL_SHOTS = YES");
  } finally {
    await browser?.close();
    await prisma.session.deleteMany({ where: { userId: adminId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
