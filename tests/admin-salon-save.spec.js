// Run with: node tests/admin-salon-save.spec.js
// All HTTP traffic is intercepted. No backend or database is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const registrationHelper = fs.readFileSync(path.join(root, "assets", "customer-registration.js"), "utf8");
  const resetHelper = fs.readFileSync(path.join(root, "assets", "customer-password-reset.js"), "utf8");
  const patchCalls = [];

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("meshwarSelectedExperience", "men");
      localStorage.setItem("meshwarLang", "de");
      localStorage.setItem("meshwarApiAuth", JSON.stringify({ accessToken: "admin-access", userId: "admin-1", role: "ADMIN" }));
    });
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/index.html" && request.frame() === page.mainFrame()) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/index.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview disabled</title>" });
      if (url.pathname === "/assets/customer-registration.js") return route.fulfill({ contentType: "text/javascript", body: registrationHelper });
      if (url.pathname === "/assets/customer-password-reset.js") return route.fulfill({ contentType: "text/javascript", body: resetHelper });
      if (url.pathname === "/api/v1/salons/salon-1" && request.method() === "PATCH") {
        const payload = request.postDataJSON();
        patchCalls.push(payload);
        if (payload.name === "Reject Salon") {
          return json({ error: "Invalid payload", details: { fieldErrors: { address: ["String must contain at least 5 character(s)"] }, formErrors: [] } }, 400);
        }
        return json({ salon: { id: "salon-1", ownerId: "owner-1", ...payload, services: [], media: [], reviews: [] } });
      }
      if (url.pathname === "/api/v1/salons") return json({ salons: [] });
      if (url.pathname.startsWith("/api/")) return json({});
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("http://admin-save.test/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.documentElement.lang = "de";
      localStorage.setItem("meshwarLang", "de");
      activeOwnerId = "salon-1";
      data = normalizeSalon({
        id: "salon-1",
        ownerId: "owner-1",
        name: "Test Salon",
        city: "Berlin",
        address: "Hauptstrasse 10",
        phone: "+49301234567",
        email: "salon@example.com",
        openingTime: "09:00",
        closingTime: "19:00",
        workingDays: ["mon", "tue", "wed", "thu", "fri"],
        timeZone: "Europe/Berlin",
        services: []
      });
      const values = {
        adminName: "Test Salon",
        adminEmail: "salon@example.com",
        adminCity: "Berlin",
        adminAddress: "Hauptstrasse 10",
        adminPhone: "+49301234567",
        adminOpenTime: "09:00",
        adminCloseTime: "19:00",
        adminTimeZone: "Europe/Berlin",
        adminTotalChairs: "5",
        adminAvailableChairs: "2"
      };
      for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
      for (const day of ["mon", "tue", "wed", "thu", "fri"]) {
        document.querySelector(`input[name="adminWorkingDay"][value="${day}"]`).checked = true;
      }
    });

    const submitWithPassword = async password => {
      await page.locator("#ownerPassword").evaluate((input, value) => { input.value = value; }, password);
      await page.locator("#adminForm").evaluate(form => form.requestSubmit());
    };

    await submitWithPassword("short7");
    await page.waitForFunction(() => document.getElementById("ownerPassword").validationMessage.length > 0);
    assert.equal(patchCalls.length, 0, "a short password must be blocked before the API request");
    assert.match(await page.locator("#ownerPassword").evaluate(input => input.validationMessage), /8.*128/);

    await submitWithPassword("x".repeat(129));
    await page.waitForFunction(() => document.getElementById("ownerPassword").validationMessage.length > 0);
    assert.equal(patchCalls.length, 0, "an overlong password must be blocked before the API request");

    const whitespaceResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/salons/salon-1") && response.request().method() === "PATCH");
    await submitWithPassword("   ");
    await whitespaceResponse;
    assert.equal(Object.hasOwn(patchCalls[0], "ownerPassword"), false, "whitespace-only password must be omitted");

    const blankResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/salons/salon-1") && response.request().method() === "PATCH");
    await submitWithPassword("");
    await blankResponse;
    assert.equal(Object.hasOwn(patchCalls[1], "ownerPassword"), false, "blank password must be omitted");

    const validResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/salons/salon-1") && response.request().method() === "PATCH");
    await submitWithPassword("OwnerPass123");
    await validResponse;
    assert.equal(patchCalls[2].ownerPassword, "OwnerPass123");

    await page.locator("#adminName").evaluate(input => { input.value = "Reject Salon"; });
    const rejectedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/salons/salon-1") && response.status() === 400);
    await submitWithPassword("");
    await rejectedResponse;
    await page.waitForFunction(() => document.getElementById("adminNotice").textContent.includes("Salondaten"));
    const notice = await page.locator("#adminNotice").textContent();
    assert.match(notice, /Die Salondaten sind ungültig/);
    assert.match(notice, /Adresse/);
    assert.equal(notice.includes("بيانات الحجز"), false);

    const localizedMessages = await page.evaluate(() => {
      const error = { status: 400, details: { fieldErrors: { address: ["invalid"] } } };
      return Object.fromEntries(["de", "en", "ar"].map(language => {
        document.documentElement.lang = language;
        return [language, getAdminSalonValidationMessage(error)];
      }));
    });
    assert.match(localizedMessages.de, /Salondaten.*Adresse/);
    assert.match(localizedMessages.en, /salon details.*address/i);
    assert.match(localizedMessages.ar, /بيانات الصالون.*العنوان/);

    console.log("Admin salon PATCH password validation and German field-error handling PASS");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
