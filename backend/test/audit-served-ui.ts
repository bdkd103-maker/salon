// Served-UI audit: node_modules/.bin/tsx test/audit-served-ui.ts (from backend).
// Loads the real pages on :8000, records console/page errors, HTTP >=400,
// broken images, horizontal overflow and section ordering at five widths.
import { chromium } from "playwright";

const site = "http://localhost:8000";
const widths = [1920, 1366, 768, 390, 320];

type Report = Record<string, unknown>;

async function auditPage(page: any, url: string, width: number, setup?: (p: any) => Promise<void>) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  const failedRequests: string[] = [];
  const onConsole = (m: any) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); };
  const onPageError = (e: any) => pageErrors.push(String(e.message).slice(0, 200));
  const onResponse = (r: any) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 140)}`); };
  const onRequestFailed = (r: any) => failedRequests.push(`${r.url().slice(0, 140)} ${r.failure()?.errorText || ""}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  try {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (await page.locator("#cookieReject").isVisible().catch(() => false)) await page.locator("#cookieReject").click();
    await page.waitForTimeout(1200);
    if (setup) await setup(page);
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - window.innerWidth;
      const wide: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2)) {
          const id = el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
          if (!wide.includes(id)) wide.push(id);
          if (wide.length >= 8) break;
        }
      }
      const brokenImages = Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0 && !/\.svg($|\?)/i.test(i.currentSrc || i.src))
        .map((i) => (i.currentSrc || i.src).slice(0, 120));
      const sections = ["#heroSearchInput", "#regularSalonGrid", "#experienceGate"];
      const pos: Record<string, number> = {};
      for (const s of sections) {
        const el = document.querySelector(s);
        if (el) pos[s] = Math.round(el.getBoundingClientRect().top + window.scrollY);
      }
      const marketing: Record<string, number> = {};
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("section[id], div[id]"))) {
        if (/vip|discover-by|about|network|apply/i.test(el.id)) marketing[el.id] = Math.round(el.getBoundingClientRect().top + window.scrollY);
      }
      return { overflow, wide, brokenImages, pos, marketing, height: doc.scrollHeight, title: document.title };
    });
    return { url, width, ...info, consoleErrors, pageErrors, badResponses, failedRequests };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 15000, args: ["--no-proxy-server"] });
  const context = await browser.newContext();
  await context.route("**/*", (r: any) => ["localhost", "127.0.0.1"].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
  const report: Report = { home: [] as any[], admin: [] as any[] };
  for (const width of widths) {
    (report.home as any[]).push(await auditPage(page, site + "/", width, async (p) => {
      if (await p.locator("#languageSelect").isVisible().catch(() => false)) await p.locator("#languageSelect").selectOption("en");
      await p.waitForTimeout(800);
    }));
  }
  (report.homeSummary as any) = (report.home as any[]).map((r: any) => ({
    width: r.width, overflow: r.overflow, height: r.height,
    consoleErrors: r.consoleErrors.length, pageErrors: r.pageErrors.length,
    badResponses: r.badResponses, failedRequests: r.failedRequests.length,
    brokenImages: r.brokenImages, wide: r.wide, pos: r.pos, marketing: r.marketing
  }));
  for (const width of widths) {
    (report.admin as any[]).push(await auditPage(page, site + "/admin/", width));
  }
  (report.adminSummary as any) = (report.admin as any[]).map((r: any) => ({
    width: r.width, overflow: r.overflow, height: r.height,
    consoleErrors: r.consoleErrors, pageErrors: r.pageErrors,
    badResponses: r.badResponses, failedRequests: r.failedRequests, wide: r.wide
  }));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
