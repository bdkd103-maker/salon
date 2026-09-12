// Run: node tests/customer-header.spec.js. All traffic is intercepted; no backend is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const files = ['index.html', 'women.html', 'assets/customer-header.css', 'assets/customer-header.js'];
  for (const file of files) assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'www', file)));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let layouts = 0;
  try {
    for (const file of ['index.html', 'women.html']) {
      const page = await browser.newPage();
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'header.test') return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ salons: [] }) });
        const relative = url.pathname.slice(1);
        if ([...files, 'assets/customer-registration.js', 'assets/customer-password-reset.js'].includes(relative)) {
          return route.fulfill({ contentType: relative.endsWith('.css') ? 'text/css' : relative.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
        }
        return route.abort();
      });
      await page.goto('http://header.test/' + file);
      await page.evaluate(() => { document.getElementById('experienceGate')?.remove(); document.getElementById('cookieBanner')?.remove(); document.body.classList.remove('entry-gate-open'); });
      for (const lang of ['de', 'en', 'ar']) {
        await page.locator('#languageSelect').selectOption(lang);
        assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
        for (const width of [320, 375, 430, 768, 1024, 1440, 1920, 2560]) {
          await page.setViewportSize({ width, height: 1000 });
          const result = await page.locator('.salo-header').evaluate(header => {
            const box = header.getBoundingClientRect();
            const controls = [...header.querySelectorAll('a, button, select')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
            const boxes = controls.map(el => ({ id: el.id || el.textContent.trim(), rect: el.getBoundingClientRect() }));
            const overflow = boxes.filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1);
            const overlaps = [];
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i].rect, b = boxes[j].rect;
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([boxes[i].id, boxes[j].id]);
            }
            return { overflow: overflow.map(x => x.id), overlaps, height: box.height, width: header.querySelector('.salo-header-inner').getBoundingClientRect().width };
          });
          assert.deepEqual(result.overflow, [], `${file}/${lang}/${width} overflow`);
          assert.deepEqual(result.overlaps, [], `${file}/${lang}/${width} overlap`);
          assert.ok(result.height <= 120, `${file}/${lang}/${width} header too tall: ${result.height}`);
          assert.ok(result.width <= 1281);
          layouts++;
        }
      }
      await page.setViewportSize({ width: 375, height: 900 });
      await page.locator('#languageSelect').selectOption('de');
      await page.locator('#mobileMenu').click();
      assert.equal(await page.locator('#mobileMenu').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mobileMenu').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#mobileMenu').evaluate(el => el === document.activeElement), true);
      const account = file === 'index.html' ? '#portalOpen' : '#headerProfileButton';
      await page.locator(account).click();
      assert.equal(await page.locator('#customerLoginModal').isVisible(), true);
      await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('customerLoginModal'); else closeWomenModal('customerLoginModal'); });
      await page.locator('#mobileMenu').click();
      await page.locator(file === 'index.html' ? '#registerMenuButton' : '[data-salo-register]').click();
      assert.equal(await page.locator('#customerRegisterModal').isVisible(), true);
      await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('customerRegisterModal'); else closeWomenModal('customerRegisterModal'); });
      assert.equal(await page.locator('.salo-brand').getAttribute('href'), file);
      assert.equal(await page.locator('.salo-experience [aria-current="page"]').count(), 1);
      if (file === 'index.html') {
        await page.evaluate(() => {
          session = { role: 'customer', userId: 'header-test' };
          localStorage.setItem('meshwarApiAuth', JSON.stringify({ accessToken: 'test-only', role: 'CUSTOMER' }));
          updatePortalButtonState();
        });
        await page.locator('#mobileMenu').click();
        assert.equal(await page.locator('#registerMenuButton').isVisible(), false);
        assert.equal(await page.locator('#customerLogoutHeader').isVisible(), true);
        await page.locator('#customerLogoutHeader').click();
        assert.equal(await page.evaluate(() => session), null);
      }
      if (process.env.HEADER_SCREENSHOTS === '1') {
        await page.screenshot({ path: path.join(root, `.header-${file}-mobile.png`) });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(root, `.header-${file}-desktop.png`) });
      }
      await page.close();
    }
    console.log(`PASS: ${layouts} header layouts; DE/EN/AR, menu keyboard behavior, auth/register entry, logout, branding and mirror equality.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
