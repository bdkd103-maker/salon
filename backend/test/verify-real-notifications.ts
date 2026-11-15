// Opt-in real PostgreSQL + actual localhost:8000 browser verification.
// Run from backend: node --experimental-transform-types test/run-typescript.mjs test/verify-real-notifications.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/auth.js';
import { notifyOperationalEvent } from '../src/lib/notifications.js';
import { isWeekend, isHoliday } from '../src/lib/booking-time.js';
dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url))});
const target=new URL(process.env.DATABASE_URL||'http://invalid');
assert.ok(['postgres:','postgresql:'].includes(target.protocol)&&['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/salon'&&(target.port||'5432')==='5432'&&['NODE_ENV','APP_ENV','ENVIRONMENT','DEPLOYMENT_ENV','VERCEL_ENV'].every(k=>!process.env[k]||/^(dev|development|local|test|testing)$/.test(process.env[k]!)),'Local DB only');
const ids=Array.from({length:7},()=>randomUUID()), salons=[randomUUID(),randomUUID()], member=randomUUID();
const roles=['CUSTOMER','CUSTOMER','OWNER','OWNER','STAFF','STAFF','ADMIN'];
const password=randomUUID()+'!aA1', email=(i:number)=>`notifications-${ids[i]}@example.invalid`;
const tokens:string[]=[];let browser:any;let stage='setup';
async function call(actor:number|null,path:string,method='GET',body?:any,expected=200){
 const response=await fetch('http://localhost:4000'+path,{method,headers:{'Content-Type':'application/json',...(actor===null?{}:{Authorization:'Bearer '+tokens[actor]})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
 const data=await response.json() as any;assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);return data;
}
const feed=(actor:number)=>call(actor,'/api/v1/notifications');
const check=async(name:string,fn:()=>Promise<any>)=>{stage=name;await fn();console.log('PASS '+name);};
try{
 const hash=await hashPassword(password);
 for(let i=0;i<ids.length;i++)await prisma.user.create({data:{id:ids[i],email:email(i),fullName:'Notification verification',passwordHash:hash,role:roles[i] as any,emailVerified:true,status:'ACTIVE'}});
 for(let i=0;i<2;i++)await prisma.salon.create({data:{id:salons[i],ownerId:ids[2+i],name:'Notification fixture '+i,slug:'notification-'+salons[i],city:'Berlin',address:'Temporary fixture',phone:'000',isActive:true,openingTime:'00:00',closingTime:'23:59',workingDays:['mon','tue','wed','thu','fri','sat','sun'],timeZone:'Europe/Berlin',bookingIntakeEnabled:true,saloTicketIntakeEnabled:true}});
 const barber=await prisma.barber.create({data:{salonId:salons[0],name:'Temporary staff'}});
 await prisma.staffMembership.create({data:{id:member,salonId:salons[0],userId:ids[4],barberId:barber.id}});
 for(let i=0;i<ids.length;i++){const result=await call(null,'/api/v1/auth/login','POST',{email:email(i),password});tokens[i]=result.accessToken;}
 let date='';for(let d=1;d<=14;d++){const iso=new Date(Date.now()+d*86400000).toISOString().slice(0,10), n=new Date(iso+'T12:00:00Z');if(!isWeekend(n,'Europe/Berlin')&&!isHoliday(n,'Europe/Berlin')){date=iso;break;}}
 const payload={salonId:salons[0],startAt:date+'T11:00:00',endAt:date+'T12:00:00',timeZone:'Europe/Berlin'};
 let booking:any, ticket:any;
 await check('Booking creation, recipient correctness and failed retry',async()=>{
  booking=(await call(0,'/api/v1/bookings','POST',payload)).booking;
  assert.equal((await feed(0)).unreadCount,1);assert.equal((await feed(2)).unreadCount,1);assert.equal((await feed(3)).unreadCount,0);
  const persisted=await prisma.notification.findMany({where:{userId:{in:ids}}});assert.equal(persisted.length,2);assert.deepEqual(persisted.map(r=>r.userId).sort(),[ids[0],ids[2]].sort());
  await call(0,'/api/v1/bookings','POST',payload,409);assert.equal(await prisma.notification.count({where:{userId:{in:ids}}}),2);
 });
 await check('Booking status, no-op retry and owner awareness',async()=>{
  await call(2,'/api/v1/bookings/'+booking.id,'PATCH',{status:'CONFIRMED'});
  assert.equal((await feed(0)).unreadCount,2);assert.equal((await feed(2)).unreadCount,1);
  await call(2,'/api/v1/bookings/'+booking.id,'PATCH',{status:'CONFIRMED'});assert.equal((await feed(0)).unreadCount,2);
  await call(0,'/api/v1/bookings/'+booking.id,'DELETE');assert.equal((await feed(0)).unreadCount,3);assert.equal((await feed(2)).unreadCount,2);
 });
 await check('User, salon, staff and admin isolation',async()=>{
  const first=(await feed(0)).notifications[0].id, owner=(await feed(2)).notifications[0].id;
  await call(null,'/api/v1/notifications','GET',undefined,401);
  for(const actor of [1,2,3,4,5,6])await call(actor,'/api/v1/notifications/read','POST',{notificationIds:[first]},404);
  for(const actor of [0,3,4,5,6])await call(actor,'/api/v1/notifications/read','POST',{notificationIds:[owner]},404);
  for(const actor of [1,3,4,5,6])assert.equal((await feed(actor)).unreadCount,0);
  await call(3,'/api/v1/bookings/'+booking.id,'PATCH',{status:'CONFIRMED'},403);
 });
 await check('Read timestamp and all-read persist across login',async()=>{
  const item=(await feed(0)).notifications[0];await call(0,'/api/v1/notifications/read','POST',{notificationIds:[item.id]});
  const first=await prisma.notification.findUniqueOrThrow({where:{id:item.id}});assert.ok(first.readAt);assert.equal(first.isRead,true);
  await call(0,'/api/v1/notifications/read','POST',{notificationIds:[item.id]});assert.equal(+(await prisma.notification.findUniqueOrThrow({where:{id:item.id}})).readAt!,+first.readAt!);
  await call(0,'/api/v1/notifications/read','POST',{readAll:true});assert.equal((await feed(0)).unreadCount,0);
  tokens[0]=(await call(null,'/api/v1/auth/login','POST',{email:email(0),password})).accessToken;assert.equal((await feed(0)).unreadCount,0);
 });
 await check('Two populated salon feeds remain isolated; completed booking event',async()=>{
  const other=(await call(0,'/api/v1/bookings','POST',{...payload,salonId:salons[1]})).booking;
  const own=(await feed(2)).notifications,foreign=(await feed(3)).notifications;
  assert.ok(own.length>0&&foreign.length>0);
  assert.ok(own.every((n:any)=>n.metadata.salonId===salons[0]));assert.ok(foreign.every((n:any)=>n.metadata.salonId===salons[1]));
  await call(2,'/api/v1/notifications/read','POST',{notificationIds:[foreign[0].id]},404);
  for(const actor of [4,5])await call(actor,'/api/v1/notifications/read','POST',{notificationIds:[foreign[0].id]},404);
  await call(3,'/api/v1/bookings/'+other.id,'PATCH',{status:'CONFIRMED'});
  await call(3,'/api/v1/bookings/'+other.id,'PATCH',{status:'COMPLETED'});
  assert.ok((await feed(0)).notifications.some((n:any)=>n.type==='booking-completed'));
  assert.equal((await feed(3)).unreadCount,1);
 });
 await check('Ticket create/retry/cancel/start notifications',async()=>{
  ticket=(await call(0,`/api/v1/salons/${salons[0]}/queue/tickets`,'POST',{},201)).queueEntry;
  const count=await prisma.notification.count({where:{userId:{in:ids}}});
  await call(0,`/api/v1/salons/${salons[0]}/queue/tickets`,'POST',{});assert.equal(await prisma.notification.count({where:{userId:{in:ids}}}),count);
  await call(1,`/api/v1/salons/${salons[0]}/queue/${ticket.id}/cancel`,'POST',{},403);assert.equal(await prisma.notification.count({where:{userId:{in:ids}}}),count);
  await call(0,`/api/v1/salons/${salons[0]}/queue/${ticket.id}/cancel`,'POST',{});
  ticket=(await call(0,`/api/v1/salons/${salons[0]}/queue/tickets`,'POST',{},201)).queueEntry;
  await call(2,`/api/v1/salons/${salons[0]}/staff/${member}/duty`,'PATCH',{dutyState:'ON_DUTY'});
  await call(2,`/api/v1/salons/${salons[0]}/staff/${member}/presence/confirm`,'POST',{});
  await call(3,`/api/v1/salons/${salons[0]}/queue/${ticket.id}/start`,'POST',{staffMembershipId:member},403);
  await call(2,`/api/v1/salons/${salons[0]}/queue/${ticket.id}/start`,'POST',{staffMembershipId:member});
  const customer=await feed(0);assert.ok(customer.notifications.some((n:any)=>n.type==='queue-started'));assert.ok(customer.notifications.some((n:any)=>n.type==='queue-cancelled'));assert.equal((await feed(4)).unreadCount,0);
 });
 await check('Transaction failure rolls back event and notification',async()=>{
  const id=randomUUID(),before=await prisma.notification.count({where:{userId:{in:ids}}});
  await assert.rejects(prisma.$transaction(async tx=>{
   await tx.booking.create({data:{id,userId:ids[0],salonId:salons[0],startAt:new Date(),endAt:new Date(Date.now()+3600000)}});
   await notifyOperationalEvent(tx,{entity:'booking',id,salonId:salons[0],customerId:ids[0],ownerId:randomUUID(),actorId:ids[0],state:'CREATED',revision:'created'});
  }));
  assert.equal(await prisma.booking.count({where:{id}}),0);assert.equal(await prisma.notification.count({where:{userId:{in:ids}}}),before);
 });
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 await check('Actual served customer and owner inbox, reload, languages, desktop/mobile, error recovery',async()=>{
  for(const actor of [0,2,1]){
   const ctx=await browser.newContext({viewport:{width:1366,height:900}});
   await ctx.addInitScript(()=>{localStorage.setItem('meshwarSelectedExperience','men');localStorage.setItem('meshwarLang','de');localStorage.setItem('salonkCookieConsent','rejected');});
   await ctx.route('**/*',(route:any)=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
   const page=await ctx.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(15000);
   const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
   await page.goto('http://localhost:8000/');await page.evaluate(()=>{(window as any).openCustomerLogin();});
   await page.locator('#customerLoginEmail').fill(email(actor));await page.locator('#customerLoginPassword').fill(password);
   const [login]=await Promise.all([page.waitForResponse((r:any)=>r.url().endsWith('/api/v1/auth/login')),page.locator('#customerLoginSubmit').click()]);assert.equal(login.status(),200);
   await page.waitForFunction(()=>Boolean((window as any).readStoredAuthToken()?.accessToken));
   if(actor!==2)await page.goto('http://localhost:8000/customer-profile.html');
   const selector=actor===2?'#ownerModal .owner-panel-scroll > [data-notification-entry]':'.page-header [data-notification-entry]';
   await page.locator(selector).waitFor({state:'visible'});await page.locator(selector).click();
   const inbox=page.locator('.salo-notification-dialog');await inbox.waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.querySelector('.salo-notification-dialog [data-state]')?.textContent?.includes('geladen'));
   const expected=(await feed(actor)).unreadCount;
   if(expected)assert.equal(Number(await page.locator(selector+' .salo-notification-badge').textContent()),expected);
   if(actor===1){await inbox.getByText('Keine Benachrichtigungen.',{exact:true}).waitFor();}
   else{
    await inbox.locator('[data-unread="true"]').first().waitFor();const row=inbox.locator('[data-unread="true"]').first();const id=await row.getAttribute('data-notification-id');await row.getByRole('button',{name:'Als gelesen markieren',exact:true}).click();
    await inbox.locator(`[data-notification-id="${id}"][data-unread="false"]`).waitFor();
    assert.ok((await prisma.notification.findUniqueOrThrow({where:{id}})).readAt);
    await page.reload();await page.locator(selector).click();await inbox.locator(`[data-notification-id="${id}"][data-unread="false"]`).waitFor();
   }
   for(const width of [1366,390])for(const language of ['de','en','ar']){
    await page.setViewportSize({width,height:900});
    // Use the existing language selector while the inbox is closed.
    await inbox.locator('[data-close]').click();
    if(actor===2){await page.evaluate((l:string)=>{(window as any).applyLanguage(l);},language);}else await page.locator('#profileLanguageSelect').selectOption(language);
    await page.locator(selector).click();await page.waitForFunction(()=>document.querySelectorAll('.salo-notification-item').length>0||!!document.querySelector('.salo-notification-dialog [data-state]')?.textContent);
    assert.equal(await inbox.getAttribute('dir'),language==='ar'?'rtl':'ltr');
    await inbox.getByRole('heading',{name:language==='de'?'Benachrichtigungen':language==='en'?'Notifications':'\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a',exact:true}).waitFor();
    const box=await inbox.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    await page.screenshot({path:fileURLToPath(new URL(`../../.tmp-notification-${actor}-${width}-${language}.png`,import.meta.url))});
   }
   if(actor!==1){await Promise.all([page.waitForResponse((r:any)=>r.url().endsWith('/api/v1/notifications/read')&&r.status()===200),inbox.locator('[data-all]').click()]);await page.waitForFunction(()=>document.querySelectorAll('.salo-notification-item[data-unread="true"]').length===0);assert.equal((await feed(actor)).unreadCount,0);}
   if(actor!==1){
    const list=(await feed(actor)).notifications;
    const target=list.find((n:any)=>n.metadata.entityType===(actor===2?'queue':'booking'));
    await inbox.locator('[data-notification-id="'+target.id+'"] footer button').last().click();
    await inbox.waitFor({state:'hidden'});
    if(actor===2)await page.locator('#ownerModal [data-owner-panel-section="queue"]:not([hidden])').waitFor();
    else assert.ok(page.url().endsWith('#recentBookingsCard'));
    await page.locator(selector).click();
   }
   await inbox.locator('[data-close]').click();
   await page.route('**/api/v1/notifications', (route:any)=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Verification outage'})}));
   await page.locator(selector).click();await inbox.locator('[data-retry]').waitFor({state:'visible'});
   await page.unroute('**/api/v1/notifications');await inbox.locator('[data-retry]').click();await inbox.locator('[data-retry]').waitFor({state:'hidden'});
   assert.deepEqual(errors,[]);await ctx.close();
  }
 });
 console.log('REAL_POSTGRES_E2E = PASS\nREAL_BROWSER_E2E = PASS');
}catch(error){console.error('FAILED_STAGE = '+stage);throw error;}
finally{
 await browser?.close();
 await prisma.notification.deleteMany({where:{userId:{in:ids}}});
 await prisma.queueEntry.deleteMany({where:{salonId:{in:salons}}});
 await prisma.serviceVisit.deleteMany({where:{salonId:{in:salons}}});
 await prisma.booking.deleteMany({where:{salonId:{in:salons}}});
 await prisma.salon.deleteMany({where:{id:{in:salons}}});
 await prisma.session.deleteMany({where:{userId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});
 assert.equal(await prisma.user.count({where:{id:{in:ids}}}),0);console.log('ISOLATED_FIXTURE_CLEANUP = PASS');await prisma.$disconnect();
}
