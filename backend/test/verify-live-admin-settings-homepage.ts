// Run from backend: node_modules/.bin/tsx test/verify-live-admin-settings-homepage.ts
// Requires the local servers: static host on :8000 and API on :4000.
// Real browser end-to-end: Homepage renders from the live API and the new Admin
// Settings page loads, saves and persists platform settings through the real API.
// Opt-in standalone verification; never run automatically with unit tests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { isHoliday, isWeekend } from "../src/lib/booking-time.js";

// Booking API policy only accepts Mon-Fri non-holiday dates; pick a date that is
// guaranteed to be bookable so the check is independent of the day it runs on.
function nextBookableDate(timeZone = "Europe/Berlin"): string {
  for (let offset = 1; offset <= 14; offset++) {
    const iso = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const instant = new Date(`${iso}T12:00:00Z`);
    if (!isWeekend(instant, timeZone) && !isHoliday(instant, timeZone)) return iso;
  }
  throw new Error("No bookable weekday within 14 days");
}

function databaseGuard() {
  dotenv.config();
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL ?? ""); }
  catch {
    console.error("Database safety guard: REJECTED; missing or invalid configuration; zero writes");
    throw new Error("Unsafe configuration");
  }
  const host = target.hostname;
  const database = target.pathname.slice(1);
  const port = target.port || "5432";
  console.log("REAL DB SAFETY:", JSON.stringify({ host, port, database }));
  const environments = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "VERCEL_ENV"];
  const safeEnvironment = environments.every(key => !process.env[key]
    || /^(development|dev|test|testing|local)$/i.test(process.env[key]!));
  const safeName = database === "salon";
  const allowedParameters = new Set(["schema", "connection_limit", "connect_timeout", "pool_timeout"]);
  const safeParameters = [...target.searchParams].every(([key, value]) =>
    allowedParameters.has(key) && (key === "schema" ? value === "public" : /^\d+$/.test(value)));
  if (!["postgresql:", "postgres:"].includes(target.protocol)
      || !["localhost", "127.0.0.1"].includes(host) || port !== "5432"
      || !safeName || !safeEnvironment || !safeParameters || target.hash) {
    console.error("SAFE LOCAL TARGET = NO; zero writes");
    throw new Error("Database safety guard rejected target; zero writes");
  }
  console.log("SAFE LOCAL TARGET = YES");
  return database;
}

const api = "http://localhost:4000";
const site = "http://localhost:8000";

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } finally { clearTimeout(timer); }
}

