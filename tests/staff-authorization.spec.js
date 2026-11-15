// All HTTP is intercepted. Credentials and accounts are synthetic; never log their values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), fs.readFileSync(path.join(root, 'www/index.html'), 'utf8'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const target of ['.', 'www']) {
      const context = await browser.newContext();
      let access = 'fixture-access', refreshes = 0, refreshAllowed = false, rejectAccess = false, selfDenied = false;
      let active = null, presence = 'OFF_DUTY', visitCount = 0, holdSelf = null;
      const protectedRequests = [], errors = [], queue = [{ id: 'waiting', status: 'WAITING' }, { id: 'called', status: 'CALLED' }];
      const info = () => ({ user: { id: 'staff-1', role: 'STAFF', fullName: 'Fixture' }, membership: { id: 'member-1', salonId: 'salon-1', salon: { name: 'Fixture' } }, presenceState: presence, occupancy: active ? 'BUSY' : presence === 'ON_DUTY_CONFIRMED' ? 'AVAILABLE' : 'NOT_AVAILABLE', hasActiveVisit: Boolean(active), activeVisitId: active, activeVisitStartedAt: active ? new Date(Date.now() - 1000).toISOString() : null, serverTime: new Date().toISOString() });
      await context.addInitScript(() => {
        localStorage.setItem('meshwarLang', 'en'); localStorage.setItem('meshwarSelectedExperience', 'men'); sessionStorage.setItem('meshwarEntryChoiceSeen', 'true');
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const credentials = () => ({ accessToken: access, refreshToken: 'fixture-refresh', user: info().user });
        if (url.pathname === '/api/v1/auth/login') return json(credentials());
        if (url.pathname === '/api/v1/auth/refresh') {
          refreshes++;
          if (!refreshAllowed) return json({ error: 'Fixture unauthorized' }, 401);
          access = 'fixture-rotated'; rejectAccess = false; return json(credentials());
        }
        const protectedPath = url.pathname === '/api/v1/staff/me' || url.pathname.startsWith('/api/v1/salons/salon-1/');
        if (protectedPath) {
          const authorized = !rejectAccess && req.headers().authorization === `Bearer ${access}`;
          const status = authorized ? (selfDenied && url.pathname === '/api/v1/staff/me' ? 403 : 200) : 401;
          protectedRequests.push({ path: url.pathname, method: req.method(), authorized, status });
          if (holdSelf && url.pathname === '/api/v1/staff/me') { const wait = holdSelf; holdSelf = null; await wait; }
          if (status !== 200) return json({ error: 'Fixture denied' }, status);
          if (url.pathname === '/api/v1/staff/me') return json(info());
          if (url.pathname.endsWith('/duty')) { presence = req.postDataJSON().dutyState === 'ON_DUTY' ? 'ON_DUTY_CONFIRMED' : 'OFF_DUTY'; return json({ ok: true }); }
          if (url.pathname.endsWith('/presence/confirm')) { assert.equal(presence, 'ON_DUTY_CONFIRMED'); return json({ ok: true }); }
          if (url.pathname.endsWith('/queue') && req.method() === 'GET') return json({ queue: queue.filter(e => ['WAITING', 'CALLED'].includes(e.status)).map(e => ({ ...e, source: 'SALO_TICKET', customer: { name: 'Fixture' }, joinedAt: new Date().toISOString() })) });
          if (url.pathname.includes('/queue/') && url.pathname.endsWith('/start')) {
            const entry = queue.find(e => url.pathname.endsWith(`/queue/${e.id}/start`));
            assert.ok(entry && ['WAITING', 'CALLED'].includes(entry.status)); assert.equal(req.postDataJSON().staffMembershipId, 'member-1');
            assert.equal(presence, 'ON_DUTY_CONFIRMED'); entry.status = 'STARTED'; active = 'visit-' + (++visitCount); return json({ ok: true });
          }
          if (url.pathname.endsWith('/service-visits') && req.method() === 'POST') {
            assert.equal(presence, 'ON_DUTY_CONFIRMED'); assert.equal(req.postDataJSON().source, 'WALK_IN'); assert.equal(req.postDataJSON().staffMembershipId, 'member-1');
            active = 'visit-' + (++visitCount); return json({ ok: true });
          }
          if (url.pathname.endsWith('/complete')) { assert.ok(active && url.pathname.endsWith(`/service-visits/${active}/complete`)); active = null; return json({ ok: true }); }
          return json({});
        }
        if (url.pathname.startsWith('/api/')) return json({ salons: [], queue: [], notifications: [], unreadCount: 0, messages: [], plans: [], settings: { staffStatusLiveEnabled: true } });
        const relative = url.pathname.slice(1) || 'index.html';
        if (relative === 'index.html' || relative.startsWith('assets/')) {
          const file = path.join(root, target, relative);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        }
        return route.abort();
      });
      try {
        const page = await context.newPage(); page.on('dialog', dialog => dialog.dismiss()); page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://localhost:8000/index.html');
        await page.evaluate(() => {
          openModal('customerLoginModal'); document.getElementById('customerLoginEmail').value = 'fixture@example.test'; document.getElementById('customerLoginPassword').value = 'fixture-password'; document.getElementById('customerLoginForm').requestSubmit();
        });
        await page.locator('#staffModal.show').waitFor(); await page.locator('[data-staff-queue-start="waiting"]').waitFor();
        assert.equal(refreshes, 0); assert.ok(protectedRequests.length > 0 && protectedRequests.every(r => r.authorized)); checks++;
        await page.evaluate(async () => { await document.getElementById('staffDutyToggle').onclick(); await document.getElementById('staffConfirmPresence').onclick(); });
        assert.ok(protectedRequests.some(r => r.path.endsWith('/duty'))); assert.ok(protectedRequests.some(r => r.path.endsWith('/presence/confirm'))); checks += 2;
        for (const id of ['waiting', 'called']) {
          await page.locator(`[data-staff-queue-start="${id}"]`).click();
          await page.waitForFunction(() => Boolean(window.__staffInfo?.activeVisitId));
          assert.equal(queue.find(e => e.id === id).status, 'STARTED'); checks++;
          await page.evaluate(() => document.getElementById('staffEndService').onclick());
          assert.equal(active, null); checks++;
        }
        await page.evaluate(() => document.getElementById('staffStartService').onclick()); assert.ok(active); checks++;
        await page.evaluate(() => document.getElementById('staffEndService').onclick()); assert.equal(active, null); checks++;
        const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/staff/me'); await page.locator('#staffRefresh').evaluate(button => button.click()); await refreshed; checks++;
        await page.waitForLoadState('networkidle');
        assert.ok(protectedRequests.every(r => r.authorized)); assert.equal(refreshes, 0); checks++;
        // Existing refresh lifecycle is used only after a genuinely rejected access token.
        rejectAccess = true; refreshAllowed = true;
        await page.evaluate(() => staffApiRequest('/api/v1/staff/me'));
        assert.equal(refreshes, 1); assert.ok(protectedRequests.some(r => r.status === 401)); checks++;
        refreshAllowed = false;
        rejectAccess = true;
        const rejected = await page.evaluate(() => staffApiRequest('/api/v1/staff/me').then(() => 0, error => error.status));
        assert.equal(rejected, 401); checks++;
        rejectAccess = false;
        selfDenied = true;
        const denied = await page.evaluate(() => staffApiRequest('/api/v1/staff/me').then(() => 0, error => error.status));
        assert.equal(denied, 403); checks++;
        selfDenied = false;
        // Fail closed before sending requests for missing/malformed/foreign credentials.
        for (const variant of ['missing', 'malformed', 'other-user', 'other-role', 'other-session']) {
          const before = protectedRequests.length, beforeRefresh = refreshes;
          const status = await page.evaluate(variant => {
            closeModal('staffModal'); window.SaloBusyReminder?.stop();
            session = { role: 'staff', userId: 'staff-1', salonId: 'salon-1' };
            localStorage.setItem('meshwarSession', JSON.stringify(session));
            const stored = { role: variant === 'other-role' ? 'OWNER' : 'STAFF', userId: variant === 'other-user' ? 'staff-2' : 'staff-1', accessToken: 'fixture-rotated', refreshToken: 'fixture-refresh' };
            localStorage.setItem('meshwarApiAuth', JSON.stringify(stored));
            if (variant === 'missing') localStorage.removeItem('meshwarApiAuth');
            if (variant === 'malformed') localStorage.setItem('meshwarApiAuth', '{broken');
            if (variant === 'other-session') localStorage.setItem('meshwarSession', JSON.stringify({ role: 'owner', userId: 'staff-2' }));
            return staffApiRequest('/api/v1/staff/me').then(() => 0, error => error.status);
          }, variant);
          assert.equal(status, 401); assert.equal(protectedRequests.length, before); assert.equal(refreshes, beforeRefresh); checks++;
          await page.evaluate(() => openStaffPanel()); assert.equal(await page.locator('#staffModal').isVisible(), false);
        }
        // An account replacement while the request is in flight cannot enter Staff UI.
        for (const rejectedResponse of [false, true]) {
          rejectAccess = rejectedResponse;
          const beforeRefresh = refreshes;
          await page.evaluate(() => {
            session = { role: 'staff', userId: 'staff-1' }; localStorage.setItem('meshwarSession', JSON.stringify(session));
            localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-1', accessToken: 'fixture-rotated' }));
          });
          let release; holdSelf = new Promise(resolve => { release = resolve; });
          const pending = page.evaluate(() => openStaffPanel());
          const deadline = Date.now() + 10000;
          while (holdSelf && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
          assert.equal(holdSelf, null, 'protected request must reach fixture');
          await page.evaluate(() => localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'OWNER', userId: 'other', accessToken: 'fixture-other' })));
          release(); await pending; assert.equal(await page.locator('#staffModal').isVisible(), false); assert.equal(refreshes, beforeRefresh); checks++;
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${target}: authenticated staff login/actions, refresh, denial and account isolation`);
      } finally { await context.close(); }
    }
    console.log(`PASS ${checks} Staff authorization checks; root/www match`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
