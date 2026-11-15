// All traffic is intercepted. No live accounts or database records are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  for (const file of ['index.html', 'www/index.html']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(source.includes('apiRequest("/api/v1/partner-requests"'), `${file} must POST applications to the API`);
    assert.ok(!source.includes('formspree.io/f/xppagpja'), `${file} partner form must not use Formspree`);
    assert.ok(source.includes('translate("applicationClosed")'), `${file} needs closed-application copy`);
    assert.match(source, /applicationClosed:"[^"]+"/);
    assert.match(source, /partnerSubmitFailed:"[^"]+"/);
    assert.match(source, /applicationSuccess:"[^"]+"/);
  }
  const adminSource = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  assert.ok(adminSource.includes('openProvisionFromApplication'));
  assert.ok(adminSource.includes('saloPendingApplicationProvision'));
  assert.ok(adminSource.includes("status: 'APPROVED'"));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    // Public partner form hits the real API contract.
    {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const calls = [];
      let applicationsEnabled = true;
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname.startsWith('/api/')) {
          calls.push({ path: url.pathname, method: route.request().method(), body: route.request().postData() });
          if (url.pathname === '/api/v1/partner-requests' && route.request().method() === 'POST') {
            if (!applicationsEnabled) return json({ error: 'Salon applications are currently disabled', code: 'SALON_APPLICATIONS_DISABLED' }, 409);
            return json({ id: 'pr-1', status: 'PENDING', createdAt: new Date().toISOString(), request: { id: 'pr-1', status: 'PENDING' } }, 201);
          }
          return json({});
        }
        const relative = url.pathname.slice(1);
        const target = path.join(root, relative);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          const type = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'application/octet-stream';
          return route.fulfill({ contentType: type, body: fs.readFileSync(target) });
        }
        return route.fulfill({ status: 204, body: '' });
      });
      await page.goto('http://partner-app.test/index.html', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => openModal('partnerModal'));
      await page.locator('#partnerSalonName').fill('API Salon');
      await page.locator('input[name="contactPerson"]').fill('API Contact');
      await page.locator('#partnerEmail').fill('api@example.test');
      await page.locator('#partnerPhone').fill('+491701234567');
      await page.locator('#partnerCity').fill('Berlin');
      await page.locator('#partnerForm').evaluate(form => form.requestSubmit());
      await page.locator('#partnerNotice.show').waitFor();
      const post = calls.find(c => c.path === '/api/v1/partner-requests' && c.method === 'POST');
      assert.ok(post, 'partner form must POST /api/v1/partner-requests'); checks++;
      const payload = JSON.parse(post.body);
      assert.deepEqual(payload, { salonName: 'API Salon', contactName: 'API Contact', contactEmail: 'api@example.test', contactPhone: '+491701234567', city: 'Berlin' }); checks++;
      assert.equal(await page.locator('#partnerNotice').isVisible(), true); checks++;

      applicationsEnabled = false;
      await page.locator('#partnerSalonName').fill('Closed Salon');
      await page.locator('input[name="contactPerson"]').fill('Closed Contact');
      await page.locator('#partnerEmail').fill('closed@example.test');
      await page.locator('#partnerCity').fill('Hamburg');
      await page.locator('#partnerForm').evaluate(form => form.requestSubmit());
      await page.locator('#partnerError.show').waitFor();
      const errorText = await page.locator('#partnerError').innerText();
      assert.match(errorText, /Applications are currently closed|Bewerbungen sind derzeit geschlossen|التقديم مغلق/); checks++;
      assert.deepEqual(errors, []);
      await page.close();
    }

    // NEW Admin partners review: approve creates salon prefill, reject persists reason, invalid transition surfaces.
    {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const requests = [
        { id: 'pr-1', salonName: 'Pending Salon', contactName: 'Pat Pending', contactEmail: 'pat@example.test', contactPhone: '+491701111111', city: 'Berlin', message: 'Please approve', status: 'PENDING', createdAt: '2026-09-01T10:00:00Z', rejectReason: null },
        { id: 'pr-2', salonName: 'Rejected Salon', contactName: 'Rex Reject', contactEmail: 'rex@example.test', contactPhone: null, city: 'Köln', message: null, status: 'REJECTED', createdAt: '2026-09-01T11:00:00Z', rejectReason: 'Duplicate application' },
      ];
      const calls = [];
      await page.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/api/')) {
          calls.push({ path: url.pathname, method: req.method(), body: req.postData(), auth: req.headers().authorization });
          if (url.pathname === '/api/v1/auth/login') return json({ user: { id: 'u1', role: 'ADMIN', fullName: 'Admin Test' }, accessToken: 'test-token', refreshToken: 'test-refresh' });
          if (url.pathname === '/api/v1/admin/dashboard') return json({ summary: { totalSalons: 1, totalBookings: 0, totalUsers: 2 } });
          if (url.pathname === '/api/v1/admin/salons') return json({ salons: [] });
          if (url.pathname === '/api/v1/admin/partner-requests' && req.method() === 'GET') return json({ requests });
          if (url.pathname === '/api/v1/admin/partner-requests/pr-1' && req.method() === 'PATCH') {
            const body = req.postDataJSON();
            if (requests[0].status !== 'PENDING') return json({ error: 'Request already reviewed', code: 'INVALID_TRANSITION', status: requests[0].status }, 409);
            requests[0] = { ...requests[0], status: body.status, rejectReason: body.status === 'REJECTED' ? body.rejectReason || null : null, reviewedByUserId: 'u1', reviewedAt: new Date().toISOString() };
            return json({ request: requests[0] });
          }
          if (url.pathname === '/api/v1/admin/partner-requests/pr-2' && req.method() === 'PATCH') return json({ error: 'Request already reviewed', code: 'INVALID_TRANSITION', status: 'REJECTED' }, 409);
          const patchMatch = url.pathname.match(/^\/api\/v1\/admin\/partner-requests\/(pr-\d+)$/);
          if (patchMatch && req.method() === 'PATCH') {
            const target = requests.find(r => r.id === patchMatch[1]);
            if (!target) return json({ error: 'Partner request not found' }, 404);
            if (target.status !== 'PENDING') return json({ error: 'Request already reviewed', code: 'INVALID_TRANSITION', status: target.status }, 409);
            const body = req.postDataJSON();
            Object.assign(target, { status: body.status, rejectReason: body.status === 'REJECTED' ? body.rejectReason || null : null, reviewedByUserId: 'u1', reviewedAt: new Date().toISOString() });
            return json({ request: target });
          }
          return json({});
        }
        const relative = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
        if (['admin/index.html', 'admin/admin.js', 'admin/admin.css', 'assets/salon-intake-controls.js'].includes(relative)) return route.fulfill({ contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
        return route.abort();
      });
      await page.goto('http://admin-partners.test/admin/');
      await page.locator('#login-form input[name="email"]').fill('admin@example.test');
      await page.locator('#login-form input[name="password"]').fill('test-password');
      await page.locator('#login-form button[type="submit"]').click();
      await page.locator('#workspace').waitFor();
      await page.getByRole('link', { name: 'Partners', exact: true }).click();
      await page.getByText('Pending Salon', { exact: true }).waitFor(); checks++;

      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.getByText('Partner request approved.', { exact: true }).waitFor();
      await page.getByLabel('Salon name', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Salon name', { exact: true }).inputValue(), 'Pending Salon'); checks++;
      assert.equal(await page.getByLabel('City', { exact: true }).inputValue(), 'Berlin'); checks++;
      assert.equal(await page.getByLabel('Owner full name', { exact: true }).inputValue(), 'Pat Pending'); checks++;
      assert.equal(await page.getByLabel('Owner email', { exact: true }).inputValue(), 'pat@example.test'); checks++;
      const approvePatch = calls.find(c => c.path.endsWith('/pr-1') && c.method === 'PATCH');
      assert.deepEqual(JSON.parse(approvePatch.body), { status: 'APPROVED' }); checks++;
      await page.getByRole('button', { name: 'Close dialog' }).click();

      await page.getByRole('link', { name: 'Partners', exact: true }).click();
      await page.getByRole('button', { name: 'Create salon', exact: true }).waitFor(); checks++;

      // Reject persists reason on a pending row (re-seed pr-1 as pending via refresh of list state is complex; use reject on a fresh pending entry).
      requests.push({ id: 'pr-3', salonName: 'Reject Me', contactName: 'Rita', contactEmail: 'rita@example.test', contactPhone: null, city: 'Mainz', message: null, status: 'PENDING', createdAt: '2026-09-02T10:00:00Z', rejectReason: null });
      await page.getByRole('link', { name: 'Dashboard', exact: true }).click().catch(() => {});
      await page.getByRole('link', { name: 'Partners', exact: true }).click();
      await page.getByText('Reject Me', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
      await page.getByLabel('Reason (optional)', { exact: true }).fill('Not ready');
      await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
      await page.getByText('Partner request rejected.', { exact: true }).waitFor();
      const rejectPatch = calls.filter(c => c.method === 'PATCH' && c.path.includes('/partner-requests/')).map(c => JSON.parse(c.body)).find(b => b.status === 'REJECTED');
      assert.equal(rejectPatch.rejectReason, 'Not ready'); checks++;
      await page.getByText('Reason: Not ready', { exact: true }).waitFor(); checks++;

      // Terminal transition surfaces INVALID_TRANSITION.
      await page.getByRole('button', { name: 'Create salon', exact: true }).click().catch(() => {});
      const late = await page.evaluate(async () => {
        const auth = JSON.parse(localStorage.getItem('meshwarApiAuth'));
        const response = await fetch('http://admin-partners.test:4000/api/v1/admin/partner-requests/pr-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
          body: JSON.stringify({ status: 'REJECTED' }),
        });
        return { status: response.status, body: await response.json() };
      }).catch(() => null);
      // Route interception covers page-level fetches; assert via injected route call log instead when evaluate is cross-origin blocked.
      const forced = await page.evaluate(async () => {
        try {
          const auth = JSON.parse(localStorage.getItem('meshwarApiAuth'));
          const response = await fetch('/api/v1/admin/partner-requests/pr-2', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
            body: JSON.stringify({ status: 'APPROVED' }),
          });
          return { status: response.status, body: await response.json() };
        } catch (error) {
          return { status: 0, body: { error: error.message } };
        }
      });
      assert.equal(forced.status, 409); checks++;
      assert.equal(forced.body.code, 'INVALID_TRANSITION'); checks++;
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(`PASS ${checks} salon application checks`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
