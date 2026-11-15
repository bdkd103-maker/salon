// Real Staff Panel + Web Locks; every HTTP request intercepted, synthetic accounts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const START = Date.parse('2026-01-01T10:00:00Z');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const lang of ['de', 'en', 'ar']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      let active = 'visit-1', fail = false, completeCount = 0, serverTime = START + 40 * 60000, reads = 0;
      const clockOrigin = Date.now();
      const errors = [], writes = [];
      const info = () => ({ user: { id: 'staff-1', role: 'STAFF', fullName: 'Fixture' }, membership: { id: 'member-1', salonId: 'salon-1', salon: { name: 'Fixture', city: 'Berlin' } }, presenceState: 'STALE', occupancy: active ? 'BUSY' : 'NOT_AVAILABLE', hasActiveVisit: Boolean(active), activeVisitId: active, activeVisitStartedAt: active ? new Date(START).toISOString() : null, serverTime: new Date(serverTime + Date.now() - clockOrigin).toISOString() });
      await context.addInitScript(({ lang }) => {
        localStorage.setItem('meshwarLang', lang); localStorage.setItem('meshwarSelectedExperience', 'men'); sessionStorage.setItem('meshwarEntryChoiceSeen', 'true');
        localStorage.setItem('meshwarSession', JSON.stringify({ role: 'staff', userId: 'staff-1', salonId: 'salon-1' }));
        localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-1', accessToken: 'fixture-access' }));
        window.__tones = 0;
        window.AudioContext = class {
          state = 'suspended'; currentTime = 0; destination = {};
          async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; }
          createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() { window.__tones++; }, stop() { queueMicrotask(() => this.onended?.()); } }; }
          createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
        };
      }, { lang });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/api/')) {
          if (req.method() !== 'GET') writes.push({ path: url.pathname, method: req.method() });
          if (url.pathname === '/api/v1/staff/me') { reads++; return json(info()); }
          if (url.pathname.endsWith('/service-visits/visit-1/complete')) { assert.equal(req.headers().authorization, 'Bearer fixture-access'); completeCount++; if (fail) return json({ error: 'Fixture failure' }, 500); active = null; return json({ ok: true, serviceVisit: { id: 'visit-1', status: 'COMPLETED' }, occupancy: 'NOT_AVAILABLE' }); }
          if (url.pathname.includes('platform-settings')) return json({ settings: { siteName: 'SALO', staffStatusLiveEnabled: true } });
          if (url.pathname.includes('live-status')) return json({ salons: [] });
          if (url.pathname.endsWith('/salons')) return json({ salons: [] });
          if (url.pathname.endsWith('/queue')) return json({ queue: [] });
          return json({ notifications: [], unreadCount: 0, messages: [], plans: [], products: [], bookings: [] });
        }
        const relative = url.pathname.slice(1) || 'index.html';
        if (relative === 'index.html' || relative.startsWith('assets/')) {
          const file = path.join(root, relative);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        }
        return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://localhost:8000/index.html');
      await page.locator('#staffModal.show').waitFor();
      try { await page.locator('#saloBusyReminder:visible').waitFor(); }
      catch (error) { console.error('Initial reminder diagnostics', { lang, reads, errors, controller: await page.evaluate(() => Boolean(window.SaloBusyReminder)), locks: await page.evaluate(() => Boolean(navigator.locks)), eligibleSession: await page.evaluate(() => session?.role === 'staff' && Boolean(session.userId)) }); throw error; }
      console.log(`PASS ${lang} initial reminder`); checks++;
      const expected = { de: 'Bist du noch beschäftigt?', en: 'Are you still busy?', ar: 'بعدك مشغول؟' };
      assert.equal(await page.locator('#saloBusyTitle').textContent(), expected[lang]); checks++;
      assert.equal(await page.evaluate(() => window.__tones), 0, 'no audio before explicit interaction');
      await page.locator('#saloBusySound').click();
      assert.equal(await page.locator('#saloBusySound').getAttribute('aria-pressed'), 'true'); checks++;
      await page.locator('#saloBusyYes').click(); await page.waitForFunction(() => document.getElementById('saloBusyReminder').hidden);
      assert.equal(completeCount, 0); assert.equal(active, 'visit-1'); checks++;
      const state = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('saloBusyReminder:v1:')).map(k => ({ key: k, value: JSON.parse(localStorage.getItem(k)) })));
      assert.equal(state.length, 1); assert.equal(state[0].value.nextDueAt - state[0].value.acknowledgedAt, 600000); checks++;
      await page.reload(); await page.locator('#staffModal.show').waitFor();
      await page.waitForFunction(() => Boolean(window.SaloBusyReminder)); assert.equal(await page.locator('#saloBusyReminder').isVisible(), false); checks++;
      // Advance authoritative time without changing visit start or app code.
      serverTime += 11 * 60000;
      await page.evaluate(async () => { const fresh = await apiRequest('/api/v1/staff/me'); window.__staffInfo = fresh; renderStaffDashboard(fresh); });
      await page.locator('#saloBusyReminder:visible').waitFor();
      console.log(`PASS ${lang} reminder after reload and snooze`);
      fail = true; await page.locator('#saloBusyFinish').click();
      await page.waitForFunction(() => !document.getElementById('saloBusyFinish').disabled && document.querySelector('#saloBusyReminder p').textContent.length > 0);
      assert.equal(active, 'visit-1'); assert.equal(completeCount, 1); checks++;
      fail = false; await page.locator('#saloBusyFinish').evaluate(button => { button.click(); button.click(); });
      try { await page.waitForFunction(() => document.getElementById('saloBusyReminder').hidden); }
      catch (error) { console.error('Completion diagnostics', { completeCount, active, reads, errors, ui: await page.evaluate(() => ({ hidden: document.getElementById('saloBusyReminder').hidden, disabled: document.getElementById('saloBusyFinish').disabled, message: document.querySelector('#saloBusyReminder p').textContent })) }); throw error; }
      assert.equal(completeCount, 2); assert.equal(active, null); checks++;
      assert.ok(writes.every(r => r.method === 'PATCH' && r.path === '/api/v1/salons/salon-1/service-visits/visit-1/complete'));
      const layout = await page.locator('#staffServiceCard').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
      assert.equal(layout, true); checks++;
      assert.deepEqual(errors, []); assert.ok(reads < 30, 'no aggressive reads');
      await context.close(); console.log(`PASS ${lang} real Staff Panel integration`);
    }
    for (const relative of ['index.html', 'assets/smart-busy-reminder.js']) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), fs.readFileSync(path.join(root, 'www', relative), 'utf8'));
    console.log(`PASS ${checks} browser checks; root/www mirrors match`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
