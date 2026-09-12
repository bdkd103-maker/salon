// Run: node tests/admin-translations.spec.js
// All HTTP is intercepted; no live backend, credentials, or database are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Independent expected UI copy: deliberately not read from production dictionaries.
const copy = {
  de: {
    workspace: 'Admin-Arbeitsbereich', women: '+ Neuer Damensalon', inbox: 'Posteingang öffnen',
    basic: 'Grundinformationen', cityHint: 'Stadt Ihres Salons', search: 'Suche',
    status: 'Status', closed: 'Geschlossen', cities: 'Alle Städte',
    overview: 'Übersicht', editor: 'Salon bearbeiten',
    overviewLead: 'Eine Übersicht über Leistung, Aktivitäten und Betriebsstatus.',
    editorLead: 'Bearbeiten Sie den ausgewählten Salon in übersichtlichen Bereichen.',
    noData: 'Keine Backend-Daten', capacity: 'Verfügbar', chairs: 'Gesamtzahl der Stühle', edit: 'Bearbeiten',
    intake: 'Annahmekanäle', on: 'Ein', off: 'Aus',
  },
  en: {
    workspace: 'Admin Workspace', women: '+ New women’s salon', inbox: 'Open Inbox',
    basic: 'Basic information', cityHint: 'Your salon’s city', search: 'Search',
    status: 'Status', closed: 'Closed', cities: 'All cities',
    overview: 'Overview', editor: 'Salon Editor',
    overviewLead: 'A business dashboard view for performance, activity, and operational signals.',
    editorLead: 'Edit the selected salon through grouped cards without losing any existing fields.',
    noData: 'No backend data', capacity: 'Available', chairs: 'Total chairs', edit: 'Edit',
    intake: 'Intake controls', on: 'On', off: 'Off',
  },
  ar: {
    workspace: 'مساحة عمل الإدارة', women: '+ صالون نسائي', inbox: 'فتح صندوق الوارد',
    basic: 'المعلومات الأساسية', cityHint: 'مدينة صالونك', search: 'بحث',
    status: 'الحالة', closed: 'مغلق', cities: 'جميع المدن',
    overview: 'نظرة عامة', editor: 'تعديل الصالون',
    overviewLead: 'نظرة عامة على الأداء والأنشطة وحالة التشغيل.',
    editorLead: 'عدّل الصالون المحدد من خلال أقسام واضحة.',
    noData: 'لا توجد بيانات من الخادم', capacity: 'متاح', chairs: 'إجمالي الكراسي', edit: 'تعديل',
    intake: 'قنوات استقبال العملاء', on: 'مفعّل', off: 'متوقف',
  },
};

