// Run: node tests/owner-content-i18n.spec.js [www]. Presentation fixtures only; all HTTP intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const target = process.argv[2] || '.';
  assert.ok(['.', 'www'].includes(target));
  const root = path.resolve(__dirname, '..', target);
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport:{width:target === "www" ? 390 : 1440,height:900}});
    const errors = [], mutations = [], snapshots = {};
    page.on('pageerror', error => errors.push(error.message));
    let populated = false;
    await page.addInitScript(() => {
      localStorage.setItem('meshwarSelectedExperience', 'men');
      localStorage.setItem('meshwarLang', 'de');
      localStorage.setItem('meshwarApiAuth', JSON.stringify({accessToken: 'presentation-fixture', userId: 'user-1', role: 'OWNER'}));
    });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      const json = body => route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname === '/index.html') return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8')});
      if(url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,url.pathname.slice(1)),'utf8')});
      if(url.pathname.startsWith('/api/')) {
        if(request.method() !== 'GET') mutations.push({path:url.pathname,method:request.method()});
        if(url.pathname.endsWith('/notifications')) return json({notifications:[],unreadCount:0});
        if(url.pathname.endsWith('/subscriptions/me')) return json({subscription:{plan:'SMART',status:'ACTIVE'}});
        if(url.pathname.endsWith('/messages')) return request.method() === 'GET' ? json({messages:[]}) : json({message:{id:'msg-1'}});
        if(url.pathname.endsWith('/staff/status')) return json({expiresAt:new Date(Date.now()+60000).toISOString(),staff:[{staffMembershipId:'staff-1',barberName:'SALO',occupancy:'AVAILABLE'},{staffMembershipId:'staff-2',barberName:'SALO',occupancy:'BUSY',activeVisitId:'visit-1'}]});
        if(url.pathname.endsWith('/intake-controls')) return json({intakeControls:{bookingIntakeEnabled:true,saloTicketIntakeEnabled:false,walkInIntakeEnabled:true}});
        if(url.pathname.includes('/loyalty/cards/')) return json({card:populated?{id:'card-1',requiredStamps:8,customers:[{customerId:'customer-1',currentStamps:3,totalVisits:3}]}:null});
        if(url.pathname.includes('/analytics/salons/')) return json({summary:{metrics:{profile_view:{current:4,previous:2,delta:100}},totals:{current:4,previous:2,delta:100}}});
        if(url.pathname.endsWith('/salons')) return json({salons:[]});
        return json({});
      }
      return route.fulfill({status:204,body:''});
    });
    await page.goto('http://owner.test/index.html');
    await page.addStyleTag({content:'#cookieBanner,#experienceGate{display:none!important}'});
    await page.evaluate(async () => {
      session={role:'owner',userId:'user-1'};
      localStorage.setItem('meshwarSession',JSON.stringify(session));
      await openOwnerPanel(normalizeSalon({id:'salon-1',ownerId:'user-1',name:'SALO',city:'Berlin',services:[],media:[],reviews:[]}));
      await Promise.all([SaloSmartCore.loadOwner('salon-1'),loadOwnerLoyaltyCard(),loadOwnerAnalyticsSummary()]);
    });
    const auth = await page.evaluate(() => localStorage.getItem('meshwarApiAuth'));
    for(const filled of [false,true]) {
      populated=filled;
      await page.evaluate(async filled => {
        if(filled) {
          data.boostStatus='ACTIVE'; data.boostStartsAt='2026-01-01'; data.boostEndsAt='2027-01-01';
          data.services=[{id:'service-1',name:'SALO',price:20}];
          data.offers=[{id:'offer-1',isActive:true,price:10,discount:5,availableSlots:2,startTime:'10:00',endTime:'12:00'}];
          data.bookings=[{date:new Date().toLocaleDateString('en-CA'),time:'10:00',status:'pending'}];
          messages=[{id:'message-1',target:'owner',salonId:'salon-1',message:'SALO'}];
          globalThis.ownerSubscription={plan:'PREMIUM',status:'ACTIVE',providerReference:'fixture',startDate:'2026-01-01',renewalDate:'2027-01-01'};
        }
        renderOwnerServiceList();
        await loadOwnerLoyaltyCard();
      },filled);
      await page.locator('[data-owner-service-name]').first().evaluate(input => { input.value='SALO draft'; input.dispatchEvent(new Event('input',{bubbles:true})); });
      const sectionList = ['dashboard','bookings','live','team','queue','services','offers','messages','analytics','loyalty','growth','settings'];
      for(const section of sectionList) {
        await page.evaluate(section => setOwnerPanelSection(section),section);
        for(const lang of ['de','ar','en','de']) {
          // Dispatch the actual selector event while the full-screen Owner panel is open.
          await page.locator('#languageSelect').evaluate((select,lang)=>{select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
          const result = await page.evaluate(({section,lang}) => {
            const problems=[];
            const check=(selector,key)=>{const e=document.querySelector(selector);if(!e||e.textContent.trim()!==ownerText(key))problems.push(selector+': '+e?.textContent+' != '+ownerText(key));};
            for(const tab of ['dashboard','bookings','live','services','offers','messages','analytics','loyalty','growth','settings'])check(`[data-owner-panel-tab="${tab}"] span`,tab==='growth'?'growthTab':tab==='analytics'?'analyticsTab':tab+'Tab');
            check('[data-owner-panel-tab="team"] span','teamTitle');
            check('[data-owner-panel-tab="queue"] span','queueTitle');
            check('[data-owner-panel-section="growth"] h3','growthTab');
            check('[data-owner-panel-section="growth"] .service-settings.owner-panel-card:nth-of-type(2) h3','boostTab');
            check('[data-owner-panel-section="messages"] h3','messagesTitle');
            check('[data-owner-settings-tab="salon"]','settingsSalonTab');
            check('[data-owner-settings-tab="hours"]','settingsHoursTab');
            check('[data-owner-settings-tab="booking"]','settingsBookingTab');
            check('[data-owner-settings-tab="smart"]','settingsSmartTab');
            check('[data-owner-settings-tab="notifications"]','settingsNotificationsTab');
            check('[data-owner-settings-tab="privacy"]','settingsPrivacyTab');
            check('[data-owner-settings-tab="plan"]','settingsPlanTab');
            check('[data-owner-settings-tab="account"]','settingsAccountTab');
            check('#ownerServiceSaveBtn','servicesSave');
            check('#ownerOfferEditorActive + span','offerPublishLabel');
            check('#ownerLoyaltyActive + span','loyaltyToggle');
            check('#smartStaffPanel h3','smart_panelTitle');
            check('#ownerIntakeControls h3','intake_title');
            check('#subscriptionModal .subscription-badge','subscriptionMembership');
            check('#subscriptionModal .subscription-hero-copy h3','subscriptionMonthlyTitle');
            check('#subscriptionModal [data-close].btn','closeAction');
            for(const [selector,keys] of [
              ['#ownerSubscriptionSummary',['subscriptionCurrentPlan','subscriptionStatusLabel','subscriptionBillingProvider','subscriptionPriceLabel','subscriptionStartDate','subscriptionRenewalDate','subscriptionNotes']],
              ['#ownerSubscriptionPlans',['subscriptionFeatureBasicProfile','subscriptionFeatureStandardVisibility','subscriptionFeatureManualUpdates','subscriptionFeatureLoyalty']],
              ['#ownerBoostOptions',['boostOption7','boostOption14','boostPositionLabel','boostExpectedVisibility','boostVisibilityHigh','boostVisibilityVeryHigh']],
              ['#ownerProfileMissingList',['completionFieldEmail']],
              ['#smartStaffPanel',['smart_confirmFree','smart_startService','smart_endService','smart_offDuty']],
            ])for(const key of keys)if(!document.querySelector(selector).textContent.includes(ownerText(key)))problems.push(selector+' missing '+key);
            if(document.documentElement.dir!==(lang==='ar'?'rtl':'ltr'))problems.push('direction');
            if(!document.querySelector(`[data-owner-panel-tab="${section}"]`).classList.contains('active'))problems.push('section changed');
            if(session.role!=='owner'||!document.querySelector('#ownerModal').classList.contains('show'))problems.push('session/panel');
            if(document.querySelector('[data-owner-service-name]').value!=='SALO draft')problems.push('draft lost: '+document.querySelector('[data-owner-service-name]').value);
            const text=document.querySelector('#ownerModal').innerText;
            if(lang!=='ar'&&/[؀-ۿ]/.test(text))problems.push('Arabic in '+lang);
            if(lang==='ar'){ const untranslated=text.replace(/SALO Ticket|SALO|SMART|BERLIN|Berlin|IANA|SAL0J2SH|\bS\b/g,'').match(/[A-Za-z][A-Za-z -]*/g); if(untranslated)problems.push('Latin UI text: '+untranslated.join(', ')); }
            if(lang==='de'&&/Not subscribed|Current plan|Billing provider|Expected visibility|Customer messages|Publish offer|Enable card/.test(text))problems.push('English in German');
            if(lang==='en'&&/Fehlt noch|Nicht abonniert|Aktueller Plan|Annahmekan|Besch.ftigt/.test(text))problems.push('German in English');
            return {problems,text};
          },{section,lang});
          snapshots[`${filled}-${section}-${lang}`]=result.text;
          assert.deepEqual(result.problems,[],`${target} ${filled} ${section} ${lang}`);
          assert.equal(await page.evaluate(()=>localStorage.getItem('meshwarApiAuth')),auth);
        }
      }
    }
    // Messages retain their existing inbox; the notification bell now has its own persisted feed.
    await page.locator('#messageInboxButton').evaluate(button=>button.click());
    for(const lang of ['de','ar','en','de']) {
      await page.locator('#languageSelect').evaluate((select,lang)=>{select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
      const inbox=await page.locator('#messageInboxList').textContent();
      const expected=await page.evaluate(()=>[translate('ownerTarget'),translate('channelInApp'),translate('deleteMessage')]);
      expected.forEach(label=>assert.ok(inbox.includes(label),`Inbox missing ${label}`));
      if(lang!=='ar')assert.ok(!/[\u0600-\u06ff]/.test(inbox),'Inbox has stale Arabic');
      assert.equal(await page.evaluate(()=>session.role),'owner');
    }
    await page.locator('#headerNotificationsButton').evaluate(button=>button.click());
    for(const lang of ['de','ar','en','de']) {
      await page.locator('#languageSelect').evaluate((select,lang)=>{select.value=lang;select.dispatchEvent(new Event('change',{bubbles:true}));},lang);
      const expected={de:'Benachrichtigungen',en:'Notifications',ar:'\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a'}[lang];
      await page.getByRole('heading',{name:expected,exact:true}).waitFor();
      assert.equal(await page.locator('.salo-notification-dialog').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
    }
    await page.locator('.salo-notification-dialog [data-close]').click();
    if(process.env.OWNER_I18N_SNAPSHOTS)fs.writeFileSync(path.resolve(__dirname,'../.tmp-owner-i18n.json'),JSON.stringify(snapshots,null,2));
    assert.deepEqual(errors,[],'No browser errors');
    assert.deepEqual(mutations,[],'Language switching must not mutate API state');
    await page.evaluate(()=>{ openModal('ownerModal'); setOwnerPanelSection('live'); });
    await page.locator('#smartStaffPanel [data-smart-copy=confirmFree]').click();
    await page.waitForFunction(()=>document.querySelector('#smartStaffPanel [data-smart-copy=confirmFree]')?.disabled === false);
    assert.deepEqual(mutations,[{path:'/api/v1/salons/salon-1/staff/staff-1/duty',method:'PATCH'}],'SMART control still sends its existing authenticated action');
    console.log(`PASS ${target}: empty/populated content in all Owner sections; DE -> AR -> EN -> DE; immediate dynamic text; RTL/LTR; session and service draft retained; no API mutations`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

