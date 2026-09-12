// Run: node tests/customer-hero.spec.js. All traffic is intercepted; no backend is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const expectedTitles = {
  de: 'Was brauchst du heute?',
  en: 'What do you need today?',
  ar: 'ماذا تحتاج',
};

(async () => {
  const root = path.resolve(__dirname, '..');
  const mirroredFiles = ['index.html', 'women.html', 'assets/customer-hero.css', 'assets/customer-hero.js'];
  for (const file of mirroredFiles) {
    assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'www', file)));
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let layouts = 0;
  try {
    for (const file of ['index.html', 'women.html']) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'hero.test') return route.abort();
        if (url.pathname.startsWith('/api/')) {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ salons: [] }) });
        }
        const relative = decodeURIComponent(url.pathname.slice(1));
        const target = path.join(root, relative);
        if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.abort();
        const extension = path.extname(target);
        const contentType = extension === '.css' ? 'text/css' : extension === '.js' ? 'text/javascript' : extension === '.jpg' ? 'image/jpeg' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(target) });
      });

      await page.goto(`http://hero.test/${file}`);
      await page.evaluate(() => {
        document.getElementById('experienceGate')?.remove();
        document.getElementById('cookieBanner')?.remove();
        document.body.classList.remove('entry-gate-open');
      });

      for (const lang of ['de', 'en', 'ar']) {
        await page.locator('#languageSelect').selectOption(lang);
        assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
        assert.ok((await page.locator('.salo-hero-copy h1').textContent()).includes(expectedTitles[lang]));

        for (const width of [320, 375, 430, 768, 1024, 1440, 1920, 2560]) {
          await page.setViewportSize({ width, height: 1000 });
          const result = await page.locator('[data-salo-hero]').evaluate(hero => {
            const controls = [...hero.querySelectorAll('button, input, select')].filter(element => element.getClientRects().length);
            const overflow = controls.filter(element => {
              const rect = element.getBoundingClientRect();
              return rect.left < -1 || rect.right > innerWidth + 1;
            });
            const heroBox = hero.getBoundingClientRect();
            const innerBox = hero.querySelector('.salo-hero-inner').getBoundingClientRect();
            return {
              documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
              overflow: overflow.map(element => element.id || element.dataset.heroIntent),
              heroHeight: heroBox.height,
              innerWidth: innerBox.width,
              pressed: hero.querySelectorAll('[data-hero-intent][aria-pressed="true"]').length,
            };
          });
          assert.equal(result.documentOverflow, false, `${file}/${lang}/${width} document overflow`);
          assert.deepEqual(result.overflow, [], `${file}/${lang}/${width} control overflow`);
          assert.ok(result.innerWidth <= 1181, `${file}/${lang}/${width} Hero is not bounded`);
          assert.equal(result.pressed, 1, `${file}/${lang}/${width} selected intent count`);
          if (width <= 430) assert.ok(result.heroHeight < 800, `${file}/${lang}/${width} Hero crowds first viewport: ${result.heroHeight}`);
          layouts++;
        }
      }

      await page.setViewportSize({ width: 375, height: 900 });
      await page.locator('#languageSelect').selectOption('de');
      await page.locator('[data-hero-intent="now"]').focus();
      assert.equal(await page.locator('[data-hero-intent="now"]').evaluate(element => element.matches(':focus-visible')), true);
      await page.locator('[data-hero-intent="now"]').click();
      assert.equal(await page.locator('[data-hero-intent="now"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-hero-intent="appointment"]').click();
      assert.equal(await page.locator('[data-hero-intent="appointment"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-hero-intent="appointment"]').evaluate(element => Boolean(document.querySelector(element.dataset.heroTarget))), true);
      await page.locator('#heroSearchInput').fill('cut');
      await page.locator('#heroSearchInput').press('Enter');
      await page.locator('#heroSearchButton').click();
      assert.deepEqual(pageErrors, [], `${file} page errors`);

      if (process.env.HERO_SCREENSHOTS === '1') {
        await page.locator('#heroSearchInput').fill('');
        for (const lang of ['de', 'ar']) {
          await page.locator('#languageSelect').selectOption(lang);
          for (const [label, width] of [['mobile', 375], ['desktop', 1440], ['wide', 2560]]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('[data-salo-hero]').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(root, `.hero-${path.basename(file, '.html')}-${lang}-${label}.png`) });
          }
        }
      }
      await page.close();
    }
    console.log(`PASS: ${layouts} Hero layouts; DE/EN/AR, responsive bounds, intent state, keyboard focus, search invocation, and mirror equality.`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});