(async () => {
  const root = path.resolve(__dirname, '..');
  const productionFiles = ['index.html', 'assets/salon-intake-controls.js', 'backend/src/lib/auth.ts'];
  const originalBytes = productionFiles.map(file => fs.readFileSync(path.join(root, file)));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  let passed = 0;
  const failures = [];
  function check(name, actual, expected) {
    try { assert.deepEqual(actual, expected); passed++; }
    catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      failures.push(name);
      console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  }
  try {
    for (const language of ['de', 'en', 'ar']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const requests = [];
      const controls = { bookingIntakeEnabled: true, saloTicketIntakeEnabled: false, walkInIntakeEnabled: true };
      const initialLanguage = language === 'de' ? 'en' : 'de';
      await page.addInitScript(initial => {
        localStorage.setItem('meshwarSelectedExperience', 'men');
        localStorage.setItem('meshwarLang', initial);
        localStorage.setItem('meshwarApiAuth', JSON.stringify({ accessToken: 'synthetic-test-access', userId: 'test-admin', role: 'ADMIN' }));
      }, initialLanguage);
      await page.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: request.frame() === page.mainFrame() ? originalBytes[0].toString('utf8') : '<!doctype html>' });
        if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) {
          const file = path.resolve(root, '.' + url.pathname);
          if (!file.startsWith(root + path.sep)) return route.abort();
          return route.fulfill({ contentType: 'text/javascript', body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
        }
        if (url.pathname.endsWith('/intake-controls')) {
          requests.push(request.method());
          return json({ intakeControls: controls });
        }
        if (url.pathname === '/api/v1/salons') return json({ salons: [] });
        if (url.pathname.startsWith('/api/')) return json({});
        return route.fulfill({ status: 204, body: '' });
      });
      await page.goto('http://admin-translations.test/index.html', { waitUntil: 'load' });
      await page.addStyleTag({ content: '#cookieBanner, #experienceGate { display: none !important; }' });
      await page.evaluate(() => {
        const salon = normalizeSalon({ id: 'translation-salon', name: 'Fixture Salon', city: 'Berlin',
          address: 'Teststrasse 10', totalChairs: 4, availableChairs: 4, status: 'open',
          services: [], media: [], reviews: [], workingDays: ['mon', 'wed'], timeZone: 'Europe/Berlin' });
        session = { role: 'admin' };
        salons = [salon];
        persistSalons();
        globalThis.__adminDashboardSummary = {};
        populateAdminFormFromSalon(salon);
        bindAdminWorkspaceNavigation();
        openModal('adminModal');
        setActiveAdminView('salon-editor');
        document.getElementById('adminName').value = 'Unsaved editor name';
        document.getElementById('adminCity').value = 'Unsaved city';
        document.getElementById('adminAddress').value = 'Unsaved address 42';
        document.getElementById('adminWomen').checked = true;
      });
      await page.waitForFunction(() => document.querySelector('#adminIntakeControls [data-intake-field]')?.disabled === false);
      assert.deepEqual(requests, ['GET'], 'fixture must load Intake Controls exactly once');
      const snapshot = () => page.locator('#adminForm input, #adminForm select, #adminForm textarea').evaluateAll(elements =>
        elements.map(el => ({ id: el.id, name: el.name, value: el.value, checked: el.checked })));
      const editorBefore = await snapshot();
      const switches = page.locator('#adminIntakeControls [data-intake-field]');
      const toggleSnapshot = () => switches.evaluateAll(elements => elements.map(el => ({ checked: el.getAttribute('aria-checked'), disabled: el.disabled })));
      const togglesBefore = await toggleSnapshot();
      assert.deepEqual(togglesBefore.map(toggle => toggle.checked), ['true', 'false', 'true']);
      const c = copy[language];
      const text = async selector => (await page.locator(selector).textContent()).trim();
      const switchLanguage = async value => {
        await page.locator('#languageSelect').selectOption(value);
        // Flush DOM observers/render callbacks without calling component.render() from the test.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      await switchLanguage(language);
      check(`${language} selected language`, await page.locator('html').getAttribute('lang'), language);
      for (const [selector, key] of [
        ['.admin-workspace-copy > .eyebrow', 'workspace'], ['#newWomenSalonButton', 'women'],
        ['#adminOpenInbox', 'inbox'], ['#adminIntakeControls + .admin-editor-grid > .admin-editor-card:first-child > h3', 'basic'],
        ['label[for="salonSearch"]', 'search'], ['label[for="salonStatusFilter"]', 'status'],
        ['#salonStatusFilter option[value="closed"]', 'closed'], ['#salonCityFilter option[value="all"]', 'cities'],
      ]) check(`${language} static ${key}`, await text(selector), c[key]);
      check(`${language} city placeholder`, await page.locator('#adminCity').getAttribute('placeholder'), c.cityHint);

      // Language change must retain the editor's view-specific copy, not generic adminText.
      check(`${language} editor title after language change`, await text('#adminWorkspaceTitle'), c.editor);
      check(`${language} editor lead after language change`, await text('#adminWorkspaceLead'), c.editorLead);
      for (const [view, title, lead] of [['overview', c.overview, c.overviewLead], ['salon-editor', c.editor, c.editorLead]]) {
        await page.locator(`[data-admin-nav="${view}"]`).click();
        check(`${language} ${view} title after navigation`, await text('#adminWorkspaceTitle'), title);
        check(`${language} ${view} lead after navigation`, await text('#adminWorkspaceLead'), lead);
        await switchLanguage(initialLanguage);
        await switchLanguage(language);
        check(`${language} ${view} title after switching back`, await text('#adminWorkspaceTitle'), title);
        check(`${language} ${view} lead after switching back`, await text('#adminWorkspaceLead'), lead);
      }

      // These nodes are generated by the normal applyLanguage -> renderAdminLists path.
      check(`${language} runtime home fallback`, await text('#kpiTotalUsers'), c.noData);
      check(`${language} runtime capacity`, (await text('#salonList tbody tr td:nth-child(6) .status-chip')).replace(/^[🟢🟡🔴⚫]\s*/u, ''), c.capacity);
      check(`${language} runtime table heading`, await text('#salonList th:nth-child(3)'), c.chairs);
      check(`${language} runtime mobile data-label`, await page.locator('#salonList tbody tr td:nth-child(3)').getAttribute('data-label'), c.chairs);
      check(`${language} runtime edit action`, await text('#salonList [data-edit-salon]'), c.edit);

      check(`${language} intake heading refresh`, await text('#adminIntakeControls h3'), c.intake);
      for (const [index, state] of ['on', 'off', 'on'].entries()) {
        const label = (await switches.nth(index).textContent()).trim();
        check(`${language} intake switch ${index} translated state`, label.slice(label.lastIndexOf(':') + 1).trim(), c[state]);
      }
      check(`${language} language changes make no intake GET/PATCH`, requests, ['GET']);
      check(`${language} loaded toggle state retained`, await toggleSnapshot(), togglesBefore);
      check(`${language} unsaved editor values retained`, await snapshot(), editorBefore);
      await page.close();
    }
  } finally {
    await browser.close();
    productionFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(root, file)), originalBytes[index], `${file} must remain unchanged`));
  }
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
