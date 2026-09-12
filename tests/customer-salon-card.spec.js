// Run: node tests/customer-salon-card.spec.js. All traffic is intercepted; no backend is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const mirroredFiles = [
    'index.html',
    'women.html',
    'assets/customer-salon-card.css',
    'assets/customer-salon-card.js',
    'assets/salo-salon-placeholder.svg',
  ];
  for (const file of mirroredFiles) {
    assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'www', file)), `${file} mirror differs`);
  }

  const explicitImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#315f55"/></svg>');
  const weeklyOpeningHours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(day => [day, { intervals: [{ open: '00:00', close: '23:59' }] }]));
  const salons = [
    {
      id: 'reviewed-open',
      name: 'Verified Studio',
      city: 'Berlin',
      address: 'Realstrasse 1',
      phone: '+493011111',
      forWomen: true,
      isWomenOnly: true,
      timeZone: 'UTC',
      weeklyOpeningHours,
      rating: 4.7,
      ratingCount: 18,
      image: explicitImage,
      services: [{ name: 'Precision Cut', price: 34, isActive: true }],
      customServices: [{ name: 'Precision Cut', price: 34 }],
    },
    {
      id: 'unreviewed-closed',
      name: 'New Atelier',
      city: 'Berlin',
      address: 'Startweg 2',
      phone: '+493022222',
      forWomen: true,
      isWomenOnly: true,
      rating: 0,
      ratingCount: 0,
      customServices: [{ name: 'Care Service', price: 42 }],
    },
    {
      id: 'premium-real',
      name: 'Premium House',
      city: 'Berlin',
      address: 'Goldweg 3',
      phone: '+493033333',
      forWomen: true,
      isWomenOnly: true,
      isVip: true,
      vip: true,
      rating: 4.9,
      ratingCount: 7,
      timeZone: 'UTC',
      weeklyOpeningHours,
      customServices: [{ name: 'Real Ritual', price: 55 }],
    },
  ];

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let layouts = 0;
  try {
    for (const file of ['index.html', 'women.html']) {
      const page = await browser.newPage();
      const pageSalons = file === 'index.html'
        ? salons.map(({ forWomen, isWomenOnly, ...salon }) => salon)
        : salons;
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.addInitScript(({ salons, experience }) => {
        localStorage.setItem('meshwarSelectedExperience', experience);
        localStorage.setItem('meshwarLang', 'de');
        localStorage.setItem('meshwarSalons', JSON.stringify(salons));
      }, { salons: pageSalons, experience: file === 'index.html' ? 'men' : 'women' });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'cards.test') return route.abort();
        if (url.pathname === '/api/v1/salons') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ salons: pageSalons }) });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        const relative = decodeURIComponent(url.pathname.slice(1));
        const target = path.join(root, relative);
        if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.abort();
        const extension = path.extname(target);
        const contentType = extension === '.css' ? 'text/css' : extension === '.js' ? 'text/javascript' : extension === '.svg' ? 'image/svg+xml' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(target) });
      });

      await page.goto(`http://cards.test/${file}`);
      await page.evaluate(() => {
        document.getElementById('experienceGate')?.remove();
        document.getElementById('cookieBanner')?.remove();
        document.body.classList.remove('entry-gate-open');
      });
      const cardSelector = file === 'index.html' ? '.salon-card' : '#womenGrid > .card';
      await page.waitForFunction(({ selector }) => [...document.querySelectorAll(selector)].some(card => card.textContent.includes('Verified Studio')), { selector: cardSelector });

      for (const lang of ['de', 'en', 'ar']) {
        await page.locator('#languageSelect').selectOption(lang);
        for (const width of [320, 375, 430, 768, 1024, 1440, 1920, 2560]) {
          await page.setViewportSize({ width, height: 1000 });
          const layout = await page.locator(file === 'index.html' ? '#regularSalonGrid' : '#womenGrid').evaluate(grid => ({
            overflow: grid.scrollWidth > grid.clientWidth + 1,
            cards: [...grid.children].filter(card => card.matches('.salon-card, .card')).map(card => {
              const rect = card.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            }),
          }));
          assert.equal(layout.overflow, false, `${file}/${lang}/${width} grid overflow`);
          assert.equal(layout.cards.some(card => card.left < -1 || card.right > width + 1), false, `${file}/${lang}/${width} card overflow`);
          layouts++;
        }
      }

      await page.locator('#languageSelect').selectOption('de');
      const result = await page.evaluate(({ selector }) => {
        const cards = [...document.querySelectorAll(selector)];
        const find = name => cards.find(card => card.textContent.includes(name));
        const reviewed = find('Verified Studio');
        const unreviewed = find('New Atelier');
        const premium = find('Premium House');
        return {
          reviewedText: reviewed?.textContent || '',
          reviewedImage: reviewed?.querySelector('img')?.getAttribute('src') || '',
          unreviewedText: unreviewed?.textContent || '',
          unreviewedImage: unreviewed?.querySelector('img')?.getAttribute('src') || '',
          premiumText: premium?.textContent || '',
          prohibitedCount: cards.reduce((count, card) => count + card.querySelectorAll('.salon-card-capacity, .salon-card-stat-grid, .stats, [data-availability-watch]').length, 0),
          hooks: {
            profile: Boolean(reviewed?.matches('[data-open-profile-salon]')),
            favorite: Boolean(reviewed?.querySelector('[data-favorite], [data-favorite-salon]')),
            route: Boolean(reviewed?.querySelector('[data-salon-route], [data-route-salon]')),
            booking: Boolean(reviewed?.querySelector('[data-choose-salon], [data-book-salon]')),
          },
        };
      }, { selector: cardSelector });
      assert.match(result.reviewedText, /4\.7/);
      assert.match(result.reviewedText, /18/);
      assert.match(result.reviewedText, /Geöffnet/);
      assert.match(result.reviewedText, /Precision Cut/);
      assert.match(result.reviewedImage, /^data:image\/svg\+xml/);
      assert.match(result.unreviewedText, /Noch keine Bewertungen/);
      assert.match(result.unreviewedText, /Geschlossen/);
      assert.match(result.unreviewedImage, /salo-salon-placeholder\.svg$/);
      assert.match(result.premiumText, /Premium|VIP/);
      assert.equal(result.prohibitedCount, 0);
      assert.deepEqual(result.hooks, { profile: true, favorite: true, route: true, booking: true });
      assert.deepEqual(pageErrors, []);

      if (process.env.CARD_SCREENSHOTS === '1') {
        for (const lang of ['de', 'ar']) {
          await page.locator('#languageSelect').selectOption(lang);
          for (const [label, width] of [['mobile', 320], ['desktop', 1440], ['wide', 2560]]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator(cardSelector).first().scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(root, `.card-${path.basename(file, '.html')}-${lang}-${label}.png`) });
          }
        }
      }
      await page.close();
    }
    console.log(`PASS: ${layouts} card layouts; real reviews/images/schedules, neutral placeholders, preserved actions, and no capacity UI.`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});