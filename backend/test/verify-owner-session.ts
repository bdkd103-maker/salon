import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chromium } from 'playwright';
import { prisma } from '../src/lib/prisma.js';
import { mock } from 'node:test';
import { hashPassword } from '../src/lib/auth.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { staffStatusRoutes } from '../src/routes/staff-status.js';
import { authRoutes } from '../src/routes/auth.js';
import { salonRoutes } from '../src/routes/salons.js';
import { dashboardRoutes } from '../src/routes/dashboard.js';

dotenv.config();
const target = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.ok(['postgresql:', 'postgres:'].includes(target.protocol)
  && ['localhost', '127.0.0.1'].includes(target.hostname)
  && (target.port || '5432') === '5432' && target.pathname === '/salon'
  && ['NODE_ENV','APP_ENV','ENVIRONMENT','DEPLOYMENT_ENV','VERCEL_ENV'].every(k => !process.env[k] || /^(dev|development|local|test|testing)$/.test(process.env[k]!))
  && [...target.searchParams].every(([k,v]) => k === 'schema' ? v === 'public' : ['connection_limit','connect_timeout','pool_timeout'].includes(k) && /^\d+$/.test(v)), 'Local test database safety guard');
// Ephemeral signing key, confined to this test process; no existing credentials used.
process.env.JWT_ACCESS_SECRET = randomUUID();
process.env.JWT_REFRESH_SECRET = randomUUID();
const password = randomUUID() + "Aa1!";
const suffix = randomUUID();
const ids = ['owner','other-owner','staff','other-staff','customer','admin'].map(role => `smart-${role}-${suffix}`);
const salonId = `smart-salon-${suffix}`, otherSalonId = `smart-other-${suffix}`;
const memberId = `smart-member-${suffix}`, otherMemberId = `smart-member-other-${suffix}`;
const roles = ['OWNER','OWNER','STAFF','STAFF','CUSTOMER','ADMIN'];
const tokens = ids.map((id,i) => signAccessToken({ sub:id, role:roles[i] }));
const app = Fastify(); let browser;
const base = `/api/v1/salons/${salonId}`;
async function call(method:string, path:string, actor:number|null=0, payload?:any, expected=200) {
  const r = await app.inject({ method:method as any, url:path, ...(actor === null ? {} : {headers:{authorization:`Bearer ${tokens[actor]}`}}), ...(payload ? {payload} : {}) });
  assert.equal(r.statusCode,expected,`${method} ${path}: ${r.body}`); return r.json();
}
const state = async () => (await call('GET',base+'/staff/status')).staff.find((s:any) => s.staffMembershipId === memberId);
try {
  assert.equal((await prisma.$queryRaw<any[]>`SELECT current_database() AS name`)[0].name,'salon');
  const passwordHash = await hashPassword(password);
  await prisma.user.createMany({data: ids.map((id,i) => ({id, email:`${id}@example.invalid`, fullName:`SMART ${roles[i]}`, role:roles[i] as any, emailVerified:true, passwordHash}))});
  for(const [id,ownerId] of [[salonId,ids[0]],[otherSalonId,ids[1]]]) await prisma.salon.create({data:{id,ownerId,name:'SMART test '+id,slug:id,city:'Berlin',address:'Fixture 1',phone:'000', openingTime:'00:00',closingTime:'23:59',workingDays:['mon','tue','wed','thu','fri','sat','sun'],timeZone:'Europe/Berlin'}});
  for(const [id,userId,name] of [[memberId,ids[2],'SMART Alice'],[otherMemberId,ids[3],'SMART Bob']]) {
    const barber = await prisma.barber.create({data:{salonId,name}});
    await prisma.staffMembership.create({data:{id,salonId,userId,barberId:barber.id}});
  }
  await app.register(cors, { origin: true });
  await staffStatusRoutes(app); await authRoutes(app); await salonRoutes(app); await dashboardRoutes(app);
  const root = resolve('..');
  app.get('/*',async (req:any,reply:any) => {
    const path=resolve(root, req.params['*'] || 'index.html');
    if(!path.startsWith(root+sep) || !/\.(html|js|css|svg|png|jpg|webp|ico)$/.test(path))return reply.code(404).send();
    try { const content=await readFile(path); reply.type(path.endsWith('.html')?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'image/svg+xml'); return content; } catch{return reply.code(404).send();}
  });

  const address=await app.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('meshwarSelectedExperience','men'); localStorage.setItem('meshwarLang','de'); localStorage.setItem('salonkCookieConsent','rejected');
  });
  await context.route('**/*',route => {
    const u=new URL(route.request().url());
    if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
    if(u.pathname.startsWith('/api/'))return route.continue({url:address+u.pathname+u.search});
    return route.continue();
  });
  const page=await context.newPage();
  console.log('FIXTURE_SUFFIX',suffix);
  page.on('pageerror', e=>console.log('UI_ERROR',e.message));
  const statuses: Array<{path:string,status:number,bearer:boolean}> = [];
  page.on('response',r => {
    if(r.url().includes('/api/v1/')) statuses.push({path:new URL(r.url()).pathname,status:r.status(),bearer:Boolean(r.request().headers().authorization?.startsWith('Bearer '))});
  });
  await page.goto(address+'/index.html');
  await page.evaluate(() => openCustomerLogin());
  await page.locator('#customerLoginEmail').fill(ids[0]+'@example.invalid');
  await page.locator('#customerLoginPassword').fill(password);
  const [login]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login')), page.locator('#customerLoginSubmit').click()]);
  assert.equal(login.status(),200);
  const openLiveTab=async()=>{
    await page.locator('#ownerModal [data-owner-panel-tab="live"]').click();
    await page.locator('#ownerModal [data-owner-panel-section="live"]:not([hidden])').waitFor();
  };
  await openLiveTab();
  const row=page.locator('[data-smart-staff="'+memberId+'"]');
  await row.getByRole('button',{name:'Frei best\u00e4tigen',exact:true}).click();
  await row.getByText('Frei \u00b7 best\u00e4tigt',{exact:false}).waitFor();
  await row.getByRole('button',{name:'Service starten',exact:true}).click();
  await row.getByText('Besch\u00e4ftigt',{exact:false}).waitFor();
  await page.reload();
  await openLiveTab();
  await row.getByText('Besch\u00e4ftigt',{exact:false}).waitFor();

  await row.getByRole('button',{name:'Service beenden',exact:true}).click();
  await row.getByText('Frei \u00b7 best\u00e4tigt',{exact:false}).waitFor();
  const identity=await page.evaluate(() => {
    const auth=readStoredAuthToken();const claims=JSON.parse(atob(auth.accessToken.split('.')[1]));
    return {role:auth.role,userId:auth.userId,refresh:Boolean(auth.refreshToken),lifetime:claims.exp-claims.iat};
  });
  assert.equal(identity.role,'OWNER');assert.equal(identity.userId,ids[0]);assert.equal(identity.refresh,true);assert.equal(identity.lifetime,900);
  assert.ok(statuses.some(s=>s.path.endsWith('/staff/status')&&s.status===200&&s.bearer));
  console.log('NORMAL_OWNER_LOGIN_HEADER_CONTROLS_F5 = PASS');
  // Advance only this isolated server's clock. The real login issued the tokens
  // and persisted the session; no browser session or credential is fabricated.
  mock.timers.enable({apis:['Date'],now:Date.now()});mock.timers.tick(16*60*1000);
  const expired=await page.evaluate(async () => (await fetch(API_BASE_URL+'/api/v1/owner/dashboard',{headers:getApiHeaders()})).status);
  assert.equal(expired,401);
  const before=statuses.length;
  await page.reload();
  if(process.env.EXPECT_OWNER_SESSION_BUG==='1') {
    await page.waitForFunction(() => document.body.textContent.includes('\u0627\u0646\u062a\u0647\u062a \u0627\u0644\u062c\u0644\u0633\u0629'));
    assert.equal(statuses.slice(before).filter(s=>s.path.endsWith('/auth/refresh')).length,0);
    console.log('REPRODUCED: expired access token; stored refresh token unused; Owner panel reports expired session');
  } else {
    await openLiveTab();
    await row.getByRole('button',{name:'Frei best\u00e4tigen',exact:true}).waitFor();

    assert.ok(statuses.slice(before).some(s=>s.path.endsWith('/auth/refresh')&&s.status===200));
    assert.ok(statuses.slice(before).some(s=>s.path.endsWith('/staff/status')&&s.status===200&&s.bearer));
    const isolation=await page.evaluate(async id=>(await fetch(API_BASE_URL+'/api/v1/salons/'+id+'/staff/status',{headers:getApiHeaders()})).status,otherSalonId);
    assert.equal(isolation,403);
    console.log('EXPIRED_OWNER_RENEWAL_F5_SMART_ISOLATION = PASS');
  }
} finally {
  mock.timers.reset();
  await browser?.close(); await app.close();
  await prisma.serviceVisit.deleteMany({where:{salonId:{in:[salonId,otherSalonId]}}});
  await prisma.staffPresenceLease.deleteMany({where:{staffMembershipId:{in:[memberId,otherMemberId]}}});
  await prisma.staffPresence.deleteMany({where:{staffMembershipId:{in:[memberId,otherMemberId]}}});
  await prisma.staffMembership.deleteMany({where:{id:{in:[memberId,otherMemberId]}}});
  await prisma.barber.deleteMany({where:{salonId:{in:[salonId,otherSalonId]}}});
  await prisma.salon.deleteMany({where:{id:{in:[salonId,otherSalonId]}}});
  await prisma.session.deleteMany({where:{userId:{in:ids}}});
  await prisma.user.deleteMany({where:{id:{in:ids}}});
  assert.equal(await prisma.user.count({where:{id:{in:ids}}}),0);
  assert.equal(await prisma.salon.count({where:{id:{in:[salonId,otherSalonId]}}}),0);
  await prisma.$disconnect(); console.log('TEMPORARY_FIXTURE_CLEANUP = PASS');
}