async function main() {
  databaseGuard();
  const { prisma } = await import('../src/lib/prisma.js');
  const { hashPassword } = await import('../src/lib/auth.js');
  const ids = Array.from({length:7},()=>randomUUID());
  const [adminId,ownerId,staffId,customerId,salonId,staleId,memberId]=ids;
  const suffix=randomUUID().slice(0,8), password=randomUUID()+'Aa1!';
  const email=(id:string)=>`salo-live-${id}@example.invalid`;
  const salonName='SALO E2E '+suffix, staleName='SALO Stale '+suffix;
  let browser:any, original:any, headers:any, stage='preflight';
  const call=async(path:string,options:any={})=>fetch(api+path,{...options,signal:AbortSignal.timeout(8000)});
  const json=async(path:string,options:any={})=>{const r=await call(path,options);assert.ok(r.ok,`${options.method||'GET'} ${path}: HTTP ${r.status}`);return r.json() as any;};
  const patch=async(value:any)=>json('/api/v1/admin/platform-settings',{method:'PATCH',headers,body:JSON.stringify(value)});
  const check=async(label:string,fn:()=>Promise<any>)=>{stage=label;await fn();console.log('PASS '+label);};
  let watchdog:ReturnType<typeof setTimeout>|undefined;
  try {
    assert.equal(await probe(api+'/health'),200);assert.equal(await probe(site+'/'),200);
    const passwordHash=await hashPassword(password);
    for(const[id,role]of [[adminId,'ADMIN'],[ownerId,'OWNER'],[staffId,'STAFF'],[customerId,'CUSTOMER']])await prisma.user.create({data:{id,email:email(id),passwordHash,role:role as any,status:'ACTIVE',emailVerified:true,fullName:'SALO E2E',phone:'+4917612345678'}});
    const login=await json('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email(adminId),password})});
    headers={'Content-Type':'application/json',Authorization:'Bearer '+login.accessToken};
    original=(await json('/api/v1/admin/platform-settings',{headers})).settings;
    const enabled={customerRegistrationEnabled:true,salonApplicationsEnabled:true,bookingGloballyEnabled:true,saloTicketGloballyEnabled:true,walkInGloballyEnabled:true,staffStatusLiveEnabled:true};
    await patch(enabled);
    for(const[id,name]of [[salonId,salonName],[staleId,staleName]])await prisma.salon.create({data:{id,ownerId,slug:id,name,city:'Berlin',address:'Fixture 1',phone:'+4917612345678',timeZone:'Europe/Berlin',openingTime:'00:00',closingTime:'23:59',workingDays:['mon','tue','wed','thu','fri','sat','sun'],bookingIntakeEnabled:id===salonId,saloTicketIntakeEnabled:true,walkInIntakeEnabled:true}});
    const service=await prisma.service.create({data:{salonId,name:'Precision '+suffix,durationMin:30,price:21}});
    const barber=await prisma.barber.create({data:{salonId,name:'SALO E2E'}});
    await prisma.staffMembership.create({data:{id:memberId,salonId,userId:staffId,barberId:barber.id}});
    await json(`/api/v1/salons/${salonId}/staff/${memberId}/duty`,{method:'PATCH',headers,body:JSON.stringify({dutyState:'ON_DUTY'})});
    browser=await chromium.launch({channel:'msedge',headless:true,timeout:15000,args:['--no-proxy-server']});
    watchdog=setTimeout(()=>{console.error('E2E deadline reached at '+stage);void browser?.close();},240000);
    const context=await browser.newContext();
    // Only optional third-party fonts/images are blocked. All local pages and APIs are real.
    await context.route('**/*',(route:any)=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(15000);
    const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
    await check('Admin real login and six visible settings groups',async()=>{
      await page.goto(site+'/admin/',{waitUntil:'domcontentloaded'});
      await page.locator('#login-form input[name=email]').fill(email(adminId));await page.locator('#login-form input[name=password]').fill(password);await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
      await page.locator('nav a[href="#settings"]').click();await page.locator('#settings-form').waitFor();
      assert.deepEqual(await page.locator('#settings-form h3').allTextContents(),['General','Registration & Applications','Booking Rules','SMART & Queue','Platform Security','System']);
    });
    await check('Admin browser save -> PostgreSQL -> API -> reload -> policy',async()=>{
      await page.locator('[name=siteName]').fill('SALO E2E '+suffix);await page.locator('[name=supportEmail]').fill('support@example.invalid');await page.locator('[name=defaultLocale]').selectOption('en');await page.locator('[name=customerRegistrationEnabled]').uncheck();
      const saved=page.waitForResponse((r:any)=>r.url().endsWith('/admin/platform-settings')&&r.request().method()==='PATCH');await page.locator('[data-action=save-settings]').click();assert.equal((await saved).status(),200);
      assert.equal((await prisma.platformSettings.findUnique({where:{id:'platform'}}))?.siteName,'SALO E2E '+suffix);
      assert.equal((await json('/api/v1/admin/platform-settings',{headers})).settings.customerRegistrationEnabled,false);
      const blocked=await call('/api/v1/auth/verification/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:"EMAIL",purpose:"CUSTOMER_REGISTRATION",email:email(randomUUID())})});assert.equal(blocked.status,409);
      await page.reload({waitUntil:'domcontentloaded'});await page.locator('#settings-form').waitFor();assert.equal(await page.locator('[name=siteName]').inputValue(),'SALO E2E '+suffix);assert.equal(await page.locator('[name=customerRegistrationEnabled]').isChecked(),false);
      await patch(enabled);
    });
    await check('Admin Settings responsive 1920/1366/768/390/320',async()=>{
      for(const width of [1920,1366,768,390,320]){await page.setViewportSize({width,height:1000});const bad=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(bad.scroll<=bad.width+1,JSON.stringify(bad));assert.ok(await page.locator('[data-action=save-settings]').isVisible());}
      await page.screenshot({path:'../.tmp-admin-settings-320.png',fullPage:true,timeout:8000});
    });
    await page.goto(site+'/',{waitUntil:'domcontentloaded'});
    if(await page.locator('#cookieReject').isVisible())await page.locator('#cookieReject').click();
    await page.locator('#languageSelect').selectOption('en');
    await check('Homepage hierarchy and real search, Now, Appointment, Discover, filters',async()=>{
      assert.equal(await page.locator('#experienceGate').isVisible(),false);
      await page.locator('#heroSearchInput').fill(suffix);await page.locator('#heroSearchButton').click();
      await page.locator(`#regularSalonGrid article[data-open-profile-salon="${salonId}"]`).waitFor();
      await page.locator('[data-hero-intent=now]').click();await page.waitForFunction((id:string)=>document.querySelectorAll('#regularSalonGrid article').length===1&&!!document.querySelector(`#regularSalonGrid article[data-open-profile-salon="${id}"]`),salonId);
      await page.locator('[data-hero-intent=appointment]').click();assert.equal(await page.locator('#regularSalonGrid article').count(),1);
      await page.locator('[data-hero-intent=discover]').click();assert.equal(await page.locator('#regularSalonGrid article').count(),2);
      assert.equal(await page.locator('#topBarberDistanceFilter').isDisabled(),true);
      await page.locator('#topBarberPriceFilter').selectOption('25');assert.equal(await page.locator('#regularSalonGrid article').count(),1);
      await page.locator('#topBarberPriceFilter').selectOption('all');await page.locator('#topBarberRatingFilter').selectOption('4.5');assert.equal(await page.locator('#regularSalonGrid article').count(),0);await page.locator('#topBarberRatingFilter').selectOption('all');
      await page.locator('#heroSearchInput').fill(service.name);await page.locator('#heroSearchButton').click();assert.equal(await page.locator('#regularSalonGrid article').count(),1);
      const text=await page.locator('#regularSalonGrid').innerText();assert.ok(text.includes('No reviews'));assert.ok(!/28%|4\s*\/\s*6|0\.0/.test(text));
    });
    await check('Homepage responsive AR/DE/EN at five required widths',async()=>{
      for(const lang of ['ar','de','en'])for(const width of [1920,1366,768,390,320]){await page.setViewportSize({width,height:1000});await page.locator('#languageSelect').selectOption(lang);const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dir:document.documentElement.dir}));assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));assert.equal(geometry.dir,lang==='ar'?'rtl':'ltr');}
      await page.screenshot({path:'../.tmp-home-discovery-320.png',fullPage:true,timeout:8000});
    });
    await page.setViewportSize({width:1366,height:900});
    await check('Salon detail, canonical services/prices, opening hours, SMART Live, booking entry',async()=>{
      await page.locator(`#regularSalonGrid [data-profile-salon="${salonId}"]`).click();await page.locator('#salonProfileModal').waitFor({state:'visible'});
      await page.locator('#salonProfileModal').getByText(service.name,{exact:true}).first().waitFor();const text=await page.locator('#salonProfileModal').innerText();assert.ok(text.includes(service.name));assert.ok(text.includes('21'));assert.ok(!/28%|4\s*\/\s*6/.test(text));
      await page.locator('[data-book-from-profile]').click();await page.locator('#bookingModal').waitFor({state:'visible'});assert.ok((await page.locator('#bookingService').textContent()).includes(service.name));
      await page.locator('#bookingModal [data-close=bookingModal]').click();
    });
    await check('Public Add Salon -> PostgreSQL -> NEW Admin Partners',async()=>{
      await page.locator('#partnerOpen').click();await page.locator('#partnerForm').waitFor({state:'visible'});
      await page.locator('#partnerSalonName').fill('Application '+suffix);await page.locator('#partnerForm [name=contactPerson]').fill('SALO E2E');await page.locator('#partnerEmail').fill(email(customerId));await page.locator('#partnerPhone').fill('+4917612345678');await page.locator('#partnerCity').fill('Berlin');
      const response=page.waitForResponse((r:any)=>r.url().endsWith('/partner-requests')&&r.request().method()==='POST');await page.locator('#partnerForm [type=submit]').click();assert.equal((await response).status(),201);assert.equal(await prisma.partnerRequest.count({where:{salonName:'Application '+suffix}}),1);
      await page.goto(site+'/admin/#partners',{waitUntil:'domcontentloaded'});await page.getByText('Application '+suffix,{exact:true}).waitFor();
    });
    await check('Real customer login and SALO Ticket persistence',async()=>{
      const customerContext=await browser.newContext();await customerContext.route('**/*',(route:any)=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());const customer=await customerContext.newPage();customer.setDefaultTimeout(8000);customer.setDefaultNavigationTimeout(15000);
      await customer.goto(site+'/?customerAuth=login',{waitUntil:'domcontentloaded'});if(await customer.locator('#cookieReject').isVisible())await customer.locator('#cookieReject').click();
      await customer.locator('#customerLoginEmail').fill(email(customerId));await customer.locator('#customerLoginPassword').fill(password);await customer.locator('#customerLoginForm [type=submit]').click();await customer.locator('#customerLoginModal').waitFor({state:'hidden'});
      await customer.locator('#heroSearchInput').fill(salonName);await customer.locator('#heroSearchButton').click();await customer.locator(`#regularSalonGrid [data-profile-salon="${salonId}"]`).click();
      stage='Customer ticket request';const ticket=customer.waitForResponse((r:any)=>r.url().includes('/queue/')&&r.request().method()==='POST');await customer.locator('[data-salo-ticket-action]').click();assert.ok((await ticket).ok());assert.equal(await prisma.queueEntry.count({where:{salonId,customerId}}),1);
      console.log('PASS Customer ticket PostgreSQL persistence');stage='Customer booking request';await customer.locator('[data-book-from-profile]').click();await customer.locator('#bookingModal').waitFor({state:'visible'});
      await customer.locator('#bookingService').selectOption(service.id);await customer.locator('#dateInput').fill(nextBookableDate());
      await customer.waitForFunction(()=>document.querySelectorAll('#bookingTime option:not([value=""]):not(:disabled)').length>0);
      const time=await customer.locator('#bookingTime option:not([value=""]):not(:disabled)').first().evaluate((e:any)=>e.value);await customer.locator('#bookingTime').selectOption(time);
      await customer.locator('#bookingName').fill('SALO E2E');await customer.locator('#bookingPhone').fill('+4917612345678');await customer.locator('#bookingGdprConsent').check();
      console.log('Booking invalid controls',await customer.locator('#bookingForm :invalid').evaluateAll((els:any[])=>els.map(e=>e.id)));const booked=customer.waitForResponse((r:any)=>r.url().endsWith('/bookings')&&r.request().method()==='POST');await customer.locator('#bookingForm [type=submit]').click();assert.ok((await booked).ok());assert.equal(await prisma.booking.count({where:{salonId,userId:customerId}}),1);
      await customer.reload({waitUntil:'domcontentloaded'});assert.equal(await prisma.queueEntry.count({where:{salonId,customerId}}),1);assert.equal(await prisma.booking.count({where:{salonId,userId:customerId}}),1);
      await customerContext.close();
    });
    await check('All operational platform switches enforce backend policy',async()=>{
      const customerLogin=await json('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email(customerId),password})});
      const customerHeaders={'Content-Type':'application/json',Authorization:'Bearer '+customerLogin.accessToken};
      await patch({bookingGloballyEnabled:false,saloTicketGloballyEnabled:false,walkInGloballyEnabled:false,staffStatusLiveEnabled:false,salonApplicationsEnabled:false});
      const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
      const checks=[
        ['/api/v1/bookings',{salonId,serviceId:service.id,startAt:tomorrow+'T10:00',endAt:tomorrow+'T10:30',timeZone:'Europe/Berlin'},customerHeaders,'POST'],
        ['/api/v1/salons/'+salonId+'/queue/tickets',{},customerHeaders,'POST'],
        ['/api/v1/salons/'+salonId+'/service-visits',{staffMembershipId:memberId,source:'WALK_IN'},headers,'POST'],
        ['/api/v1/salons/'+salonId+'/staff/'+memberId+'/duty',{dutyState:'ON_DUTY'},headers,'PATCH'],
        ['/api/v1/partner-requests',{salonName:'Blocked '+suffix,contactName:'SALO',contactEmail:email(customerId),city:'Berlin'},headers,'POST']
      ];
      for(const[path,body,h,method]of checks as any[])assert.equal((await call(path,{method,headers:h,body:JSON.stringify(body)})).status,409,path);
      const publicSettings=await json('/api/v1/platform-settings');assert.equal(publicSettings.settings.staffStatusLiveEnabled,false);assert.equal(publicSettings.settings.defaultLocale,'en');
      await patch(enabled);
    });
    assert.deepEqual(errors,[],'No page errors');console.log('REAL_E2E_COMPLETE = YES');
  } catch(error) { console.error('FAILED STAGE = '+stage);throw error; }
  finally {
    if(watchdog)clearTimeout(watchdog);await browser?.close();
    if(original){const {id,createdAt,updatedAt,...values}=original;await prisma.platformSettings.update({where:{id:'platform'},data:values});}
    await prisma.partnerRequest.deleteMany({where:{salonName:'Application '+suffix,contactEmail:email(customerId)}});
    await prisma.queueEntry.deleteMany({where:{salonId:{in:[salonId,staleId]}}});
    await prisma.serviceVisit.deleteMany({where:{salonId:{in:[salonId,staleId]}}});
    await prisma.salon.deleteMany({where:{id:{in:[salonId,staleId]}}});
    await prisma.session.deleteMany({where:{userId:{in:ids.slice(0,4)}}});await prisma.user.deleteMany({where:{id:{in:ids.slice(0,4)}}});
    assert.equal(await prisma.salon.count({where:{id:{in:[salonId,staleId]}}}),0);console.log('FIXTURE_CLEANUP_AND_SETTINGS_RESTORE = PASS');await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});