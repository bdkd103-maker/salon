// Run: node tests/salon-extras.spec.js [www]. All HTTP is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const CATALOG = ['coffee', 'otherDrinks', 'wifi', 'parking', 'cashPayment', 'cardPayment', 'applePay', 'googlePay', 'wheelchairAccess'];

(async () => {
  const target = process.argv[2] || '.';
  assert.ok(['.', 'www'].includes(target), 'target must be root or www');
  const root = path.resolve(__dirname, '..', target);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  let passed = 0;
  try {
    for (const { role, plan } of [
      { role: 'ADMIN', plan: 'FREE' },
      { role: 'OWNER', plan: 'FREE' },
      { role: 'OWNER', plan: 'SMART' },
      { role: 'OWNER', plan: 'PREMIUM' },
    ]) {
      const page = await browser.newPage();
      const calls = [];
      let failGet = false;
      let failPatch = false;
      let release;
      let hold = false;
      let state = { extras: ['wifi', 'cashPayment'] };
      await page.addInitScript(role => {
        localStorage.setItem('meshwarSelectedExperience', 'men');
        localStorage.setItem('meshwarLang', 'de');
        localStorage.setItem('meshwarApiAuth', JSON.stringify({ accessToken: 'test-access', userId: 'user-1', role }));
      }, role);
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: request.frame() === page.mainFrame() ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : '<!doctype html>' });
        if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) {
          const file = path.join(root, url.pathname.slice(1));
          return route.fulfill({ contentType: 'text/javascript', body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
        }
        if (url.pathname === '/api/v1/subscriptions/me') return json({ subscription: { plan, status: 'ACTIVE', providerReference: null } });
        if (url.pathname === '/api/v1/salons/salon-1/extras') {
          assert.equal(request.headers().authorization, 'Bearer test-access');
          if (request.method() === 'GET') return json(failGet ? { error: 'Unavailable' } : state, failGet ? 403 : 200);
          const body = request.postDataJSON();
          calls.push(body);
          if (hold) await new Promise(resolve => { release = resolve; });
          if (failPatch) return json({ error: 'Save rejected' }, 403);
          // Deliberately drop one enabled extra to prove the server response is authoritative.
          state = { extras: body.extras.filter(key => key !== 'cashPayment') };
          return json(state);
        }
        if (url.pathname === '/api/v1/salons') return json({ salons: [] });
        if (url.pathname.startsWith('/api/')) return json({});
        return route.fulfill({ status: 204, body: '' });
      });
      await page.goto('http://extras.test/index.html', { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
      const open = async () => {
        await page.evaluate(async role => {
          const salon = normalizeSalon({ id: 'salon-1', ownerId: 'user-1', name: 'Test Salon', services: [], media: [], reviews: [] });
          session = { role: role.toLowerCase() };
          if (role === 'ADMIN') {
            populateAdminFormFromSalon(salon);
            openModal('adminModal');
            setActiveAdminView('salon-editor');
          } else {
            await openOwnerPanel(salon);
            setOwnerPanelSection('settings');
            setOwnerSettingsPanel('salon');
          }
        }, role);
      };
      await open();
      const section = page.locator(role === 'ADMIN' ? '#adminExtrasControls' : '#ownerExtrasControls');
      await section.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForFunction(id => document.querySelectorAll(`#${id} [data-extra-key]`).length === 9 && document.querySelector(`#${id} [data-extra-key]`)?.disabled === false, await section.getAttribute('id'));
      const keys = await section.locator('[data-extra-key]').evaluateAll(nodes => nodes.map(node => node.dataset.extraKey));
      assert.deepEqual(keys, CATALOG, 'extras render in canonical catalog order');
      assert.equal(await section.locator('[data-extra-key="wifi"]').getAttribute('aria-checked'), 'true');
      assert.equal(await section.locator('[data-extra-key="cashPayment"]').getAttribute('aria-checked'), 'true');
      assert.equal(await section.locator('[data-extra-key="coffee"]').getAttribute('aria-checked'), 'false');
      assert.ok((await section.locator('[data-extra-key="coffee"]').textContent()).includes('Kaffee'), 'localized German label is used');
      hold = true;
      const saving = page.waitForRequest(request => request.url().endsWith('/salons/salon-1/extras') && request.method() === 'PATCH');
      await section.locator('[data-extra-key="parking"]').click();
      await saving;
      await page.waitForFunction(id => document.querySelector(`#${id} [data-extra-key]`).disabled, await section.getAttribute('id'));
      assert.equal(await section.locator('[data-extra-key="parking"]').isDisabled(), true);
      release();
      hold = false;
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-extra-key]`).disabled, await section.getAttribute('id'));
      assert.deepEqual(calls[0], { extras: ['wifi', 'parking', 'cashPayment'] }, 'PATCH sends the full canonical selection');
      assert.equal(await section.locator('[data-extra-key="parking"]').getAttribute('aria-checked'), 'true');
      assert.equal(await section.locator('[data-extra-key="cashPayment"]').getAttribute('aria-checked'), 'false', 'server response wins over the requested state');
      failPatch = true;
      await section.locator('[data-extra-key="coffee"]').click();
      await section.locator('[role="status"]').filter({ hasText: 'nicht gespeichert' }).waitFor();
      assert.deepEqual(calls[1], { extras: ['coffee', 'wifi', 'parking'] });
      assert.equal(await section.locator('[data-extra-key="coffee"]').getAttribute('aria-checked'), 'false', 'failed saves keep the confirmed state');
      failPatch = false;
      failGet = true;
      await open();
      await section.getByRole('button', { name: 'Erneut versuchen' }).waitFor();
      assert.equal(await section.locator('[data-extra-key="coffee"]').isDisabled(), true);
      assert.equal(await section.locator('[data-extra-key="coffee"]').getAttribute('aria-checked'), null);
      failGet = false;
      await section.getByRole('button', { name: 'Erneut versuchen' }).press('Enter');
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-extra-key]`).disabled, await section.getAttribute('id'));
      assert.equal(await section.locator('[data-extra-key="wifi"]').getAttribute('aria-checked'), 'true');
      assert.equal(await section.locator('[data-extra-key="parking"]').getAttribute('aria-checked'), 'true');
      state = { extras: [] };
      await open();
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-extra-key]`).disabled, await section.getAttribute('id'));
      for (const key of CATALOG) {
        assert.equal(await section.locator(`[data-extra-key="${key}"]`).getAttribute('aria-checked'), 'false', `empty salon leaves ${key} off`);
      }
      passed++;
      console.log(`PASS ${role} ${plan}: catalog order, load, canonical PATCH, server authority, failure, retry, empty state`);
      await page.close();
    }
    const page = await browser.newPage();
    const detailExtras = { 'salon-1': ['wifi', 'coffee'], 'salon-2': undefined };
    await page.addInitScript(() => {
      localStorage.setItem('meshwarSelectedExperience', 'men');
      localStorage.setItem('meshwarLang', 'de');
    });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: request.frame() === page.mainFrame() ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : '<!doctype html>' });
      if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) {
        const file = path.join(root, url.pathname.slice(1));
        return route.fulfill({ contentType: 'text/javascript', body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
      }
      const detail = url.pathname.match(/^\/api\/v1\/salons\/(salon-[12])$/);
      if (detail) {
        const extras = detailExtras[detail[1]];
        return json({ salon: { id: detail[1], name: 'Extras Salon', city: 'Berlin', services: [], media: [], reviews: [], barbers: [], offers: [], ...(extras ? { extras } : {}) } });
      }
      if (url.pathname.startsWith('/api/v1/loyalty/')) return json({ card: null });
      if (url.pathname.startsWith('/api/')) return json({});
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('http://extras.test/index.html', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
    const openProfile = async salonId => {
      await page.evaluate(id => {
        openSalonProfile(normalizeSalon({ id, name: 'Extras Salon', services: [], media: [], reviews: [] }));
      }, salonId);
      await page.locator('#salonProfileModal.show').waitFor();
    };
    await openProfile('salon-1');
    await page.locator('.salon-profile-extras li').first().waitFor();
    assert.equal(await page.locator('.salon-profile-extras-section h3').textContent(), 'Ausstattung');
    assert.deepEqual(await page.locator('.salon-profile-extras li').allTextContents(), ['Kaffee', 'WLAN'], 'profile extras follow catalog order with German labels');
    await page.addInitScript(() => localStorage.setItem('meshwarLang', 'en'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
    await openProfile('salon-1');
    await page.locator('.salon-profile-extras li').first().waitFor();
    assert.equal(await page.locator('.salon-profile-extras-section h3').textContent(), 'Amenities');
    assert.deepEqual(await page.locator('.salon-profile-extras li').allTextContents(), ['Coffee', 'Wi-Fi']);
    await page.addInitScript(() => localStorage.setItem('meshwarLang', 'ar'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
    await openProfile('salon-1');
    await page.locator('.salon-profile-extras li').first().waitFor();
    assert.equal(await page.locator('.salon-profile-extras-section h3').textContent(), 'المرافق');
    assert.deepEqual(await page.locator('.salon-profile-extras li').allTextContents(), ['قهوة', 'واي فاي']);
    await openProfile('salon-2');
    await page.waitForFunction(() => !document.querySelector('.salon-profile-extras-section'), null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.locator('.salon-profile-extras-section').count(), 0, 'salons without extras show no amenities section');
    passed++;
    console.log('PASS customer profile: amenities section in de/en/ar, omitted without extras');
    await page.close();
    console.log(`${passed} passed, 0 failed`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
