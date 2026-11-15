// Real same-origin Web Locks, storage events and Web Audio adapter with synthetic visits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const START = Date.parse('2026-01-01T10:00:00Z');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  let serverTime = START + 40 * 60000;
  const html = `<!doctype html><html lang="en"><body><div id="staffModal" class="show"><div id="staffServiceCard"></div></div>
    <script>
    let session = {role:'staff',userId:'staff-1'};
    localStorage.setItem('meshwarSession',JSON.stringify(session));
    window.__tones=0;
    window.AudioContext=class {state='suspended';currentTime=0;destination={};async resume(){this.state='running'}async suspend(){this.state='suspended'}createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){window.__tones++},stop(){queueMicrotask(()=>this.onended?.())}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}}};
    function getApiHeaders(){return {}}
    async function apiRequest(path,options={}){const r=await fetch(path,options);if(!r.ok)throw Object.assign(new Error('Fixture failure'),{status:r.status});return r.json()}
    function renderStaffDashboard(info){window.SaloBusyReminder?.sync(info)}
    </script><script src="/assets/smart-busy-reminder.js"></script>
    <script>apiRequest('/api/v1/staff/me').then(info=>{window.__staffInfo=info;window.SaloBusyReminder.sync(info)})</script></body></html>`;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'assets/smart-busy-reminder.js')) });
    if (url.pathname === '/api/v1/staff/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user:{id:'staff-1',role:'STAFF'},membership:{salonId:'salon-1'},hasActiveVisit:true,activeVisitId:'visit-1',activeVisitStartedAt:new Date(START).toISOString(),serverTime:new Date(serverTime).toISOString() }) });
    return route.abort();
  });
  try {
    const a = await context.newPage(), b = await context.newPage();
    for (const p of [a,b]) { await p.clock.install({ time: serverTime }); await p.goto('http://localhost:8000/fixture'); await p.waitForFunction(() => Boolean(window.SaloBusyReminder)); await p.clock.runFor(10); }
    await a.clock.runFor(10); await b.clock.runFor(10);
    const owner = (await a.locator('#saloBusyReminder').isVisible()) ? a : b;
    const follower = owner === a ? b : a;
    await owner.locator('#saloBusyReminder:visible').waitFor();
    assert.equal(await follower.locator('#saloBusyReminder').isVisible(), false);
    for (const p of [a,b]) await p.locator('#saloBusySound').click();
    assert.equal(await owner.evaluate(() => window.__tones), 0);
    serverTime += 120000;
    await owner.clock.runFor(120001); await follower.clock.runFor(120001);
    await owner.waitForFunction(() => window.__tones === 3);
    assert.equal(await follower.evaluate(() => window.__tones), 0);
    console.log('PASS real Web Locks: one three-tone audible owner across two tabs');
    await owner.close();
    serverTime += 120000;
    await follower.clock.runFor(120001);
    await follower.locator('#saloBusyReminder:visible').waitFor();
    await follower.waitForFunction(() => window.__tones === 3);
    console.log('PASS owner close transfers real browser ownership and sound');
    await follower.locator('#saloBusyYes').click();
    assert.equal(await follower.locator('#saloBusyReminder').isVisible(), false);
    console.log('PASS explicit acknowledgement stops and hides reminder');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
