// Disposable browser contexts, intercepted APIs, synthetic credentials only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const target of ['.', 'www']) {
      const context = await browser.newContext();
      const errors = [], mutations = [];
      let hold = null, overdue = true;
      const info = () => ({ user: { id: 'staff-1', role: 'STAFF', fullName: 'Fixture' }, membership: { id: 'member-1', salonId: 'salon-1', salon: { name: 'Fixture' } }, presenceState: 'STALE', occupancy: 'BUSY', hasActiveVisit: true, activeVisitId: 'visit-1', activeVisitStartedAt: new Date(Date.now() - (overdue ? 41 : 1) * 60000).toISOString(), serverTime: new Date().toISOString() });
      await context.addInitScript(() => {
        localStorage.setItem('meshwarLang', 'en'); localStorage.setItem('meshwarSelectedExperience', 'men'); sessionStorage.setItem('meshwarEntryChoiceSeen', 'true');
        window.__audioStops = 0;
        window.AudioContext = class {
          state = 'suspended'; currentTime = 0; destination = {};
          async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; window.__audioStops++; }
          createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() { queueMicrotask(() => this.onended?.()); } }; }
          createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
        };
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const captured = info();
        if (hold && url.pathname === hold.path) { const wait = hold; hold = null; wait.seen(); await wait.promise; captured.user.fullName = 'Obsolete response'; }
        if (url.pathname === '/api/v1/auth/login' || url.pathname === '/api/v1/auth/refresh') return json({ user: info().user, accessToken: url.pathname.endsWith('/refresh') ? 'fixture-refreshed' : 'fixture-access', refreshToken: 'fixture-refresh' });
        if (url.pathname === '/api/v1/staff/me') return json(captured);
        if (url.pathname.startsWith('/api/')) {
          if (req.method() !== 'GET') mutations.push(url.pathname);
          return json({ salons: [], queue: [], notifications: [], unreadCount: 0, messages: [], plans: [], settings: { staffStatusLiveEnabled: true } });
        }
        if (url.pathname === '/writer') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated storage writer</title>' });
        const relative = url.pathname.slice(1) || 'index.html';
        if (relative === 'index.html' || relative.startsWith('assets/')) {
          const file = path.join(root, target, relative);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        }
        return route.abort();
      });
      try {
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.dismiss());
        await page.goto('http://localhost:8000/index.html');
        const submitLogin = () => page.evaluate(() => {
          openModal('customerLoginModal'); document.getElementById('customerLoginEmail').value = 'fixture@example.test'; document.getElementById('customerLoginPassword').value = 'fixture-password'; document.getElementById('customerLoginForm').requestSubmit();
        });
        async function login() { await submitLogin(); await page.locator('#staffModal.show').waitFor(); await page.waitForLoadState('networkidle'); }
        function delay(path) {
          let release, seen; const promise = new Promise(resolve => { release = resolve; }); const arrived = new Promise(resolve => { seen = resolve; });
          hold = { path, promise, seen }; return { release, arrived };
        }
        async function assertLoggedOut() {
          const state = await page.evaluate(() => ({ closed: !document.getElementById('staffModal').classList.contains('show'), noAuth: localStorage.getItem('meshwarApiAuth') === null, noSession: localStorage.getItem('meshwarSession') === null, noMemory: window.__staffInfo === null, emptyQueue: !document.getElementById('staffQueueList').hasChildNodes(), stopped: document.getElementById('saloBusyReminder').hidden }));
          assert.ok(Object.values(state).every(Boolean), 'Staff UI, matching credentials, memory and reminder must be cleared');
        }
        await login(); await page.locator('#saloBusyReminder:visible').waitFor();
        await page.locator('#saloBusySound').click();
        await page.locator('#staffLogout').evaluate(button => button.click());
        await assertLoggedOut(); checks++;
        await page.waitForFunction(() => window.__audioStops > 0);
        await page.waitForFunction(async () => !(await navigator.locks.query()).held.some(lock => lock.name.startsWith('saloBusyReminder:'))); checks++;
        assert.equal(info().occupancy, 'BUSY'); assert.equal(info().hasActiveVisit, true); assert.deepEqual(mutations, []); checks++;
        const blocked = await page.evaluate(() => staffApiRequest('/api/v1/staff/me').then(() => 0, error => error.status)); assert.equal(blocked, 401); checks++;
        overdue = false;
        await login(); assert.equal(await page.locator('#staffDutyToggle').isEnabled(), true); checks++;
        // Logout blocks a delayed authenticated response from reopening the panel.
        let deferred = delay('/api/v1/staff/me'); let pending = page.evaluate(() => openStaffPanel()); await deferred.arrived;
        await page.evaluate(() => logout('staff')); deferred.release(); await pending; await assertLoggedOut(); checks++;
        // Even a same-account re-login must not accept old request results.
        await login(); deferred = delay('/api/v1/staff/me'); pending = page.evaluate(() => openStaffPanel()); await deferred.arrived;
        await page.evaluate(() => logout('staff')); await login(); deferred.release(); await pending;
        assert.equal(await page.evaluate(() => window.__staffInfo.user.fullName), 'Fixture'); checks++;
        // Queue reads and refresh-button requests cannot repopulate cleared state.
        deferred = delay('/api/v1/salons/salon-1/queue'); pending = page.evaluate(() => loadStaffQueue('salon-1', document.getElementById('staffQueueList'), 'member-1')); await deferred.arrived;
        await page.evaluate(() => logout('staff')); deferred.release(); await pending; await assertLoggedOut(); checks++;
        await login(); deferred = delay('/api/v1/staff/me');
        await page.locator('#staffRefresh').evaluate(button => button.click()); await deferred.arrived;
        await page.evaluate(() => logout('staff')); deferred.release(); await page.waitForLoadState('networkidle'); await assertLoggedOut(); checks++;
        // A delayed reminder read cannot restore memory after same-account re-login.
        await login(); deferred = delay('/api/v1/staff/me'); pending = page.evaluate(() => window.SaloBusyReminder.sync(window.__staffInfo)); await deferred.arrived;
        await page.evaluate(() => logout('staff')); await login(); deferred.release(); await pending;
        assert.equal(await page.evaluate(() => window.__staffInfo.user.fullName), 'Fixture'); checks++;
        await page.evaluate(() => logout('staff'));
        // A pending login is discarded after an explicit Staff logout.
        deferred = delay('/api/v1/auth/login'); await submitLogin(); await deferred.arrived;
        await page.evaluate(() => logout('staff')); deferred.release(); await page.waitForLoadState('networkidle'); await assertLoggedOut(); checks++;
        // A pending refresh cannot restore departed credentials.
        await login(); deferred = delay('/api/v1/auth/refresh'); pending = page.evaluate(() => refreshAccessToken()); await deferred.arrived;
        await page.evaluate(() => logout('staff')); deferred.release(); assert.equal(await pending, null); await assertLoggedOut(); checks++;
        const writer = await context.newPage(); await writer.goto('http://localhost:8000/writer');
        // A different account replaces shared storage: close only the old Staff UI.
        await login();
        await writer.evaluate(() => {
          localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'OWNER', userId: 'owner-2', accessToken: 'fixture-new' }));
          localStorage.setItem('meshwarSession', JSON.stringify({ role: 'owner', userId: 'owner-2' }));
        });
        await page.waitForFunction(() => !document.getElementById('staffModal').classList.contains('show'));
        await page.evaluate(() => logout('staff'));
        assert.equal(await writer.evaluate(() => JSON.parse(localStorage.getItem('meshwarApiAuth')).userId === 'owner-2' && JSON.parse(localStorage.getItem('meshwarSession')).role === 'owner'), true); checks++;
        // Same-account newer credentials are preserved, even after an authenticated read.
        await login();
        await writer.evaluate(() => localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-1', accessToken: 'fixture-newer' })));
        await page.evaluate(() => staffApiRequest('/api/v1/staff/me'));
        await page.evaluate(() => logout('staff'));
        assert.equal(await writer.evaluate(() => JSON.parse(localStorage.getItem('meshwarApiAuth')).accessToken === 'fixture-newer' && JSON.parse(localStorage.getItem('meshwarSession')).role === 'staff'), true); checks++;
        // Own refresh credentials remain part of this tab's departing session.
        await login(); await page.evaluate(() => refreshAccessToken()); await page.evaluate(() => logout('staff')); await assertLoggedOut(); checks++;
        for (const role of ['customer', 'owner', 'admin']) {
          const preserved = await page.evaluate(role => {
            session = { role, userId: 'unrelated' }; const ui = JSON.stringify(session), auth = JSON.stringify({ role: role.toUpperCase(), userId: 'unrelated', accessToken: 'fixture-other' });
            localStorage.setItem('meshwarSession', ui); localStorage.setItem('meshwarApiAuth', auth); openModal('ownerModal');
            logout('staff'); return JSON.stringify(session) === ui && localStorage.getItem('meshwarSession') === ui && localStorage.getItem('meshwarApiAuth') === auth && document.getElementById('ownerModal').classList.contains('show');
          }, role); assert.equal(preserved, true); checks++;
        }
        // Genuine logout from another tab invalidates the Staff UI without writes.
        await login(); await writer.evaluate(() => { localStorage.removeItem('meshwarApiAuth'); localStorage.removeItem('meshwarSession'); });
        await page.waitForFunction(() => window.__staffInfo === null); await assertLoggedOut(); checks++;
        assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
        console.log(`PASS ${target}: Staff logout, delayed operations, reminder cleanup, newer credentials and unrelated roles`);
      } finally { await context.close(); }
    }
    for (const relative of ['index.html', 'assets/smart-busy-reminder.js']) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), fs.readFileSync(path.join(root, 'www', relative), 'utf8'));
    console.log(`PASS ${checks} Staff logout checks; root/www match`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
