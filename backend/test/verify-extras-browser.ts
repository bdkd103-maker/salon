import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
export async function verifyExtrasBrowser({email,password,salonId}:any){
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 try{
 const context=async()=>{const c=await browser.newContext({viewport:{width:1366,height:1000}});await c.addInitScript(()=>{localStorage.setItem('meshwarSelectedExperience','men');localStorage.setItem('meshwarLang','de');localStorage.setItem('salonkCookieConsent','rejected');sessionStorage.setItem('meshwarEntryChoiceSeen','true');});await c.route('**/*',(r:any)=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());return c;};
 const login=async(page:any,actor:number)=>{await page.goto('http://localhost:8000/');await page.evaluate(()=>{(window as any).openCustomerLogin();});await page.locator('#customerLoginEmail').fill(email(actor));await page.locator('#customerLoginPassword').fill(password);await page.locator('#customerLoginSubmit').click();await page.locator('#customerLoginModal').waitFor({state:'hidden'});};
  const labels:{[lang:string]:{owner:string[];customer:string;items:string[]}}={
   de:{owner:['Kaffee','Getränke','WLAN','Parkplatz','Barzahlung','Kartenzahlung','Apple Pay','Google Pay','Rollstuhlgerecht'],customer:'Ausstattung',items:['Kaffee','WLAN','Kartenzahlung']},
   en:{owner:['Coffee','Drinks','Wi-Fi','Parking','Cash payment','Card payment','Apple Pay','Google Pay','Wheelchair access'],customer:'Amenities',items:['Coffee','Wi-Fi','Card payment']},
   ar:{owner:['قهوة','مشروبات','واي فاي','موقف سيارات','دفع نقداً','دفع بالبطاقة','أبل باي','جوجل باي','مخصص لمستخدمي الكرسي المتحرك'],customer:'المرافق',items:['قهوة','واي فاي','دفع بالبطاقة']},
  };
  const enabled=['coffee','wifi','cardPayment'];
  const oc=await context(),owner=await oc.newPage();owner.setDefaultTimeout(15000);await login(owner,0);await owner.locator('#ownerModal.show').waitFor();await owner.locator('[data-owner-panel-tab="settings"]').click();
  const extrasRoot=owner.locator('#ownerExtrasControls');await extrasRoot.waitFor({state:'visible'});
  await owner.waitForFunction(()=>document.querySelector('#ownerExtrasControls [data-extra-key="coffee"]')?.disabled===false);
  assert.equal(await owner.locator('#ownerExtrasControls [data-extra-key="coffee"]').getAttribute('aria-checked'),'false','fixture starts with no extras');
  const responses:{[key:string]:string[]}={coffee:['coffee'],wifi:['coffee','wifi'],cardPayment:['coffee','wifi','cardPayment']};
   for(const key of enabled){
   const trace:string[]=[];
  const onReq=(r:any)=>{if(r.url().includes('/extras'))trace.push('REQ '+r.method()+' body='+r.postData());};
  const onRes=(r:any)=>{if(r.url().includes('/extras'))trace.push('RES '+r.request().method()+' '+r.status());};
  owner.on('request',onReq);owner.on('response',onRes);
  // A background openOwnerPanel refresh re-fires an extras GET mid-toggle, so
  // latch only a real PATCH and trust its server-authoritative body.
  const saved=owner.waitForResponse((r:any)=>r.url().includes('/extras')&&r.request().method()==='PATCH');
  const btn=owner.locator(`#ownerExtrasControls [data-extra-key="${key}"]`);
  await btn.waitFor({state:'visible'});
  const before=await owner.evaluate(k=>{const b=document.querySelector(`#ownerExtrasControls [data-extra-key="${k}"]`)as any;return{disabled:b?.disabled,ariaBusy:b?.closest('#ownerExtrasControls')?.getAttribute('aria-busy'),checked:b?.getAttribute('aria-checked')};},key);
  try{await btn.click({timeout:5000});}catch(e:any){console.log('CLICK-FAIL '+key+' before='+JSON.stringify(before)+' trace='+trace.join(' | ')+' err='+e.message.split('\n')[0]);throw e;}
  const response=await saved;assert.equal(response.status(),200);
  console.log('TOGGLE '+key+' before='+JSON.stringify(before)+' :: '+trace.join(' | '));
  owner.off('request',onReq);owner.off('response',onRes);
   const extras=(await response.json()).extras;
   assert.deepEqual(extras,responses[key],'PATCH body for '+key+' is '+JSON.stringify(extras));
   await owner.waitForFunction(k=>document.querySelector(`#ownerExtrasControls [data-extra-key="${k}"]`)?.getAttribute('aria-checked')==='true',key);
   await owner.waitForTimeout(200);
 }
 for(const key of enabled)assert.equal(await owner.locator(`#ownerExtrasControls [data-extra-key="${key}"]`).getAttribute('aria-checked'),'true','widget keeps '+key+' after settle');
 const cc=await context(),customer=await cc.newPage();customer.setDefaultTimeout(15000);await login(customer,2);
 await customer.locator(`#regularSalonGrid [data-profile-salon="${salonId}"]`).first().click();
 await customer.locator('#salonProfileModal.show').waitFor();
 await customer.locator('.salon-profile-extras li').first().waitFor();
 assert.deepEqual(await customer.locator('.salon-profile-extras li').allTextContents(),labels.de.items);
 const detail=await customer.locator('#salonProfileContent').textContent();assert.ok(detail.includes('Ausstattung'));
 for(const width of [1920,1366,768,390,320]){for(const lang of ['de','en','ar']){
  await customer.setViewportSize({width,height:1000});
  await customer.locator('#languageSelect').evaluate((el:any,l:string)=>{el.value=l;el.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  await customer.waitForTimeout(150);
  assert.equal(await customer.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr','customer dir '+width+' '+lang);
  assert.ok(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'customer overflow '+width+' '+lang);
  await customer.evaluate(id=>{closeModal('salonProfileModal');openSalonProfile(normalizeSalon({id,name:'Fixture',services:[],media:[],reviews:[]}));},salonId);
  await customer.locator('#salonProfileModal.show').waitFor();
  await customer.locator('.salon-profile-extras li').first().waitFor();
  assert.equal((await customer.locator('.salon-profile-extras-section h3').textContent()).trim(),labels[lang].customer,'customer heading '+lang);
  assert.deepEqual(await customer.locator('.salon-profile-extras li').allTextContents(),labels[lang].items,'customer labels '+lang+' '+width);
  assert.ok(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'customer modal overflow '+width+' '+lang);
  await customer.locator('.salon-profile-extras-section').scrollIntoViewIfNeeded();
  await customer.screenshot({path:fileURLToPath(new URL(`../../.tmp-extras-customer-${width}-${lang}.png`,import.meta.url))});
  await owner.setViewportSize({width,height:1000});
  await owner.locator('#languageSelect').evaluate((el:any,l:string)=>{el.value=l;el.dispatchEvent(new Event('change',{bubbles:true}));},lang);
  await owner.waitForTimeout(150);
  assert.equal(await owner.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr','owner dir '+width+' '+lang);
  assert.ok(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'owner overflow '+width+' '+lang);
  const host=owner.locator('#ownerExtrasControls .form-grid');
  assert.ok(await host.isVisible(),'owner extras visible '+width+' '+lang);
  assert.deepEqual(await host.locator('[data-extra-key]').evaluateAll((els:any[])=>els.map(el=>el.textContent.split(':')[0].trim())),labels[lang].owner,'owner labels '+lang);
  await host.scrollIntoViewIfNeeded();
  await owner.screenshot({path:fileURLToPath(new URL(`../../.tmp-extras-owner-${width}-${lang}.png`,import.meta.url))});
 }console.log('PASS Extras browser languages/width '+width);}
 console.log('EXTRAS_REAL_BROWSER_E2E=PASS; Owner UI configuration, public profile amenities, owner/customer i18n sweep');
 }finally{await browser.close();}
}
