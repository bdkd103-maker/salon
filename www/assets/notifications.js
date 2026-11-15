/* One private PostgreSQL-backed inbox. Uses the host page's existing auth client. */
(() => {
  const texts = {
    de: { loyalty:'Treuekarte', READY:'Prämie verfügbar', REDEEMED:'Prämie eingelöst', title:'Benachrichtigungen', close:'Schließen', all:'Alle als gelesen markieren', read:'Als gelesen markieren', empty:'Keine Benachrichtigungen.', loading:'Wird geladen…', error:'Benachrichtigungen konnten nicht geladen werden.', retry:'Erneut versuchen', open:'Öffnen', more:'Die neuesten 100 Benachrichtigungen werden angezeigt.', booking:'Buchung', queue:'SALO Ticket', incoming:'Neue Anfrage für Ihren Salon', CREATED:'Eingegangen', CONFIRMED:'Bestätigt', CANCELLED:'Storniert', COMPLETED:'Abgeschlossen', NO_SHOW:'Als nicht erschienen markiert', UPDATED:'Geändert', STARTED:'Service gestartet', availability:'Im Salon ist wieder Verfügbarkeit gemeldet.', generic:'Neue Mitteilung' },
    en: { loyalty:'Loyalty', READY:'Reward available', REDEEMED:'Reward redeemed', title:'Notifications', close:'Close', all:'Mark all as read', read:'Mark as read', empty:'No notifications.', loading:'Loading…', error:'Notifications could not be loaded.', retry:'Try again', open:'Open', more:'Showing the latest 100 notifications.', booking:'Booking', queue:'SALO Ticket', incoming:'New request for your salon', CREATED:'Received', CONFIRMED:'Confirmed', CANCELLED:'Cancelled', COMPLETED:'Completed', NO_SHOW:'Marked as no-show', UPDATED:'Changed', STARTED:'Service started', availability:'The salon has reported availability again.', generic:'New notification' },
    ar: { loyalty:'الولاء', READY:'المكافأة متاحة', REDEEMED:'تم استبدال المكافأة', title:'الإشعارات', close:'إغلاق', all:'تحديد الكل كمقروء', read:'تحديد كمقروء', empty:'لا توجد إشعارات.', loading:'جارٍ التحميل…', error:'تعذر تحميل الإشعارات.', retry:'إعادة المحاولة', open:'فتح', more:'تظهر أحدث 100 إشعار.', booking:'الحجز', queue:'SALO Ticket', incoming:'طلب جديد لصالونك', CREATED:'تم الاستلام', CONFIRMED:'مؤكد', CANCELLED:'ملغى', COMPLETED:'مكتمل', NO_SHOW:'تم تسجيل عدم الحضور', UPDATED:'تم التعديل', STARTED:'بدأت الخدمة', availability:'أعلن الصالون عن توفر جديد.', generic:'إشعار جديد' }
  };
  const lang = () => texts[document.documentElement.lang] ? document.documentElement.lang : 'de';
  const t = () => texts[lang()];
  const entries = [];
  let items = [], count = null, busy = false, failed = false, identity = null, timer;
  const auth = () => typeof readStoredAuthToken === 'function' ? readStoredAuthToken() : null;
  const allowed = () => ['CUSTOMER','OWNER'].includes(String(auth()?.role).toUpperCase());
  const dialog = document.createElement('dialog');
  dialog.className = 'salo-notification-dialog';
  dialog.innerHTML = '<header><h2 id="saloInboxTitle"></h2><button type="button" data-close></button></header><p><button type="button" data-all></button></p><p data-state role="status"></p><button type="button" data-retry hidden></button><div data-notification-list></div>';
  dialog.setAttribute('aria-labelledby','saloInboxTitle'); document.body.append(dialog);
  function entry(host, reuse) {
    if (!host) return;
    const button = reuse ? host : document.createElement('button');
    if (!reuse) { button.type='button'; host.prepend(button); }
    button.classList.add('salo-notification-entry'); button.dataset.notificationEntry='';
    button.addEventListener('click', () => { dialog.showModal(); refresh(); }); entries.push(button);
  }
  entry(document.querySelector('#headerNotificationsButton'),true);
  entry(document.querySelector('#ownerModal .owner-panel-scroll'));
  const summary=document.querySelector('#ownerSettingsNotificationsSummary'); if(summary){summary.removeAttribute('data-owner-i18n');summary.replaceChildren();} entry(summary);
  entry(document.querySelector('.page-header .header-tools'));
  function render() {
    const tr=t(); dialog.dir=lang()==='ar'?'rtl':'ltr';
    entries.forEach(b => { b.hidden=!allowed(); b.setAttribute('aria-label',tr.title+(count>0?' ('+count+')':'')); b.replaceChildren(); const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','18');icon.setAttribute('height','18');icon.setAttribute('aria-hidden','true');icon.innerHTML='<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';b.append(icon);if(b.id!=='headerNotificationsButton')b.append(document.createTextNode(tr.title)); if(count>0){const badge=document.createElement('span');badge.className='salo-notification-badge';badge.textContent=String(count);b.append(badge);} });
    dialog.querySelector('h2').textContent=tr.title;
    dialog.querySelector('[data-close]').textContent=tr.close;
    const all=dialog.querySelector('[data-all]');all.textContent=tr.all;all.disabled=busy||!count||failed;
    dialog.querySelector('[data-retry]').textContent=tr.retry;dialog.querySelector('[data-retry]').hidden=!failed;
    dialog.querySelector('[data-state]').textContent=failed?tr.error:busy?tr.loading:!items.length?tr.empty:items.length===100?tr.more:'';
    const list=dialog.querySelector('[data-notification-list]');list.replaceChildren();
    if(failed || busy)return;
    for(const item of items){
      const meta=item.metadata||{}, row=document.createElement('article');row.className='salo-notification-item';row.dataset.unread=String(!item.isRead);row.dataset.notificationId=item.id;
      const body=document.createElement('p');body.textContent=meta.entityType && tr[meta.entityType] ? tr[meta.entityType]+': '+(meta.state==='CREATED'&&meta.audience==='owner'?tr.incoming:tr[meta.state]||tr.UPDATED) : item.type==='salon-chair-available'?tr.availability:tr.generic;
      const time=document.createElement('time');time.dateTime=item.createdAt;time.textContent=new Intl.DateTimeFormat(lang(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.createdAt));row.append(body,time);
      const actions=document.createElement('footer');
      if(!item.isRead){const read=document.createElement('button');read.textContent=tr.read;read.onclick=()=>mark({notificationIds:[item.id]});actions.append(read);}
      // Only existing destinations; entity IDs are never used as arbitrary URLs.
      const ownerTab=meta.entityType==='queue'?'queue':'bookings';
      const ownerDestination=document.querySelector('#ownerModal [data-owner-panel-tab="'+ownerTab+'"]');
      if(meta.entityType==='booking'||(meta.entityType==='queue'&&meta.audience==='owner'&&ownerDestination)){
        const open=document.createElement('button');open.textContent=tr.open;open.onclick=async()=>{
          if(!item.isRead && !await mark({notificationIds:[item.id]}))return;
          dialog.close();
          if(String(auth()?.role).toUpperCase()==='OWNER')ownerDestination?.click();
          else location.href='customer-profile.html#recentBookingsCard';
        };
        if(meta.audience!=='owner'||ownerDestination)actions.append(open);
      }
      row.append(actions);list.append(row);
    }
  }
  async function refresh(){
    if(busy)return;
    const next=auth()?.accessToken;
    if(identity!==next){items=[];count=null;identity=next;}
    if(!allowed()){items=[];count=null;if(dialog.open)dialog.close();render();return;}
    busy=true;failed=false;render();
    try {const result=await apiRequest('/api/v1/notifications',{headers:getApiHeaders()});if(auth()?.accessToken!==next)return;if(!Array.isArray(result.notifications)||!Number.isSafeInteger(result.unreadCount)||result.unreadCount<0)throw new Error('Invalid notification response');items=result.notifications;count=result.unreadCount;}
    catch{items=[];count=null;failed=true;}
    finally{busy=false;render();}
  }
  async function mark(payload){
    if(busy)return false;busy=true;render();
    try{await apiRequest('/api/v1/notifications/read',{method:'POST',headers:getApiHeaders({'Content-Type':'application/json'}),body:JSON.stringify(payload)});busy=false;await refresh();return !failed;}
    catch{busy=false;failed=true;count=null;render();return false;}
  }
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-all]').onclick=()=>mark({readAll:true});
  dialog.querySelector('[data-retry]').onclick=refresh;
  const observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang','dir']});
  const owner=document.querySelector('#ownerModal');const ownerObserver=new MutationObserver(()=>{if(owner?.classList.contains('show'))refresh();});if(owner)ownerObserver.observe(owner,{attributes:true,attributeFilter:['class']});
  const onVisible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',onVisible);window.addEventListener('storage',refresh);
  timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);observer.disconnect();ownerObserver.disconnect();document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('storage',refresh);});
  window.addEventListener('pageshow',event=>{if(event.persisted){
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang','dir']});
    if(owner)ownerObserver.observe(owner,{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',onVisible);window.addEventListener('storage',refresh);
    clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refresh();},60000);refresh();
  }});
  window.SaloNotifications={refresh};refresh();
})();
