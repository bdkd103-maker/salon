/* Header presentation only: existing page handlers own auth and navigation. */
(() => {
  const header = document.querySelector('.salo-header');
  if (!header) return;
  const isWomen = header.dataset.saloExperience === 'women';
  const menu = header.querySelector('#mobileNav');
  const toggle = header.querySelector('#mobileMenu');
  const paths = {
    account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    message: '<path d="M21 11a9 9 0 0 1-9 9H3l2-4a9 9 0 1 1 16-5Z"/><path d="M8 10h8M8 14h5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    logout: '<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-header-svg="${name}">${paths[name]}</svg>`;
  const copy = {
    de: { home: 'SALO Startseite', experience: 'Salon-Erlebnis', women: 'Damen', men: 'Herren', discover: 'Entdecken', language: 'Sprache', menu: 'Weitere Navigation', close: 'Navigation schließen', account: 'Mein Konto', login: 'Anmelden', register: 'Registrieren', bell: 'Benachrichtigungen', message: 'Nachrichten' },
    en: { home: 'SALO home', experience: 'Salon experience', women: 'Women', men: 'Men', discover: 'Discover', language: 'Language', menu: 'More navigation', close: 'Close navigation', account: 'My account', login: 'Log in', register: 'Register', bell: 'Notifications', message: 'Messages' },
    ar: { home: 'الصفحة الرئيسية SALO', experience: 'تجربة الصالون', women: 'نساء', men: 'رجال', discover: 'اكتشف', language: 'اللغة', menu: 'المزيد من خيارات التنقل', close: 'إغلاق التنقل', account: 'حسابي', login: 'تسجيل الدخول', register: 'إنشاء حساب', bell: 'الإشعارات', message: 'الرسائل' },
  };
  function setIcon(button, name) {
    if (!button || button.querySelector(`[data-header-svg="${name}"]`)) return;
    button.querySelectorAll('i, svg, [data-salo-icon]').forEach(icon => icon.remove());
    button.insertAdjacentHTML('afterbegin', svg(name));
  }
  function sync() {
    const text = copy[document.documentElement.lang] || copy.de;
    header.querySelectorAll('[data-salo-text]').forEach(el => {
      const value = text[el.dataset.saloText];
      if (value && el.textContent !== value) el.textContent = value;
    });
    header.querySelectorAll('[data-salo-label]').forEach(el => el.setAttribute('aria-label', text[el.dataset.saloLabel]));
    header.querySelector('#languageSelect').setAttribute('aria-label', text.language);
    const account = header.querySelector(isWomen ? '#headerProfileButton' : '#portalOpen');
    if (isWomen) {
      const signedIn = typeof hasStoredCustomerAuth === 'function' && hasStoredCustomerAuth();
      const label = signedIn ? text.account : text.login;
      const span = account.querySelector('span');
      if (span && span.textContent !== label) span.textContent = label;
      account.setAttribute('aria-label', label);
      header.querySelector('[data-salo-register]').hidden = signedIn;
    } else {
      account.setAttribute('aria-label', account.textContent.trim() || text.account);
    }
    setIcon(account, 'account');
    for (const [id, name] of [['headerNotificationsButton', 'bell'], ['messageInboxButton', 'message'], ['customerLogoutHeader', 'logout'], ['adminOpen', 'account']]) {
      const button = header.querySelector('#' + id);
      setIcon(button, name);
      if (button && text[name]) button.setAttribute('aria-label', text[name]);
    }
    const expanded = menu.classList.contains('show');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? text.close : text.menu);
    setIcon(toggle, expanded ? 'close' : 'menu');
  }
  function closeMenu(returnFocus = false) {
    menu.classList.remove('show');
    sync();
    if (returnFocus) toggle.focus();
  }
  if (isWomen) toggle.addEventListener('click', () => { menu.classList.toggle('show'); sync(); });
  header.querySelector('[data-salo-register]')?.addEventListener('click', () => document.getElementById('customerOpenRegisterFromLogin')?.click());
  header.querySelector('[data-salo-account]')?.addEventListener('click', () => document.getElementById('headerProfileButton')?.click());
  header.querySelectorAll('[data-salo-mode]').forEach(link => link.addEventListener('click', () => {
    const mode = link.dataset.saloMode;
    localStorage.setItem('meshwarSelectedExperience', mode);
    localStorage.setItem('meshwarCustomerLastPage', mode === 'women' ? './women.html' : './index.html');
  }));
  menu.addEventListener('click', event => { if (event.target.closest('a, button')) closeMenu(); });
  document.addEventListener('click', event => { if (!event.composedPath().includes(header)) closeMenu(); });
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('show')) { event.preventDefault(); closeMenu(true); }
  });
  header.addEventListener('focusout', event => { if (event.relatedTarget && !header.contains(event.relatedTarget)) closeMenu(); });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  new MutationObserver(sync).observe(header, { childList: true, subtree: true });
  // Existing auth dialogs change visibility after login/logout; refresh labels only.
  const modalObserver = new MutationObserver(sync);
  document.querySelectorAll('#customerLoginModal, #customerRegisterModal, #customerProfileModal').forEach(modal => modalObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] }));
  window.addEventListener('storage', sync);
  window.addEventListener('pageshow', sync);
  sync();
})();
