// Run: node tests/customer-geolocation-distance.spec.js. All API traffic is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const salons = [
  { id: 'near-regular', name: 'Zulu Near', city: 'Berlin', address: 'Near 1', latitude: 0, longitude: 0, rating: 4.4, reviewCount: 5, isActive: true, isWomenOnly: false, forWomen: true },
  { id: 'mid-regular', name: 'Middle Studio', city: 'Berlin', address: 'Middle 2', latitude: 0, longitude: 0.5, rating: 4.2, reviewCount: 3, isActive: true, isWomenOnly: false, forWomen: true },
  { id: 'far-vip', name: 'Alpha VIP', city: 'Berlin', address: 'Far 3', latitude: 0, longitude: 1, rating: 4.9, reviewCount: 20, isActive: true, isWomenOnly: false, forWomen: true, isVip: true, adminVip: true, classification: 'VIP' },
  { id: 'missing-coords', name: 'No Coordinates', city: 'Hamburg', address: 'Unknown 4', latitude: null, longitude: null, rating: 4, reviewCount: 1, isActive: true, isWomenOnly: false, forWomen: true },
];

const recentLocation = { latitude: 48, longitude: 11, accuracy: 10, capturedAt: new Date().toISOString() };

(async () => {
  const root = path.resolve(__dirname, '..');
  for (const [source, mirror] of [['index.html', 'www/index.html'], ['women.html', 'www/women.html']]) {
    assert.deepEqual(fs.readFileSync(path.join(root, source)), fs.readFileSync(path.join(root, mirror)), `${source} mirror differs`);
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const file of ['index.html', 'www/index.html', 'women.html', 'www/women.html']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(12000);
      const isWomenPage = file.endsWith('women.html');
      await page.addInitScript(({ storedLocation }) => {
        localStorage.setItem('meshwarSelectedExperience', 'men');
        localStorage.setItem('meshwarLang', 'en');
        localStorage.setItem('meshwarLocationConsent', 'false');
        localStorage.setItem('meshwarUserLocation', JSON.stringify(storedLocation));
        window.__geoRequests = 0;
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition(success, error) {
              window.__geoRequests++;
              window.__geoSuccess = success;
              window.__geoError = error;
            },
          },
        });
      }, { storedLocation: recentLocation });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v1/salons') {
          const pageSalons = isWomenPage
            ? salons.map(salon => ({ ...salon, forWomen: true }))
            : salons.map(({ forWomen, ...salon }) => salon);
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ salons: pageSalons }) });
        }
        if (url.pathname.startsWith('/api/')) {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
        }
        if (url.hostname !== 'geo.test') return route.abort();
        const relative = decodeURIComponent(url.pathname.slice(1));
        const target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.abort();
        const extension = path.extname(target);
        const contentType = extension === '.css' ? 'text/css' : extension === '.js' ? 'text/javascript' : extension === '.svg' ? 'image/svg+xml' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(target) });
      });

      await page.goto(`http://geo.test/${file}`);
      await page.evaluate(() => {
        document.getElementById('experienceGate')?.remove();
        document.getElementById('cookieBanner')?.remove();
        document.body.classList.remove('entry-gate-open');
      });
      const isWomen = file.endsWith('women.html');
      const cardSelector = isWomen ? '#womenGrid .card' : '#regularSalonGrid .salon-card, #vipSalonGrid .salon-card';
      const nearestSelector = isWomen ? '#womenNearbyButton' : '#heroLocationButton';
      await page.waitForFunction(selector => document.querySelectorAll(selector).length >= 3, cardSelector);
      assert.equal(await page.evaluate(() => window.__geoRequests), 0, `${file} requested location during startup`);
      if (!isWomen) {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        assert.equal(await page.evaluate(() => window.__geoRequests), 0, `${file} requested location on focus`);
        assert.equal(await page.locator('.salon-distance').count(), 0, `${file} used stale coordinates without consent`);
        assert.ok(await page.locator('#vipSalonGrid .salon-card').count() > 0, `${file} default VIP presentation changed`);
      } else {
        assert.equal(await page.locator('#womenGrid .women-card-distance').count(), 0, `${file} used stale coordinates without consent`);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        assert.equal(await page.evaluate(() => window.__geoRequests), 0, `${file} requested location on focus`);
      }

      await page.locator(nearestSelector).click();
      await page.waitForFunction(() => window.__geoRequests === 1);
      await page.evaluate(() => window.__geoSuccess({ coords: { latitude: 0, longitude: 0, accuracy: 8 } }));
      if (isWomen) {
        await page.waitForFunction(() => document.querySelector('#womenGrid .card')?.textContent.includes('Zulu Near'));
        const ids = await page.locator('#womenGrid .card').evaluateAll(cards => cards.map(card => card.getAttribute('data-open-profile-salon')));
        assert.deepEqual(ids.slice(0, 4), ['near-regular', 'mid-regular', 'far-vip', 'missing-coords'], `${file} nearest-first order`);
        assert.match(await page.locator('#womenGrid [data-open-profile-salon="near-regular"]').innerText(), /< 1 km/);
        assert.match(await page.locator('#womenGrid [data-open-profile-salon="far-vip"]').innerText(), /111\.2 km/);
        assert.doesNotMatch(await page.locator('#womenGrid [data-open-profile-salon="missing-coords"]').innerText(), /0\.0 km/);
        assert.equal(await page.locator('#womenGrid [data-open-profile-salon="missing-coords"] .women-card-distance').count(), 0);
      } else {
        await page.waitForFunction(() => document.querySelector('#regularSalonGrid [data-open-profile-salon="near-regular"]'));
        const ids = await page.locator('#regularSalonGrid .salon-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-open-profile-salon')));
        assert.deepEqual(ids, ['near-regular', 'mid-regular', 'far-vip', 'missing-coords'], `${file} nearest-first order across VIP and standard cards`);
        assert.equal(await page.locator('#vipSalonGrid .salon-card').count(), 0, `${file} left VIP cards outside nearest order`);
        assert.equal(await page.locator('#vipSalons').evaluate(element => element.hidden), true, `${file} did not combine tiers in nearest mode`);
        assert.match(await page.locator('#regularSalonGrid [data-open-profile-salon="near-regular"]').innerText(), /< 1 km/);
        assert.match(await page.locator('#regularSalonGrid [data-open-profile-salon="far-vip"]').innerText(), /111\.2 km/);
        assert.equal(await page.locator('#regularSalonGrid [data-open-profile-salon="missing-coords"] .salon-distance').count(), 0);
      }
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('meshwarLocationConsent'))), true);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('meshwarUserLocation')).latitude), 0, `${file} lost valid zero latitude`);
      console.log(`PASS ${file}: explicit location, validated distances, and proximity order`);
      await page.close();
    }

    const deniedPage = await browser.newPage();
    deniedPage.setDefaultTimeout(8000);
    deniedPage.setDefaultNavigationTimeout(12000);
    const homepageSalons = salons.map(({ forWomen, ...salon }) => salon);
    await deniedPage.addInitScript(({ storedLocation }) => {
      localStorage.setItem('meshwarSelectedExperience', 'men');
      localStorage.setItem('meshwarLang', 'en');
      localStorage.setItem('meshwarLocationConsent', 'true');
      localStorage.setItem('meshwarUserLocation', JSON.stringify(storedLocation));
      window.__geoRequests = 0;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, error) { window.__geoRequests++; window.__geoSuccess = success; window.__geoError = error; } } });
    }, { storedLocation: recentLocation });
    await deniedPage.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/salons') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ salons: homepageSalons }) });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      if (url.hostname !== 'geo.test') return route.abort();
      const target = path.resolve(root, decodeURIComponent(url.pathname.slice(1)));
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.abort();
      const extension = path.extname(target);
      return route.fulfill({ contentType: extension === '.css' ? 'text/css' : extension === '.js' ? 'text/javascript' : extension === '.svg' ? 'image/svg+xml' : 'text/html', body: fs.readFileSync(target) });
    });
    await deniedPage.goto('http://geo.test/index.html');
    await deniedPage.evaluate(() => { document.getElementById('experienceGate')?.remove(); document.getElementById('cookieBanner')?.remove(); });
    await deniedPage.waitForFunction(() => document.querySelector('#regularSalonGrid .salon-card'));
    assert.ok(await deniedPage.locator('.salon-distance').count() > 0, 'valid consented coordinates were not used');
    await deniedPage.evaluate(() => {
      const location = JSON.parse(localStorage.getItem('meshwarUserLocation'));
      location.capturedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      localStorage.setItem('meshwarUserLocation', JSON.stringify(location));
      renderSalonDirectory();
    });
    assert.equal(await deniedPage.locator('.salon-distance').count(), 0, 'expired coordinates were still shown');
    await deniedPage.locator('#heroLocationButton').click();
    await deniedPage.waitForFunction(() => window.__geoRequests === 1);
    await deniedPage.evaluate(() => window.__geoError({ code: 1 }));
    await deniedPage.waitForFunction(() => document.getElementById('locationStatus')?.textContent.includes('Location access denied'));
    assert.equal(await deniedPage.locator('.salon-distance').count(), 0, 'denial retained stale distance labels');
    assert.equal(await deniedPage.evaluate(() => localStorage.getItem('meshwarUserLocation')), null, 'denial retained stale coordinates');
    assert.equal(await deniedPage.evaluate(() => localStorage.getItem('meshwarLocationConsent')), 'false');
    await deniedPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await deniedPage.evaluate(() => window.__geoRequests), 1, 'focus re-requested denied location');
    assert.match(await deniedPage.locator('#locationStatus').innerText(), /Location access denied/, 'denial status was overwritten');
    await deniedPage.locator('#cityFilterSelect').selectOption({ label: 'Hamburg' });
    const cities = await deniedPage.locator('#regularSalonGrid .salon-location').allTextContents();
    assert.ok(cities.length > 0 && cities.every(city => city.includes('Hamburg')), 'manual city filtering failed without GPS');
    await deniedPage.close();
    console.log('PASS: explicit geolocation, no automatic requests, fresh consent, zero/missing coordinates, Haversine km labels, nearest ordering, denied cleanup/status, manual city fallback, and root/www parity.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
