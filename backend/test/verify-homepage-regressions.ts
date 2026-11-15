// Real local PostgreSQL fixtures + actual served homepage. No API mocks except explicit failure test.
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
const users=Array.from({length:5},()=>randomUUID()),ids=Array.from({length:5},()=>randomUUID()),member=randomUUID();
const roles=['OWNER','OWNER','CUSTOMER','STAFF','ADMIN'],prefix='Discovery '+randomUUID().slice(0,8),password=randomUUID()+'aA1!';
const email=(i:number)=>roles[i].toLowerCase()+'-'+users[i]+'@example.invalid';const tokens:string[]=[];
let browser:any,stage='setup';
async function api(actor:number|null,path:string,method='GET',body?:any){const r=await fetch('http://localhost:4000'+path,{method,headers:{'Content-Type':'application/json',...(actor===null?{}:{Authorization:'Bearer '+tokens[actor]})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});assert.ok(r.ok,`${path}: ${r.status}`);return r.json() as any;}
try{
 const hash=await hashPassword(password);
 for(let i=0;i<users.length;i++)await prisma.user.create({data:{id:users[i],email:email(i),fullName:'Private account '+roles[i],role:roles[i] as any,passwordHash:hash,emailVerified:true}});
 for(let i=0;i<ids.length;i++){
  await prisma.salon.create({data:{id:ids[i],ownerId:users[i===2?1:0],name:prefix+' '+['Alpha','Beta','Gamma','Women','Hidden'][i],slug:'discovery-'+ids[i],city:['Berlin',' berlin  ','Hamburg','OnlyWomenCity','HiddenCity'][i],address:'Public fixture address',phone:'000',email:'public-business@example.invalid',isWomenOnly:i===3,isActive:i!==4,openingTime:'00:00',closingTime:'23:59',workingDays:['mon','tue','wed','thu','fri','sat','sun'],timeZone:'Europe/Berlin',bookingIntakeEnabled:i!==1}});
  await prisma.service.create({data:{salonId:ids[i],name:i===1?'Shave':'Haircut',durationMin:30,price:i===1?15:25,isActive:true}});
 }
 const barber=await prisma.barber.create({data:{salonId:ids[0],name:'Public Barber'}});
 await prisma.staffMembership.create({data:{id:member,salonId:ids[0],userId:users[3],barberId:barber.id}});
 for(let i=0;i<users.length;i++)tokens[i]=(await api(null,'/api/v1/auth/login','POST',{email:email(i),password})).accessToken;
 await api(0,`/api/v1/salons/${ids[0]}/staff/${member}/duty`,'PATCH',{dutyState:'ON_DUTY'});
 await api(0,`/api/v1/salons/${ids[0]}/staff/${member}/presence/confirm`,'POST',{});
 stage='public privacy';
 for(const actor of [null,0,1,2,3,4])for(const path of ['/api/v1/salons','/api/v1/salons/'+ids[0]]){
  const response=await api(actor,path),text=JSON.stringify(response);
  for(let i=0;i<users.length;i++){assert.ok(!text.includes(email(i)));assert.ok(!text.includes(users[i]));}
  assert.ok(text.includes('public-business@example.invalid'));
 }
 console.log('PASS public API boundary: all roles, business contact preserved');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 const ctx=await browser.newContext({viewport:{width:1366,height:900}});
 await ctx.addInitScript(()=>{localStorage.setItem('meshwarSelectedExperience','men');localStorage.setItem('meshwarLang','de');localStorage.setItem('salonkCookieConsent','rejected');sessionStorage.setItem('meshwarEntryChoiceSeen','true');});
 await ctx.route('**/*',(r:any)=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const p=await ctx.newPage();p.setDefaultTimeout(12000);p.setDefaultNavigationTimeout(15000);
 const errors:string[]=[],responses:any[]=[];p.on('pageerror',(e:any)=>errors.push(e.message));p.on('response',(r:any)=>{if(r.url().includes('/api/'))responses.push({url:r.url(),status:r.status()});});
 await p.goto('http://localhost:8000/');
 assert.deepEqual(await p.locator('#heroSearchInput').evaluate((input:any)=>({form:input.form?.id,role:input.form?.getAttribute('role'),passwords:input.form?.querySelectorAll('input[type="password"]').length})),{form:'salonDiscoveryForm',role:'search',passwords:0});
 const results=async()=>p.locator('#regularSalonGrid [data-open-profile-salon]').evaluateAll((els:any[])=>els.map(e=>e.dataset.openProfileSalon));
 const expectIds=async(wanted:string[])=>{await p.waitForFunction(({all,wanted}:any)=>{const present=[...document.querySelectorAll('#regularSalonGrid [data-open-profile-salon]')].map((e:any)=>e.dataset.openProfileSalon).filter((id:string)=>all.includes(id)).sort();return JSON.stringify(present)===JSON.stringify([...wanted].sort());},{all:ids,wanted});};
 await expectIds(ids.slice(0,3));
 const scanDiscovery = async(label:string)=>{
  for(const lang of ['de','en','ar']){
   await p.locator('#languageSelect').selectOption(lang);
   for(const query of [prefix.slice(0,12),'Ber','']){
    await p.locator('#heroSearchInput').fill(query);
    const scan=await p.evaluate(()=>{
     const roots=[...document.querySelectorAll('#heroSearchInput,#headerSearchInput,#heroCitySelect,#headerCitySelect,#cityFilterSelect,#salonDirectory,datalist,[role="listbox"]')];
     return roots.map((root:any)=>({id:root.id,text:root.textContent||'',values:[root,...root.querySelectorAll('input,option')].map((node:any)=>node.value||'')}));
    });
    assert.ok(!JSON.stringify(scan).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i),label+' discovery DOM contains email');
   }
   await p.locator('#heroCitySelect').selectOption('berlin');await expectIds(ids.slice(0,2));
   await p.locator('#heroCitySelect').selectOption('all');await expectIds(ids.slice(0,3));
   // The current header hides this legacy entry; inspect its dormant dialog too.
   await p.evaluate(()=>{(window as any).openCityPickerModal();});
   await p.locator('#salonPickerModal.show').waitFor();
   assert.ok(!(await p.locator('#salonPickerList').textContent()).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i),label+' city picker contains email');
   await p.locator('#salonPickerList [data-city-pick="Berlin" i]').click();await expectIds(ids.slice(0,2));
   await p.locator('#heroCitySelect').selectOption('all');await expectIds(ids.slice(0,3));
  }
  console.log('PASS public discovery DOM and DE/EN/AR: '+label);
 };
 await scanDiscovery('unauthenticated visitor');
 // Reproduce the stale hidden/autofill input path without using any real account credentials.
 await p.evaluate((privateEmail:string)=>{(document.querySelector('#headerSearchInput') as HTMLInputElement).value=privateEmail;localStorage.setItem('meshwarQuickSearch',privateEmail);},email(4));
 stage='responsive composed filters';
 for(const width of [1920,1366,768,390,320]){
  await p.setViewportSize({width,height:1000});
  for(const lang of ['de','en','ar']){
   await p.locator('#languageSelect').evaluate((select:any,l:string)=>{select.value=l;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
   await p.locator('#heroSearchInput').fill(prefix+' Alpha');await p.locator('#heroSearchInput').press('Enter');await expectIds([ids[0]]);
   await p.locator('#heroSearchInput').fill('');await expectIds(ids.slice(0,3));
   await p.locator('#heroCitySelect').selectOption('berlin');await expectIds(ids.slice(0,2));
   await p.locator('#heroCitySelect').selectOption('hamburg');await expectIds([ids[2]]);
   await p.locator('#heroCitySelect').selectOption('all');await expectIds(ids.slice(0,3));
   await p.locator('#heroSearchInput').fill(prefix);await p.locator('#heroCitySelect').selectOption('berlin');await expectIds(ids.slice(0,2));
   await p.locator('#heroSearchInput').fill(prefix+' Gamma');await expectIds([]);await p.locator('#heroSearchInput').fill(prefix);await expectIds(ids.slice(0,2));
   await p.locator('[data-hero-intent=appointment]').focus();await p.locator('[data-hero-intent=appointment]').press('Enter');await expectIds([ids[0]]);
   await p.locator('[data-hero-intent=now]').focus();await p.locator('[data-hero-intent=now]').press('Enter');await expectIds([ids[0]]);
   await p.locator('[data-hero-intent=discover]').focus();await p.locator('[data-hero-intent=discover]').press('Enter');await expectIds(ids.slice(0,2));
   await p.locator('#topBarberPriceFilter').selectOption('25');await expectIds(ids.slice(0,2));await p.locator('#topBarberPriceFilter').selectOption('all');
   await p.locator('#heroCitySelect').selectOption('all');await p.locator('#heroSearchInput').fill('');await expectIds(ids.slice(0,3));
   const options=await p.locator('#heroCitySelect option').evaluateAll((els:any[])=>els.map(e=>e.value));assert.equal(options.filter((v:string)=>v==='berlin').length,1);assert.ok(!options.includes('onlywomencity'));assert.ok(!options.includes('hiddencity'));
   assert.equal(await p.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+width+' '+lang);
   await p.locator('#salonDirectory').scrollIntoViewIfNeeded();await p.screenshot({path:fileURLToPath(new URL(`../../.tmp-home-fixed-${width}-${lang}.png`,import.meta.url))});
  }
  console.log('PASS filters/languages/RTL width '+width);
 }
 stage='refresh and failure retention';
 const baseline=await results();await p.evaluate(async()=>{await (window as any).refreshCustomerDiscoveryStatus();(window as any).refreshVisibleSalonOperatingStatus();});await expectIds(ids.slice(0,3));
 await p.route('**/api/v1/salons', (r:any)=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"verification outage"}'}));
 await p.evaluate(async()=>{await (window as any).loadLiveSalons();});assert.deepEqual(await results(),baseline);await p.unroute('**/api/v1/salons');
 stage='customer session and favorites';await p.setViewportSize({width:1366,height:1000});
 const login=async(actor:number)=>{await p.evaluate(()=>{(window as any).openCustomerLogin();});await p.locator('#customerLoginEmail').fill(email(actor));await p.locator('#customerLoginPassword').fill(password);await Promise.all([p.waitForResponse((r:any)=>r.url().endsWith('/api/v1/auth/login')&&r.status()===200),p.locator('#customerLoginSubmit').click()]);};
 await login(2);await expectIds(ids.slice(0,3));
 await p.evaluate(()=>{(document.querySelector('#headerSearchInput') as HTMLInputElement).value='';});
 await scanDiscovery('Customer');
 stage='card interaction persistence';
 const cardState=()=>p.evaluate(()=>({
  source:(window as any).__meshwarSalonList.map((s:any)=>s.id).sort(),
  derived:(window as any).__meshwarSalonList.filter((s:any)=>!(window as any).isMeshwarSalon(s)&&!(window as any).isWomenOnlySalon(s)&&(window as any).matchesCustomerDiscovery(s)).map((s:any)=>s.id).sort(),
  cards:[...document.querySelectorAll('#regularSalonGrid [data-open-profile-salon]')].map((c:any)=>c.dataset.openProfileSalon).sort(),
  filters:[...document.querySelectorAll('#heroSearchInput,#heroCitySelect,#cityFilterSelect,#topBarberAvailableOnly,#topBarberDistanceFilter,#topBarberRatingFilter,#topBarberPriceFilter,#topBarberPremiumFilter')].map((e:any)=>[e.id,e.value,e.checked]),
  mode:document.querySelector('[data-hero-intent][aria-pressed="true"]')?.getAttribute('data-hero-intent'),
 }));
 for(const width of [1920,1366,768,390,320]){
  await p.setViewportSize({width,height:1000});
  await p.locator('#languageSelect').selectOption(width===390?'ar':width===768?'en':'de');
  const before=await cardState();
  const unchanged=async(action:string)=>assert.deepEqual(await cardState(),before,action+' changed public source, derived results, cards or filters');
  const card=p.locator(`#regularSalonGrid [data-open-profile-salon="${ids[0]}"]`);
  for(const method of ['POST','DELETE']){
   await Promise.all([p.waitForResponse((r:any)=>r.url().endsWith('/api/v1/favorites/'+ids[0])&&r.request().method()===method&&r.status()===200),card.locator('[data-favorite]').click()]);
   await unchanged('Favorite '+method);
  }
  await card.locator('[data-choose-salon]').click();await p.locator('#bookingModal.show').waitFor();await unchanged('Booking open');
  await p.locator('[data-close="bookingModal"]').click();await unchanged('Booking close');
  const profileReads=responses.filter(r=>r.url.endsWith('/api/v1/salons/'+ids[0])).length;
  await card.locator('[data-profile-salon]').click();await p.locator('#salonProfileContent [data-salo-ticket-action]').waitFor();await unchanged('Profile open');
  assert.equal(responses.filter(r=>r.url.endsWith('/api/v1/salons/'+ids[0])).length-profileReads,1,'One Profile click must open/fetch once');
  const ticket=p.locator('#salonProfileContent [data-salo-ticket-action]');
  for(const suffix of ['/queue/tickets','/cancel']){
   const [ticketResponse]=await Promise.all([p.waitForResponse((r:any)=>r.url().includes('/api/v1/salons/'+ids[0]+'/queue/')&&r.url().endsWith(suffix)&&r.request().method()==='POST'),(suffix==='/cancel'?p.locator('[data-salo-ticket-cancel]'):ticket).click()]);
   assert.ok(ticketResponse.status()<300,'Ticket '+suffix+' width '+width+': '+ticketResponse.status()+' '+await ticketResponse.text());
   await unchanged('Ticket '+suffix);
   if(suffix==='/queue/tickets'){
    await p.waitForFunction(()=>document.querySelector('[data-salo-ticket-action]')?.getAttribute('data-salo-ticket-state')==='active');
    await p.evaluate(()=>{(window as any).refreshVisibleSalonOperatingStatus();});
    assert.equal(await ticket.getAttribute('data-salo-ticket-state'),'active','Live refresh discarded active Ticket control');
    await unchanged('Operating-status refresh with active Ticket');
   }
  }
  await p.locator('#saloTicketModal > .modal-box > [data-close]').click();
  await p.evaluate(async()=>{await (window as any).refreshCustomerDiscoveryStatus();});await unchanged('SMART refresh with profile open');
  await card.locator('[data-profile-salon]').click();
  await p.locator('[data-close="salonProfileModal"]').click();await unchanged('Profile/Ticket close');
  // Exercise both links without leaving localhost or invoking an OS phone handler.
  for(const action of ['data-salon-route','data-salon-phone']){
   const link=card.locator('['+action+']');
   if(await link.count()) {await link.evaluate((el:any)=>el.addEventListener('click',(e:Event)=>e.preventDefault(),{once:true}));await link.click();await unchanged(action);}
  }
  console.log('PASS card source/derived/DOM/filter persistence: Favorite, Booking, Ticket, SMART, Profile, Route/Call width '+width);
 }
 await p.setViewportSize({width:1366,height:1000});
 const favorite=p.locator(`#regularSalonGrid [data-favorite="${ids[0]}"]`);
 for(const method of ['POST','DELETE']){await Promise.all([p.waitForResponse((r:any)=>r.url().endsWith('/api/v1/favorites/'+ids[0])&&r.request().method()===method),favorite.click()]);await expectIds(ids.slice(0,3));assert.equal(await prisma.customerFavorite.count({where:{userId:users[2],salonId:ids[0]}}),method==='POST'?1:0);}
 await p.evaluate(async()=>{await (window as any).refreshAccessToken();await (window as any).loadOwnerDashboard();});await expectIds(ids.slice(0,3));
 await p.locator('#headerNotificationsButton').click();await p.locator('.salo-notification-dialog [data-close]').click();await expectIds(ids.slice(0,3));
 await p.locator('#customerLogoutHeader').evaluate((b:any)=>b.click());await expectIds(ids.slice(0,3));
 stage='owner source isolation';await login(0);await p.locator('#ownerModal.show').waitFor();await p.evaluate(()=>{(window as any).closeModal('ownerModal');});await expectIds(ids.slice(0,3));
 await scanDiscovery('Owner');
 await p.evaluate(async()=>{await (window as any).loadOwnerDashboard();(window as any).renderSalonDirectory();});await expectIds(ids.slice(0,3));
 await p.locator('#ownerLogout').evaluate((b:any)=>b.click());await expectIds(ids.slice(0,3));
 for(let i=0;i<users.length;i++){await p.locator('#heroSearchInput').fill(email(i));await expectIds([]);await p.locator('#heroSearchInput').fill('');await expectIds(ids.slice(0,3));}
 assert.ok(!responses.some(r=>r.url.endsWith('/owner/dashboard')&&r.status===403));assert.ok(!responses.some(r=>r.status===429));assert.deepEqual(errors,[]);
 assert.ok(responses.filter(r=>new URL(r.url).pathname==='/api/v1/salons').length<12,'Public fetch storm');
 console.log('PASS real source retention, session refresh/login/logout, favorites, notifications, private search, no 403/429/errors');
 stage='Admin login then logout to public discovery';
 await p.goto('http://localhost:8000/admin/');
 await p.locator('#login-form input[name="email"]').fill(email(4));
 await p.locator('#login-form input[name="password"]').fill(password);
 await p.locator('#login-form button[type="submit"]').click();
 await p.locator('#workspace').waitFor({state:'visible'});
 await p.locator('#logout').click();await p.locator('#login').waitFor({state:'visible'});
 await p.goto('http://localhost:8000/');await expectIds(ids.slice(0,3));
 await scanDiscovery('Admin login/logout');
 console.log('HOMEPAGE_REAL_REGRESSION_E2E = PASS');
}catch(error){console.error('FAILED_STAGE='+stage);throw error;}
finally{await browser?.close();await prisma.salon.deleteMany({where:{id:{in:ids}}});await prisma.session.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});assert.equal(await prisma.salon.count({where:{id:{in:ids}}}),0);console.log('ISOLATED_FIXTURE_CLEANUP = PASS');await prisma.$disconnect();}
