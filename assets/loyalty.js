/* Loyalty display only: balances and history are always read from the authenticated API. */
(() => {
 const copy={
 de:{title:'Treuekarte',rule:'Ein Stempel pro abgeschlossenem Kundenbesuch.',rewardActive:'Prämie aktiv',refresh:'Aktualisieren',empty:'Noch keine Treueaktivität. Stempel entstehen nach abgeschlossenen Besuchen.',error:'Treuedaten konnten nicht geladen werden. Bitte erneut versuchen.',redeem:'Prämie einlösen',ready:'Prämie verfügbar',disabled:'Treueprogramm oder Prämie derzeit deaktiviert',progress:'{count} / {total} Stempel',EARN:'Stempel verdient',REDEEM:'Prämie eingelöst',history:'Letzte Aktivitäten (bis zu 100)',success:'Prämie eingelöst. Der Salon kann die Einlösung prüfen.',failed:'Einlösung nicht möglich. Bitte den aktuellen Stand prüfen.',verify:'Einlösungsnachweis',view:'Meine Treuekarten',reward:'Prämie'},
 en:{title:'Loyalty card',rule:'One stamp per completed customer visit.',rewardActive:'Reward active',refresh:'Refresh',empty:'No loyalty activity yet. Stamps are earned after completed visits.',error:'Could not load loyalty data. Please try again.',redeem:'Redeem reward',ready:'Reward available',disabled:'Loyalty program or reward currently disabled',progress:'{count} / {total} stamps',EARN:'Stamp earned',REDEEM:'Reward redeemed',history:'Recent activity (up to 100)',success:'Reward redeemed. The salon can verify this redemption.',failed:'Could not redeem. Please check the current balance.',verify:'Redemption receipt',view:'My loyalty cards',reward:'Reward'},
 ar:{title:'بطاقة الولاء',rule:'ختم واحد لكل زيارة مكتملة للعميل.',rewardActive:'المكافأة مفعلة',refresh:'تحديث',empty:'لا يوجد نشاط ولاء بعد. تُضاف الأختام بعد اكتمال الزيارات.',error:'تعذر تحميل بيانات الولاء. يرجى المحاولة مرة أخرى.',redeem:'استبدال المكافأة',ready:'المكافأة متاحة',disabled:'برنامج الولاء أو المكافأة متوقف حاليًا',progress:'{count} / {total} أختام',EARN:'ختم مكتسب',REDEEM:'تم استبدال المكافأة',history:'آخر الأنشطة (حتى 100)',success:'تم استبدال المكافأة. يمكن للصالون التحقق منها.',failed:'تعذر الاستبدال. يرجى التحقق من الرصيد الحالي.',verify:'إثبات الاستبدال',view:'بطاقات الولاء الخاصة بي',reward:'المكافأة'}
 };
 const lang=()=>copy[document.documentElement.lang]?document.documentElement.lang:'de';
 const t=(key)=>copy[lang()][key]||key;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const request=(path,options={})=>apiRequest(path,{...options,headers:getApiHeaders()});
 const customerHost=document.getElementById('customerLoyalty');
 let accounts=[],ownerHistory=[],ownerCard=null,failed=false,busy=false,notice='',epoch=0;
 function history(rows){return `<h4>${esc(t('history'))}</h4><div class="loyalty-history">${rows.map(h=>`<article data-loyalty-kind="${esc(h.kind)}"><strong>${esc(t(h.kind))} · ${h.amount>0?'+':''}${esc(h.amount)}</strong>${h.customerName?`<span>${esc(h.customerName)}</span>`:''}<time>${esc(new Date(h.at).toLocaleString(lang()))}</time>${h.rewardTitle?`<span>${esc(h.rewardTitle)}</span><small>${esc(t('verify'))}: ${esc(h.id)}</small>`:''}</article>`).join('')}</div>`;}
 function render(){
  document.querySelectorAll('[data-loyalty-copy]').forEach(el=>el.textContent=t(el.dataset.loyaltyCopy));
  if(customerHost){customerHost.innerHTML=`<h2>${esc(t('title'))}</h2><p>${esc(t('rule'))}</p><button type="button" data-loyalty-refresh>${esc(t('refresh'))}</button><p role="status">${esc(notice?t(notice):failed?t('error'):accounts.length?'':t('empty'))}</p>`+(failed?'':accounts.map(a=>{
   const c=a.card,p=a.progress,eligible=c.isActive&&c.rewardActive&&p.isRewardReady;
   return `<article class="loyalty-account" data-loyalty-card="${esc(c.id)}"><h3>${esc(c.salonName)}</h3><p data-loyalty-balance="${p.stamps}">${esc(t('progress').replace('{count}',p.stamps).replace('{total}',p.requiredStamps))}</p><progress max="${p.requiredStamps}" value="${Math.min(p.stamps,p.requiredStamps)}"></progress><p>${esc(c.rewardTitle)}</p><p>${esc(c.rewardText)}</p><p>${esc(!c.isActive||!c.rewardActive?t('disabled'):eligible?t('ready'):'')}</p><button type="button" data-loyalty-redeem="${esc(c.id)}" ${!eligible||busy?'disabled':''}>${esc(t('redeem'))}</button>${history(a.history)}</article>`;
  }).join(''));
  customerHost.querySelector('[data-loyalty-refresh]').onclick=()=>loadCustomer();
  customerHost.querySelectorAll('[data-loyalty-redeem]').forEach(b=>b.onclick=async()=>{if(busy)return;busy=true;render();try{await request('/api/v1/loyalty/cards/'+encodeURIComponent(b.dataset.loyaltyRedeem)+'/redeem',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID()})});notice='success';}catch{notice='failed';}finally{busy=false;await loadCustomer();}});
  }
  const ownerHost=document.getElementById('ownerLoyaltyActivity');if(ownerHost)ownerHost.innerHTML=history(ownerHistory);
 }
 async function loadCustomer(){if(!customerHost)return;const token=typeof readStoredAuthToken==='function'?readStoredAuthToken():null;const version=++epoch;if(token?.role!=='CUSTOMER'){accounts=[];failed=false;notice='';render();return;}try{const result=await request('/api/v1/loyalty/me');if(version!==epoch)return;accounts=result.accounts||[];failed=false;}catch{if(version!==epoch)return;failed=true;}render();}
 async function loadOwner(cardId){ownerCard=cardId;ownerHistory=[];render();if(!cardId)return;try{const result=await request('/api/v1/loyalty/cards/'+encodeURIComponent(cardId)+'/activity');if(ownerCard!==cardId)return;ownerHistory=result.history||[];render();}catch{const el=document.getElementById('ownerLoyaltyActivity');if(el)el.textContent=t('error');}}
 window.SaloLoyalty={loadCustomer,loadOwner,render};
 new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 window.addEventListener('focus',loadCustomer);render();if(customerHost)loadCustomer();
})();
