// Run: node tests/salon-intake-controls.spec.js [www]. All HTTP is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const target = process.argv[2] || '.';
  assert.ok(['.', 'www'].includes(target), 'target must be root or www');
  const root = path.resolve(__dirname, '..', target);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  let passed = 0;
  try {
    for (const { role, plan } of [
      { role: 'ADMIN', plan: 'FREE' },
      { role: 'OWNER', plan: 'SMART' },
      { role: 'OWNER', plan: 'PREMIUM' },
      { role: 'OWNER', plan: 'PRO' },
    ]) {
      const page = await browser.newPage();
      const calls = [];
      let subscriptionCalls = 0;
      let failGet = false;
      let failPatch = false;
      let release;
      let hold = false;
      let state = { bookingIntakeEnabled: true, saloTicketIntakeEnabled: false, walkInIntakeEnabled: true };
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
        if (url.pathname === '/api/v1/subscriptions/me') {
  subscriptionCalls++;
  return json({
    subscription: {
      plan,
      status: 'ACTIVE',
      providerReference: null
    }
  });
}
        if (url.pathname.endsWith('/intake-controls')) {
          assert.equal(subscriptionCalls, role === 'OWNER' ? 1 : 0, 'Owner fetches subscription once before intake; ADMIN is independent');
          assert.equal(request.headers().authorization, 'Bearer test-access');
          assert.equal(url.pathname, '/api/v1/salons/salon-1/intake-controls');
          if (request.method() === 'GET') return json(failGet ? { error: 'Unavailable' } : { intakeControls: state }, failGet ? 403 : 200);
          calls.push(request.postDataJSON());
          if (hold) await new Promise(resolve => { release = resolve; });
          if (failPatch) return json({ error: 'Save rejected' }, 403);
          // Deliberately return a different value for another flag to prove response authority.
          state = { ...state, ...request.postDataJSON(), walkInIntakeEnabled: false };
          return json({ intakeControls: state });
        }
        if (url.pathname === '/api/v1/salons') return json({ salons: [] });
        if (url.pathname.startsWith('/api/')) return json({});
        return route.fulfill({ status: 204, body: '' });
      });
      await page.goto('http://intake.test/index.html', { waitUntil: 'domcontentloaded' });
      // Keep unrelated first-visit overlays out of this management-only test.
      await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
      const open = async () => {
        subscriptionCalls = 0;
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
        }
        }, role);
        assert.equal(subscriptionCalls, role === 'OWNER' ? 1 : 0, 'opening must not fetch the subscription twice');
      };
      await open();
      const section = page.locator(role === 'ADMIN' ? '#adminIntakeControls' : '#ownerIntakeControls');
      const booking = section.locator('[data-intake-field="bookingIntakeEnabled"]');
      const ticket = section.locator('[data-intake-field="saloTicketIntakeEnabled"]');
      const walkIn = section.locator('[data-intake-field="walkInIntakeEnabled"]');
      await booking.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForFunction(id => document.querySelector(`#${id} [data-intake-field]`)?.disabled === false, await section.getAttribute('id'));
      assert.equal(await booking.getAttribute('aria-checked'), 'true');
      assert.equal(await ticket.getAttribute('aria-checked'), 'false');
      assert.equal(await walkIn.getAttribute('aria-checked'), 'true');
      hold = true;
      const saving = page.waitForRequest(request => request.url().endsWith('/intake-controls') && request.method() === 'PATCH');
      await booking.press('Space');
      await saving;
      await page.waitForFunction(id => document.querySelector(`#${id} [data-intake-field]`).disabled, await section.getAttribute('id'));
      assert.equal(await booking.isDisabled(), true);
      assert.equal(await booking.getAttribute('aria-checked'), 'true');
      await booking.evaluate(button => button.click());
      assert.deepEqual(calls, [{ bookingIntakeEnabled: false }]);
      release();
      hold = false;
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-intake-field]`).disabled, await section.getAttribute('id'));
      assert.equal(await booking.getAttribute('aria-checked'), 'false');
      assert.equal(await walkIn.getAttribute('aria-checked'), 'false');
      await walkIn.press('Space');
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-intake-field]`).disabled, await section.getAttribute('id'));
      assert.deepEqual(calls[1], { walkInIntakeEnabled: true });
      assert.equal(await walkIn.getAttribute('aria-checked'), 'false', 'show the server result even when it differs from the requested value');
      failPatch = true;
      await ticket.press('Space');
      await section.locator('[role="status"]').filter({ hasText: 'nicht gespeichert' }).waitFor();
      assert.equal(await ticket.getAttribute('aria-checked'), 'false');
      assert.deepEqual(calls[2], { saloTicketIntakeEnabled: true });
      failGet = true;
      await open();
      await section.getByRole('button', { name: 'Erneut versuchen' }).waitFor();
      assert.equal(await booking.isDisabled(), true);
      assert.equal(await booking.getAttribute('aria-checked'), null);
      failGet = false;
      await section.getByRole('button', { name: 'Erneut versuchen' }).press('Enter');
      await page.waitForFunction(id => !document.querySelector(`#${id} [data-intake-field]`).disabled, await section.getAttribute('id'));
      assert.equal(await booking.getAttribute('aria-checked'), 'false');
      passed++;
      console.log(`PASS ${role} ${plan}: load, mapping, partial save, server state, failure, duplicate protection, retry`);
      await page.close();
    }
    for (const { plan, status } of [
      { plan: 'FREE', status: 'ACTIVE' },
      { plan: 'NONE', status: 'ACTIVE' },
      { plan: 'SMART', status: 'CANCELLED' },
    ]) {
  const page = await browser.newPage();
  let intakeGetCalls = 0;

  await page.addInitScript(() => {
    localStorage.setItem('meshwarSelectedExperience', 'men');
    localStorage.setItem('meshwarLang', 'de');
    localStorage.setItem('meshwarApiAuth', JSON.stringify({
      accessToken: 'test-access',
      userId: 'user-1',
      role: 'OWNER'
    }));
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });

    if (url.pathname === '/index.html') {
      return route.fulfill({
        contentType: 'text/html',
        body: request.frame() === page.mainFrame()
          ? fs.readFileSync(path.join(root, 'index.html'), 'utf8')
          : '<!doctype html>'
      });
    }

    if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) {
      const file = path.join(root, url.pathname.slice(1));
      return route.fulfill({
        contentType: 'text/javascript',
        body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      });
    }

    if (url.pathname === '/api/v1/subscriptions/me') {
      return json({
        subscription: {
          plan,
          status,
          providerReference: null
        }
      });
    }

    if (url.pathname.endsWith('/intake-controls')) {
      intakeGetCalls++;
      return json({
        intakeControls: {
          bookingIntakeEnabled: true,
          saloTicketIntakeEnabled: true,
          walkInIntakeEnabled: true
        }
      });
    }

    if (url.pathname === '/api/v1/salons') return json({ salons: [] });
    if (url.pathname.startsWith('/api/')) return json({});
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('http://intake.test/index.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });

  await page.evaluate(async () => {
    const salon = normalizeSalon({
      id: 'salon-1',
      ownerId: 'user-1',
      name: 'Test Salon',
      services: [],
      media: [],
      reviews: []
    });

    session = { role: 'owner' };
    await openOwnerPanel(salon);
    setOwnerPanelSection('settings');
  });

  await page.waitForTimeout(100);

  assert.equal(
    intakeGetCalls,
    0,
    'FREE owner must not request Smart Salon intake controls'
  );

  passed++;
  assert.equal(await page.locator('#ownerName').inputValue(), 'Test Salon', 'basic Owner editor remains populated');
  assert.equal(await page.locator('#ownerName').isDisabled(), false, 'basic Owner editing remains enabled');
  assert.equal(await page.locator('#ownerModal').evaluate(el => el.classList.contains('show')), true);
  console.log(`PASS OWNER ${plan} ${status}: no intake requests; basic editor available`);
  await page.close();
}
    console.log(`${passed} passed, 0 failed`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
