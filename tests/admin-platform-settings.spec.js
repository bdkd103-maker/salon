// All traffic is intercepted. No live accounts or database records are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  for (const file of ['admin/admin.js', 'www/admin/admin.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(source.includes("request('/api/v1/admin/platform-settings')"), `${file} must load settings from the API`);
    assert.ok(source.includes("send('/api/v1/admin/platform-settings', 'PATCH'"), `${file} must save settings through the API`);
    assert.ok(source.includes('Registration &amp; Applications'));
    assert.ok(source.includes('Booking Rules'));
    assert.ok(source.includes('SMART &amp; Queue'));
    assert.ok(source.includes('Platform Security'));
    assert.ok(source.includes('System'));
    assert.ok(!source.includes('JWT_ACCESS_SECRET'));
    assert.ok(!source.includes('DATABASE_URL'));
  }
  const migration = fs.readFileSync(path.join(root, 'backend/prisma/migrations/20260915120000_add_platform_settings/migration.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE "PlatformSettings"/);
  const schema = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /model PlatformSettings/);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const calls = [];
    let settings = {
      id: 'platform',
      siteName: 'SALO',
      supportEmail: 'support@example.test',
      defaultLocale: 'ar',
      customerRegistrationEnabled: true,
      salonApplicationsEnabled: true,
      bookingGloballyEnabled: true,
      saloTicketGloballyEnabled: true,
      walkInGloballyEnabled: true,
      staffStatusLiveEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/api/')) {
        calls.push({ path: url.pathname, method: req.method(), body: req.postData(), auth: req.headers().authorization });
        if (url.pathname === '/api/v1/auth/login') return json({ user: { id: 'u1', role: 'ADMIN', fullName: 'Admin Test' }, accessToken: 'test-token', refreshToken: 'test-refresh' });
        if (url.pathname === '/api/v1/admin/dashboard') return json({ summary: { totalSalons: 1, totalBookings: 0, totalUsers: 2 } });
        if (url.pathname === '/api/v1/admin/platform-settings' && req.method() === 'GET') {
          return json({
            settings,
            system: { environment: 'test', apiVersion: 'v1', nodeVersion: 'v20.0.0', processUptimeSeconds: 12, databaseConnected: true, serverTime: '2026-09-15T12:00:00.000Z' },
            security: { authentication: 'JWT Bearer', passwordHashing: 'Argon2id', adminAuthorization: 'ADMIN role required', secretsExposed: false, notes: 'No secrets returned.' },
          });
        }
        if (url.pathname === '/api/v1/admin/platform-settings' && req.method() === 'PATCH') {
          const body = req.postDataJSON();
          settings = { ...settings, ...body, updatedAt: new Date().toISOString() };
          return json({ settings });
        }
        return json({});
      }
      const relative = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      if (['admin/index.html', 'admin/admin.js', 'admin/admin.css', 'assets/salon-intake-controls.js'].includes(relative)) return route.fulfill({ contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
      return route.abort();
    });

    await page.goto('http://admin-settings.test/admin/');
    await page.locator('#login-form input[name="email"]').fill('admin@example.test');
    await page.locator('#login-form input[name="password"]').fill('test-password');
    await page.locator('#login-form button[type="submit"]').click();
    await page.locator('#workspace').waitFor();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Site name', { exact: true }).waitFor(); checks++;
    assert.equal(await page.getByLabel('Site name', { exact: true }).inputValue(), 'SALO'); checks++;
    assert.equal(await page.getByLabel('Support email', { exact: true }).inputValue(), 'support@example.test'); checks++;
    assert.ok(await page.getByText('Registration & Applications', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('Booking Rules', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('SMART & Queue', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('Platform Security', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('Argon2id', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('System', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByText('JWT_ACCESS_SECRET', { exact: true }).count() === 0); checks++;
    const getCall = calls.find(c => c.path === '/api/v1/admin/platform-settings' && c.method === 'GET');
    assert.equal(getCall.auth, 'Bearer test-token'); checks++;

    await page.getByLabel('Site name', { exact: true }).fill('SALO Platform');
    await page.locator('[name="customerRegistrationEnabled"]').uncheck();
    await page.locator('[name="bookingGloballyEnabled"]').uncheck();
    await page.locator('[name="salonApplicationsEnabled"]').uncheck();
    await page.locator('[name="saloTicketGloballyEnabled"]').uncheck();
    await page.locator('[name="walkInGloballyEnabled"]').uncheck();
    await page.locator('[name="staffStatusLiveEnabled"]').uncheck();
    await page.getByRole('button', { name: 'Save platform settings', exact: true }).click();
    await page.getByText('Platform settings saved.', { exact: true }).waitFor(); checks++;

    const patch = calls.find(c => c.path === '/api/v1/admin/platform-settings' && c.method === 'PATCH');
    assert.ok(patch, 'settings save must PATCH the API'); checks++;
    assert.equal(patch.auth, 'Bearer test-token'); checks++;
    const payload = JSON.parse(patch.body);
    assert.equal(payload.siteName, 'SALO Platform'); checks++;
    assert.equal(payload.customerRegistrationEnabled, false); checks++;
    assert.equal(payload.bookingGloballyEnabled, false); checks++;
    assert.equal(payload.salonApplicationsEnabled, false); checks++;
    assert.equal(payload.saloTicketGloballyEnabled, false); checks++;
    assert.equal(payload.walkInGloballyEnabled, false); checks++;
    assert.equal(payload.staffStatusLiveEnabled, false); checks++;

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Site name', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Site name', { exact: true }).inputValue(), 'SALO Platform'); checks++;
    assert.equal(await page.locator('[name="bookingGloballyEnabled"]').isChecked(), false); checks++;

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } checks++;

    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${checks} platform settings checks`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
