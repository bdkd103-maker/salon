// Run with: node tests/customer-password-reset.spec.js
// All HTTP traffic is intercepted. No backend, database or real email is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomInt, randomUUID, randomBytes } = require("node:crypto");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  for (const name of ["index.html", "women.html", "assets/customer-password-reset.js"]) {
    assert.deepEqual(fs.readFileSync(path.join(root, name)), fs.readFileSync(path.join(root, "www", name)), `${name} copies differ`);
  }
  const resetHelper = fs.readFileSync(path.join(root, "assets/customer-password-reset.js"), "utf8");
  const registrationHelper = fs.readFileSync(path.join(root, "assets/customer-registration.js"), "utf8");
  new Function(resetHelper);

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    for (const name of ["index.html", "women.html"]) {
      const html = fs.readFileSync(path.join(root, name), "utf8");
      const challengeId = randomUUID();
      const code = String(randomInt(100000, 1000000));
      const resetToken = `${challengeId}.${randomBytes(32).toString("hex")}`;
      const calls = [];
      const page = await browser.newPage();
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === `/${name}`) return route.fulfill({ contentType: "text/html", body: html });
        if (url.pathname === "/assets/customer-registration.js") return route.fulfill({ contentType: "text/javascript", body: registrationHelper });
        if (url.pathname === "/assets/customer-password-reset.js") return route.fulfill({ contentType: "text/javascript", body: resetHelper });
        if (url.pathname.includes("/api/v1/auth/password-reset/")) {
          const body = route.request().postDataJSON();
          calls.push({ path: url.pathname, body, authorization: route.request().headers().authorization });
          if (url.pathname.endsWith("/request") || url.pathname.endsWith("/resend")) {
            return json({ challengeId, status: "accepted", expiresAt: new Date(Date.now() + 600000), resendAvailableAt: new Date(Date.now() + 60000) }, 202);
          }
          if (url.pathname.endsWith("/confirm")) return body.code === code ? json({ resetToken, expiresAt: new Date(Date.now() + 600000) }) : json({ error: "Invalid reset code." }, 400);
          assert.equal(body.resetToken, resetToken);
          return json({ reset: true });
        }
        return route.abort();
      });

      await page.goto(`http://reset.test/${name}`);
      await page.evaluate(() => {
        document.documentElement.lang = "en";
        localStorage.setItem("meshwarApiAuth", JSON.stringify({ accessToken: "stale", role: "CUSTOMER" }));
        localStorage.setItem("meshwarSession", JSON.stringify({ role: "customer", userId: "customer-1" }));
        localStorage.setItem("meshwarCustomer", JSON.stringify({ id: "customer-1" }));
        localStorage.setItem("meshwarCustomerAuth", JSON.stringify({ email: "customer@example.com", password: "OldPassword123" }));
        const login = document.getElementById("customerLoginModal");
        login.classList.add("show"); login.style.display = "grid";
        document.getElementById("customerForgotPassword").click();
      });
      await page.locator("#customerResetEmail").fill("customer@example.com");
      await page.locator("#customerPasswordResetForm").evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => !document.querySelector('[data-reset-step="2"]').hidden);
      assert.equal(calls.length, 1);
      assert.match(calls[0].path, /password-reset\/request$/);
      assert.equal(calls[0].authorization, undefined);
      assert.equal(await page.locator("#customerResetResend").isDisabled(), true);

      await page.locator("#customerResetCode").fill(code);
      await page.locator("#customerPasswordResetForm").evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => !document.querySelector('[data-reset-step="3"]').hidden);
      await page.locator("#customerResetPassword").fill("ReplacementPassword123");
      await page.locator("#customerResetPasswordConfirm").fill("DifferentPassword123");
      await page.locator("#customerPasswordResetForm").evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => document.getElementById("customerResetNotice").textContent.includes("do not match"));
      assert.equal(calls.length, 2);

      await page.locator("#customerResetPasswordConfirm").fill("ReplacementPassword123");
      await page.locator("#customerPasswordResetForm").evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => document.getElementById("customerLoginModal").classList.contains("show"));
      assert.equal(calls.length, 3);
      assert.match(calls[2].path, /password-reset\/complete$/);
      assert.equal(calls.some(call => call.authorization), false);
      const browserState = await page.evaluate(() => ({
        url: location.href,
        storage: JSON.stringify(localStorage),
        auth: localStorage.getItem("meshwarApiAuth"),
        session: localStorage.getItem("meshwarSession"),
        customer: localStorage.getItem("meshwarCustomer"),
        remembered: localStorage.getItem("meshwarCustomerAuth"),
        notice: document.getElementById("customerForgotNotice").textContent,
      }));
      assert.equal(browserState.url.includes(code) || browserState.url.includes(resetToken), false);
      assert.equal(browserState.storage.includes(code) || browserState.storage.includes(resetToken), false);
      assert.equal(browserState.auth, null);
      assert.equal(browserState.session, null);
      assert.equal(browserState.customer, null);
      assert.equal(browserState.remembered, null);
      assert.match(browserState.notice, /password was changed/i);
      await page.close();
      console.log(`${name}: password reset flow, cooldown, storage and auth cleanup PASS`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
