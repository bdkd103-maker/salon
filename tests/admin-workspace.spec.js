// All traffic is intercepted. No live accounts or database records are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.ok(html.includes('id="workspace"'), '/admin/ must be an application');
  assert.ok(!html.includes('location.replace'), '/admin/ must not redirect');
  for (const file of ['index.html', 'admin.css', 'admin.js']) assert.equal(fs.readFileSync(path.join(root, 'admin', file), 'utf8'), fs.readFileSync(path.join(root, 'www/admin', file), 'utf8'));
  const adminRedirect = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(adminRedirect, /new URL\("\.\/admin\/"/, 'admin.html must redirect to ./admin/');
  assert.equal(fs.readFileSync(path.join(root, 'admin.html'), 'utf8'), fs.readFileSync(path.join(root, 'www/admin.html'), 'utf8'));
  for (const file of ['index.html', 'www/index.html']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!source.includes('id="adminOpen"'));
    assert.ok(!source.includes('adminTapCount'));
    assert.match(source, /id="brandNav" href="index.html"/);
    assert.match(source, /function goToAdminApp\(hash = ""\)/, 'canonical Admin entry helper required');
    assert.match(source, /window\.location\.assign\(`\.\/admin\/\$\{suffix\}`\)/, 'goToAdminApp must target ./admin/');
    assert.ok(!source.includes('openAdminWorkspace'), 'embedded Admin workspace entry must not remain');
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const role of ['OWNER', 'CUSTOMER', 'ADMIN']) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const requests = [];
      let salons = [{ id: 's1', name: 'Inactive Salon', city: 'Berlin', address: 'Test street 1', phone: '+49301234567', isActive: false, owner: { fullName: 'Owner', email: 'owner@example.test' } }];
      let deleteBlocked = true;
      let rejectToggle = false;
      await page.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/api/')) {
          requests.push({ path: url.pathname, method: req.method(), body: req.postData(), auth: req.headers().authorization });
          if (url.pathname === '/api/v1/auth/login') return json({ user: { id: 'u1', role, fullName: 'Admin Test' }, accessToken: 'test-token', refreshToken: 'test-refresh' });
          if (url.pathname === '/api/v1/admin/dashboard') return json({ summary: { totalSalons: 1, totalBookings: 9, totalUsers: 4, activeSubscriptions: 2 }, offers: [{ id: 'o1', salonId: 's1', title: 'Real offer', price: 10, isActive: true }], boosts: [], subscriptions: [], loyalty: { cards: [{ id: 'c1', salon: { name: 'Inactive Salon' }, rewardTitle: 'Haircut', requiredStamps: 5, customers: [{ customer: { fullName: 'Loyal customer' }, currentStamps: 3 }] }] } });
          if (url.pathname === '/api/v1/salons/s1/offers') return json({ offers: [{ id: 'o1', salonId: 's1', title: 'Real offer', price: 10, discount: 5, availableSlots: 3, isActive: true }] });
          if (url.pathname === '/api/v1/admin/salons') return json({ salons });
          if (url.pathname.endsWith('/intake-controls')) return json({ intakeControls: { bookingIntakeEnabled: true, saloTicketIntakeEnabled: false, walkInIntakeEnabled: true } });
          if (url.pathname === '/api/v1/salons/s1' && req.method() === 'PATCH') { if (rejectToggle) return json({ error: 'Status update refused' }, 409); salons[0] = { ...salons[0], ...req.postDataJSON() }; return json({ salon: salons[0] }); }
          if (url.pathname === '/api/v1/salons/s1' && req.method() === 'DELETE') { if (deleteBlocked) return json({ error: 'Active retention hold' }, 409); salons = []; return json({ deleted: true }); }
          if (url.pathname === '/api/v1/bookings') return json({ bookings: [{ id: 'b1', salon: { name: 'Live salon' }, user: { fullName: 'Live customer' }, startAt: '2026-09-14T12:00:00Z', status: 'PENDING' }] });
          if (url.pathname === '/api/v1/messages') return json({ messages: [{ id: 'm1', sender: { id: 'owner-2', fullName: 'Fresh sender' }, receiver: { id: 'u1', fullName: 'Admin' }, subject: 'Fresh subject', body: 'Fresh server message' }] });
          return json({});
        }
        const relative = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
        if (['admin/index.html', 'admin/admin.js', 'admin/admin.css', 'assets/salon-intake-controls.js', 'assets/salon-extras.js'].includes(relative)) return route.fulfill({ contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
        return route.abort();
      });
      await page.goto('http://admin.test/admin/');
      await page.locator('#login-form input[name="email"]').fill('admin@example.test');
      await page.locator('#login-form input[name="password"]').fill('test-password');
      await page.locator('#login-form button[type="submit"]').click();
      if (role !== 'ADMIN') {
        await page.getByText('An ADMIN account is required.').waitFor();
        assert.equal(await page.locator('#workspace').isVisible(), false);
        assert.equal(requests.some(r => r.path.includes('/admin/')), false); checks++;
      } else {
        await page.locator('#workspace').waitFor();
        if (process.env.ADMIN_SCREENSHOTS === '1') {
          await page.getByText('Total bookings', { exact: true }).waitFor();
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.screenshot({ path: path.join(root, '.admin-overview-review.png') });
        }
        await page.getByRole('link', { name: 'Salons', exact: true }).click();
        await page.getByText('Inactive Salon', { exact: true }).waitFor();
        assert.equal(requests.find(r => r.path === '/api/v1/admin/salons').auth, 'Bearer test-token'); checks++;
        await page.getByRole('button', { name: 'Activate', exact: true }).click();
        await page.getByRole('button', { name: 'Deactivate', exact: true }).waitFor();
        assert.deepEqual(JSON.parse(requests.find(r => r.method === 'PATCH').body), { isActive: true }); checks++;
        rejectToggle = true;
        await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
        await page.getByText('Status update refused', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Deactivate', exact: true }).count(), 1); checks++;
        rejectToggle = false;
        await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
        await page.getByRole('button', { name: 'Activate', exact: true }).waitFor(); checks++;
        await page.getByRole('button', { name: 'View / edit' }).click();
        await page.getByRole('switch', { name: 'Bookings / Appointments' }).waitFor();
        await page.getByRole('switch', { name: 'Bookings / Appointments' }).click();
        await page.getByText('Saved.', { exact: true }).waitFor();
        assert.ok(requests.some(r => r.path.endsWith('/intake-controls') && r.method === 'PATCH' && JSON.parse(r.body).bookingIntakeEnabled === false)); checks++;
        await page.getByLabel('Salon name', { exact: true }).fill('Edited Salon');
        await page.getByLabel('Reset owner password (leave blank to keep)', { exact: true }).fill('new-owner-password');
        await page.getByRole('button', { name: 'Save salon', exact: true }).click();
        await page.getByText('Edited Salon', { exact: true }).waitFor();
        const edit = requests.find(r => r.method === 'PATCH' && r.body.includes('Edited Salon'));
        assert.equal(JSON.parse(edit.body).ownerPassword, 'new-owner-password'); checks++;
        await page.getByRole('button', { name: '+ Create salon', exact: true }).click();
        await page.getByLabel('Salon name', { exact: true }).fill('Created Salon');
        await page.getByLabel('City', { exact: true }).fill('Berlin');
        await page.getByLabel('Address', { exact: true }).fill('Test street 22');
        await page.getByLabel('Salon phone', { exact: true }).fill('+49301234567');
        await page.getByLabel('Owner full name', { exact: true }).fill('New Owner');
        await page.getByLabel('Owner email', { exact: true }).fill('new-owner@example.test');
        await page.getByLabel('Owner phone', { exact: true }).fill('+491701234567');
        await page.getByLabel('Owner password', { exact: true }).fill('new-owner-password');
        await page.getByRole('button', { name: 'Create salon & owner', exact: true }).click();
        await page.getByText('Owner provisioning completed. Review the refreshed salon list.', { exact: true }).waitFor();
        const provision = requests.find(r => r.path === '/api/v1/auth/admin/provision-owner');
        assert.equal(JSON.parse(provision.body).salon.name, 'Created Salon'); checks++;
        assert.equal(JSON.parse(provision.body).owner.phone, '+491701234567'); checks++;
        await page.getByRole('button', { name: 'Permanent delete', exact: true }).click();
        await page.getByLabel('Type the salon name to confirm').fill('Edited Salon');
        await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
        await page.getByText('Active retention hold', { exact: true }).waitFor();
        assert.ok(await page.getByText('Edited Salon', { exact: true }).first().isVisible());
        deleteBlocked = false;
        await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
        await page.getByText('No salons match your search.').waitFor();
        assert.ok(requests.filter(r => r.method === 'DELETE').every(r => r.body === null)); checks++;
        await page.getByRole('link', { name: 'Bookings', exact: true }).click();
        await page.getByText('Live customer', { exact: true }).waitFor(); checks++;
        await page.getByRole('button', { name: 'Update status', exact: true }).click();
        await page.locator('#booking-form select[name="status"]').selectOption('CANCELLED');
        await page.getByRole('button', { name: 'Save status', exact: true }).click();
        await page.getByText('Booking status saved.', { exact: true }).waitFor();
        assert.ok(requests.some(r => r.path === '/api/v1/bookings/b1' && JSON.parse(r.body).status === 'CANCELLED')); checks++;
        await page.getByRole('link', { name: 'Messages', exact: true }).click();
        await page.getByText('Fresh server message', { exact: true }).waitFor(); checks++;
        await page.getByRole('button', { name: 'Compose message', exact: true }).click();
        await page.getByLabel('Recipient', { exact: true }).selectOption('u:owner-2');
        await page.getByLabel('Message', { exact: true }).fill('New message');
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await page.getByText('Message sent.', { exact: true }).waitFor();
        assert.ok(requests.some(r => r.path === '/api/v1/messages' && r.method === 'POST' && JSON.parse(r.body).recipientId === 'owner-2')); checks++;
        await page.getByRole('link', { name: 'Promotions', exact: true }).click();
        await page.getByText('Real offer', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Disable', exact: true }).click();
        await page.getByText('Offer status saved.', { exact: true }).waitFor();
        assert.ok(requests.some(r => r.path === '/api/v1/salons/s1/offers/o1' && r.method === 'PATCH' && JSON.parse(r.body).isActive === false)); checks++;
        const offerPatch = JSON.parse(requests.find(r => r.path.endsWith('/offers/o1') && r.method === 'PATCH').body);
        assert.equal(offerPatch.discount, 5); assert.equal(offerPatch.availableSlots, 3);
        assert.equal(offerPatch.title, 'Real offer'); checks++;
        await page.getByRole('link', { name: 'Loyalty', exact: true }).click();
        await page.getByRole('button', { name: 'View customers' }).click();
        await page.getByText('Loyal customer', { exact: true }).waitFor(); checks++;
        await page.getByRole('button', { name: 'Close dialog' }).click();
        for (const width of [375, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); } checks++;
        await page.getByRole('link', { name: 'Subscriptions', exact: true }).click();
        await page.getByText('No records available.', { exact: true }).waitFor();
        assert.equal(requests.some(r => r.path === '/api/v1/subscriptions/me'), false); checks++;
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    // Stored role claims never grant entry without a fresh authenticated role check.
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('meshwarApiAuth', JSON.stringify({ accessToken: 'stale-token', role: 'ADMIN' })));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/auth/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { role: 'OWNER' } }) });
      const relative = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      if (['admin/index.html', 'admin/admin.js', 'admin/admin.css', 'assets/salon-intake-controls.js', 'assets/salon-extras.js'].includes(relative)) return route.fulfill({ contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
      return route.abort();
    });
    await page.goto('http://admin.test/admin/');
    await page.getByText('An ADMIN account is required.').waitFor();
    assert.equal(await page.locator('#workspace').isVisible(), false); checks++;
    await page.close();
    console.log(`PASS ${checks} dedicated Admin checks`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
