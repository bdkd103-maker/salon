// Isolated browser contexts and intercepted APIs; only synthetic credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const credentials = (userId = 'admin-1', role = 'ADMIN', accessToken = 'fixture-access') => ({ userId, role, accessToken, refreshToken: 'fixture-refresh' });

(async () => {
  assert.equal(fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8'), fs.readFileSync(path.join(root, 'www/admin/admin.js'), 'utf8'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let passed = 0;
  try {
    async function scenario(name, run) {
      const context = await browser.newContext();
      const errors = [];
      let lastAuthorization;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/api/')) {
          lastAuthorization = route.request().headers().authorization;
          if (url.pathname.endsWith('/login')) return json({ user: { id: 'admin-1', role: 'ADMIN' }, ...credentials() });
          if (url.pathname.endsWith('/me')) return json({ user: { id: 'admin-1', role: 'ADMIN' } });
          if (url.pathname.endsWith('/dashboard')) return json({ summary: {}, offers: [], boosts: [], subscriptions: [], loyalty: { cards: [] } });
          return json({ bookings: [], salons: [] });
        }
        const relative = url.pathname.slice(1);
        if (['admin/index.html', 'admin/admin.js', 'admin/admin.css', 'assets/salon-intake-controls.js', 'assets/salon-extras.js'].includes(relative)) {
          return route.fulfill({ contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, relative)) });
        }
        return route.abort();
      });
      async function page() {
        const p = await context.newPage();
        p.on('pageerror', error => errors.push(error.message));
        await p.goto('http://localhost:8000/admin/index.html');
        return p;
      }
      async function login(p) {
        await p.locator('[name=email]').fill('fixture@example.test');
        await p.locator('[name=password]').fill('fixture-password');
        await p.locator('#login-form button[type=submit]').click();
        await p.waitForFunction(() => !document.getElementById('workspace').hidden && !document.getElementById('content').hasAttribute('aria-busy'));
      }
      async function write(p, value) {
        await p.evaluate(value => value === null ? localStorage.removeItem('meshwarApiAuth') : localStorage.setItem('meshwarApiAuth', value), value);
      }
      async function invalidated(p) {
        await p.waitForFunction(() => document.getElementById('workspace').hidden && document.getElementById('login-status').textContent.includes('Your session changed'));
      }
      try {
        await run({ page, login, write, invalidated, authorization: () => lastAuthorization });
        assert.deepEqual(errors, []);
        console.log(`PASS ${name}`); passed++;
      } finally { await context.close(); }
    }
    await scenario('fresh isolated Admin login', async ({ page, login }) => { await login(await page()); });
    await scenario('same-account updates reach subsequent API calls', async ({ page, login, write, authorization }) => {
      const first = await page(); await login(first); const second = await page();
      await write(second, JSON.stringify(credentials('admin-1', 'ADMIN', 'fixture-updated')));
      await first.waitForFunction(() => !document.getElementById('workspace').hidden);
      await first.waitForTimeout(100);
      await first.locator('#refresh').click();
      await first.waitForFunction(() => !document.getElementById('content').hasAttribute('aria-busy'));
      assert.equal(authorization(), 'Bearer fixture-updated');
    });
    await scenario('genuine logout propagates', async ({ page, login, invalidated }) => {
      const first = await page(); await login(first); const second = await page();
      await second.waitForFunction(() => !document.getElementById('workspace').hidden);
      await second.locator('#logout').click(); await invalidated(first);
      assert.equal(await first.evaluate(() => localStorage.getItem('meshwarApiAuth')), null);
    });
    for (const [name, value] of [
      ['different Admin account', JSON.stringify(credentials('admin-2'))],
      ['non-Admin replacement', JSON.stringify(credentials('admin-1', 'OWNER'))],
      ['malformed JSON', '{broken'],
      ['missing access token', JSON.stringify({ userId: 'admin-1', role: 'ADMIN' })],
      ['invalid token type', JSON.stringify(credentials('admin-1', 'ADMIN', 42))],
      ['invalid refresh token type', JSON.stringify({ ...credentials(), refreshToken: {} })],
      ['null authentication', 'null'],
    ]) await scenario(name + ' invalidates without deleting replacement', async ({ page, login, write, invalidated }) => {
      const first = await page(); await login(first); const second = await page();
      await write(second, value); await invalidated(first);
      assert.equal(await first.evaluate(() => localStorage.getItem('meshwarApiAuth')), value);
      assert.ok(await first.locator('#workspace').isHidden());
    });
    await scenario('storage clear propagates logout', async ({ page, login, invalidated }) => {
      const first = await page(); await login(first); const second = await page();
      await second.evaluate(() => localStorage.clear()); await invalidated(first);
    });
    await scenario('queued stale event uses current credentials', async ({ page, login, write }) => {
      const first = await page(); await login(first); const second = await page();
      const replacement = JSON.stringify(credentials('admin-1', 'ADMIN', 'fixture-latest'));
      await write(second, replacement);
      await first.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'meshwarApiAuth', newValue: null, storageArea: localStorage })));
      assert.ok(await first.locator('#workspace').isVisible());
      assert.equal(await first.evaluate(() => localStorage.getItem('meshwarApiAuth')), replacement);
    });
    await scenario('two Admin tabs do not cascade sign-out', async ({ page, login, write, invalidated }) => {
      const first = await page(); const second = await page(); await login(first); await login(second);
      await write(second, JSON.stringify(credentials('admin-1', 'ADMIN', 'fixture-two-tabs')));
      await first.waitForTimeout(150);
      assert.ok(await first.locator('#workspace').isVisible());
      assert.ok(await second.locator('#workspace').isVisible());
      const replacement = JSON.stringify(credentials('admin-2'));
      // A separate writer lets both Admin listeners observe replacement.
      const writer = await contextPage(first);
      await write(writer, replacement); await invalidated(first); await invalidated(second);
      assert.equal(await first.evaluate(() => localStorage.getItem('meshwarApiAuth')), replacement);
    });
    console.log(`PASS ${passed} Admin session scenarios`);
  } finally { await browser.close(); }
})().catch(error => { console.error('FAIL Admin session regression suite:', error.message); process.exitCode = 1; });

async function contextPage(page) {
  const writer = await page.context().newPage();
  await writer.goto('http://localhost:8000/admin/index.html');
  return writer;
}

