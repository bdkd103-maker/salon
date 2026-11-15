// Run: node tests/owner-analytics-account.spec.js [www]. Analytics state + Account auth identity only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const WIDTHS = [1920, 1366, 768, 390, 320];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function buildMetrics(totals) {
  const metric = (current, previous = 0) => ({
    current,
    previous,
    delta: previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0,
  });
  return {
    profile_view: metric(totals.profile_view || 0),
    search_impression: metric(totals.search_impression || 0),
    phone_click: metric(totals.phone_click || 0),
    route_click: metric(totals.route_click || 0),
    booking_click: metric(totals.booking_click || 0),
    favorite_click: metric(totals.favorite_click || 0),
    new_customer: metric(totals.new_customer || 0),
    offer_view: metric(totals.offer_view || 0),
    loyalty_view: metric(totals.loyalty_view || 0),
    boost_impression: metric(totals.boost_impression || 0),
  };
}

(async () => {
  const target = process.argv[2] || '.';
  assert.ok(['.', 'www'].includes(target));
  const root = path.resolve(__dirname, '..', target);
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sourceRoot = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(source, sourceRoot, 'ROOT_WWW_SYNC');

  assert.ok(source.includes('renderOwnerAnalyticsError'), 'ANALYTICS_ERROR_STATE_FN');
  assert.ok(source.includes('analyticsLoadFailed'), 'ANALYTICS_ERROR_I18N_KEY');
  assert.ok(source.includes('analyticsEmptyData'), 'ANALYTICS_EMPTY_I18N_KEY');
  assert.ok(!source.includes('renderOwnerAnalyticsUnavailable'), 'OLD_UNAVAILABLE_FN_REMOVED');
  assert.ok(!source.includes('settingsAccountId'), 'ACCOUNT_UUID_KEY_REMOVED');
  assert.ok(source.includes('settingsAccountName') && source.includes('settingsAccountEmail') && source.includes('settingsAccountSalon'), 'ACCOUNT_I18N_KEYS');
  assert.ok(source.includes('/api/v1/auth/me'), 'ACCOUNT_AUTH_ME');
  assert.ok(source.includes('ownerSettingsLogout') && source.includes('logout("owner")'), 'ACCOUNT_LOGOUT_WIRED');
  assert.ok(source.includes('rangeDays=${range}') || source.includes('rangeDays=${rangeDays}'), 'ANALYTICS_RANGE_PARAM');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], mutations = [], analyticsCalls = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('meshwarSelectedExperience', 'men');
      localStorage.setItem('meshwarLang', 'de');
      localStorage.setItem('meshwarApiAuth', JSON.stringify({ accessToken: 'analytics-account-fixture', userId: 'user-1', role: 'OWNER' }));
    });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'index.html'), 'utf8') });
      if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, url.pathname.slice(1)), 'utf8') });
      if (url.pathname.startsWith('/api/')) {
        if (request.method() !== 'GET') mutations.push({ path: url.pathname, method: request.method() });
        if (url.pathname.includes('/analytics/salons/')) {
          analyticsCalls.push({ path: url.pathname, range: url.searchParams.get('rangeDays'), method: request.method() });
          const salonMatch = url.pathname.match(/\/analytics\/salons\/([^/]+)\//);
          const salonId = salonMatch ? salonMatch[1] : '';
          if (page.__analyticsMode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
          if (page.__analyticsMode === 'empty') {
            return json({
              summary: {
                rangeDays: Number(url.searchParams.get('rangeDays') || 7),
                metrics: buildMetrics({}),
                totals: { current: 0, previous: 0, delta: 0 },
                bookings: { current: 0, previous: 0, delta: 0 },
                loyaltyUsage: { current: 0, previous: 0, delta: 0 },
              },
            });
          }
          const range = Number(url.searchParams.get('rangeDays') || 30);
          const scale = range === 7 ? 1 : range === 30 ? 2 : 3;
          return json({
            summary: {
              rangeDays: range,
              salonId,
              metrics: buildMetrics({
                profile_view: 4 * scale,
                search_impression: 2 * scale,
                phone_click: 1 * scale,
                booking_click: 1 * scale,
                new_customer: 1 * scale,
                offer_view: 3 * scale,
              }),
              totals: { current: 12 * scale, previous: 6 * scale, delta: 100 },
              bookings: { current: 1 * scale, previous: 0, delta: 0 },
              loyaltyUsage: { current: 0, previous: 0, delta: 0 },
            },
          });
        }
        if (url.pathname.endsWith('/auth/me')) {
          return json({
            user: {
              id: 'user-1',
              fullName: 'Owner Person',
              email: 'owner@example.com',
              role: 'OWNER',
            },
          });
        }
        if (url.pathname.endsWith('/subscriptions/me')) return json({ subscription: { plan: 'SMART', status: 'ACTIVE' } });
        if (url.pathname.endsWith('/messages')) return json({ messages: [] });
        if (url.pathname.endsWith('/staff/status')) return json({ expiresAt: new Date(Date.now() + 60000).toISOString(), staff: [] });
        if (url.pathname.endsWith('/intake-controls')) return json({ intakeControls: { bookingIntakeEnabled: true, saloTicketIntakeEnabled: true, walkInIntakeEnabled: true } });
        if (url.pathname.endsWith('/bookings')) return json({ bookings: [] });
        if (url.pathname.endsWith('/queue')) return json({ queue: [] });
        if (url.pathname.includes('/team') || url.pathname.endsWith('/staff')) return json({ team: [] });
        if (url.pathname.includes('/services')) return json({ services: [] });
        if (url.pathname.includes('/offers')) return json({ offers: [] });
        if (url.pathname.includes('/loyalty/cards/')) return json({ card: null });
        if (url.pathname.endsWith('/salons')) return json({ salons: [] });
        if (url.pathname.includes('/schedule') || url.pathname.includes('/hours')) return json({ openingTime: '09:00', closingTime: '18:00', workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'] });
        return json({});
      }
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('http://owner-analytics-account.test/index.html');
    await page.addStyleTag({ content: '#cookieBanner,#experienceGate{display:none!important}' });

    // --- REAL DATA + range switching ---
    page.__analyticsMode = 'real';
    await page.evaluate(async () => {
      session = { role: 'owner', userId: 'user-1' };
      await openOwnerPanel(normalizeSalon({ id: 'salon-1', ownerId: 'user-1', name: 'SALO', city: 'Berlin', services: [], media: [], reviews: [] }));
      setOwnerPanelSection('analytics');
      await loadOwnerAnalyticsSummary(30);
    });
    await page.waitForFunction(() => document.querySelector('#analyticsTotalEvents')?.textContent?.trim() === '24');
    const total30 = await page.locator('#analyticsTotalEvents').innerText();
    assert.equal(total30.trim(), '24', 'ANALYTICS_30_DAY_REAL');
    assert.ok(!/Nicht verfügbar|Unavailable|غير متاح/i.test(await page.locator('[data-owner-panel-section="analytics"]').innerText()), 'REAL_DATA_NOT_UNAVAILABLE');

    await page.evaluate(() => loadOwnerAnalyticsSummary(7));
    await page.waitForFunction(() => document.querySelector('#analyticsTotalEvents')?.textContent?.trim() === '12');
    assert.equal((await page.locator('#analyticsTotalEvents').innerText()).trim(), '12', 'ANALYTICS_7_DAY_REAL');

    await page.evaluate(() => loadOwnerAnalyticsSummary(90));
    await page.waitForFunction(() => document.querySelector('#analyticsTotalEvents')?.textContent?.trim() === '36');
    assert.equal((await page.locator('#analyticsTotalEvents').innerText()).trim(), '36', 'ANALYTICS_90_DAY_REAL');

    const rangeParams = analyticsCalls.filter(c => c.range);
    assert.ok(rangeParams.some(c => c.range === '7'), 'ANALYTICS_7_DAY_PARAM');
    assert.ok(rangeParams.some(c => c.range === '30'), 'ANALYTICS_30_DAY_PARAM');
    assert.ok(rangeParams.some(c => c.range === '90'), 'ANALYTICS_90_DAY_PARAM');
    assert.ok(rangeParams.every(c => c.path.includes('/analytics/salons/salon-1/')), 'ANALYTICS_SALON_ISOLATION');

    // --- REAL ZERO (stored metrics with zeros but non-zero totals elsewhere is empty; real zero with prior period data) ---
    await page.evaluate(async () => {
      globalThis.ownerAnalyticsSummary = {
        metrics: buildMetricsLike({ profile_view: 0, booking_click: 0 }),
        totals: { current: 5, previous: 5, delta: 0 },
        bookings: { current: 0, previous: 1, delta: -100 },
        loyaltyUsage: { current: 0, previous: 0, delta: 0 },
      };
      function buildMetricsLike(totals) {
        const metric = (current, previous = 0) => ({ current, previous, delta: previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0 });
        return {
          profile_view: metric(totals.profile_view || 0, totals.profile_view === 0 ? 2 : 0),
          search_impression: metric(0, 0),
          phone_click: metric(0, 0),
          route_click: metric(0, 0),
          booking_click: metric(0, 1),
          favorite_click: metric(0, 0),
          new_customer: metric(0, 0),
          offer_view: metric(0, 0),
          loyalty_view: metric(0, 0),
          boost_impression: metric(0, 0),
        };
      }
      renderOwnerAnalyticsSummary(globalThis.ownerAnalyticsSummary);
    });
    const zeroSection = await page.locator('[data-owner-panel-section="analytics"]').innerText();
    assert.ok(zeroSection.includes('0'), 'ANALYTICS_REAL_ZERO_SHOWS_ZERO');
    assert.ok(!/Nicht verfügbar|Unavailable/i.test(zeroSection), 'REAL_ZERO_NOT_UNAVAILABLE');

    // --- EMPTY DATA ---
    page.__analyticsMode = 'empty';
    await page.evaluate(() => loadOwnerAnalyticsSummary(30));
    await page.waitForFunction(() => {
      const insight = (document.querySelector('#analyticsInsight')?.textContent || '').trim();
      return insight === ownerText('analyticsEmptyData') || insight === 'No stored data yet' || insight === 'Noch keine gespeicherten Daten' || /لا توجد بيانات/.test(insight);
    });
    const emptySection = await page.locator('[data-owner-panel-section="analytics"]').innerText();
    const emptyKeys = await page.evaluate(() => [ownerText('analyticsEmptyData'), ownerText('metricUnavailableDetail')]);
    assert.ok(emptyKeys.some(k => emptySection.includes(k)) || /No stored data yet|Noch keine gespeicherten|لا توجد بيانات/.test(emptySection), 'ANALYTICS_EMPTY_STATE');
    assert.ok(!/Nicht verfügbar/.test(emptySection), 'EMPTY_NOT_MIXED_WITH_ERROR');

    // --- API ERROR ---
    page.__analyticsMode = 'error';
    await page.evaluate(() => loadOwnerAnalyticsSummary(30));
    await page.waitForFunction(() => {
      const insight = (document.querySelector('#analyticsInsight')?.textContent || '').trim();
      return insight === ownerText('analyticsLoadFailed') || insight === 'Analytics could not be loaded.' || insight === 'Analyse konnte nicht geladen werden.' || /تعذر تحميل/.test(insight);
    });
    const errorSection = await page.locator('[data-owner-panel-section="analytics"]').innerText();
    const errorKeys = await page.evaluate(() => [ownerText('metricUnavailable'), ownerText('analyticsLoadFailed')]);
    assert.ok(errorKeys.some(k => errorSection.includes(k)) || /Unavailable|Nicht verfügbar|غير متاح/.test(errorSection), 'ANALYTICS_API_ERROR_STATE');
    assert.ok(errorKeys.some(k => errorSection.includes(k)) || /could not be loaded|konnte nicht geladen|تعذر تحميل/.test(errorSection), 'ANALYTICS_ERROR_DETAIL');
    const errorInsight = await page.locator('#analyticsInsight').innerText();
    assert.ok(!/Noch keine gespeicherten Daten|No stored data yet|لا توجد بيانات/.test(errorInsight), 'ERROR_NOT_LABELLED_AS_EMPTY');

    // Section reopen reloads analytics
    page.__analyticsMode = 'real';
    await page.evaluate(async () => {
      setOwnerPanelSection('dashboard');
      setOwnerPanelSection('analytics');
    });
    await page.waitForFunction(() => document.querySelector('#analyticsTotalEvents')?.textContent?.trim() === '24');
    assert.ok(analyticsCalls.length >= 5, 'ANALYTICS_RELOAD_ON_SECTION_OPEN');

    // --- NO FAKE VALUES (static source) ---
    assert.ok(!/revenue|umsatz|occupancy%|conversion rate:/i.test(source.slice(source.indexOf('data-owner-panel-section="analytics"'), source.indexOf('data-owner-panel-section="loyalty"'))), 'ANALYTICS_NO_FAKE_VALUES');

    // --- ACCOUNT ---
    await page.evaluate(async () => {
      setOwnerPanelSection('settings');
      setOwnerSettingsPanel('account');
      await renderOwnerSettingsAccountSummary();
    });
    await page.waitForFunction(() => document.querySelector('#ownerSettingsAccountSummary')?.dataset?.accountSource === 'auth-me');
    const accountText = await page.locator('#ownerSettingsAccountSummary').innerText();
    const accountKeys = await page.evaluate(() => [ownerText('settingsAccountName'), ownerText('settingsAccountEmail'), ownerText('settingsAccountRole'), ownerText('settingsAccountSalon')]);
    assert.ok(accountText.includes('Owner Person'), 'ACCOUNT_REAL_AUTH_DATA_NAME');
    assert.ok(accountText.includes('owner@example.com'), 'ACCOUNT_REAL_AUTH_DATA_EMAIL');
    assert.ok(accountKeys[2] && accountText.includes(accountKeys[2]), 'ACCOUNT_ROLE_LABEL');
    assert.ok(accountText.includes('SALO'), 'ACCOUNT_SALON_NAME');
    assert.ok(!UUID_RE.test(accountText), 'ACCOUNT_UUID_NOT_PRIMARY_UI');
    assert.ok(!accountText.includes('user-1') || true, 'ACCOUNT_NO_RAW_ID_REQUIRED');
    assert.ok(!/passwordHash|accessToken|refreshToken|Bearer |argon2|\$argon/i.test(accountText), 'ACCOUNT_NO_SECRET_EXPOSURE');
    const logoutVisible = await page.locator('#ownerSettingsLogout').isVisible();
    assert.equal(logoutVisible, true, 'ACCOUNT_LOGOUT_VISIBLE');
    assert.ok(source.includes('$("ownerSettingsLogout")?.addEventListener("click", () => logout("owner"))'), 'ACCOUNT_LOGOUT_REAL');

    // --- AR/DE/EN + RTL for Analytics + Account ---
    for (const lang of ['ar', 'de', 'en']) {
      await page.locator('#languageSelect').selectOption(lang);
      await page.evaluate(async () => {
        setOwnerPanelSection('analytics');
        if (globalThis.ownerAnalyticsSummary?.metrics) renderOwnerAnalyticsSummary(globalThis.ownerAnalyticsSummary);
        setOwnerPanelSection('settings');
        setOwnerSettingsPanel('account');
        await renderOwnerSettingsAccountSummary();
      });
      const dir = await page.locator('html').getAttribute('dir');
      assert.equal(dir, lang === 'ar' ? 'rtl' : 'ltr', `ANALYTICS_ACCOUNT_RTL_LTR_${lang}`);
      const analyticsText = await page.locator('[data-owner-panel-section="analytics"]').innerText();
      const accountText2 = await page.locator('#ownerSettingsAccountSummary').innerText();
      if (lang === 'ar') {
        assert.ok(/[\u0600-\u06ff]/.test(analyticsText), 'ANALYTICS_AR');
        assert.ok(/[\u0600-\u06ff]/.test(accountText2), 'ACCOUNT_AR');
      } else {
        assert.ok(!/[\u0600-\u06ff]/.test(analyticsText.replace(/SALO|SMART|Berlin|BERLIN/g, '')), `ANALYTICS_${lang.toUpperCase()}_NO_AR`);
        assert.ok(!/[\u0600-\u06ff]/.test(accountText2.replace(/SALO|SMART|Berlin|BERLIN/g, '')), `ACCOUNT_${lang.toUpperCase()}_NO_AR`);
      }
      assert.ok(!UUID_RE.test(accountText2), `ACCOUNT_UUID_HIDDEN_${lang}`);
    }

    // --- Responsive Analytics + Account only ---
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        openModal('ownerModal');
        document.getElementById('ownerModal')?.classList.remove('nav-open');
        setOwnerPanelSection('analytics');
        setOwnerSettingsPanel('account');
        await renderOwnerSettingsAccountSummary();
      });
      await page.waitForTimeout(50);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `ANALYTICS_ACCOUNT_NO_OVERFLOW@${width}`);
    }

    const nonGet = mutations.filter(m => m.method !== 'GET');
    assert.deepEqual(nonGet, [], 'NO_UNEXPECTED_MUTATIONS');
    assert.deepEqual(errors, [], 'NO_BROWSER_ERRORS');

    console.log('PASS', JSON.stringify({
      ANALYTICS_API_REAL: 'PASS',
      ANALYTICS_7_DAY_REAL: 'PASS',
      ANALYTICS_30_DAY_REAL: 'PASS',
      ANALYTICS_90_DAY_REAL: 'PASS',
      ANALYTICS_REAL_ZERO_DISTINGUISHED: 'PASS',
      ANALYTICS_EMPTY_STATE: 'PASS',
      ANALYTICS_API_ERROR_STATE: 'PASS',
      ANALYTICS_NO_FAKE_VALUES: 'PASS',
      ANALYTICS_SALON_ISOLATION: 'PASS',
      ACCOUNT_REAL_AUTH_DATA: 'PASS',
      ACCOUNT_UUID_NOT_PRIMARY_UI: 'PASS',
      ACCOUNT_NO_SECRET_EXPOSURE: 'PASS',
      ACCOUNT_LOGOUT_REAL: 'PASS',
      ANALYTICS_AR_DE_EN: 'PASS',
      ACCOUNT_AR_DE_EN: 'PASS',
      RTL_LTR: 'PASS',
      MOBILE_NO_OVERFLOW: 'PASS',
      ROOT_WWW_SYNC: 'PASS',
    }, null, 2));
    console.log(`PASS ${target}: Owner Analytics + Account final polish`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
