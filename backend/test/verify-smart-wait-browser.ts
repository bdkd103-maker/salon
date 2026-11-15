// Actual served UI + real local PostgreSQL. Only unique fixtures are removed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {chromium} from 'playwright';
import {prisma} from '../src/lib/prisma.js';
import {hashPassword} from '../src/lib/auth.js';
dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url))});
const target=new URL(process.env.DATABASE_URL||'http://invalid');
assert.ok(['postgres:','postgresql:'].includes(target.protocol)&&['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/salon'&&(target.port||'5432')==='5432'&&['NODE_ENV','APP_ENV','ENVIRONMENT','DEPLOYMENT_ENV','VERCEL_ENV'].every(k=>!process.env[k]||/^(dev|development|local|test|testing)$/.test(process.env[k]!)),'Local fixture guard');
const users=Array.from({length:6},()=>randomUUID()),salons=Array.from({length:3},()=>randomUUID()),member=randomUUID(),member2=randomUUID();
const roles=['OWNER','OWNER','CUSTOMER','CUSTOMER','STAFF','STAFF'],password=randomUUID()+'aA1!',prefix='Ticket '+randomUUID().slice(0,8);
const email=(i:number)=>roles[i].toLowerCase()+'-'+users[i]+'@example.invalid';const tokens:string[]=[];
let browser:any,stage='setup';
async function api(actor:number|null,path:string,method='GET',body?:any,expected=200){const r=await fetch('http://localhost:4000'+path,{method,headers:{'Content-Type':'application/json',...(actor===null?{}:{Authorization:'Bearer '+tokens[actor]})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,expected,`${path}: ${r.status} ${await r.clone().text()}`);return r.json() as any;}
const base=(i=0)=>`/api/v1/salons/${salons[i]}`;
try{
 const settings=await prisma.platformSettings.findUniqueOrThrow({where:{id:'platform'}});assert.ok(settings.saloTicketGloballyEnabled&&settings.walkInGloballyEnabled,'Local gates must be enabled; this test does not modify shared platform settings');
 const hash=await hashPassword(password);
 for(let i=0;i<users.length;i++)await prisma.user.create({data:{id:users[i],email:email(i),fullName:'Ticket fixture '+roles[i],role:roles[i] as any,passwordHash:hash,emailVerified:true}});
 for(let i=0;i<salons.length;i++)await prisma.salon.create({data:{id:salons[i],ownerId:users[i===0?0:1],name:prefix+' '+['Eligible','Disabled','Other'][i],slug:'ticket-'+salons[i],city:'Berlin',address:'Fixture address',phone:'000',isActive:true,saloTicketIntakeEnabled:i!==1,openingTime:'00:00',closingTime:'23:59',workingDays:['mon','tue','wed','thu','fri','sat','sun'],timeZone:'Europe/Berlin'}});
 const barber=await prisma.barber.create({data:{salonId:salons[0],name:'Ticket staff'}});await prisma.staffMembership.create({data:{id:member,salonId:salons[0],userId:users[4],barberId:barber.id}});
 await prisma.service.create({data:{salonId:salons[0],name:'Configured service',durationMin:20,price:25}});
 const barber2=await prisma.barber.create({data:{salonId:salons[0],name:'Second staff'}});await prisma.staffMembership.create({data:{id:member2,salonId:salons[0],userId:users[5],barberId:barber2.id}});
 for(let i=0;i<users.length;i++)tokens[i]=(await api(null,'/api/v1/auth/login','POST',{email:email(i),password})).accessToken;
 await api(0,base()+`/staff/${member}/duty`,'PATCH',{dutyState:'ON_DUTY'});await api(0,base()+`/staff/${member}/presence/confirm`,'POST',{});
 await api(0,base()+`/staff/${member2}/duty`,'PATCH',{dutyState:'ON_DUTY'});
 for(const actor of [null,0,4])await api(actor,base()+'/queue/tickets','POST',{},actor===null?401:403);
 await api(2,base(1)+'/queue/tickets','POST',{},409);
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 const context=async()=>{const c=await browser.newContext({viewport:{width:1366,height:1000}});await c.addInitScript(()=>{localStorage.setItem('meshwarSelectedExperience','men');localStorage.setItem('meshwarLang','de');localStorage.setItem('salonkCookieConsent','rejected');sessionStorage.setItem('meshwarEntryChoiceSeen','true');});await c.route('**/*',(r:any)=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());return c;};
 const c=await context(),p=await c.newPage();p.setDefaultTimeout(15000);const errors:string[]=[];p.on('pageerror',(e:any)=>errors.push(e.message));await p.goto('http://localhost:8000/');
 const login=async(page:any,actor:number)=>{await page.evaluate(()=>{(window as any).openCustomerLogin();});await page.locator('#customerLoginEmail').fill(email(actor));await page.locator('#customerLoginPassword').fill(password);await page.locator('#customerLoginSubmit').click();await page.locator('#customerLoginModal').waitFor({state:'hidden'});};
 const profile=async(i=0)=>{await p.locator(`#regularSalonGrid [data-profile-salon="${salons[i]}"]`).click();await p.locator('#salonProfileModal.show').waitFor();};
 stage='public login gate';await profile();await p.locator('[data-salo-ticket-action]').click();await p.locator('#customerLoginModal.show').waitFor();assert.equal(await prisma.queueEntry.count({where:{salonId:{in:salons}}}),0);await login(p,2);
 stage='real creation';await prisma.queueEntry.create({data:{salonId:salons[0],source:'MANUAL_WALK_IN',status:'WAITING',joinedAt:new Date(Date.now()-120000)}});await prisma.queueEntry.create({data:{salonId:salons[0],source:'MANUAL_WALK_IN',status:'WAITING',joinedAt:new Date(Date.now()-60000)}});await profile();await p.locator('[data-salo-ticket-action][data-salo-ticket-mode="draw"]').click();await p.locator('[data-salo-ticket-status-value="WAITING"]').waitFor();
 let ticket=await prisma.queueEntry.findFirstOrThrow({where:{customerId:users[2]}});assert.equal(ticket.salonId,salons[0]);assert.equal(ticket.status,'WAITING');
  const mine=await api(2,'/api/v1/queue/tickets/mine');assert.equal(mine.ticket.id,ticket.id);assert.equal(mine.position,3);assert.equal(mine.ahead,2);
  assert.ok(mine.wait,'an active ticket exposes the derived SMART wait state');
  assert.equal(mine.wait.salonId,salons[0]);assert.equal(mine.wait.queueAhead,2);assert.equal(mine.wait.queueLength,null);
  assert.equal(mine.wait.state,'ESTIMATED_WAIT');
  assert.equal(mine.wait.etaMinutes,20);
  assert.equal(mine.wait.reliable,true);assert.ok(!/customer|email|phone|customerId/i.test(JSON.stringify(mine.wait)));
 assert.equal(await prisma.notification.count({where:{userId:{in:users},eventKey:{startsWith:'queue:'+ticket.id+':created:'}}}),2);
 const duplicate=await api(2,base(2)+'/queue/tickets','POST',{});assert.equal(duplicate.created,false);assert.equal(duplicate.queueEntry.id,ticket.id);assert.equal(await prisma.queueEntry.count({where:{customerId:users[2],status:{in:['WAITING','CALLED']}}}),1);
 assert.equal((await api(3,'/api/v1/queue/tickets/mine?customerId='+users[2])).ticket,null);
 await api(3,base()+`/queue/${ticket.id}/cancel`,'POST',{},403);await api(2,base(1)+`/queue/${ticket.id}/cancel`,'POST',{},404);await api(1,base()+'/queue','GET',undefined,403);
 stage='reload and logout/login';await p.reload();await p.locator('#customerTicketBar [data-open-salo-ticket]').click();await p.locator('[data-salo-ticket-status-value="WAITING"]').waitFor();
 await p.locator('#saloTicketModal > .modal-box > [data-close]').click();await p.locator('#customerLogoutHeader').evaluate((b:any)=>b.click());await login(p,2);await p.locator('#customerTicketBar [data-open-salo-ticket]').click();await p.locator('[data-salo-ticket-status-value="WAITING"]').waitFor();
 stage='responsive languages';
 for(const width of [1920,1366,768,390,320]){await p.setViewportSize({width,height:1000});for(const lang of ['de','en','ar']){
  await p.locator('#languageSelect').evaluate((select:any,l:string)=>{select.value=l;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  await p.locator('[data-salo-ticket-status-value="WAITING"]').waitFor();assert.equal(await p.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok((await p.locator('#saloTicketContent').textContent()).includes({de:'Warteschlange',en:'queue',ar:'\u0627\u0644\u0637\u0627\u0628\u0648\u0631'}[lang]));
  assert.ok((await p.locator('[data-salo-ticket-wait-text]').textContent()).includes('20'));
  await p.screenshot({path:fileURLToPath(new URL(`../../.tmp-eta-${width}-${lang}.png`,import.meta.url))});
 }console.log('PASS Ticket viewport/languages '+width);}
 stage='active elsewhere and disabled salon';await p.locator('#saloTicketModal > .modal-box > [data-close]').click();await profile(2);await p.locator('[data-salo-ticket-mode="open"]').click();await p.locator('[data-salo-ticket-status-value="WAITING"]').waitFor();assert.ok((await p.locator('#saloTicketContent').textContent()).includes(prefix+' Eligible'));
 stage='owner queue start';const oc=await context(),op=await oc.newPage();await op.goto('http://localhost:8000/');await login(op,0);await op.locator('#ownerModal.show').waitFor();await op.locator('[data-owner-panel-tab="queue"]').click();await op.locator(`[data-queue-id="${ticket.id}"]`).waitFor();await op.locator(`[data-queue-staff-for="${ticket.id}"]`).selectOption(member);await op.locator(`[data-queue-start="${ticket.id}"]`).click();await op.locator(`[data-queue-id="${ticket.id}"]`).waitFor({state:'hidden'});
 ticket=await prisma.queueEntry.findUniqueOrThrow({where:{id:ticket.id}});assert.equal(ticket.status,'STARTED');assert.ok(ticket.serviceVisitId);const visit=await prisma.serviceVisit.findUniqueOrThrow({where:{id:ticket.serviceVisitId!}});assert.equal(visit.status,'IN_SERVICE');assert.equal(visit.staffMembershipId,member);
 assert.equal((await api(0,base()+'/staff/status')).staff.find((s:any)=>s.staffMembershipId===member).occupancy,'BUSY');
 assert.equal((await api(null,base()+'/live-status')).wait.etaMinutes,40);
 await op.locator('[data-owner-panel-tab="live"]').click();await op.waitForFunction(()=>document.querySelector('[data-owner-live-wait-value]')?.textContent?.includes('40'),null,{timeout:25000});
 await p.waitForSelector('[data-salo-ticket-status-value="STARTED"]',{timeout:16000});
 assert.equal(await prisma.notification.count({where:{userId:users[2],type:'queue-started',eventKey:{startsWith:'queue:'+ticket.id+':'}}}),1);
 await api(0,base()+`/service-visits/${visit.id}/complete`,'PATCH',{});await p.waitForSelector('[data-salo-ticket-status-value="COMPLETED"]',{timeout:16000});assert.equal((await api(2,'/api/v1/queue/tickets/mine')).ticket.serviceVisit.status,'COMPLETED');
 assert.equal((await api(null,base()+'/live-status')).wait.etaMinutes,20);
 const sc=await context(),sp=await sc.newPage();await sp.goto('http://localhost:8000/');await login(sp,5);const dutySaved=sp.waitForResponse((r:any)=>r.url().endsWith('/duty')&&r.request().method()==='PATCH'&&r.status()===200);await sp.locator('#staffDutyToggle').click();assert.equal((await dutySaved).status(),200);assert.equal((await prisma.staffPresence.findUniqueOrThrow({where:{staffMembershipId:member2}})).dutyState,'OFF_DUTY');
 await p.waitForTimeout(300);assert.equal((await api(null,base()+'/live-status')).wait.etaMinutes,40);
 console.log('PASS Customer -> PostgreSQL -> Owner queue/start -> ServiceVisit -> SMART Busy -> Customer completion; notification dedup and isolation');
 stage='cancel and disabled UI';await p.locator('#saloTicketModal > .modal-box > [data-close]').click();await profile(1);assert.equal(await p.locator('[data-salo-ticket-action]').isEnabled(),false);await p.locator('[data-close="salonProfileModal"]').click();await profile();await p.locator('[data-salo-ticket-mode="draw"]').click();await p.locator('[data-salo-ticket-cancel]').click();await p.locator('[data-salo-ticket-status-value="CANCELLED"]').waitFor();await p.reload();await p.locator('#customerTicketBar [data-open-salo-ticket]').click();await p.locator('[data-salo-ticket-status-value="CANCELLED"]').waitFor();
 assert.equal(await prisma.queueEntry.count({where:{customerId:users[2],status:'CANCELLED'}}),1);assert.equal((await api(2,'/api/v1/queue/tickets/mine')).active,false);assert.equal((await api(null,base()+'/live-status')).wait.etaMinutes,40);assert.deepEqual(errors,[]);
 await p.locator('#saloTicketModal > .modal-box > [data-close]').click();await profile();await p.waitForFunction(()=>document.querySelector('[data-live-status-label]')?.textContent?.includes('40'),null,{timeout:25000});
 await p.locator('[data-close="salonProfileModal"]').click();await p.waitForFunction(id=>document.querySelector('[data-smart-salon="'+id+'"]')?.textContent?.includes('40'),salons[0],{timeout:25000});
 console.log('SMART_ETA_MULTI_STAFF_POSTGRES_BROWSER_E2E = PASS');
}catch(error){console.error('FAILED_STAGE='+stage);throw error;}
finally{await browser?.close();await prisma.notification.deleteMany({where:{userId:{in:users}}});await prisma.queueEntry.deleteMany({where:{salonId:{in:salons}}});await prisma.serviceVisit.deleteMany({where:{salonId:{in:salons}}});await prisma.salon.deleteMany({where:{id:{in:salons}}});await prisma.session.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});assert.equal(await prisma.user.count({where:{id:{in:users}}}),0);console.log('ISOLATED_FIXTURE_CLEANUP = PASS');await prisma.$disconnect();}
