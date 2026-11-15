/* Dedicated Admin application. All business state is loaded from authenticated APIs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const id = value => encodeURIComponent(value);
  const date = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : '—';
  const badge = value => `<span class="badge ${esc(String(value).toLowerCase())}">${esc(value ?? 'Unknown')}</span>`;
  const button = (label, action, key = '', style = '') => `<button type="button" class="${style}" data-action="${action}" data-key="${esc(key)}">${label}</button>`;
  const table = (headers, rows, empty = 'No records available.') => rows.length ? `<div class="table-wrap" tabindex="0" aria-label="Scrollable data table"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="empty">${empty}</p>`;
  const field = (name, label, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const check = (name, label, value) => `<label class="check"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${label}</label>`;
  const paths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
    salon: '<path d="M4 10v11h16V10M3 4h18l1 6a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2zM9 21v-6h6v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18M7 15h2M15 15h2M7 18h2"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3zM16 3a4 4 0 0 1 0 8M19 14a6 6 0 0 1 3 7"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>',
    document: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
    shop: '<path d="M2 3h3l3 13h12l2-10H6"/><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
    box: '<path d="m12 2 10 5v10l-10 5-10-5V7zM2 7l10 5 10-5M12 12v10M7 4.5l10 5"/>',
    crown: '<path d="m2 6 5 5 5-8 5 8 5-5-3 13H5zM5 22h14"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 5 10 8L22 5"/>',
    bell: '<path d="M5 10a7 7 0 0 1 14 0v6l2 3H3l2-3zM10 22h4M12 1v2"/>',
    settings: '<path d="m9 3 1-2h4l1 2 3 2 3 1v4l-2 2 2 2v4l-3 1-3 2-1 2h-4l-1-2-3-2-3-1v-4l2-2-2-2V6l3-1z"/><circle cx="12" cy="12" r="4"/>',
    logout: '<path d="M9 3H4v18h5M10 12h12m-4-4 4 4-4 4"/>',
    refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
    scissors: '<circle cx="5" cy="6" r="3"/><circle cx="5" cy="18" r="3"/><path d="m7.5 7.5 14 13M7.5 16.5 14 10M17 7l4-4"/>',
    diamond: '<path d="M5 3h14l4 6-11 13L1 9zM1 9h22M8 3 6 9l6 13 6-13-2-6"/>',
    activity: '<path d="M1 12h5l3-9 5 18 3-9h6"/>',
    heart: '<path d="M12 21 3 12C-3 5 6-1 12 6c6-7 15-1 9 6z"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.document}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  const navIcons = { overview: 'home', salons: 'salon', partners: 'document', bookings: 'calendar', messages: 'mail', promotions: 'tag', 'global-offers': 'tag', subscriptions: 'crown', loyalty: 'heart', shop: 'shop', orders: 'box', notifications: 'bell', legal: 'document', settings: 'settings' };
  document.querySelectorAll('nav a').forEach(link => link.insertAdjacentHTML('afterbegin', icon(navIcons[link.hash.slice(1)])));
  const mobileNavigation = matchMedia('(max-width: 1000px)');
  function setNavigation(open, restoreFocus = false) {
    const expanded = open && mobileNavigation.matches;
    document.body.classList.toggle('nav-open', expanded);
    $('sidebar-backdrop').hidden = !expanded;
    $('menu-toggle').setAttribute('aria-expanded', String(expanded));
    $('sidebar').inert = mobileNavigation.matches && !expanded;
    document.querySelector('.main').inert = expanded;
    if (expanded) $('close-sidebar').focus();
    else if (restoreFocus) $('menu-toggle').focus();
  }
  $('menu-toggle').onclick = () => setNavigation(true);
  $('close-sidebar').onclick = $('sidebar-backdrop').onclick = () => setNavigation(false, true);
  mobileNavigation.addEventListener('change', () => setNavigation(false));
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('nav-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); setNavigation(false, true); }
    if (event.key === 'Tab') {
      const links = [...$('sidebar').querySelectorAll('a, button:not(:disabled)')];
      const first = links[0], last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.querySelector('nav').addEventListener('click', event => {
    if (event.target.closest('a') && !mutation) setNavigation(false, mobileNavigation.matches);
  });
  setNavigation(false);
  const titles = { overview: 'Overview', salons: 'Salons', partners: 'Partner Requests', bookings: 'Bookings', messages: 'Messages', promotions: 'Promotions', 'global-offers': 'Global Offers', subscriptions: 'Subscriptions', loyalty: 'Loyalty', shop: 'Shop / Products', orders: 'Orders', notifications: 'Notifications', settings: 'Settings', legal: 'Legal / Rechtliches' };
  let auth = null, user = null, section = 'overview', version = 0, snapshot = {}, selectedSalon = null, mutation = false, salonFilter = { search: '', status: '', city: '', plan: '', vip: '', boost: '', verified: '', women: '' };
  function apiBase() {
    const explicit = String(window.SALO_API_BASE_URL || document.querySelector('meta[name="salo-api-base"]')?.content || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const { protocol, hostname, port } = location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:4000`;
    if (/-8000\.(app\.github\.dev|preview\.app\.github\.dev|githubpreview\.dev)$/.test(hostname)) return `${protocol}//${hostname.replace('-8000.', '-4000.')}`;
    if (/^8000-/.test(hostname)) return `${protocol}//${hostname.replace(/^8000-/, '4000-')}`;
    return port ? `${protocol}//${hostname}:4000` : location.origin;
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${apiBase()}${path}`, { ...options, signal: controller.signal, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && user) signOut('Your session has expired. Please sign in again.');
        const details = data.details?.fieldErrors ? Object.entries(data.details.fieldErrors).map(([key, values]) => `${key}: ${values.join(', ')}`).join('; ') : '';
        throw new Error([data.error || `Request failed (${response.status})`, details].filter(Boolean).join('. '));
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. Refresh server data before trying again.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  const send = (path, method, body) => request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  function notice(message, error = false) { $('notice').hidden = !message; $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
  function signOut(message = '', clearStored = true) {
    setNavigation(false);
    // A delayed response or another tab must not erase newer credentials.
    if (clearStored && localStorage.getItem('meshwarApiAuth') === JSON.stringify(auth)) {
      localStorage.removeItem('meshwarApiAuth'); localStorage.removeItem('meshwarSession');
    }
    user = null; auth = null; ++version; snapshot = {}; selectedSalon = null;
    $('workspace').hidden = true; $('login').hidden = false; $('content').replaceChildren(); $('dialog').close();
    $('login-status').textContent = message;
  }
  function openProvisionFromApplication(request) {
    if (!user || !request) return;
    salonEditor({
      name: request.salonName || '',
      city: request.city || '',
      description: request.message || '',
      ownerName: request.contactName || '',
      ownerEmail: request.contactEmail || '',
      ownerPhone: request.contactPhone || '',
    });
  }
  async function consumePendingAdminHandoffs() {
    if (!user) return;
    let salonEditId = null;
    let provision = null;
    try { salonEditId = sessionStorage.getItem('saloPendingSalonEdit'); sessionStorage.removeItem('saloPendingSalonEdit'); } catch {}
    try {
      const raw = sessionStorage.getItem('saloPendingApplicationProvision');
      sessionStorage.removeItem('saloPendingApplicationProvision');
      if (raw) provision = JSON.parse(raw);
    } catch {}
    if (provision && typeof provision === 'object') { openProvisionFromApplication(provision); return; }
    if (salonEditId) {
      const salon = (snapshot.salons || []).find(s => s.id === salonEditId);
      if (salon) salonEditor(salon);
    }
  }
  async function enter(account) {
    if (account?.role !== 'ADMIN') throw new Error('An ADMIN account is required.');
    user = account; $('identity').textContent = account.fullName || account.email || 'Administrator';
    $('identity-role').textContent = account.role;
    $('login').hidden = true; $('workspace').hidden = false; $('login-form').reset();
    await load();
    await consumePendingAdminHandoffs();
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('button');
    submit.disabled = true; $('login-status').textContent = 'Signing in…';
    const current = version;
    try {
      const result = await send('/api/v1/auth/login', 'POST', Object.fromEntries(new FormData(form)));
      if (current !== version) return;
      if (result.user?.role !== 'ADMIN') throw new Error('An ADMIN account is required.');
      auth = { accessToken: result.accessToken, refreshToken: result.refreshToken, userId: result.user.id, role: result.user.role };
      localStorage.setItem('meshwarApiAuth', JSON.stringify(auth));
      localStorage.setItem('meshwarSession', JSON.stringify({ role: 'admin', userId: result.user.id, salonId: null }));
      await enter(result.user);
    } catch (error) { $('login-status').textContent = error.message; } finally { submit.disabled = false; }
  });
  $('logout').onclick = () => signOut();
  $('refresh').onclick = () => load();
  window.addEventListener('hashchange', () => { if (user && !mutation) { closeDialog(); load(); } });
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage || (event.key !== 'meshwarApiAuth' && event.key !== null)) return;
    // Read current storage: queued events may describe credentials already replaced.
    let next = null;
    try { next = JSON.parse(localStorage.getItem('meshwarApiAuth') || 'null'); } catch {}
    const valid = next && !Array.isArray(next) && next.role === 'ADMIN'
      && typeof next.userId === 'string' && next.userId.trim()
      && typeof next.accessToken === 'string' && next.accessToken.trim()
      && (next.refreshToken === undefined || (typeof next.refreshToken === 'string' && next.refreshToken.trim()));
    const accountId = user?.id || auth?.userId;
    if (valid && accountId && next.userId === accountId && auth?.role === 'ADMIN') {
      auth = next;
      return;
    }
    // Storage never grants entry. Login or the authenticated /auth/me check does.
    signOut('Your session changed. Please sign in again.', false);
  });
  function closeDialog() { if (!mutation) { selectedSalon = null; $('dialog').close(); } }
  $('close-dialog').onclick = closeDialog;
  $('dialog').addEventListener('cancel', event => { if (mutation) event.preventDefault(); else selectedSalon = null; });
  function dialog(title, html) {
    $('dialog-title').textContent = title; $('dialog-content').innerHTML = html; $('dialog-status').textContent = '';
    if (!$('dialog').open) $('dialog').showModal();
  }
  async function perform(operation, message) {
    if (mutation) return;
    mutation = true; $('dialog-status').textContent = ''; notice('');
    const controls = [...document.querySelectorAll('#workspace button, #dialog button')];
    controls.forEach(b => b.disabled = true);
    let committed = false;
    try {
      await operation(); committed = true; selectedSalon = null; $('dialog').close();
      const refreshed = await load();
      if (user) notice(refreshed ? message : `${message} Refresh failed; use Refresh to reload server state.`, !refreshed);
    } catch (error) {
      const message = committed ? `Saved, but refreshing failed. ${error.message}` : error.message;
      if ($('dialog').open) $('dialog-status').textContent = message; else notice(message, true);
    } finally { mutation = false; controls.forEach(b => b.disabled = false); }
  }
  async function load() {
    if (!user) return;
    section = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
    const current = ++version;
    $('page-title').textContent = titles[section];
    $('content').dataset.section = section;
    document.querySelectorAll('nav a').forEach(a => a.toggleAttribute('aria-current', false));
    const navLink = document.querySelector(`nav a[href="#${section}"]`);
    if (navLink) navLink.setAttribute('aria-current', 'page');
    $('content').setAttribute('aria-busy', 'true'); $('content').innerHTML = '<p class="empty" role="status">Loading server data…</p>'; notice('');
    try {
      let result;
      if (section === 'salons') result = await request('/api/v1/admin/salons');
      else if (section === 'bookings') result = await request('/api/v1/bookings');
      else if (section === 'messages') result = await request('/api/v1/messages');
      else if (section === 'partners') result = await request('/api/v1/admin/partner-requests');
      else if (section === 'global-offers') result = await request('/api/v1/admin/global-offers');
      else if (section === 'shop') result = await request('/api/v1/admin/products');
      else if (section === 'orders') result = await request('/api/v1/admin/orders');
      else if (section === 'notifications') result = await request('/api/v1/notifications');
      else if (section === 'settings') result = await request('/api/v1/admin/platform-settings');
      else if (section === 'legal') result = await request('/api/v1/admin/legal');
      else if (section === 'overview') {
        const [dashboard, bookings, salons] = await Promise.allSettled([
          request('/api/v1/admin/dashboard'), request('/api/v1/bookings'), request('/api/v1/admin/salons'),
        ]);
        if (dashboard.status === 'rejected') throw dashboard.reason;
        result = { ...dashboard.value,
          bookings: bookings.status === 'fulfilled' && Array.isArray(bookings.value.bookings) ? bookings.value.bookings : null,
          salons: salons.status === 'fulfilled' && Array.isArray(salons.value.salons) ? salons.value.salons : null,
        };
      }
      else result = await request('/api/v1/admin/dashboard');
      if (current !== version || !user) return;
      snapshot = result; render();
      return true;
    } catch (error) {
      if (current === version && user) { $('content').innerHTML = `<p class="empty">Unable to load this page. Use Refresh to retry.</p>`; notice(error.message, true); }
      return false;
    } finally { if (current === version) $('content').removeAttribute('aria-busy'); }
  }
  const metric = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '\u2014';
  const currency = value => value != null && Number.isFinite(Number(value)) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(Number(value)) : '\u2014';
  const panelTitle = (name, symbol, action = '') => `<div class="panel-heading"><h2>${icon(symbol)}${name}</h2>${action}</div>`;
  const emptyPanel = (symbol, title, message, extra = '') => `<div class="empty ${extra}">${icon(symbol)}<strong>${title}</strong><p>${message}</p></div>`;
  function bookingOverview(bookings) {
    if (!bookings) return emptyPanel('calendar', 'Booking history unavailable', 'Use Refresh to try loading appointments again.', 'chart-empty');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - 29 + i); return d; });
    const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const counts = new Map(days.map(d => [dayKey(d), 0]));
    for (const booking of bookings) {
      const d = new Date(booking.startAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
    const values = [...counts.values()], total = values.reduce((a, b) => a + b, 0);
    if (!total) return emptyPanel('calendar', 'No appointments in this period', 'Your last 30 days of bookings will appear here.', 'chart-empty');
    const max = Math.max(...values, 1), x = i => 32 + i * 17.5, y = v => 135 - v / max * 112;
    const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const label = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<svg class="booking-chart" viewBox="0 0 550 150" role="img" aria-label="${total} appointments over the last 30 days, grouped by appointment date">
      <defs><linearGradient id="booking-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d8ad5e" stop-opacity=".35"/><stop offset="1" stop-color="#d8ad5e" stop-opacity="0"/></linearGradient></defs>
      ${[0, .5, 1].map(n => `<path d="M30 ${y(max * n)}H545" stroke="#303333" stroke-width="1"/><text x="3" y="${y(max * n) + 4}" fill="#a9adb1" font-size="10">${Number((max * n).toFixed(1))}</text>`).join('')}
      <polygon points="32,135 ${points} ${x(29)},135" fill="url(#booking-fill)"/><polyline points="${points}" fill="none" stroke="#e6bd70" stroke-width="2"/>
      ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.2" fill="#fbe4b5"><title>${esc(label(days[i]))}: ${v} appointments</title></circle>`).join('')}
      </svg><div class="chart-caption"><span>${esc(label(days[0]))}</span><span>${total} appointments &middot; all statuses &middot; local time</span><span>${esc(label(today))}</span></div>`;
  }
  function salonDistribution(salons) {
    if (!salons) return emptyPanel('salon', 'Salon data unavailable', 'Use Refresh to try again.');
    if (!salons.length) return emptyPanel('salon', 'Your network starts here', 'Create a salon to see its distribution.');
    const groups = [
      { label: 'Active', count: salons.filter(s => s.isActive === true).length, color: '#e6be72' },
      { label: 'Inactive', count: salons.filter(s => s.isActive === false).length, color: '#8c7243' },
      { label: 'Unspecified', count: salons.filter(s => typeof s.isActive !== 'boolean').length, color: '#777c80' },
    ];
    let offset = 0;
    const stops = groups.map(g => { const start = offset; offset += g.count / salons.length * 100; return `${g.color} ${start}% ${offset}%`; });
    return `<div class="distribution"><div class="donut" style="background:conic-gradient(${stops.join(',')})" role="img" aria-label="Salon distribution by active status"><span><strong>${salons.length}</strong>Salons</span></div><ul>${groups.filter(g => g.count).map(g => `<li><span class="dot" style="--dot:${g.color}"></span>${g.label}<b>${g.count} &middot; ${Math.round(g.count / salons.length * 100)}%</b></li>`).join('')}</ul></div>`;
  }
  function renderOverview(s) {
    const bookings = snapshot.bookings;
    const recent = bookings ? [...bookings].filter(b => b.createdAt || b.startAt).sort((a, b) => Date.parse(b.createdAt || b.startAt) - Date.parse(a.createdAt || a.startAt)).slice(0, 5) : null;
    const stats = [['Total salons', s.totalSalons, 'salon', 'Across your network'], ['Total bookings', s.totalBookings, 'calendar', 'All appointments'], ['Total users', s.totalUsers, 'users', 'Registered accounts'], ['Collected revenue', null, 'diamond', 'Payment data unavailable']];
    const moreStats = [['Active salons', s.activeSalons], ['Active subscriptions', s.activeSubscriptions], ['Offers', s.totalOffers], ['Boosts', s.totalBoosts], ['Loyalty cards', s.totalLoyaltyCards], ['Cancelled subscriptions', s.cancelledSubscriptions]];
    const quick = (title, description, symbol, action) => `<button class="quick-action" type="button" data-action="${action}"><span class="icon-medallion">${icon(symbol)}</span><span><strong>${title}</strong><small>${description}</small></span><span class="arrow" aria-hidden="true">&rarr;</span></button>`;
    $('content').innerHTML = `
      <section class="dashboard-hero" aria-label="Welcome"><div><h2>${icon('crown')}Welcome Back, ${esc(user.fullName || 'Admin')}</h2><p>Manage your salons and grow the SALO community.</p><span class="hero-motto">&ldquo;More Than a Salon&rdquo;</span></div><div class="hero-aside" aria-hidden="true">Style<br>&nbsp; People<br>&nbsp; &nbsp; Community</div></section>
      <div class="cards">${stats.map(([label, value, symbol, description]) => `<article class="card kpi"><span class="icon-medallion">${icon(symbol)}</span><div><small>${label}</small><strong>${metric(value)}</strong><span class="metric-note">${description}</span></div></article>`).join('')}</div>
      <div class="dashboard-grid">
        <section class="panel chart-panel">${panelTitle('Bookings Overview', 'calendar', '<span class="period">Last 30 days</span>')}${bookingOverview(bookings)}</section>
        <section class="panel distribution-panel">${panelTitle('Salon Distribution', 'salon')}${salonDistribution(snapshot.salons)}</section>
        <section class="panel recent-panel">${panelTitle('Recent Bookings', 'calendar', '<a class="view-all" href="#bookings">View all <span aria-hidden="true">&rarr;</span></a>')}${recent ? table(['Customer', 'Salon / service', 'Date & time', 'Status'], recent.map(b => [esc(b.user?.fullName || b.user?.email || '\u2014'), `${esc(b.salon?.name || '\u2014')}<small>${esc(b.service?.name || '\u2014')}</small>`, esc(date(b.startAt)), badge(b.status)]), 'No bookings yet.') : emptyPanel('calendar', 'Bookings unavailable', 'Open Bookings or refresh to try again.')}</section>
        <section class="panel activity-panel">${panelTitle('Recent Activity', 'activity')}${emptyPanel('activity', 'Activity feed unavailable', 'A combined activity timeline is not available yet.')}<a class="view-all" href="#notifications">View your notifications <span aria-hidden="true">&rarr;</span></a></section>
      </div>
      <div class="quick-actions" aria-label="Quick actions">${quick('Add New Salon', 'Create a salon in the platform', 'scissors', 'create-salon')}${quick('Create Offer', 'Open offers and promotions', 'tag', 'nav-promotions')}${quick('Partner Requests', 'Review salon applications', 'users', 'nav-partners')}</div>
      <details class="network-details"><summary>More network metrics &amp; actions</summary><div class="cards">${moreStats.map(([label, value]) => `<article class="card"><small>${label}</small><strong>${metric(value)}</strong></article>`).join('')}<article class="card"><small>Monthly plan value (estimated)</small><strong>${currency(s.monthlyRevenue)}</strong></article><article class="card"><small>MRR (plan value)</small><strong>${currency(s.mrr)}</strong></article>${['FREE', 'SMART', 'PREMIUM', 'PRO'].map(plan => `<article class="card"><small>${plan} subscriptions</small><strong>${metric(s.planCounts?.[plan])}</strong></article>`).join('')}</div><p class="muted">Plan values are not collected-payment revenue. Missing metrics are shown as &mdash;.</p><div class="actions">${button("+ Create women's salon", 'create-women-salon')}${button('View bookings', 'nav-bookings')}${button('View messages', 'nav-messages')}</div></details>`;
  }
  function render() {
    renderContent();
    if (section !== 'overview') $('content').insertAdjacentHTML('afterbegin', `<h2 class="page-heading">${esc(titles[section])}</h2>`);
  }
  function renderContent() {
    const s = snapshot.summary || {};
    if (section === 'overview') {
      renderOverview(s);
    } else if (section === 'salons') {
      const salons = (snapshot.salons || []).filter(s => {
        if (salonFilter.search && !`${s.name} ${s.city} ${s.owner?.fullName} ${s.owner?.email}`.toLowerCase().includes(salonFilter.search.toLowerCase())) return false;
        if (salonFilter.status === 'active' && !s.isActive) return false;
        if (salonFilter.status === 'inactive' && s.isActive) return false;
        if (salonFilter.city && s.city !== salonFilter.city) return false;
        if (salonFilter.vip === 'vip' && !s.adminVip && !s.isVip) return false;
        if (salonFilter.verified === 'verified' && !s.isVerified) return false;
        if (salonFilter.women === 'women' && !s.isWomenOnly) return false;
        return true;
      });
      const cities = [...new Set((snapshot.salons || []).map(s => s.city).filter(Boolean))];
      $('content').innerHTML = `
        <p class="lead">All salons, including inactive locations. Changes are saved to the server.</p>
        <div class="toolbar">
          <input id="salon-search" type="search" aria-label="Search salons" placeholder="Search name, city or owner…" value="${esc(salonFilter.search)}">
          <select id="salon-filter-status"><option value="">All status</option><option value="active" ${salonFilter.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${salonFilter.status === 'inactive' ? 'selected' : ''}>Inactive</option></select>
          <select id="salon-filter-city"><option value="">All cities</option>${cities.map(c => `<option value="${esc(c)}" ${salonFilter.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="salon-filter-vip"><option value="">All VIP</option><option value="vip" ${salonFilter.vip === 'vip' ? 'selected' : ''}>VIP only</option></select>
          <select id="salon-filter-verified"><option value="">All verified</option><option value="verified" ${salonFilter.verified === 'verified' ? 'selected' : ''}>Verified only</option></select>
          <select id="salon-filter-women"><option value="">All types</option><option value="women" ${salonFilter.women === 'women' ? 'selected' : ''}>Women's only</option></select>
          ${button('+ Create salon', 'create-salon', '', 'primary')}
          ${button('+ Women\'s salon', 'create-women-salon', '', 'primary')}
        </div>
        <div id="salon-table"></div>`;
      salonTable(salons);
      $('salon-search').oninput = event => { salonFilter.search = event.target.value; render(); };
      $('salon-filter-status').onchange = event => { salonFilter.status = event.target.value; render(); };
      $('salon-filter-city').onchange = event => { salonFilter.city = event.target.value; render(); };
      $('salon-filter-vip').onchange = event => { salonFilter.vip = event.target.value; render(); };
      $('salon-filter-verified').onchange = event => { salonFilter.verified = event.target.value; render(); };
      $('salon-filter-women').onchange = event => { salonFilter.women = event.target.value; render(); };
    } else if (section === 'partners') {
      const requests = snapshot.requests || [];
      $('content').innerHTML = `<p class="lead">Partner applications from potential salon owners.</p>
        ${table(['Salon', 'Contact', 'City', 'Status', 'Submitted', 'Actions'],
          requests.map(r => [
            `<strong>${esc(r.salonName)}</strong>`,
            `${esc(r.contactName)}<small>${esc(r.contactEmail)}</small>`,
            esc(r.city),
            badge(r.status),
            esc(date(r.createdAt)),
            r.status === 'PENDING' ? `<div class="actions">${button('Approve', 'approve-partner', r.id)}${button('Reject', 'reject-partner', r.id, 'danger')}</div>` : r.status === 'APPROVED' ? `<div class="actions">${button('Create salon', 'provision-partner', r.id)}</div>` : (r.rejectReason ? `<small>Reason: ${esc(r.rejectReason)}</small>` : '—')
          ]))}`;
    } else if (section === 'bookings') {
      $('content').innerHTML = `<p class="lead">Bookings across all salons. Times are shown in your browser's local timezone.</p>${table(['Salon / service', 'Customer', 'Appointment', 'Status', 'Action'], (snapshot.bookings || []).map(b => [esc(b.salon?.name) + `<small>${esc(b.service?.name)}</small>`, esc(b.user?.fullName || b.user?.email || b.userId), esc(date(b.startAt)), badge(b.status), ['PENDING', 'CONFIRMED'].includes(b.status) ? button('Update status', 'booking', b.id) : '—']))}`;
    } else if (section === 'messages') {
      $('content').innerHTML = `<div class="toolbar"><p class="lead">Your authenticated inbox and sent messages.</p>${button('Compose message', 'compose', '', 'primary')}</div><div class="panel">${(snapshot.messages || []).map(m => `<article class="message"><h3>${esc(m.subject || 'Message')}</h3><small>${esc(m.sender?.fullName || m.senderId)} → ${esc(m.receiver?.fullName || m.receiverId)} · ${esc(date(m.createdAt))}</small><p>${esc(m.body)}</p></article>`).join('') || '<p class="empty">No messages yet.</p>'}</div>`;
    } else if (section === 'promotions') {
      const offers = snapshot.offers || [];
      const flashDeals = offers.filter(o => o.type === 'FLASH_DEAL' || o.type === 'LAST_MINUTE');
      const regularOffers = offers.filter(o => !o.type || o.type === 'REGULAR');
      $('content').innerHTML = `
        <div class="toolbar"><h2>Regular Offers</h2>${button('+ Create offer', 'create-offer', '', 'primary')}</div>
        ${table(['Offer / salon', 'Price', 'Discount', 'Status', 'Actions'], regularOffers.map(o => [`<strong>${esc(o.title)}</strong><small>${esc(o.salon?.name || o.salonId)}</small>`, esc(o.price ?? '—'), o.discount ? `${esc(o.discount)}%` : '—', badge(o.isActive ? 'Active' : 'Inactive'), `<div class="actions">${button('Edit', 'edit-offer', o.id)}${button(o.isActive ? 'Disable' : 'Enable', 'toggle-offer', o.id)}${button('Delete', 'delete-offer', o.id, 'danger')}</div>`]))}
        <h2 class="section-title">Flash Deals / Last Minute</h2>
        ${button('+ Create flash deal', 'create-flash-deal', '', 'primary')}
        ${table(['Deal / salon', 'Price', 'Slots', 'Start', 'End', 'Status', 'Actions'], flashDeals.map(o => [`<strong>${esc(o.title)}</strong><small>${esc(o.salon?.name || o.salonId)}</small>`, esc(o.price ?? '—'), esc(o.availableSlots ?? '—'), esc(date(o.startAt)), esc(date(o.endAt)), badge(o.isActive ? 'Active' : 'Inactive'), `<div class="actions">${button('Edit', 'edit-offer', o.id)}${button('Delete', 'delete-offer', o.id, 'danger')}</div>`]))}
        <h2 class="section-title">Boosts</h2><p class="muted">Read-only campaign overview.</p>
        ${table(['Salon', 'Status', 'Start', 'End', 'Amount'], (snapshot.boosts || []).map(b => [esc(b.salon?.name || b.salonId), badge(b.status), esc(date(b.startsAt)), esc(date(b.endsAt)), `${esc(Number(b.amountCents || 0) / 100)} ${esc(b.currency || '')}`]))}`;
    } else if (section === 'global-offers') {
      const offers = snapshot.offers || [];
      $('content').innerHTML = `<div class="toolbar"><p class="lead">Platform-wide SALO offers visible on the public site.</p>${button('+ Create global offer', 'create-global-offer', '', 'primary')}</div>
        ${table(['Offer', 'Price text', 'Status', 'Actions'], offers.map(o => [`<strong>${esc(o.title)}</strong><small>${esc(o.description || '')}</small>`, esc(o.priceText || '—'), badge(o.isActive ? 'Active' : 'Inactive'), `<div class="actions">${button('Edit', 'edit-global-offer', o.id)}${button(o.isActive ? 'Disable' : 'Enable', 'toggle-global-offer', o.id)}${button('Delete', 'delete-global-offer', o.id, 'danger')}</div>`]))}`;
    } else if (section === 'subscriptions') {
      const planDist = s.planCounts || {};
      $('content').innerHTML = `<p class="lead">Read-only owner subscriptions. Plan changes for other owners are not available.</p>
        <div class="cards">
          <article class="card"><small>FREE</small><strong>${metric(planDist.FREE)}</strong></article>
          <article class="card"><small>SMART</small><strong>${metric(planDist.SMART)}</strong></article>
          <article class="card"><small>PREMIUM</small><strong>${metric(planDist.PREMIUM)}</strong></article>
          <article class="card"><small>PRO</small><strong>${metric(planDist.PRO)}</strong></article>
          <article class="card"><small>MRR</small><strong>${currency(s.mrr)}</strong></article>
        </div>
        ${table(['Owner', 'Plan', 'Status', 'Monthly plan price', 'Start', 'Renewal'], (snapshot.subscriptions || []).map(s => [esc(s.user?.fullName || s.userId) + `<small>${esc(s.user?.email)}</small>`, esc(s.plan), badge(s.status), esc(s.monthlyPrice ?? '—'), esc(date(s.startDate)), esc(date(s.renewalDate))]))}<p class="muted">Plan prices are subscription values, not collected-payment revenue.</p>`;
    } else if (section === 'loyalty') {
      $('content').innerHTML = `<p class="lead">Loyalty cards and customer progress. Read-only.</p>${table(['Salon', 'Reward', 'Required stamps', 'Status', 'Customers'], (snapshot.loyalty?.cards || []).map(c => [esc(c.salon?.name || c.salonId), esc(c.rewardTitle), esc(c.requiredStamps), badge(c.isActive ? 'Active' : 'Inactive'), button('View customers', 'loyalty', c.id)]))}`;
    } else if (section === 'shop') {
      const products = snapshot.products || [];
      $('content').innerHTML = `<div class="toolbar"><p class="lead">Product catalog management.</p>${button('+ Create product', 'create-product', '', 'primary')}</div>
        ${table(['Product', 'Brand', 'Retail', 'Wholesale', 'Status', 'Actions'], products.map(p => [`<strong>${esc(p.name)}</strong><small>${esc(p.description || '')}</small>`, esc(p.brand?.name || '—'), esc(p.retailPrice ?? '—'), esc(p.wholesalePrice ?? '—'), badge(p.isPublished ? 'Published' : 'Draft'), `<div class="actions">${button('Edit', 'edit-product', p.id)}${button(p.isPublished ? 'Unpublish' : 'Publish', 'toggle-product', p.id)}${button('Delete', 'delete-product', p.id, 'danger')}</div>`]))}`;
    } else if (section === 'orders') {
      const orders = snapshot.orders || [];
      $('content').innerHTML = `<p class="lead">Platform orders. Read-only status management.</p>
        ${table(['Order', 'Customer', 'Items', 'Total', 'Status', 'Actions'], orders.map(o => [`<strong>${esc(o.id.slice(0, 8))}</strong>`, esc(o.userId), esc(o.items?.length ?? 0), `${esc(o.totalCents / 100)} ${esc(o.currency)}`, badge(o.status), ['PENDING', 'CONFIRMED'].includes(o.status) ? button('Update status', 'update-order', o.id) : '—']))}`;
    } else if (section === 'notifications') {
      const notifications = snapshot.notifications || [];
      $('content').innerHTML = `<p class="lead">Notification history. Read-only.</p>
        ${table(['Type', 'Title', 'User', 'Read', 'Date'], notifications.map(n => [badge(n.type), esc(n.title), esc(n.userId), n.isRead ? 'Yes' : 'No', esc(date(n.createdAt))]))}`;
    } else if (section === 'legal') {
      $('content').innerHTML = `<p class="lead">Manage platform legal content. These are shown on public pages.</p>
        <div class="legal-editors">
          <h3>Structured Impressum</h3>
          <div class="form-grid">
            ${field('imprintOwnerName', 'Owner / Inhaber', snapshot.imprintOwnerName || '')}
            ${field('imprintCompanyName', 'Company name', snapshot.imprintCompanyName || '')}
            ${field('imprintStreet', 'Street & number', snapshot.imprintStreet || '')}
            ${field('imprintCity', 'PLZ & City', snapshot.imprintCity || '')}
            ${field('imprintCountry', 'Country', snapshot.imprintCountry || '')}
            ${field('imprintEmail', 'Email', snapshot.imprintEmail || '', 'email')}
            ${field('imprintPhone', 'Phone', snapshot.imprintPhone || '', 'tel')}
            ${field('imprintRepresentative', 'Representative', snapshot.imprintRepresentative || '')}
            ${field('imprintRegister', 'Trade register', snapshot.imprintRegister || '')}
          </div>
          <h3>Rich Content</h3>
          <label>Impressum (HTML)<textarea name="impressum" maxlength="100000" rows="12">${esc(snapshot.impressum || '')}</textarea></label>
          <label>Datenschutz (HTML)<textarea name="datenschutz" maxlength="100000" rows="12">${esc(snapshot.datenschutz || '')}</textarea></label>
          <label>AGB (HTML)<textarea name="agb" maxlength="100000" rows="12">${esc(snapshot.agb || '')}</textarea></label>
          <button class="primary" data-action="save-legal">Save legal content</button>
        </div>`;
    } else if (section === 'settings') {
      const settings = snapshot.settings || {};
      const system = snapshot.system || {};
      const security = snapshot.security || {};
      const flag = (name, label) => check(name, label, settings[name] !== false);
      $('content').innerHTML = `<p class="lead">Platform-wide settings are stored in PostgreSQL and enforced by the API on every request.</p>
        <form id="settings-form" class="legal-editors">
          <h3>General</h3>
          <div class="form-grid">
            ${field('siteName', 'Site name', settings.siteName || 'SALO', 'text', 'required minlength="1" maxlength="80"')}
            ${field('supportEmail', 'Support email', settings.supportEmail || '', 'email', 'maxlength="200"')}
            <label>Default language<select name="defaultLocale">${['ar', 'de', 'en'].map(locale => `<option value="${locale}" ${settings.defaultLocale === locale ? 'selected' : ''}>${locale.toUpperCase()}</option>`).join('')}</select></label>
          </div>
          <h3>Registration &amp; Applications</h3>
          ${flag('customerRegistrationEnabled', 'Customer registration enabled')}
          ${flag('salonApplicationsEnabled', 'Salon applications enabled')}
          <h3>Booking Rules</h3>
          ${flag('bookingGloballyEnabled', 'Bookings globally enabled')}
          ${flag('saloTicketGloballyEnabled', 'SALO Ticket intake globally enabled')}
          ${flag('walkInGloballyEnabled', 'Walk-in intake globally enabled')}
          <h3>SMART &amp; Queue</h3>
          ${flag('staffStatusLiveEnabled', 'SMART Live / Staff Status Live')}
          <h3>Platform Security</h3>
          <dl>
            <dt>Authentication</dt><dd>${esc(security.authentication || '—')}</dd>
            <dt>Password hashing</dt><dd>${esc(security.passwordHashing || '—')}</dd>
            <dt>Admin authorization</dt><dd>${esc(security.adminAuthorization || '—')}</dd>
            <dt>Secrets exposed</dt><dd>${security.secretsExposed === false ? 'No' : 'Yes'}</dd>
            <dt>Notes</dt><dd>${esc(security.notes || '')}</dd>
          </dl>
          <p class="muted">Credentials, tokens, and private keys are never shown or editable here.</p>
          <h3>System</h3>
          <dl>
            <dt>Environment</dt><dd>${esc(system.environment || '—')}</dd>
            <dt>API version</dt><dd>${esc(system.apiVersion || '—')}</dd>
            <dt>Node version</dt><dd>${esc(system.nodeVersion || '—')}</dd>
            <dt>Database</dt><dd>${system.databaseConnected === true ? 'Connected' : 'Unavailable'}</dd>
            <dt>Server time</dt><dd>${esc(date(system.serverTime))}</dd>
            <dt>Process uptime</dt><dd>${metric(system.processUptimeSeconds)}s</dd>
          </dl>
          <button class="primary" type="button" data-action="save-settings">Save platform settings</button>
        </form>`;
    } else {
      $('content').innerHTML = `<div class="panel"><h2>Administrator account</h2><dl><dt>Name</dt><dd>${esc(user.fullName)}</dd><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Role</dt><dd>ADMIN</dd></dl><a href="#settings">Open platform settings →</a></div>`;
    }
  }
  function salonTable(salons) {
    $('salon-table').innerHTML = table(['Salon', 'Owner', 'Status', 'Verified', 'Actions'], salons.map(s => [`<strong>${esc(s.name)}</strong><small>${esc(s.city)}</small>`, esc(s.owner?.fullName || '—') + `<small>${esc(s.owner?.email)}</small>`, badge(s.isActive ? 'Active' : 'Inactive'), s.isVerified ? badge('Verified') : button('Verify', 'verify-salon', s.id), `<div class="actions">${button('View / edit', 'edit-salon', s.id)}${button(s.isActive ? 'Deactivate' : 'Activate', 'toggle-salon', s.id)}${button('Permanent delete', 'delete-salon', s.id, 'danger')}</div>`]), 'No salons match your search.');
  }
  let salonServices = [];
  async function loadSalonServices(salonId) {
    const container = $('services');
    if (!container) return;
    container.innerHTML = '<p class="muted" role="status">Loading services…</p>';
    try {
      const result = await request(`/api/v1/salons/${id(salonId)}/services`);
      salonServices = result.services || [];
      renderSalonServices(salonId);
    } catch (error) {
      container.innerHTML = `<p class="muted">Unable to load services: ${esc(error.message)}</p>`;
    }
  }
  function renderSalonServices(salonId) {
    const container = $('services');
    if (!container) return;
    container.innerHTML = `<fieldset><legend>Salon Services</legend>${button('+ Add service', 'create-service', salonId, 'primary')}<div id="service-list">${serviceTable(salonId, salonServices)}</div></fieldset>`;
  }
  function serviceTable(salonId, services) {
    if (!services.length) return '<p class="muted">No services added yet.</p>';
    return table(['Service', 'Duration', 'Price', 'Status', 'Actions'], services.map(s => [`<strong>${esc(s.name)}</strong><small>${esc(s.description || '')}</small>`, s.durationMin ? `${esc(s.durationMin)} min` : '—', s.price != null ? `${esc(Number(s.price).toFixed(2))} €` : '—', badge(s.isActive !== false ? 'Active' : 'Inactive'), `<div class="actions">${button('Edit', 'edit-service', `${salonId}:${s.id}`)}${button(s.isActive !== false ? 'Deactivate' : 'Activate', 'toggle-service', `${salonId}:${s.id}`)}${button('Delete', 'delete-service', `${salonId}:${s.id}`, 'danger')}</div>`]));
  }
  function serviceEditor(salonId, service = {}) {
    const isEdit = !!service.id;
    dialog(isEdit ? 'Edit service' : 'Add service', `<form id="service-form">${field('name', 'Service name', service.name || '', 'text', 'required minlength="2" maxlength="120"')}${field('description', 'Description', service.description || '', 'text', 'maxlength="500"')}${field('durationMin', 'Duration (minutes)', service.durationMin ?? '', 'number', 'required min="1" max="480"')}${field('price', 'Price (€)', service.price != null ? Number(service.price).toFixed(2) : '', 'number', 'required min="0" step="0.01"')}${check('isActive', 'Active', service.isActive !== false)}<button class="primary" type="submit">${isEdit ? 'Save changes' : 'Add service'}</button></form>`);
    $('service-form').onsubmit = event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = { name: form.get('name').trim(), description: form.get('description').trim(), durationMin: Number(form.get('durationMin')), price: Number(form.get('price')), isActive: form.has('isActive') };
      perform(() => send(isEdit ? `/api/v1/salons/${id(salonId)}/services/${id(service.id)}` : `/api/v1/salons/${id(salonId)}/services`, isEdit ? 'PATCH' : 'POST', payload), isEdit ? 'Service saved.' : 'Service added.');
    };
  }
  function salonEditor(salon = {}) {
    selectedSalon = salon.id || null;
    dialog(salon.id ? 'Salon details & settings' : 'Create salon & owner', `<form id="salon-form"><div class="form-grid">${field('name', 'Salon name', salon.name, 'text', 'required minlength="2" maxlength="120"')}${field('city', 'City', salon.city, 'text', 'required minlength="2"')}${field('address', 'Address', salon.address, 'text', 'required minlength="5"')}${field('phone', 'Salon phone', salon.phone, 'tel', 'required minlength="7"')}${field('email', 'Salon email', salon.email, 'email')}${field('website', 'Website', salon.website, 'url')}${field('openingTime', 'Opening time', salon.openingTime || '09:00', 'time', 'required')}${field('closingTime', 'Closing time', salon.closingTime || '18:00', 'time', 'required')}${field('timeZone', 'Timezone', salon.timeZone || 'Europe/Berlin', 'text', 'required')}${field('imageUrl', 'Salon image URL', salon.imageUrl || salon.media?.find(m => m.kind === 'image')?.url, 'text')}<label class="span">Description<textarea name="description" maxlength="1000">${esc(salon.description)}</textarea></label><div class="span days">${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => check(d, d.toUpperCase(), (salon.workingDays || ['mon', 'tue', 'wed', 'thu', 'fri']).includes(d))).join('')}</div>${check('adminVip', 'Admin VIP', salon.adminVip)}${check('isWomenOnly', 'Women\'s salon', salon.isWomenOnly)}<label>Classification<select name="classification"><option value="REGULAR">Regular</option><option value="PREMIUM" ${(salon.baseClassification || salon.classification) === 'PREMIUM' ? 'selected' : ''}>Premium</option></select></label></div>${salon.id ? `<fieldset><legend>Owner account</legend><p class="muted">${esc(salon.owner?.fullName)} · ${esc(salon.owner?.email)}</p>${field('ownerPassword', 'Reset owner password (leave blank to keep)', '', 'password', 'minlength="8" maxlength="128" autocomplete="new-password"')}<p class="muted">Saving a new password changes the owner's login credentials.</p></fieldset>` : `<fieldset><legend>Owner login</legend>${field('ownerName', 'Owner full name', salon.ownerName || '', 'text', 'required')}${field('ownerEmail', 'Owner email', salon.ownerEmail || '', 'email', 'required')}${field('ownerPhone', 'Owner phone', salon.ownerPhone || '', 'tel', 'minlength="7" maxlength="20"')}${field('ownerPassword', 'Owner password', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')}</fieldset>`}<div id="intake"></div><div id="extras"></div>${salon.id ? '<div id="services"></div>' : ''}<button class="primary" type="submit">${salon.id ? 'Save salon' : 'Create salon & owner'}</button></form>`);
    if (salon.id) window.createSalonIntakeControls($('intake'), { request, language: () => 'en', isCurrent: key => selectedSalon === key && !!user }).load(salon.id);
    if (salon.id) window.createSalonExtras($('extras'), { request, language: () => 'en', isCurrent: key => selectedSalon === key && !!user }).load(salon.id);
    if (salon.id) loadSalonServices(salon.id);
    $('salon-form').onsubmit = event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), payload = {};
      for (const key of ['name', 'city', 'address', 'phone', 'description', 'openingTime', 'closingTime', 'timeZone', 'classification']) payload[key] = form.get(key).trim();
      for (const key of ['email', 'website']) if (form.get(key).trim()) payload[key] = form.get(key).trim();
      const image = form.get('imageUrl').trim();
      if (image !== (salon.imageUrl || salon.media?.find(m => m.kind === 'image')?.url || '')) payload.imageUrl = image;
      payload.adminVip = form.has('adminVip'); payload.isWomenOnly = form.has('isWomenOnly');
      payload.workingDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => form.has(d));
      if (salon.id) { if (form.get('ownerPassword')) payload.ownerPassword = form.get('ownerPassword'); perform(() => send(`/api/v1/salons/${id(salon.id)}`, 'PATCH', payload), 'Salon saved.'); }
      else {
        const existing = snapshot.salons?.find(s => s.owner?.email?.toLowerCase() === form.get('ownerEmail').trim().toLowerCase());
        if (existing) { $('dialog-status').textContent = `This owner already manages ${existing.name}. Open that salon to reset their password.`; return; }
        perform(() => send('/api/v1/auth/admin/provision-owner', 'POST', { owner: { fullName: form.get('ownerName'), email: form.get('ownerEmail'), phone: form.get('ownerPhone').trim(), password: form.get('ownerPassword') }, salon: payload }), 'Owner provisioning completed. Review the refreshed salon list.');
      }
    };
  }
  function deleteSalon(salon) {
    dialog('Permanently delete salon', `<p>This is irreversible. The salon and its dependent operational records will be permanently removed.</p><p>Archive, retention and clearance requirements must already be satisfied. The server may refuse deletion.</p><p><strong>${esc(salon.name)}</strong></p><form id="delete-form">${field('confirmation', 'Type the salon name to confirm', '', 'text', 'required autocomplete="off"')}<button type="submit" class="danger primary">Delete permanently</button></form>`);
    $('delete-form').onsubmit = event => { event.preventDefault(); if (new FormData(event.currentTarget).get('confirmation') !== salon.name) { $('dialog-status').textContent = 'The salon name does not match.'; return; } perform(() => send(`/api/v1/salons/${id(salon.id)}`, 'DELETE'), 'Salon permanently deleted.'); };
  }
  async function offerEditor(offer = {}, type = 'REGULAR') {
    let salons = [];
    if (!offer.id) { const response = await request('/api/v1/admin/salons'); salons = response.salons || []; }
    else offer = await fullOffer(offer);
    if (!user) return;
    const isFlash = type === 'FLASH_DEAL' || type === 'LAST_MINUTE';
    dialog(offer.id ? 'Edit offer' : (isFlash ? 'Create flash deal' : 'Create offer'), `<form id="offer-form">${!offer.id ? `<label>Salon<select name="salonId" required><option value="">Choose a salon</option>${salons.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}${field('title', 'Title', offer.title, 'text', 'required maxlength="120"')}${field('price', 'Price', offer.price ?? 0, 'number', 'required min="0" step="0.01"')}${field('discount', 'Discount %', offer.discount ?? '', 'number', 'min="0" max="100"')}${isFlash ? `${field('availableSlots', 'Available slots', offer.availableSlots ?? '', 'number', 'min="1"')}${field('startAt', 'Start date', offer.startAt ? new Date(offer.startAt).toISOString().slice(0, 16) : '', 'datetime-local')}${field('endAt', 'End date', offer.endAt ? new Date(offer.endAt).toISOString().slice(0, 16) : '', 'datetime-local')}` : ''}<label>Description<textarea name="description" maxlength="500">${esc(offer.description)}</textarea></label>${check('isActive', 'Active', offer.isActive !== false)}<input type="hidden" name="type" value="${type}"><button class="primary" type="submit">Save</button></form>`);
    $('offer-form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { ...offerPayload(offer), title: form.get('title'), price: Number(form.get('price')), description: form.get('description'), isActive: form.has('isActive'), type: form.get('type') }; if (form.get('discount')) payload.discount = Number(form.get('discount')); if (form.get('availableSlots')) payload.availableSlots = Number(form.get('availableSlots')); if (form.get('startAt')) payload.startAt = new Date(form.get('startAt')).toISOString(); if (form.get('endAt')) payload.endAt = new Date(form.get('endAt')).toISOString(); perform(() => send(`/api/v1/salons/${id(offer.salonId || form.get('salonId'))}/offers${offer.id ? `/${id(offer.id)}` : ''}`, offer.id ? 'PATCH' : 'POST', payload), 'Offer saved.'); };
  }
  async function fullOffer(offer) {
    const result = await request(`/api/v1/salons/${id(offer.salonId)}/offers`);
    const current = result.offers?.find(o => o.id === offer.id);
    if (!current) throw new Error('Offer no longer exists. Refresh promotions.');
    return current;
  }
  function offerPayload(offer) {
    const keys = ['title', 'description', 'price', 'discount', 'serviceName', 'startAt', 'endAt', 'startTime', 'endTime', 'availableSlots', 'isActive', 'type'];
    return Object.fromEntries(keys.filter(key => offer[key] !== undefined).map(key => [key, offer[key] === null && !['startAt', 'endAt'].includes(key) ? '' : offer[key]]));
  }
  async function compose() {
    const current = version;
    const result = await request('/api/v1/admin/salons');
    if (current !== version || !user) return;
    const contacts = new Map();
    for (const message of snapshot.messages || []) for (const person of [message.sender, message.receiver]) {
      if (person?.id && person.id !== user.id) contacts.set(person.id, person);
    }
    const options = (result.salons || []).map(s => `<option value="s:${esc(s.id)}">${esc(s.name)} — salon owner</option>`).join('')
      + [...contacts.values()].map(p => `<option value="u:${esc(p.id)}">${esc(p.fullName || p.email)} — conversation participant</option>`).join('');
    dialog('Compose message', `<p class="muted">Message a salon owner or someone in your existing conversations.</p><form id="message-form"><label>Recipient<select name="recipient" aria-label="Recipient" required><option value="">Choose a recipient</option>${options}</select></label>${field('subject', 'Subject', '', 'text', 'maxlength="120"')}<label>Message<textarea name="body" required maxlength="4000"></textarea></label><button class="primary" type="submit">Send message</button></form>`);
    $('message-form').onsubmit = event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), recipient = form.get('recipient');
      const data = { body: form.get('body').trim(), subject: form.get('subject').trim(), [recipient.startsWith('s:') ? 'salonId' : 'recipientId']: recipient.slice(2) };
      perform(() => send('/api/v1/messages', 'POST', data), 'Message sent.');
    };
  }
  document.addEventListener('click', async event => {
    if (mutation && event.target.closest('nav a')) { event.preventDefault(); return; }
    const target = event.target.closest('[data-action]'); if (!target || mutation || !user) return;
    const { action, key } = target.dataset;
    const salon = snapshot.salons?.find(s => s.id === key), offer = snapshot.offers?.find(o => o.id === key);
    try {
      if (action === 'create-salon') salonEditor();
      if (action === 'create-women-salon') { const s = {}; s.isWomenOnly = true; salonEditor(s); }
      if (action === 'edit-salon') salonEditor(salon);
      if (action === 'toggle-salon') perform(() => send(`/api/v1/salons/${id(salon.id)}`, 'PATCH', { isActive: !salon.isActive }), 'Salon status saved.');
      if (action === 'verify-salon') perform(() => send(`/api/v1/admin/salons/${id(key)}/verify`, 'PATCH'), 'Salon verified.');
      if (action === 'delete-salon') deleteSalon(salon);
      if (action === 'compose') await compose();
      if (action === 'create-offer') await offerEditor({}, 'REGULAR');
      if (action === 'create-flash-deal') await offerEditor({}, 'FLASH_DEAL');
      if (action === 'edit-offer') await offerEditor(offer, offer?.type || 'REGULAR');
      if (action === 'toggle-offer') perform(async () => { const current = await fullOffer(offer); return send(`/api/v1/salons/${id(offer.salonId)}/offers/${id(offer.id)}`, 'PATCH', { ...offerPayload(current), isActive: !current.isActive }); }, 'Offer status saved.');
      if (action === 'delete-offer') { dialog('Delete offer', `<p>Delete "${esc(offer.title)}"?</p>${button('Confirm delete', 'confirm-offer', offer.id, 'danger')}`); }
      if (action === 'confirm-offer') perform(() => send(`/api/v1/salons/${id(offer.salonId)}/offers/${id(offer.id)}`, 'DELETE'), 'Offer deleted.');
      if (action === 'loyalty') { const card = snapshot.loyalty.cards.find(c => c.id === key); dialog(card.rewardTitle || 'Loyalty customers', `<p class="muted">${esc(card.rewardText)} · ${esc(card.requiredStamps)} stamps required</p>${table(['Customer', 'Stamps', 'Last stamp', 'Reward'], (card.customers || []).map(c => [esc(c.customer?.fullName || c.customerId), esc(c.currentStamps), esc(date(c.lastStampedAt)), c.rewardReady ? 'Ready' : 'In progress']))}`); }
      if (action === 'save-settings') {
        const form = $('content').querySelector('#settings-form');
        if (!form) return;
        const payload = {
          siteName: form.querySelector('[name=siteName]').value.trim(),
          supportEmail: form.querySelector('[name=supportEmail]').value.trim(),
          defaultLocale: form.querySelector('[name=defaultLocale]').value,
          customerRegistrationEnabled: form.querySelector('[name=customerRegistrationEnabled]').checked,
          salonApplicationsEnabled: form.querySelector('[name=salonApplicationsEnabled]').checked,
          bookingGloballyEnabled: form.querySelector('[name=bookingGloballyEnabled]').checked,
          walkInGloballyEnabled: form.querySelector('[name=walkInGloballyEnabled]').checked,
          saloTicketGloballyEnabled: form.querySelector('[name=saloTicketGloballyEnabled]').checked,
          staffStatusLiveEnabled: form.querySelector('[name=staffStatusLiveEnabled]').checked,
        };
        if (!payload.siteName) { notice('Site name is required.', true); return; }
        perform(() => send('/api/v1/admin/platform-settings', 'PATCH', payload), 'Platform settings saved.');
      }
      if (action === 'save-legal') { const form = $('content').querySelector('.legal-editors'); const data = { impressum: form.querySelector('[name=impressum]').value, datenschutz: form.querySelector('[name=datenschutz]').value, agb: form.querySelector('[name=agb]').value }; for (const field of ['imprintOwnerName', 'imprintCompanyName', 'imprintStreet', 'imprintCity', 'imprintCountry', 'imprintEmail', 'imprintPhone', 'imprintRepresentative', 'imprintRegister']) { const el = form.querySelector(`[name=${field}]`); if (el) data[field] = el.value; } perform(() => send('/api/v1/admin/legal', 'PATCH', data), 'Legal content saved.'); }
      if (action === 'approve-partner') {
        const request = (snapshot.requests || []).find(r => r.id === key);
        await perform(() => send(`/api/v1/admin/partner-requests/${id(key)}`, 'PATCH', { status: 'APPROVED' }), 'Partner request approved.');
        if (request && user) openProvisionFromApplication(request);
      }
      if (action === 'provision-partner') {
        const request = (snapshot.requests || []).find(r => r.id === key);
        if (request) openProvisionFromApplication(request);
      }
      if (action === 'reject-partner') { dialog('Reject partner request', `<form id="reject-form">${field('rejectReason', 'Reason (optional)', '', 'text', 'maxlength="500"')}<button type="submit" class="danger primary">Reject</button></form>`); $('reject-form').onsubmit = event => { event.preventDefault(); perform(() => send(`/api/v1/admin/partner-requests/${id(key)}`, 'PATCH', { status: 'REJECTED', rejectReason: new FormData(event.currentTarget).get('rejectReason') }), 'Partner request rejected.'); }; }
      if (action === 'create-global-offer') { dialog('Create global offer', `<form id="global-offer-form">${field('title', 'Title', '', 'text', 'required maxlength="120"')}${field('description', 'Description', '', 'text', 'maxlength="500"')}${field('priceText', 'Price text', '', 'text', 'maxlength="60"')}${check('isActive', 'Active', true)}<button class="primary" type="submit">Create</button></form>`); $('global-offer-form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.currentTarget); perform(() => send('/api/v1/admin/global-offers', 'POST', { title: form.get('title'), description: form.get('description'), priceText: form.get('priceText'), isActive: form.has('isActive') }), 'Global offer created.'); }; }
      if (action === 'edit-global-offer') { const o = offer; dialog('Edit global offer', `<form id="global-offer-form">${field('title', 'Title', o.title, 'text', 'required maxlength="120"')}${field('description', 'Description', o.description, 'text', 'maxlength="500"')}${field('priceText', 'Price text', o.priceText, 'text', 'maxlength="60"')}${check('isActive', 'Active', o.isActive)}<button class="primary" type="submit">Save</button></form>`); $('global-offer-form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.currentTarget); perform(() => send(`/api/v1/admin/global-offers/${id(o.id)}`, 'PATCH', { title: form.get('title'), description: form.get('description'), priceText: form.get('priceText'), isActive: form.has('isActive') }), 'Global offer saved.'); }; }
      if (action === 'toggle-global-offer') perform(() => send(`/api/v1/admin/global-offers/${id(key)}`, 'PATCH', { isActive: !offer.isActive }), 'Global offer status saved.');
      if (action === 'delete-global-offer') { dialog('Delete global offer', `<p>Delete "${esc(offer.title)}"?</p>${button('Confirm delete', 'confirm-delete-global-offer', offer.id, 'danger')}`); }
      if (action === 'confirm-delete-global-offer') perform(() => send(`/api/v1/admin/global-offers/${id(key)}`, 'DELETE'), 'Global offer deleted.');
      if (action === 'booking') {
        const booking = snapshot.bookings.find(b => b.id === key);
        dialog('Update booking status', `<p>${esc(booking.user?.fullName)} · ${esc(booking.salon?.name)}</p><form id="booking-form"><label>Status<select name="status">${['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].map(s => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select></label><button class="primary" type="submit">Save status</button></form>`);
        $('booking-form').onsubmit = event => { event.preventDefault(); perform(() => send(`/api/v1/bookings/${id(key)}`, 'PATCH', Object.fromEntries(new FormData(event.currentTarget))), 'Booking status saved.'); };
      }
      if (action === 'nav-partners') { location.hash = '#partners'; }
      if (action === 'nav-promotions') { location.hash = '#promotions'; }
      if (action === 'nav-bookings') { location.hash = '#bookings'; }
      if (action === 'nav-messages') { location.hash = '#messages'; }
      if (action === 'create-product') {
        dialog('Create product', `<form id="product-form">${field('name', 'Product name', '', 'text', 'required maxlength="120"')}${field('description', 'Description', '', 'text', 'maxlength="500"')}${field('brand', 'Brand', '', 'text', 'maxlength="120"')}${field('retailPrice', 'Retail price', '', 'number', 'required min="0" step="0.01"')}${field('wholesalePrice', 'Wholesale price', '', 'number', 'min="0" step="0.01"')}${check('isPublished', 'Published', true)}<button class="primary" type="submit">Create product</button></form>`);
        $('product-form').onsubmit = event => { event.preventDefault(); const f = new FormData(event.currentTarget); perform(() => send('/api/v1/admin/products', 'POST', { name: f.get('name'), description: f.get('description'), brand: f.get('brand'), retailPrice: Number(f.get('retailPrice')), wholesalePrice: f.get('wholesalePrice') ? Number(f.get('wholesalePrice')) : undefined, isPublished: f.has('isPublished') }), 'Product created.'); };
      }
      if (action === 'edit-product') {
        const product = (snapshot.products || []).find(p => p.id === key);
        if (!product) return;
        dialog('Edit product', `<form id="product-form">${field('name', 'Product name', product.name, 'text', 'required maxlength="120"')}${field('description', 'Description', product.description || '', 'text', 'maxlength="500"')}${field('brand', 'Brand', product.brand?.name || '', 'text', 'maxlength="120"')}${field('retailPrice', 'Retail price', product.retailPrice ?? '', 'number', 'required min="0" step="0.01"')}${field('wholesalePrice', 'Wholesale price', product.wholesalePrice ?? '', 'number', 'min="0" step="0.01"')}${check('isPublished', 'Published', product.isPublished)}<button class="primary" type="submit">Save changes</button></form>`);
        $('product-form').onsubmit = event => { event.preventDefault(); const f = new FormData(event.currentTarget); perform(() => send(`/api/v1/admin/products/${id(key)}`, 'PATCH', { name: f.get('name'), description: f.get('description'), brand: f.get('brand'), retailPrice: Number(f.get('retailPrice')), wholesalePrice: f.get('wholesalePrice') ? Number(f.get('wholesalePrice')) : undefined, isPublished: f.has('isPublished') }), 'Product saved.'); };
      }
      if (action === 'toggle-product') {
        const product = (snapshot.products || []).find(p => p.id === key);
        if (product) perform(() => send(`/api/v1/admin/products/${id(key)}`, 'PATCH', { isPublished: !product.isPublished }), `Product ${product.isPublished ? 'unpublished' : 'published'}.`);
      }
      if (action === 'delete-product') {
        const product = (snapshot.products || []).find(p => p.id === key);
        if (!product) return;
        dialog('Delete product', `<p>Delete "<strong>${esc(product.name)}</strong>"?</p><button type="button" class="danger primary" data-action="confirm-delete-product" data-key="${esc(key)}">Delete permanently</button>`);
      }
      if (action === 'confirm-delete-product') perform(() => send(`/api/v1/admin/products/${id(key)}`, 'DELETE'), 'Product deleted.');
      if (action === 'create-service') { serviceEditor(key); }
      if (action === 'edit-service') { const [sId, svcId] = key.split(':'); const svc = salonServices.find(s => s.id === svcId); if (svc) serviceEditor(sId, svc); }
      if (action === 'toggle-service') { const [sId, svcId] = key.split(':'); const svc = salonServices.find(s => s.id === svcId); if (svc) perform(() => send(`/api/v1/salons/${id(sId)}/services/${id(svcId)}`, 'PATCH', { isActive: svc.isActive === false }), `Service ${svc.isActive !== false ? 'deactivated' : 'activated'}.`); }
      if (action === 'delete-service') { const [sId, svcId] = key.split(':'); const svc = salonServices.find(s => s.id === svcId); if (svc) { dialog('Delete service', `<p>Delete "<strong>${esc(svc.name)}</strong>"?</p><button type="button" class="danger primary" data-action="confirm-delete-service" data-key="${esc(key)}">Delete permanently</button>`); } }
      if (action === 'confirm-delete-service') { const [sId, svcId] = key.split(':'); perform(() => send(`/api/v1/salons/${id(sId)}/services/${id(svcId)}`, 'DELETE'), 'Service deleted.'); }
    } catch (error) { notice(error.message, true); }
  });
  (async () => {
    try { auth = JSON.parse(localStorage.getItem('meshwarApiAuth') || 'null'); } catch { auth = null; }
    if (!auth?.accessToken) return;
    const submit = $('login-form').querySelector('button'); submit.disabled = true;
    $('login-status').textContent = 'Checking your account…';
    const current = version;
    try { const result = await request('/api/v1/auth/me'); if (current === version) await enter(result.user); }
    catch (error) { auth = null; $('login-status').textContent = error.message; }
    finally { submit.disabled = false; }
  })();
})();
