(() => {
  const smartStrings = {
    de: {
      unknown: "Verfügbarkeit unbestätigt",
      closed: "Geschlossen",
      busy: "Beschäftigt",
      freeConfirmed: "Frei · bestätigt",
      loadError: "Status konnte nicht geladen werden",
      waitAvailableNow: "Sofort verfügbar",
      waitEta: "Ca. {minutes} Min. Wartezeit",
      waitUnknown: "Wartezeit unbekannt",
      waitWalkInDisabled: "Anmeldung derzeit deaktiviert",
    },
    en: {
      unknown: "Availability unconfirmed",
      closed: "Closed",
      busy: "Busy",
      freeConfirmed: "Free · confirmed",
      loadError: "Could not load status",
      waitAvailableNow: "Available now",
      waitEta: "About {minutes} min wait",
      waitUnknown: "Wait time unknown",
      waitWalkInDisabled: "Intake currently disabled",
    },
    ar: {
      unknown: "التوفر غير مؤكد",
      closed: "مغلق",
      busy: "مشغول",
      freeConfirmed: "متاح · مؤكد",
      loadError: "تعذر تحميل الحالة",
      waitAvailableNow: "متاح الآن",
      waitEta: "حوالي {minutes} دقيقة انتظار",
      waitUnknown: "وقت الانتظار غير معروف",
      waitWalkInDisabled: "التسجيل معطل حاليًا",
    },
  };

  function getSmartLang() {
    const lang = document.documentElement.lang || localStorage.getItem("meshwarLang") || "ar";
    const normalized = String(lang).trim().toLowerCase();
    return normalized === "ar" || normalized === "en" || normalized === "de" ? normalized : "ar";
  }

  function smartText(key) {
    if (typeof ownerText === "function") { const value = ownerText("smart_" + key); if (value !== "smart_" + key) return value; }
    const lang = getSmartLang();
    return smartStrings[lang]?.[key] || smartStrings.en[key] || smartStrings.de[key] || key;
  }

  function request(path, options = {}) {
    const base = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : WOMEN_API_BASE_URL;
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set('Content-Type', 'application/json');
    else headers.delete('Content-Type');
    return fetch(base + path, { ...options, cache: 'no-store', headers })
      .then(async response => {
        if (response.status === 401 && headers.has('Authorization') && typeof refreshAccessToken === 'function') {
          const newToken = await refreshAccessToken();
          if (newToken) {
            headers.set('Authorization', 'Bearer ' + newToken);
            response = await fetch(base + path, { ...options, cache: 'no-store', headers });
          }
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || smartText("loadError"));
        return body;
      });
  }

  function waitText(wait) {
    if (!wait || typeof wait !== 'object') return smartText("waitUnknown");
    if (wait.state === 'AVAILABLE_NOW') return smartText("waitAvailableNow");
    if (wait.state === 'ESTIMATED_WAIT') {
      const minutes = Number(wait.etaMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return smartText("waitUnknown");
      return smartText("waitEta").replace("{minutes}", String(minutes));
    }
    if (wait.state === 'WALK_IN_DISABLED') return smartText("waitWalkInDisabled");
    if (wait.state === 'CLOSED') return smartText("closed");
    return smartText("waitUnknown");
  }

  function label(snapshot) {
    if (typeof isCustomerSmartLiveEnabled === "function" && !isCustomerSmartLiveEnabled()) return smartText("unknown");
    if (!snapshot || !Number.isFinite(Date.parse(snapshot.expiresAt)) || Date.parse(snapshot.expiresAt) <= Date.now()) return smartText("unknown");
    if (snapshot.wait && typeof snapshot.wait === "object") return waitText(snapshot.wait);
    if (snapshot.salonStatus === 'CLOSED') return smartText("closed");
    if (snapshot.salonStatus === 'BUSY') return smartText("busy");
    if (snapshot.salonStatus === 'OPEN' && snapshot.staffSummary.available > 0) return smartText("freeConfirmed");
    return smartText("unknown");
  }

  function staffStatusText(occupancy) {
    if (occupancy === 'BUSY') return smartText("busy");
    if (occupancy === 'AVAILABLE') return smartText("freeConfirmed");
    return smartText("notConfirmed");
  }

  const publicBatch = new Map();
  let publicBatchScheduled = false;
  function batchedPublicStatus(id) {
    return new Promise(resolve => {
      publicBatch.set(id, resolve);
      if (publicBatchScheduled) return;
      publicBatchScheduled = true;
      Promise.resolve().then(async () => {
        const entries = [...publicBatch]; publicBatch.clear(); publicBatchScheduled = false;
        for (let offset = 0; offset < entries.length; offset += 24) {
          const chunk = entries.slice(offset, offset + 24);
          let results = [];
          try { results = (await request('/api/v1/salons/live-status?salonIds=' + chunk.map(([key]) => encodeURIComponent(key)).join(','))).salons || []; } catch (_) {}
          chunk.forEach(([key, done]) => done(results.find(row => row.salonId === key) || null));
        }
      });
    });
  }

  async function publicStatus(element, force) {
    const id = element.dataset.smartSalon;
    if (!pending.has(id)) {
      const hit = statusCache.get(id);
      if (!force && hit && Date.now() - hit.at < STATUS_TTL) { applyStatus(element, hit.value); return; }
      pending.set(id, (typeof fetchSalonLiveStatus === 'function'
        ? fetchSalonLiveStatus(id, force)
        : batchedPublicStatus(id))
        .then(value => { statusCache.set(id, { value, at: Date.now() }); return value; })
        .finally(() => pending.delete(id)));
    }
    try { const value = await pending.get(id); applyStatus(element, value); }
    catch { applyStatus(element, undefined); }
  }

  function applyStatus(element, value) {
    element.textContent = label(value);
    if (value?.expiresAt) element.dataset.smartExpires = value.expiresAt;
    else delete element.dataset.smartExpires;
  }

  const pending = new Map();
  // Re-renders must not re-bill the public rate limit: one live-status per salon
  // per refresh interval, plus forced refreshes on explicit user actions.
  const statusCache = new Map();
  const STATUS_TTL = 10000;


  function discover() {
    document.querySelectorAll('article[data-open-profile-salon], .nearby-item[data-open-profile-salon]').forEach(card => {
      if (card.querySelector('[data-smart-salon]')) return;
      const status = document.createElement('p'); status.dataset.smartSalon = card.dataset.openProfileSalon;
      status.className = 'admin-note'; status.textContent = smartText("unknown");
      (card.querySelector('.salon-card-summary, .card-body') || card).append(status);
      publicStatus(status);
    });
    document.querySelectorAll('[data-smart-salon]:not([data-smart-ready])').forEach(el => { el.dataset.smartReady = 'true'; publicStatus(el); });
  }

  let ownerId = null, epoch = 0;

  function setCopy(element, key) {
    element.dataset.smartCopy = key;
    element.textContent = smartText(key);
  }

  function renderLanguage() {
    document.querySelectorAll("[data-smart-salon]").forEach(el => { const hit = statusCache.get(el.dataset.smartSalon); applyStatus(el, hit?.value); });
    const panel = document.getElementById("smartStaffPanel");
    if (!panel) return;
    panel.setAttribute("aria-label", smartText("panelTitle"));
    panel.querySelectorAll("[data-smart-copy]").forEach(element => setCopy(element, element.dataset.smartCopy));
    panel.querySelectorAll("[data-smart-owner-state]").forEach(element => {
      const expired = element.dataset.smartOwnerState === "AVAILABLE" && (!element.dataset.smartExpires || Date.parse(element.dataset.smartExpires) <= Date.now());
      element.textContent = element.dataset.smartStaffName + ": " + (expired ? smartText("unknown") : staffStatusText(element.dataset.smartOwnerState));
    });
  }

  async function loadOwner(id) {
    const panel = document.getElementById('smartStaffPanel');
    if (!panel || !id) return;
    ownerId = id; const version = ++epoch;
    const headers = getApiHeaders();
    const base = '/api/v1/salons/' + encodeURIComponent(id);
    let message = panel.querySelector('[role="status"]');
    if (!message) {
      panel.replaceChildren();
      const title = document.createElement('h3'); setCopy(title, "panelTitle"); panel.setAttribute("aria-label", smartText("panelTitle")); panel.append(title);
      message = document.createElement('p'); message.setAttribute('role', 'status'); setCopy(message, "loading"); panel.append(message);
    }
    try {
      const response = await request(base + '/staff/status', { headers });
      if (version !== epoch) return;
      const fragment = document.createDocumentFragment();
      const title = document.createElement('h3'); setCopy(title, "panelTitle");
      fragment.append(title);
      const nextMessage = document.createElement('p'); nextMessage.setAttribute('role', 'status');
      setCopy(nextMessage, response.staff.length ? "confirmHint" : "noStaff");
      fragment.append(nextMessage);
      response.staff.forEach(staff => {
        const row = document.createElement('div'); row.className = 'barber-row'; row.style.display = 'flex'; row.style.flexWrap = 'wrap'; row.dataset.smartStaff = staff.staffMembershipId;
        const status = document.createElement('span'); status.dataset.smartOwnerState = staff.occupancy; status.dataset.smartStaffName = staff.barberName;
        status.textContent = staff.barberName + ': ' + staffStatusText(staff.occupancy);
        if (staff.occupancy === 'AVAILABLE') status.dataset.smartExpires = response.expiresAt;
        row.append(status);
        function button(key, method, path, body) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; setCopy(b, key);
          b.addEventListener('click', async () => {
            panel.querySelectorAll('button').forEach(el => el.disabled = true);
              try { await request(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }); await loadOwner(id); document.querySelectorAll('[data-smart-salon]').forEach(el => publicStatus(el, true)); }
            catch (error) { if (version !== epoch) return; const statusMessage = panel.querySelector('[role="status"]'); if (statusMessage) setCopy(statusMessage, "loadError"); panel.querySelectorAll('button').forEach(el => el.disabled = false); }
          }); row.append(b);
        }
        const memberPath = '/staff/' + encodeURIComponent(staff.staffMembershipId);
        if (staff.activeVisitId) button("endService", 'PATCH', '/service-visits/' + encodeURIComponent(staff.activeVisitId) + '/complete');
        else {
          button("confirmFree", 'PATCH', memberPath + '/duty', { dutyState: 'ON_DUTY' });
          if (staff.occupancy === 'AVAILABLE') button("startService", 'POST', '/service-visits', { staffMembershipId: staff.staffMembershipId, source: 'WALK_IN' });
        }
        button("offDuty", 'PATCH', memberPath + '/duty', { dutyState: 'OFF_DUTY' });
        fragment.append(row);
      });
      const refresh = document.createElement('button'); refresh.type = 'button'; setCopy(refresh, "refresh"); refresh.addEventListener('click', () => loadOwner(id)); fragment.append(refresh);
      panel.replaceChildren(fragment);
      if (typeof renderOwnerLiveStatusSummary === "function") renderOwnerLiveStatusSummary();
      panel.setAttribute("aria-label", smartText("panelTitle"));
    } catch (error) {
      if (version !== epoch) return;
      const statusMessage = panel.querySelector('[role="status"]');
      if (statusMessage) setCopy(statusMessage, "loadError");
      else {
        panel.replaceChildren();
        const title = document.createElement('h3'); setCopy(title, "panelTitle"); panel.setAttribute("aria-label", smartText("panelTitle")); panel.append(title);
        const failMessage = document.createElement('p'); failMessage.setAttribute('role', 'status'); setCopy(failMessage, "loadError"); panel.append(failMessage);
      }
    }
  }

  window.SaloSmartCore = { loadOwner, renderLanguage, waitText };
  new MutationObserver(discover).observe(document.body, { childList: true, subtree: true });
  discover();
  setInterval(() => {
    document.querySelectorAll('[data-smart-expires]').forEach(el => {
      if (Date.parse(el.dataset.smartExpires) <= Date.now()) { delete el.dataset.smartExpires; el.textContent = smartText("unknown"); }
    });
  }, 250);
  setInterval(() => {
    if (document.hidden) return;
    document.querySelectorAll('[data-smart-salon]').forEach(el => publicStatus(el));
    if (ownerId && document.getElementById('ownerModal')?.classList.contains('show')) loadOwner(ownerId);
  }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { discover(); document.querySelectorAll('[data-smart-salon]').forEach(el => publicStatus(el, true)); if (ownerId) loadOwner(ownerId); } });
})();
