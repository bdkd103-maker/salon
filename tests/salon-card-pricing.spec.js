// Run with: node tests/salon-card-pricing.spec.js
// All HTTP traffic is intercepted. No backend or database is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const wwwHtml = fs.readFileSync(path.join(root, "www", "index.html"), "utf8");
  assert.deepEqual(Buffer.from(html), Buffer.from(wwwHtml), "index.html copies differ");
  assert.equal(/offer:\s*\{[^}]*price\s*:\s*120/i.test(html), false);
  assert.equal(html.includes('offer:{ title:"", description:"", price:0, active:false }'), true);

  const registrationHelper = fs.readFileSync(path.join(root, "assets", "customer-registration.js"), "utf8");
  const resetHelper = fs.readFileSync(path.join(root, "assets", "customer-password-reset.js"), "utf8");
  const salons = [
    {
      id: "regular-no-offer",
      name: "Plain Cut",
      city: "Berlin",
      address: "Plainstrasse 1",
      phone: "+4930111111",
      role: "PUBLIC",
      status: "quiet",
      rating: 4.5,
      ratingCount: 12,
      totalChairs: 5,
      availableChairs: 2,
      customServices: [{ name: "Precision Cut", price: 31 }],
      services: [
        { id: "precision", name: "Precision Cut", price: 31, durationMin: 30, isActive: true },
        { id: "hidden", name: "Hidden Service", price: 1, durationMin: 30, isActive: false }
      ],
      bookings: [{ id: "booking-1", service: "Precision Cut", price: 31 }],
      loyaltyCard: { title: "Cut Club", requiredStamps: 8, currentStamps: 3, rewardTitle: "Free Cut" }
    },
    {
      id: "vip-real-offer",
      name: "Offer House",
      city: "Berlin",
      address: "Offerstrasse 2",
      phone: "+4930222222",
      adminVip: true,
      isVip: true,
      rating: 4.8,
      ratingCount: 30,
      totalChairs: 6,
      availableChairs: 3,
      offer: { title: "Real Beard Offer", description: "Owner saved 15% deal", price: 37, active: true },
      customServices: [{ name: "Beard Ritual", price: 44 }],
      services: [{ name: "Beard Ritual", price: 44 }],
      flashDeal: { title: "Real Flash Deal", description: "Today only", price: 29, active: true, availableSlots: 2, service: "Beard Ritual" }
    },
    {
      id: "boosted-no-offer",
      name: "Boosted Studio",
      city: "Berlin",
      address: "Booststrasse 3",
      phone: "+4930333333",
      boostStatus: "ACTIVE",
      boosted: true,
      rating: 4.7,
      ratingCount: 20,
      totalChairs: 4,
      availableChairs: 1,
      customServices: [{ name: "Fade", price: 28 }]
    }
  ];
  const serviceRequests = [];
  const ownerServices = {
    "owner-overflow": Array.from({ length: 6 }, (_, index) => ({
      id: `overflow-${index + 1}`,
      name: `Real Service ${index + 1}`,
      price: 20 + index,
      durationMin: 30,
      isActive: true
    })).concat({ id: "inactive-existing", name: "Inactive Existing", price: 9, durationMin: 30, isActive: false }),
    "owner-empty": []
  };

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(initialSalons => {
      localStorage.setItem("meshwarSelectedExperience", "men");
      localStorage.setItem("meshwarLang", "en");
      localStorage.setItem("meshwarSalons", JSON.stringify(initialSalons));
    }, salons);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/index.html" && route.request().frame() === page.mainFrame()) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/index.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview disabled in test</title>" });
      if (url.pathname === "/assets/customer-registration.js") return route.fulfill({ contentType: "text/javascript", body: registrationHelper });
      if (url.pathname === "/assets/customer-password-reset.js") return route.fulfill({ contentType: "text/javascript", body: resetHelper });
      if (url.pathname === "/api/v1/salons") return json({ salons });
      const serviceRoute = url.pathname.match(/^\/api\/v1\/salons\/(owner-[^/]+)\/services(?:\/([^/]+))?$/);
      if (serviceRoute) {
        const [, salonId, serviceId] = serviceRoute;
        const method = route.request().method();
        if (method === "GET") return json({ services: ownerServices[salonId] || [] });
        const payload = route.request().postDataJSON();
        serviceRequests.push({ method, salonId, serviceId: serviceId || null, payload });
        if (method === "POST") {
          const service = { id: "created-service", durationMin: 30, isActive: true, ...payload };
          ownerServices[salonId].push(service);
          return json({ service });
        }
        if (method === "PATCH") {
          const index = ownerServices[salonId].findIndex(service => service.id === serviceId);
          ownerServices[salonId][index] = { ...ownerServices[salonId][index], ...payload };
          return json({ service: ownerServices[salonId][index] });
        }
        return json({ deleted: true });
      }
      if (url.pathname.startsWith("/api/")) return json({});
      return route.fulfill({ status: 204, body: "" });
    });

    console.log("Loading intercepted salon directory");
    await page.goto("http://salon-card.test/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".salon-card").length === 4, null, { timeout: 10000 });
    console.log("Directory cards rendered");
    await page.waitForFunction(() => document.querySelectorAll(".top-barber-card").length === 3, null, { timeout: 10000 });
    console.log("Top-ranked cards rendered");

    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".salon-card")];
      const byName = name => cards.find(card => card.textContent.includes(name));
      const plain = byName("Plain Cut");
      const offered = byName("Offer House");
      const boosted = byName("Boosted Studio");
      const normalizedOffer = normalizeSalon({
        id: "preserved",
        name: "Preserved",
        city: "Berlin",
        address: "Test 1",
        offer: { title: "Saved Offer", description: "Saved Description", price: 37, active: true },
        services: [{ name: "Saved Service", price: 52 }],
        bookings: [{ id: "saved-booking", price: 52 }]
      });
      const normalizedEmpty = normalizeSalon({ id: "empty", name: "Empty", city: "Berlin", address: "Test 2" });
      return {
        cardCount: cards.length,
        cardPriceCount: document.querySelectorAll(".salon-card .salon-card-price").length,
        topWalletCount: document.querySelectorAll(".top-barber-card .fa-wallet").length,
        directoryText: cards.map(card => card.textContent).join(" "),
        topText: document.getElementById("topBarberList").textContent,
        plainOffer: plain?.querySelector(".salon-offer-banner")?.textContent || "",
        boostedOffer: boosted?.querySelector(".salon-offer-banner")?.textContent || "",
        realOffer: offered?.querySelector(".salon-offer-banner")?.textContent || "",
        realFlash: offered?.querySelector(".salon-card-feature-flash")?.textContent || "",
        capacityCount: document.querySelectorAll(".salon-card-capacity, .salon-card-stat-grid, [data-availability-watch]").length,
        loyalty: plain?.querySelector(".salon-card-feature-loyalty")?.textContent || "",
        emptyOffer: normalizedEmpty.offer,
        savedOffer: normalizedOffer.offer,
        savedStartingPrice: getSalonStartingPrice(normalizedOffer),
        savedServicePrice: normalizedOffer.services[0].price,
        savedBookingPrice: normalizedOffer.bookings[0].price,
        profileServicePrice: getSalonProfileServices(normalizedOffer)[0].price,
        activeFirstServices: getSalonConfiguredServices({
          services: [{ name: "Active Real", price: 45, isActive: true }, { name: "Inactive Real", price: 1, isActive: false }],
          customServices: [{ name: "Legacy Service", price: 12 }]
        }),
        activeFirstProfile: getSalonProfileServices({
          services: [{ name: "Active Real", price: 45, isActive: true }, { name: "Inactive Real", price: 1, isActive: false }],
          customServices: [{ name: "Legacy Service", price: 12 }]
        })
      };
    });

    assert.equal(result.cardCount, 4);
    assert.equal(result.cardPriceCount, 0);
    assert.equal(result.topWalletCount, 0);
    assert.equal(result.directoryText.includes("120"), false);
    assert.equal(result.topText.includes("120"), false);
    assert.equal(result.plainOffer, "");
    assert.equal(result.boostedOffer, "");
    assert.match(result.realOffer, /Real Beard Offer/);
    assert.match(result.realOffer, /Owner saved 15% deal/);
    assert.match(result.realFlash, /Real Flash Deal/);
    assert.match(result.realFlash, /29/);
    assert.equal(result.capacityCount, 0);
    assert.match(result.loyalty, /Cut Club/);
    assert.deepEqual(result.emptyOffer, { title: "", description: "", price: 0, active: false });
    assert.deepEqual(result.savedOffer, { title: "Saved Offer", description: "Saved Description", price: 37, active: true });
    assert.equal(result.savedStartingPrice, 52);
    assert.equal(result.savedServicePrice, 52);
    assert.equal(result.savedBookingPrice, 52);
    assert.match(result.profileServicePrice, /52/);
    assert.deepEqual(result.activeFirstServices.map(service => service.name), ["Active Real"]);
    assert.deepEqual(result.activeFirstProfile.map(service => service.name), ["Active Real"]);
    assert.match(result.directoryText, /Precision Cut/);
    assert.equal(result.directoryText.includes("Hidden Service"), false);

    await page.evaluate(async () => {
      activeOwnerId = "owner-overflow";
      await loadOwnerServicesForActiveSalon();
    });
    assert.equal(await page.locator("#ownerServiceSlots [data-owner-service-slot]").count(), 5);
    assert.equal(await page.locator("#ownerServiceOverflow .owner-booking-card").count(), 1);
    assert.match(await page.locator("#ownerServiceOverflow").textContent(), /Real Service 6/);
    assert.equal((await page.locator("#ownerServiceManagementSection").textContent()).includes("Inactive Existing"), false);

    await page.evaluate(async () => {
      activeOwnerId = "owner-empty";
      await loadOwnerServicesForActiveSalon();
    });
    const slotRows = page.locator("#ownerServiceSlots [data-owner-service-slot]");
    assert.equal(await slotRows.count(), 5);
    assert.equal(await slotRows.locator("[data-owner-service-name]").first().inputValue(), "");
    assert.equal(await slotRows.locator("[data-owner-service-price]").first().inputValue(), "");

    await slotRows.locator("[data-owner-service-name]").first().evaluate(input => input.value = "Owner Cut");
    await page.evaluate(() => saveOwnerService());
    assert.equal(serviceRequests.length, 0, "partial slots must not call the API");

    await slotRows.locator("[data-owner-service-price]").first().evaluate(input => input.value = "35.50");
    await page.evaluate(() => saveOwnerService());
    assert.equal(serviceRequests.length, 1);
    assert.deepEqual(serviceRequests[0], {
      method: "POST",
      salonId: "owner-empty",
      serviceId: null,
      payload: { name: "Owner Cut", price: 35.5, durationMin: 30, isActive: true }
    });

    await page.locator("#ownerServiceSlots [data-owner-service-name]").first().evaluate(input => input.value = "Owner Cut Updated");
    await page.evaluate(() => saveOwnerService());
    assert.equal(serviceRequests[1].method, "PATCH");
    assert.equal(serviceRequests[1].serviceId, "created-service");
    assert.equal(serviceRequests[1].payload.name, "Owner Cut Updated");

    await page.locator("#ownerServiceSlots [data-owner-service-name]").first().evaluate(input => input.value = "");
    await page.locator("#ownerServiceSlots [data-owner-service-price]").first().evaluate(input => input.value = "");
    await page.evaluate(() => saveOwnerService());
    assert.deepEqual(serviceRequests[2], {
      method: "PATCH",
      salonId: "owner-empty",
      serviceId: "created-service",
      payload: { isActive: false }
    });
    assert.equal(serviceRequests.some(request => request.method === "DELETE"), false);
    assert.equal(ownerServices["owner-overflow"].length, 7, "overflow and inactive compatibility services must remain untouched");
    console.log("Salon cards and OWNER service slots use active real services without fabricated prices or destructive deletes PASS");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
