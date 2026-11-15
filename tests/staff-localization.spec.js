// Real Staff Panel, intercepted APIs and disposable browser contexts only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const expected = {
  de: { title: 'Mitarbeiter-Bereich', service: 'Aktiver Service', active: 'Service läuft', empty: 'Kein aktiver Service', waiting: 'Wartend', called: 'Gerufen', ticket: 'SALO-Ticket', walkIn: 'Ohne Termin', booking: 'Termin', reminder: 'Bist du noch beschäftigt?' },
  en: { title: 'Staff Panel', service: 'Active service', active: 'Service in progress', empty: 'No active service', waiting: 'Waiting', called: 'Called', ticket: 'SALO Ticket', walkIn: 'Walk-in', booking: 'Appointment', reminder: 'Are you still busy?' },
  ar: { title: 'لوحة الموظف', service: 'الخدمة النشطة', active: 'الخدمة جارية', empty: 'لا توجد خدمة نشطة', waiting: 'ينتظر', called: 'تمت الدعوة', ticket: 'تذكرة SALO', walkIn: 'زائر دون موعد', booking: 'موعد', reminder: 'بعدك مشغول؟' },
};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let checks = 0;
  try {
    for (const target of ['.', 'www']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const errors = [], requests = [], dialogs = [];
      let active = 'visit-1', overdue = true, presence = 'STALE', queueError = 0, actionError = 0, hold = null;
      const allRows = [
        ['waiting', 'WAITING', 'SALO_TICKET'], ['called', 'CALLED', 'MANUAL_WALK_IN'], ['started', 'STARTED', 'WALK_IN'],
        ['service', 'IN_SERVICE', 'BOOKING'], ['done', 'COMPLETED', 'BOOKING'], ['cancelled', 'CANCELLED', 'WALK_IN'],
        ['expired', 'EXPIRED', 'SALO_TICKET'], ['absent', 'NO_SHOW', 'FUTURE_SOURCE'], ['unknown', 'FUTURE_STATUS', 'FUTURE_SOURCE'], ['unrecognized', '__proto__', 'constructor'],
      ].map(([id, status, source]) => ({ id, status, source, customer: id === 'unknown' ? null : { name: '<img src=x onerror="window.__unsafe=true">' }, joinedAt: id === 'unknown' ? 'invalid' : '2026-01-01T10:15:00Z' }));
      let rows = structuredClone(allRows);
      const info = () => ({ user: { id: 'staff-1', role: 'STAFF', fullName: 'Fixture' }, membership: { id: 'member-1', salonId: 'salon-1', salon: { name: 'Fixture', city: 'Berlin', address: 'Fixture street' } }, presenceState: presence, occupancy: active ? 'BUSY' : presence === 'ON_DUTY_CONFIRMED' ? 'AVAILABLE' : 'NOT_AVAILABLE', hasActiveVisit: Boolean(active), activeVisitId: active, activeVisitStartedAt: active ? new Date(Date.now() - (overdue ? 41 : 1) * 60000).toISOString() : null, serverTime: new Date().toISOString() });
      await context.addInitScript(() => {
        const fetch = window.fetch.bind(window);
        window.__staffFetchCount = 0;
        window.fetch = (url, options) => {
          const path = new URL(url, location.href).pathname;
          if (path === '/api/v1/staff/me' || path.startsWith('/api/v1/salons/salon-1/')) window.__staffFetchCount++;
          return fetch(url, options);
        };
        localStorage.setItem('meshwarLang', 'de'); localStorage.setItem('meshwarSelectedExperience', 'men'); sessionStorage.setItem('meshwarEntryChoiceSeen', 'true');
        localStorage.setItem('meshwarSession', JSON.stringify({ role: 'staff', userId: 'staff-1', salonId: 'salon-1' }));
        localStorage.setItem('meshwarApiAuth', JSON.stringify({ role: 'STAFF', userId: 'staff-1', accessToken: 'fixture-access' }));
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (hold && url.pathname === hold.path) { const wait = hold; hold = null; wait.seen(); await wait.promise; }
        if (url.pathname === '/api/v1/staff/me' || url.pathname.startsWith('/api/v1/salons/salon-1/')) {
          assert.ok(req.headers().authorization, 'protected request must remain authenticated');
          requests.push({ path: url.pathname, method: req.method() });
          if (req.method() !== 'GET' && actionError) return json({ error: 'Fixture failure' }, actionError);
          if (url.pathname === '/api/v1/staff/me') return json(info());
          if (url.pathname.endsWith('/queue')) return queueError ? json({ error: 'Fixture failure' }, queueError) : json({ queue: rows });
          if (url.pathname.endsWith('/duty')) { const value = req.postDataJSON().dutyState; assert.ok(['ON_DUTY', 'OFF_DUTY'].includes(value)); presence = value === 'ON_DUTY' ? 'ON_DUTY_CONFIRMED' : 'OFF_DUTY'; return json({ ok: true }); }
          if (url.pathname.endsWith('/presence/confirm')) return json({ ok: true });
          if (url.pathname.endsWith('/complete')) { active = null; return json({ ok: true }); }
          if (url.pathname.endsWith('/service-visits')) { assert.equal(req.postDataJSON().source, 'WALK_IN'); active = 'walk-in'; return json({ ok: true }); }
          if (url.pathname.includes('/queue/') && url.pathname.endsWith('/start')) {
            assert.equal(req.postDataJSON().staffMembershipId, 'member-1'); const row = rows.find(row => url.pathname.endsWith(`/queue/${row.id}/start`));
            assert.ok(row && ['WAITING', 'CALLED'].includes(row.status)); row.status = 'STARTED'; active = 'queue-visit'; return json({ ok: true });
          }
          return json({});
        }
        if (url.pathname.startsWith('/api/')) return json({ salons: [], notifications: [], unreadCount: 0, messages: [], plans: [], settings: { staffStatusLiveEnabled: true } });
        const relative = url.pathname.slice(1) || 'index.html', file = path.join(root, target, relative);
        if ((relative === 'index.html' || relative.startsWith('assets/')) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.abort();
      });
      try {
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
        await page.goto('http://localhost:8000/index.html'); await page.locator('#staffModal.show').waitFor(); await page.locator('#saloBusyReminder:visible').waitFor(); await page.waitForLoadState('networkidle');
        async function translated(selector, key) {
          const values = await page.evaluate(({ selector, key }) => ({ actual: document.querySelector(selector).textContent, expected: ownerText(key) }), { selector, key });
          assert.equal(values.actual, values.expected); checks++;
        }
        async function switchLanguage(lang, settle = true) {
          if (settle) await page.waitForLoadState('networkidle');
          const unchanged = await page.evaluate(lang => {
            const before = window.__staffFetchCount;
            applyLanguage(lang);
            return window.__staffFetchCount === before;
          }, lang);
          assert.equal(unchanged, true, 'language switching must not fetch Staff state or mutate services'); checks++;
        }
        for (const lang of ['de', 'en', 'ar', 'de']) {
          await page.locator('[data-staff-queue-start="waiting"]').focus();
          await page.evaluate(() => { document.getElementById('staffStartService').disabled = true; window.__originalHandler = document.getElementById('staffStartService').onclick; });
          await switchLanguage(lang);
          const text = expected[lang];
          assert.equal(await page.locator('#staffPanelHeading').textContent(), text.title);
          assert.equal(await page.locator('#staffServiceCard > h3').textContent(), text.service);
          assert.ok((await page.locator('#staffActiveService').textContent()).includes(text.active));
          assert.equal(await page.locator('[data-queue-id="waiting"] .owner-booking-status').textContent(), text.waiting);
          assert.equal(await page.locator('[data-queue-id="called"] .owner-booking-status').textContent(), text.called);
          assert.equal(await page.locator('[data-queue-id="waiting"] [data-owner-i18n="staffSourceTicket"]').textContent(), text.ticket);
          assert.equal(await page.locator('[data-queue-id="called"] [data-owner-i18n="queueWalkIn"]').textContent(), text.walkIn);
          assert.equal(await page.locator('[data-queue-id="service"] [data-owner-i18n="staffSourceBooking"]').textContent(), text.booking);
          assert.equal(await page.locator('#saloBusyTitle').textContent(), text.reminder); checks += 9;
          assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
          assert.equal(await page.locator('#staffModal').evaluate(el => getComputedStyle(el).direction), lang === 'ar' ? 'rtl' : 'ltr'); checks += 2;
          assert.equal(await page.evaluate(() => document.activeElement.dataset.staffQueueStart), 'waiting');
          assert.equal(await page.evaluate(() => document.getElementById('staffStartService').disabled && document.getElementById('staffStartService').onclick === window.__originalHandler), true); checks += 2;
          await translated('#staffDutyStatus', 'smart_notConfirmed'); await translated('#staffConfirmPresence', 'staffConfirmFree');
          await translated('[data-queue-id="unknown"] .owner-booking-status', 'staffUnknownStatus');
          await translated('[data-queue-id="unknown"] [data-owner-i18n="staffUnknownSource"]', 'staffUnknownSource');
          await translated('[data-queue-id="unrecognized"] .owner-booking-status', 'staffUnknownStatus');
          await translated('[data-queue-id="unrecognized"] [data-owner-i18n="staffUnknownSource"]', 'staffUnknownSource');
          await translated('[data-queue-id="unknown"] [data-owner-i18n="staffUnknownCustomer"]', 'staffUnknownCustomer');
          await translated('[data-queue-id="unknown"] [data-staff-joined-at]', 'staffUnknownTime');
          assert.equal(await page.locator('#staffModal [data-close]').getAttribute('aria-label'), await page.evaluate(() => ownerText('closeAction'))); checks++;
          const visibleText = await page.locator('#staffModal').innerText();
          const raw = visibleText.match(/\b(WAITING|CALLED|STARTED|IN_SERVICE|COMPLETED|CANCELLED|EXPIRED|NO_SHOW|WALK_IN|MANUAL_WALK_IN|SALO_TICKET|BOOKING|FUTURE_STATUS|FUTURE_SOURCE)\b/g);
          assert.equal(raw, null, `raw labels in ${lang}: ${raw}`);
          assert.equal(await page.locator('#staffQueueList img').count(), 0); assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false); checks += 3;
        }
        overdue = false;
        function delay(path) { let release, seen; const promise = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { seen = resolve; }); hold = { path, promise, seen }; return { release, arrived }; }
        let deferred = delay('/api/v1/salons/salon-1/queue');
        let pending = page.evaluate(() => loadStaffQueue('salon-1', document.getElementById('staffQueueList'), 'member-1')); await deferred.arrived;
        await translated('#staffQueueList', 'staffQueueLoading'); await switchLanguage('ar', false); await translated('#staffQueueList', 'staffQueueLoading'); deferred.release(); await pending;
        rows = []; await page.evaluate(() => loadStaffQueue('salon-1', document.getElementById('staffQueueList'), 'member-1')); await translated('#staffQueueList', 'queueEmpty');
        await switchLanguage('en'); await translated('#staffQueueList', 'queueEmpty');
        queueError = 403; await page.evaluate(() => loadStaffQueue('salon-1', document.getElementById('staffQueueList'), 'member-1')); await translated('#staffQueueList', 'staffQueueLoadError');
        await switchLanguage('de'); await translated('#staffQueueList', 'staffQueueLoadError'); queueError = 0;
        deferred = delay('/api/v1/staff/me'); await page.locator('#staffRefresh').evaluate(button => button.click()); await deferred.arrived;
        await translated('#staffFeedback', 'staffLoading'); await switchLanguage('ar', false); await translated('#staffFeedback', 'staffLoading'); deferred.release();
        await page.waitForFunction(() => document.getElementById('staffFeedback').dataset.ownerI18n === 'staffRefreshed'); await translated('#staffFeedback', 'staffRefreshed');
        await page.waitForLoadState('networkidle');
        deferred = delay('/api/v1/salons/salon-1/staff/member-1/duty'); pending = page.evaluate(() => document.getElementById('staffDutyToggle').onclick()); await deferred.arrived;
        await translated('#staffFeedback', 'staffSaving'); await switchLanguage('en', false); await translated('#staffFeedback', 'staffSaving'); deferred.release(); await pending;
        await translated('#staffFeedback', 'staffDutySaved'); await switchLanguage('ar');
        for (const [id, key] of [['staffDutyToggle', 'staffDutySaved'], ['staffConfirmPresence', 'staffPresenceSaved'], ['staffEndService', 'staffServiceCompleted'], ['staffStartService', 'staffServiceStarted'], ['staffEndService', 'staffServiceCompleted']]) {
          await page.evaluate(id => document.getElementById(id).onclick(), id); await translated('#staffFeedback', key);
        }
        for (const lang of ['de', 'en', 'ar']) { await switchLanguage(lang); assert.equal(await page.locator('#staffActiveService').textContent(), expected[lang].empty); checks++; }
        rows = structuredClone(allRows).slice(0, 2); await page.evaluate(() => loadStaffQueue('salon-1', document.getElementById('staffQueueList'), 'member-1'));
        for (const id of ['waiting', 'called']) {
          await page.evaluate(id => startStaffQueueEntry('salon-1', id, 'member-1'), id); await translated('#staffFeedback', 'staffQueueStarted');
          await page.evaluate(() => document.getElementById('staffEndService').onclick());
        }
        for (const [status, key] of [[403, 'staffAccessDenied'], [404, 'staffActionNotFound'], [401, 'staffSessionExpired'], [409, 'staffActionError']]) {
          actionError = status; await page.evaluate(() => document.getElementById('staffStartService').onclick()); await translated('#staffFeedback', key);
          await switchLanguage('en'); await translated('#staffFeedback', key); await switchLanguage('ar');
        }
        actionError = 403; await page.evaluate(() => startStaffQueueEntry('salon-1', 'waiting', 'member-1').catch(() => {}));
        assert.equal(dialogs.at(-1), await page.evaluate(() => ownerText('staffQueueStartForbidden'))); checks++;
        assert.equal(await page.locator('#staffServiceCard').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true); checks++;
        assert.deepEqual(errors, []);
        console.log(`PASS ${target}: full Staff localization, live language switching, RTL, states, escaping and unchanged action enums`);
      } finally { await context.close(); }
    }
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), fs.readFileSync(path.join(root, 'www/index.html'), 'utf8'));
    console.log(`PASS ${checks} Staff localization checks; root/www match`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
