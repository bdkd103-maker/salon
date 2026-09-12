// Run with: node tests/customer-registration.spec.js
// All HTTP traffic is intercepted. No backend, database or real email is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomInt, randomUUID, randomBytes } = require("node:crypto");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  for (const name of ["index.html", "women.html", "assets/customer-registration.js", "assets/customer-password-reset.js"]) {
    assert.deepEqual(fs.readFileSync(path.join(root, name)), fs.readFileSync(path.join(root, "www", name)), `${name} copies differ`);
  }
  const helper = fs.readFileSync(path.join(root, "assets/customer-registration.js"), "utf8");
  const resetHelper = fs.readFileSync(path.join(root, "assets/customer-password-reset.js"), "utf8");
  new Function(helper);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    for (const name of ["index.html", "women.html"]) {
      const html = fs.readFileSync(path.join(root, name), "utf8");
      for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new Function(script[1]);
      assert.equal(html.includes("generateCustomerVerificationCode"), false);
      const page = await browser.newPage();
      const code = String(randomInt(100000, 1000000));
      const challengeId = randomUUID();
      const token = `${challengeId}.${randomBytes(32).toString("hex")}`;
      const calls = [];
      let rejectDelivery = false;
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/" || url.pathname === `/${name}`) return route.fulfill({ contentType: "text/html", body: html });
        if (url.pathname === "/assets/customer-registration.js") return route.fulfill({ contentType: "text/javascript", body: helper });
        if (url.pathname === "/assets/customer-password-reset.js") return route.fulfill({ contentType: "text/javascript", body: resetHelper });
        if (url.pathname.includes("/api/v1/auth/verification/") || url.pathname.endsWith("/api/v1/auth/register")) {
          const body = route.request().postDataJSON(); calls.push({ path: url.pathname, body });
          if (/\/(request|resend)$/.test(url.pathname)) {
            if (rejectDelivery) return json({ error: "Email provider rejected the request.", code: "EMAIL_REJECTED" }, 503);
            return json({ challengeId, status: "accepted", expiresAt: new Date(Date.now() + 600000), resendAvailableAt: new Date(Date.now() + 60000) }, 202);
          }
          if (url.pathname.endsWith("/confirm")) return body.code === code ? json({ verificationToken: token, expiresAt: new Date(Date.now() + 600000) }) : json({ error: "Invalid verification code." }, 400);
          assert.equal(body.verificationToken, token);
          assert.equal(body.phone, "015123456789"); // Canonicalization belongs to the server.
          return json({ user: { id: "test-customer", role: "CUSTOMER", fullName: body.fullName, email: body.email, phone: "+4915123456789", emailVerified: true, phoneVerified: false }, accessToken: "isolated-access", refreshToken: "isolated-refresh" });
        }
        return route.abort();
      });
      await page.goto(`http://registration.test/${name}`);
      await page.evaluate(() => {
        document.documentElement.lang = "de";
        const modal = document.getElementById("customerRegisterModal");
        modal.classList.add("open"); modal.style.display = "flex";
        for (const [id, value] of Object.entries({ customerRegisterName: "Test Customer", customerRegisterPhone: "015123456789", customerRegisterEmail: "customer@example.com", customerRegisterPassword: "TestPassword123" })) document.getElementById(id).value = value;
        document.getElementById("customerGdprConsent").checked = true;
      });
      for (const width of [375, 414, 520, 600, 800, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const phone = await page.locator(".registration-phone").evaluate(el => ({ prefix: el.querySelector("span").textContent, overflow: el.scrollWidth > el.clientWidth + 1, autocomplete: el.querySelector("input").autocomplete }));
        assert.match(phone.prefix, /\+49/); assert.equal(phone.overflow, false); assert.equal(phone.autocomplete, "tel-national");
      }
      const submit = () => page.locator("#customerRegisterForm").evaluate(form => form.requestSubmit());
      console.log(name + ": submitting registration step");
      await submit();
      console.log(await page.evaluate(() => ({ notice: document.getElementById("customerRegisterNotice").textContent, helper: typeof customerRegistrationVerification, codeBox: document.getElementById("customerVerifyBox").style.display })));
      await page.waitForFunction(() => document.getElementById("customerVerifyBox").style.display === "block");
      assert.equal(calls.length, 1);
      assert.match(calls[0].path, /verification\/request$/);
      assert.equal(await page.locator("#customerSendVerifyCode").isDisabled(), true);
      await page.locator("#customerVerifyCode").fill("000000");
      console.log(name + ": submitting registration step");
      await submit();
      console.log(await page.evaluate(() => ({ notice: document.getElementById("customerRegisterNotice").textContent, helper: typeof customerRegistrationVerification, codeBox: document.getElementById("customerVerifyBox").style.display })));
      await page.waitForFunction(() => document.getElementById("customerRegisterNotice").textContent.includes("Invalid verification"));
      assert.equal(calls.length, 2); // Incorrect input does not send another email.
      await page.locator("#customerVerifyCode").fill(code);
      console.log(name + ": submitting registration step");
      await submit();
      console.log(await page.evaluate(() => ({ notice: document.getElementById("customerRegisterNotice").textContent, helper: typeof customerRegistrationVerification, codeBox: document.getElementById("customerVerifyBox").style.display })));
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("meshwarCustomer") || "null")?.id === "test-customer");
      assert.equal(calls.filter(c => c.path.endsWith("/register")).length, 1);
      const storage = await page.evaluate(() => ({ proof: localStorage.getItem("meshwarCustomerVerify"), remembered: localStorage.getItem("meshwarCustomerAuth"), content: JSON.stringify(localStorage) }));
      assert.equal(storage.proof, null); assert.equal(storage.remembered, null); assert.equal(storage.content.includes(token), false);
      rejectDelivery = true;
      await page.evaluate(() => {
        document.getElementById("customerRegisterEmail").value = "other@example.com";
        document.getElementById("customerRegisterEmail").dispatchEvent(new Event("input"));
      });
      console.log(name + ": submitting registration step");
      await submit();
      console.log(await page.evaluate(() => ({ notice: document.getElementById("customerRegisterNotice").textContent, helper: typeof customerRegistrationVerification, codeBox: document.getElementById("customerVerifyBox").style.display })));
      await page.waitForFunction(() => document.getElementById("customerRegisterNotice").textContent.includes("provider rejected"));
      assert.equal(calls.filter(c => c.path.endsWith("/register")).length, 1);
      assert.match(calls.at(-1).path, /verification\/request$/);
      await page.close();
      console.log(`${name}: verification flow, provider failure, email changes, phone layout at six widths PASS`);
    }
    console.log("Frontend syntax and root/www synchronization PASS");
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
