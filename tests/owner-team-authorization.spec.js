// Intercepted APIs and synthetic credentials only. Never print credential values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const SALON = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const target of ['.', 'www']) {
      const context = await browser.newContext();
      let access = 'fixture-access', refreshes = 0, expired = false, allowRefresh = false, forbidden = false, hold = null;
      const requests = [], errors = [];
      const salon = { id: SALON, ownerId: 'owner-1', name: 'Fixture', city: 'Berlin', services: [], barbers: [], media: [], reviews: [] };
      let team = [{ membershipId: MEMBER, status: 'ACTIVE', occupancy: 'NOT_AVAILABLE', user: { fullName: 'Fixture Staff', email: 'staff@example.test' }, barber: { name: 'Fixture Barber' } }];
      await context.addInitScript(({ salonId }) => {
        localStorage.setItem('meshwarLang', 'en'); localStorage.setItem('meshwarSelectedExperience', 'men'); sessionStorage.setItem('meshwarEntryChoiceSeen', 'true');
        localStorage.setItem('meshwarSession', JSON.stringify({ role: 'owner', userId: 'owner-1', salonId }));
        localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'OWNER', userId: 'owner-1', accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }));
      }, { salonId: SALON });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (hold && url.pathname === hold.path) { const wait = hold; hold = null; wait.seen(); await wait.promise; }
        if (url.pathname === '/api/v1/auth/refresh') {
          refreshes++;
          if (!allowRefresh) return json({ error: 'Fixture unauthorized' }, 401);
          access = 'fixture-rotated'; expired = false;
          return json({ accessToken: access, refreshToken: 'fixture-refreshed', user: { id: 'owner-1', role: 'OWNER' } });
        }
        if (url.pathname === `/api/v1/salons/${SALON}/team` || url.pathname.startsWith(`/api/v1/salons/${SALON}/team/`)) {
          const authorized = !expired && req.headers().authorization === `Bearer ${access}`;
          const status = !authorized ? 401 : forbidden ? 403 : 200;
          requests.push({ path: url.pathname, method: req.method(), authorized, status });
          if (status !== 200) return json({ error: 'Fixture denied' }, status);
          if (req.method() === 'GET') return json({ team });
          if (req.method() === 'POST') { team.push({ membershipId: 'new-member', status: 'ACTIVE', occupancy: 'NOT_AVAILABLE', user: { fullName: 'New Fixture' }, barber: { name: 'New Fixture' } }); return json({ ok: true }, 201); }
          if (req.method() === 'PATCH') { const value = req.postDataJSON().status; assert.ok(['ACTIVE', 'SUSPENDED'].includes(value)); team[0].status = value; return json({ ok: true }); }
          if (req.method() === 'DELETE') { team[0].status = 'REVOKED'; return json({ ok: true }); }
        }
        if (url.pathname === '/api/v1/owner/dashboard') return json({ user: { id: 'owner-1', role: 'OWNER' }, salons: [salon] });
        if (url.pathname.endsWith('/subscriptions/me')) return json({ subscription: { plan: 'SMART', status: 'ACTIVE' } });
        if (url.pathname.endsWith('/staff/status')) return json({ staff: [], expiresAt: new Date(Date.now() + 15000).toISOString() });
        if (url.pathname.startsWith('/api/')) return json({ salons: [], queue: [], notifications: [], unreadCount: 0, messages: [], plans: [], bookings: [], team: [], settings: { staffStatusLiveEnabled: true } });
        const relative = url.pathname.slice(1) || 'index.html', file = path.join(root, target, relative);
        if ((relative === 'index.html' || relative.startsWith('assets/')) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.abort();
      });
      try {
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.dismiss());
        await page.goto('http://localhost:8000/index.html'); await page.locator('#ownerModal.show').waitFor();
        await page.waitForFunction(() => window.__ownerTeam?.length > 0); await page.waitForLoadState('networkidle');
        assert.ok(requests.length > 0 && requests.every(req => req.authorized)); assert.equal(refreshes, 0); checks++;
        await page.locator('[data-owner-panel-tab="team"]').evaluate(button => button.click());
        await page.evaluate(() => {
          document.getElementById('teamAddName').value = 'New Fixture'; document.getElementById('teamAddEmail').value = 'new@example.test';
          document.getElementById('teamAddPassword').value = 'Synthetic-initial-passphrase'; document.getElementById('teamAddBarberName').value = 'New Fixture';
          document.getElementById('teamAddButton').click();
        });
        await page.waitForFunction(() => document.getElementById('teamAddResult').textContent === ownerText('teamAddSuccess'));
        assert.ok(requests.some(req => req.method === 'POST')); checks++;
        for (const [action, status] of [['suspend', 'SUSPENDED'], ['activate', 'ACTIVE'], ['revoke', 'REVOKED']]) {
          await page.locator(`[data-membership-id="${MEMBER}"] [data-team-action="${action}"]`).evaluate(button => button.click());
          await page.waitForFunction(status => window.__ownerTeam?.[0]?.status === status, status); checks++;
        }
        assert.equal(refreshes, 0); assert.ok(requests.every(req => req.authorized)); checks++;
        expired = true; allowRefresh = true;
        await page.evaluate(salonId => ownerTeamApiRequest(salonId), SALON);
        assert.equal(refreshes, 1); assert.ok(requests.some(req => req.status === 401)); checks++;
        allowRefresh = false; forbidden = true;
        const denied = await page.evaluate(salonId => ownerTeamApiRequest(salonId).then(() => 0, error => error.status), SALON); assert.equal(denied, 403); checks++;
        forbidden = false;
        for (const variant of ['missing', 'malformed', 'other-user', 'other-role', 'other-session', 'no-session', 'foreign-salon']) {
          const before = requests.length, beforeRefresh = refreshes;
          const status = await page.evaluate(({ variant, salonId }) => {
            session = { role: 'owner', userId: 'owner-1', salonId }; activeOwnerId = salonId; data = { ...data, id: salonId, ownerId: 'owner-1' };
            localStorage.setItem('meshwarSession', JSON.stringify(session));
            localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: variant === 'other-role' ? 'STAFF' : 'OWNER', userId: variant === 'other-user' ? 'owner-2' : 'owner-1', accessToken: 'fixture-rotated', refreshToken: 'fixture-refresh' }));
            if (variant === 'missing') localStorage.removeItem('meshwarApiAuth');
            if (variant === 'malformed') localStorage.setItem('meshwarApiAuth', '{broken');
            if (variant === 'other-session') localStorage.setItem('meshwarSession', JSON.stringify({ role: 'owner', userId: 'owner-2' }));
            if (variant === 'no-session') session = null;
            return ownerTeamApiRequest(variant === 'foreign-salon' ? 'foreign-salon' : salonId).then(() => 0, error => error.status);
          }, { variant, salonId: SALON });
          assert.equal(status, variant === 'foreign-salon' ? 403 : 401); assert.equal(requests.length, before); assert.equal(refreshes, beforeRefresh); checks++;
        }
        const restore = () => page.evaluate(salonId => {
          session = { role: 'owner', userId: 'owner-1', salonId }; activeOwnerId = salonId; data = { ...data, id: salonId, ownerId: 'owner-1' };
          localStorage.setItem('meshwarSession', JSON.stringify(session));
          localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'OWNER', userId: 'owner-1', accessToken: 'fixture-rotated', refreshToken: 'fixture-refresh' }));
        }, SALON);
        function delay(path) { let release, seen; const promise = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { seen = resolve; }); hold = { path, promise, seen }; return { release, arrived }; }
        await restore(); let deferred = delay(`/api/v1/salons/${SALON}/team`);
        let pending = page.evaluate(salonId => ownerTeamApiRequest(salonId).then(() => 0, error => error.status), SALON); await deferred.arrived;
        await page.evaluate(() => localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-other', accessToken: 'fixture-other' })));
        deferred.release(); assert.equal(await pending, 401); checks++;
        await restore(); deferred = delay(`/api/v1/salons/${SALON}/team`);
        pending = page.evaluate(() => loadOwnerTeamFromAPI()); await deferred.arrived;
        await page.evaluate(() => { activeOwnerId = 'other-salon'; window.__ownerTeam = [{ membershipId: 'new-salon-sentinel' }]; });
        deferred.release(); await pending; assert.equal(await page.evaluate(() => window.__ownerTeam[0].membershipId), 'new-salon-sentinel'); checks++;
        await restore(); expired = true; allowRefresh = true; deferred = delay('/api/v1/auth/refresh');
        pending = page.evaluate(salonId => ownerTeamApiRequest(salonId).then(() => 0, error => error.status), SALON); await deferred.arrived;
        await page.evaluate(() => {
          session = { role: 'staff', userId: 'staff-other' }; localStorage.setItem('meshwarSession', JSON.stringify(session));
          localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-other', accessToken: 'fixture-other' }));
        });
        deferred.release(); assert.equal(await pending, 401);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('meshwarApiAuth')).userId === 'staff-other'), true); checks++;
        assert.deepEqual(errors, []);
        console.log(`PASS ${target}: Owner Team headers, actions, tenant/account isolation and safe refresh`);
      } finally { await context.close(); }
    }
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), fs.readFileSync(path.join(root, 'www/index.html'), 'utf8'));
    console.log(`PASS ${checks} Owner Team browser checks; root/www match`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
