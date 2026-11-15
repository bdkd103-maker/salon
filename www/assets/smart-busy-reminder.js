/* Staff-only reminders. Service lifecycle remains authoritative on the server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createSaloBusyReminder = factory;
})(typeof window === 'undefined' ? globalThis : window, function createBusyReminder(deps) {
  'use strict';
  const MINUTE = 60000, FIRST = 40 * MINUTE, SNOOZE = 10 * MINUTE, REPEAT = 2 * MINUTE;
  let visit = null, key = null, offset = 0, timer = null, generation = 0;
  let owner = false, release = null, requesting = false, silent = !deps.locks;
  let running = false, again = false, finishing = false, error = '', memory = {};
  const now = () => deps.now() + offset;
  const scope = info => info?.user?.role === 'STAFF' && info.membership?.salonId && info.user.id
    && info.hasActiveVisit && info.activeVisitId && Number.isFinite(Date.parse(info.activeVisitStartedAt))
    && Number.isFinite(Date.parse(info.serverTime))
    ? 'saloBusyReminder:v1:' + [info.user.id, info.membership.salonId, info.activeVisitId].map(encodeURIComponent).join(':') : null;
  function state() {
    let stored;
    try { stored = JSON.parse(deps.storage.getItem(key)); } catch {}
    if (!stored || typeof stored !== 'object') stored = memory[key] || {};
    const start = Date.parse(visit.activeVisitStartedAt);
    const acknowledgedAt = Number.isFinite(stored.acknowledgedAt) && stored.acknowledgedAt >= start && stored.acknowledgedAt <= now() ? stored.acknowledgedAt : null;
    const nextDueAt = acknowledgedAt === null ? start + FIRST : acknowledgedAt + SNOOZE;
    return { acknowledgedAt, nextDueAt, lastAlertAt: Number.isFinite(stored.lastAlertAt) && stored.lastAlertAt <= now() ? stored.lastAlertAt : null };
  }
  function save(value) {
    memory[key] = value;
    try { deps.storage.setItem(key, JSON.stringify(value)); }
    catch { silent = true; relinquish(); }
  }
  function cancelTimer() { if (timer !== null) deps.clearTimer(timer); timer = null; }
  function relinquish() {
    deps.stopAudio(); owner = false;
    if (release) { release(); release = null; }
  }
  function stop() {
    ++generation; cancelTimer(); relinquish(); visit = null; key = null; error = '';
    deps.render({ visible: false, busy: finishing, error: '' });
  }
  function sync(info) {
    const nextKey = scope(info);
    if (!nextKey) { stop(); return; }
    if (key !== nextKey) { stop(); key = nextKey; }
    visit = info;
    offset = Date.parse(info.serverTime) - deps.now();
  }
  function schedule(delay) {
    cancelTimer();
    if (key && deps.eligible()) timer = deps.setTimer(() => { timer = null; tick(); }, Math.max(1, delay));
  }
  function acquire() {
    if (silent || owner || requesting) return;
    requesting = true;
    const expected = key, epoch = generation;
    deps.locks.request(key, { ifAvailable: true }, async lock => {
      if (!lock || expected !== key || epoch !== generation || !deps.eligible()) return;
      owner = true;
      const held = new Promise(resolve => { release = resolve; });
      schedule(1);
      await held;
    }).catch(() => { silent = true; relinquish(); schedule(1); })
      .finally(() => { requesting = false; });
  }
  async function tick() {
    if (running) { again = true; return; }
    cancelTimer();
    if (!key || !deps.eligible()) { relinquish(); deps.render({ visible: false, busy: finishing, error: '' }); return; }
    running = true;
    const expected = key, epoch = generation;
    try {
      acquire();
      if (!owner && !silent) {
        deps.render({ visible: false, busy: finishing, error: '' });
        schedule(15000); // Followers retry ownership locally, without polling the API.
        return;
      }
      // One authenticated read per minute, or when a deadline/action needs it.
      const fresh = await deps.read();
      if (epoch !== generation || expected !== key || !deps.eligible()) return;
      sync(fresh);
      if (expected !== key) { again = Boolean(key); return; }
      if (error !== 'completion') error = '';
      const value = state(), due = now() >= value.nextDueAt;
      deps.render({ visible: due && (owner || silent), busy: finishing, error, silent });
      if (due && owner && !finishing && (value.lastAlertAt === null || now() - value.lastAlertAt >= REPEAT)) {
        save({ ...value, lastAlertAt: now() });
        value.lastAlertAt = now();
        if (owner && !silent) deps.tone();
      }
      const deadline = due ? (value.lastAlertAt === null ? now() + REPEAT : value.lastAlertAt + REPEAT) : value.nextDueAt;
      schedule(Math.min(owner || silent ? MINUTE : 15000, Math.max(1, deadline - now())));
    } catch (failure) {
      if (epoch !== generation || expected !== key) return;
      // An inaccessible account cannot retain a reminder or ownership.
      if ([401, 403, 404].includes(Number(failure.status))) { stop(); return; }
      deps.stopAudio();
      error = 'offline';
      deps.render({ visible: now() >= state().nextDueAt && (owner || silent), busy: finishing, error, silent });
      schedule(MINUTE);
    } finally {
      running = false;
      if (again) { again = false; schedule(1); }
    }
  }
  async function acknowledge() {
    if (!key || finishing || !deps.eligible() || (!owner && !silent)) return;
    const value = state();
    if (now() < value.nextDueAt) return;
    deps.stopAudio();
    error = '';
    const acknowledgedAt = now();
    save({ ...value, acknowledgedAt, nextDueAt: acknowledgedAt + SNOOZE, lastAlertAt: null });
    deps.render({ visible: false, busy: false, error: '' }); schedule(SNOOZE > MINUTE ? MINUTE : SNOOZE);
  }
  async function finish() {
    if (!key || finishing || !deps.eligible() || (!owner && !silent)) return;
    const expected = key, epoch = generation, expectedVisit = visit.activeVisitId;
    finishing = true; error = ''; deps.stopAudio();
    deps.render({ visible: true, busy: true, error: '', silent });
    try {
      const fresh = await deps.read();
      if (epoch !== generation || expected !== key || !deps.eligible()) return;
      if (scope(fresh) !== expected) { sync(fresh); again = true; return; }
      const complete = async () => {
        // Retain a separate action lock even if this tab loses alert ownership.
        const latest = await deps.read();
        if (epoch !== generation || expected !== key || !deps.eligible()) return false;
        if (scope(latest) !== expected) { sync(latest); again = Boolean(key); return false; }
        await deps.complete(latest.membership.salonId, expectedVisit);
        return true;
      };
      const completed = deps.locks && !silent
        ? await deps.locks.request(expected + ':complete', { ifAvailable: true }, lock => lock ? complete() : false)
        : await complete();
      if (!completed) { again = Boolean(key); return; }
      if (epoch !== generation || expected !== key) return;
      // Wake other tabs without touching authentication or queue state.
      save({ ...state(), completed: true });
      stop();
      const updated = await deps.read();
      if (!key && deps.eligible()) sync(updated);
      again = Boolean(key);
    } catch (failure) {
      if (epoch !== generation || expected !== key) return;
      if ([401, 403, 404].includes(Number(failure.status))) { stop(); return; }
      error = 'completion';
      deps.render({ visible: true, busy: true, error, silent });
      // Keep the reminder and service unchanged on failure. A later read reconciles conflicts.
      schedule(MINUTE);
    } finally {
      finishing = false;
      if (key === expected) deps.render({ visible: deps.eligible() && (owner || silent) && now() >= state().nextDueAt, busy: false, error, silent });
      if (again) { again = false; schedule(1); }
    }
  }
  return {
    sync(info) { sync(info); return tick(); }, tick, acknowledge, finish, stop,
    pause() { cancelTimer(); relinquish(); deps.render({ visible: false, busy: finishing, error: '' }); },
    changed(storageKey) { if (key && storageKey === key) { deps.stopAudio(); return tick(); } },
  };
});

if (typeof window !== 'undefined') (() => {
  'use strict';
  if (window.SaloBusyReminder || !document.getElementById('staffModal')) return;
  const copy = {
    de: { title: 'Bist du noch beschäftigt?', yes: 'Ja, noch beschäftigt', finish: 'Service beenden', sound: 'Erinnerungston aktivieren', enabled: 'Erinnerungston aktiviert', blocked: 'Ton blockiert. Erneut aktivieren.', silent: 'Stille Erinnerung: Exklusive Tonsteuerung ist nicht verfügbar.', offline: 'Status nicht erreichbar. Der Service bleibt unverändert. Bitte erneut aktualisieren.', completion: 'Service konnte nicht beendet werden. Bitte erneut versuchen.' },
    en: { title: 'Are you still busy?', yes: 'Yes, still busy', finish: 'Finish service', sound: 'Enable reminder sound', enabled: 'Reminder sound enabled', blocked: 'Sound blocked. Enable again.', silent: 'Silent reminder: Exclusive sound control is unavailable.', offline: 'Status unavailable. The service is unchanged. Please refresh and try again.', completion: 'Could not finish the service. Please try again.' },
    ar: { title: 'بعدك مشغول؟', yes: 'إيه، بعدني مشغول', finish: 'خلصت', sound: 'تفعيل صوت التذكير', enabled: 'صوت التذكير مفعّل', blocked: 'الصوت محظور. فعّله من جديد.', silent: 'تذكير صامت: التحكم الحصري بالصوت غير متاح.', offline: 'تعذّر تحديث الحالة. الخدمة لم تتغيّر. حدّث وحاول مجدداً.', completion: 'تعذّر إنهاء الخدمة. حاول مجدداً.' },
  };
  const panel = document.getElementById('staffModal'), card = document.getElementById('staffServiceCard');
  const box = document.createElement('section'); box.hidden = true; box.className = 'owner-panel-card';
  box.setAttribute('aria-labelledby', 'saloBusyTitle');
  const title = document.createElement('h3'); title.id = 'saloBusyTitle'; title.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'owner-booking-actions'; actions.style.flexWrap = 'wrap';
  const yes = document.createElement('button'), finish = document.createElement('button'), sound = document.createElement('button');
  for (const button of [yes, finish, sound]) { button.type = 'button'; button.className = 'secondary'; button.style.whiteSpace = 'normal'; }
  finish.className = 'warning';
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  actions.append(yes, finish); box.append(title, actions, message); card.append(sound, box);
  box.id = 'saloBusyReminder'; yes.id = 'saloBusyYes'; finish.id = 'saloBusyFinish'; sound.id = 'saloBusySound';
  let view = { visible: false }, audio = null, oscillators = [], audioEnabled = false, blocked = false, reading = false;
  let audioEpoch = 0, tonePending = false;
  const tr = () => copy[document.documentElement.lang] || copy.en;
  function render(next = view) {
    view = next; const text = tr(); box.hidden = !next.visible; title.textContent = text.title;
    yes.textContent = text.yes; finish.textContent = text.finish; yes.disabled = finish.disabled = Boolean(next.busy);
    sound.textContent = blocked ? text.blocked : audioEnabled ? text.enabled : text.sound;
    sound.setAttribute('aria-pressed', String(audioEnabled));
    message.textContent = text[next.error] || (next.silent ? text.silent : '');
  }
  function stopAudio() {
    ++audioEpoch; tonePending = false;
    oscillators.forEach(node => { try { node.stop(); } catch {} }); oscillators = [];
    if (audio?.state === 'running') audio.suspend().catch(() => {});
  }
  sound.onclick = async () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('unsupported');
      if (!audio) audio = new Audio();
      await audio.resume(); audioEnabled = audio.state === 'running'; blocked = !audioEnabled;
    } catch { audioEnabled = false; blocked = true; }
    render();
  };
  function tone() {
    if (!audioEnabled || !audio || document.hidden || oscillators.length || tonePending) return;
    const epoch = audioEpoch; tonePending = true;
    audio.resume().then(() => {
      if (epoch !== audioEpoch) return;
      if (audio.state !== 'running' || document.hidden || !view.visible || view.busy) { blocked = true; render(); return; }
      [0, .3, .6].forEach((delay, index) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + delay;
        oscillator.type = 'sine'; oscillator.frequency.value = [620, 740, 620][index];
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.12, start + .025); gain.gain.linearRampToValueAtTime(0, start + .20);
        oscillator.connect(gain); gain.connect(audio.destination); oscillators.push(oscillator);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); oscillators = oscillators.filter(node => node !== oscillator); };
        oscillator.start(start); oscillator.stop(start + .22);
      });
    }).catch(() => { if (epoch === audioEpoch) { blocked = true; render(); } })
      .finally(() => { if (epoch === audioEpoch) tonePending = false; });
  }
  // Read auth metadata only; never persist or write shared authentication state.
  function eligible() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('meshwarSession') || 'null'); } catch {}
    return !document.hidden && panel.classList.contains('show') && session?.role === 'staff'
      && stored?.role === 'staff' && stored.userId === session.userId;
  }
  const controller = window.createSaloBusyReminder({
    now: () => Date.now(), setTimer: (fn, delay) => setTimeout(fn, delay), clearTimer: id => clearTimeout(id),
    storage: localStorage, locks: navigator.locks, eligible, render, tone, stopAudio,
    read: async () => {
      const epoch = typeof staffSessionEpoch === 'number' ? staffSessionEpoch : null;
      const info = await apiRequest('/api/v1/staff/me', { headers: getApiHeaders(), ...(epoch === null ? {} : { staffUserId: session?.userId, staffEpoch: epoch }) });
      if (epoch !== null && epoch !== staffSessionEpoch) throw Object.assign(new Error('Staff session ended'), { status: 403 });
      if (info.user?.id !== session?.userId || session?.role !== 'staff') throw Object.assign(new Error('Account changed'), { status: 403 });
      window.__staffInfo = info;
      reading = true;
      try { renderStaffDashboard(info); } finally { reading = false; }
      return info;
    },
    // Start at the shared client's retry limit: a completion must never be retried automatically.
    complete: (salonId, visitId) => apiRequest('/api/v1/salons/' + encodeURIComponent(salonId) + '/service-visits/' + encodeURIComponent(visitId) + '/complete', { method: 'PATCH', headers: getApiHeaders() }, 2),
  });
  yes.onclick = () => controller.acknowledge(); finish.onclick = () => controller.finish();
  window.SaloBusyReminder = { sync: info => { if (!reading) return controller.sync(info); }, stop: controller.stop };
  const reconcile = () => {
    if (!eligible()) { controller.pause(); return; }
    if (window.__staffInfo) controller.sync(window.__staffInfo); else controller.tick();
  };
  new MutationObserver(reconcile).observe(panel, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => render()).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('visibilitychange', reconcile); window.addEventListener('online', reconcile);
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null || ['meshwarApiAuth', 'meshwarSession'].includes(event.key)) { controller.stop(); if (eligible()) reconcile(); }
    else controller.changed(event.key);
  });
  window.addEventListener('pagehide', () => { controller.pause(); stopAudio(); });
  window.addEventListener('pageshow', reconcile);
  render(); reconcile();
})();
