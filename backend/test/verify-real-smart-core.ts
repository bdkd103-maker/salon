// From backend: node --experimental-transform-types test/run-typescript.mjs test/verify-real-smart-core.ts
// Uses the existing local PostgreSQL database and installed Edge; deletes only unique test fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chromium } from 'playwright';
import { prisma } from '../src/lib/prisma.js';
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
  await prisma.user.createMany({data: ids.map((id,i) => ({id, email:`${id}@example.invalid`, fullName:`SMART ${roles[i]}`, role:roles[i] as any, emailVerified:true}))});
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
  assert.equal((await state()).occupancy,'NOT_AVAILABLE');
  for(const actor of [1,4]) {
    await call('GET',base+'/staff/status',actor,undefined,403);
    await call('PATCH',base+`/staff/${memberId}/duty`,actor,{dutyState:'ON_DUTY'},403);
    await call('POST',base+'/service-visits',actor,{staffMembershipId:memberId},403);
  }
  await call('PATCH',base+`/staff/${memberId}/duty`,null,{dutyState:'ON_DUTY'},401);
  await call('GET',`/api/v1/salons/${otherSalonId}/staff/status`,2,undefined,403);
  await call('PATCH',base+`/staff/${otherMemberId}/duty`,2,{dutyState:'ON_DUTY'},403);
  await call('POST',base+'/service-visits',2,{staffMembershipId:otherMemberId},403);
  await call('PATCH',base+`/staff/${memberId}/duty`,2,{dutyState:'ON_DUTY'});
  assert.equal((await state()).occupancy,'AVAILABLE');
  const publicFree=await call('GET',base+'/live-status',null); assert.equal(publicFree.staffSummary.available,1);
  assert.equal(await prisma.staffPresence.count({where:{staffMembershipId:memberId,dutyState:'ON_DUTY'}}),1);
  const starts=await Promise.all([0,1].map(() => app.inject({method:'POST',url:base+'/service-visits',headers:{authorization:`Bearer ${tokens[2]}`},payload:{staffMembershipId:memberId}})));
  assert.deepEqual(starts.map(r=>r.statusCode).sort(),[200,409]);
  const visitId=starts.find(r=>r.statusCode===200)!.json().serviceVisit.id;
  assert.equal((await state()).occupancy,'BUSY');
  assert.equal((await call('POST',base+`/staff/${memberId}/presence/confirm`,2)).occupancy,'BUSY');
  await call('PATCH',base+`/service-visits/${visitId}/complete`,3,undefined,403);
  await call('PATCH',base+`/service-visits/${visitId}/complete`,4,undefined,403);
  await prisma.staffPresenceLease.updateMany({where:{staffMembershipId:memberId},data:{validUntil:new Date(Date.now()-1000),observedAt:new Date(Date.now()-600000)}});
  assert.equal((await state()).occupancy,'BUSY');
  await call('PATCH',base+`/service-visits/${visitId}/complete`,2);
  assert.equal((await state()).occupancy,'NOT_AVAILABLE');
  assert.equal((await call('GET',base+'/live-status',null)).staffSummary.available,0);
  await call('PATCH',base+`/service-visits/${visitId}/complete`,2,undefined,409);
  await call('POST',base+`/staff/${memberId}/presence/confirm`,0);
  assert.equal((await state()).occupancy,'AVAILABLE');
  await prisma.staffMembership.update({where:{id:memberId},data:{status:'SUSPENDED'}});
  await call('PATCH',base+`/staff/${memberId}/duty`,2,{dutyState:'ON_DUTY'},403);
  await prisma.staffMembership.update({where:{id:memberId},data:{status:'ACTIVE'}});
  await call('GET',base+'/staff/status',5);
  console.log('REAL_API_POSTGRES_SECURITY = PASS');

  const address=await app.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true,channel:"msedge"});
  const context=await browser.newContext();
  await context.addInitScript(() => { localStorage.setItem('meshwarSelectedExperience','men'); localStorage.setItem('meshwarLang','de'); localStorage.setItem('salonkCookieConsent','rejected'); });
  // Only local traffic; rewrite the app's fixed local API port to this test server.
  await context.route('**/*',route => {
    const u=new URL(route.request().url());
    if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
    if(u.pathname.startsWith('/api/'))return route.continue({url:address+u.pathname+u.search});
    return route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror', error => console.log('UI_ERROR',error.message));
  await page.goto(address+'/index.html');
  await page.evaluate(({token,id,salon}) => {
    storeAuthToken({accessToken:token,userId:id,role:'OWNER'});
    session={role:'owner',id:salon.id}; activeOwnerId=salon.id; data=normalizeSalon(salon);
    openModal('ownerModal'); setOwnerPanelSection('live'); renderOwnerBarbers();
  },{token:tokens[0],id:ids[0],salon:await prisma.salon.findUnique({where:{id:salonId},include:{barbers:true}})});
  const row=page.locator(`[data-smart-staff="${memberId}"]`);
  await row.getByRole('button',{name:'Frei bestätigen',exact:true}).click();
  await row.getByText('Frei · bestätigt',{exact:false}).waitFor();
  await row.getByRole('button',{name:'Service starten',exact:true}).click();
  await row.getByText('Beschäftigt',{exact:false}).waitFor();
  assert.equal((await state()).occupancy,'BUSY');
  const completed = page.waitForResponse(r => r.url().includes('/complete') && r.request().method() === 'PATCH');
  await row.getByRole('button',{name:'Service beenden',exact:true}).click();
  assert.equal((await completed).status(),200);
  await row.getByText('Frei · bestätigt',{exact:false}).waitFor();
  await page.reload();
  await page.evaluate(async salonId => { activeOwnerId=salonId; openModal('ownerModal');setOwnerPanelSection('live');await window.SaloSmartCore.loadOwner(salonId); },salonId);
  await row.getByText('Frei · bestätigt',{exact:false}).waitFor();
  // Real customer card, same public API, no mocked response or persisted browser status.
  const customer=await context.newPage(); await customer.goto(address+'/index.html');
  await customer.locator(`[data-smart-salon="${salonId}"]:visible`).first().getByText('Sofort verfügbar',{exact:true}).waitFor();
  await prisma.staffPresenceLease.updateMany({where:{staffMembershipId:memberId},data:{validUntil:new Date(Date.now()-1000),observedAt:new Date(Date.now()-600000)}});
  await customer.reload();
  await customer.locator(`[data-smart-salon="${salonId}"]:visible`).first().getByText('Wartezeit unbekannt',{exact:true}).waitFor();
  const staleWait = (await call('GET',base+'/live-status',null)).wait;
  assert.equal(staleWait.state,'STAFF_STATUS_UNCONFIRMED');assert.equal(staleWait.etaMinutes,null);
  console.log('REAL_OWNER_CUSTOMER_UI_RELOAD = PASS');
} finally {
  await browser?.close(); await app.close();
  await prisma.serviceVisit.deleteMany({where:{salonId:{in:[salonId,otherSalonId]}}});
  await prisma.staffPresenceLease.deleteMany({where:{staffMembershipId:{in:[memberId,otherMemberId]}}});
  await prisma.staffPresence.deleteMany({where:{staffMembershipId:{in:[memberId,otherMemberId]}}});
  await prisma.staffMembership.deleteMany({where:{id:{in:[memberId,otherMemberId]}}});
  await prisma.barber.deleteMany({where:{salonId:{in:[salonId,otherSalonId]}}});
  await prisma.salon.deleteMany({where:{id:{in:[salonId,otherSalonId]}}});
  await prisma.user.deleteMany({where:{id:{in:ids}}});
  assert.equal(await prisma.user.count({where:{id:{in:ids}}}),0);
  assert.equal(await prisma.salon.count({where:{id:{in:[salonId,otherSalonId]}}}),0);
  await prisma.$disconnect(); console.log('TEMPORARY_FIXTURE_CLEANUP = PASS');
}

