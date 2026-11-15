(function () {
  const catalog = ['coffee', 'otherDrinks', 'wifi', 'parking', 'cashPayment', 'cardPayment', 'applePay', 'googlePay', 'wheelchairAccess'];
  const translations = {
    de: {
      title: 'Extras & Annehmlichkeiten',
      note: 'Aktivieren Sie nur Extras, die in diesem Salon wirklich vorhanden sind. Sie werden im öffentlichen Salonprofil angezeigt.',
      labels: ['Kaffee', 'Getränke', 'WLAN', 'Parkplatz', 'Barzahlung', 'Kartenzahlung', 'Apple Pay', 'Google Pay', 'Rollstuhlgerecht'],
      on: 'Ein', off: 'Aus', unknown: 'Noch nicht geladen', loading: 'Wird geladen …', saving: 'Wird gespeichert …',
      saved: 'Gespeichert.', loadError: 'Die Extras konnten nicht geladen werden.',
      saveError: 'Die Änderung wurde nicht gespeichert. Bitte erneut versuchen.', retry: 'Erneut versuchen',
    },
    en: {
      title: 'Extras & amenities',
      note: 'Only enable extras that are genuinely available at this salon. They appear in the public salon profile.',
      labels: ['Coffee', 'Drinks', 'Wi-Fi', 'Parking', 'Cash payment', 'Card payment', 'Apple Pay', 'Google Pay', 'Wheelchair access'],
      on: 'On', off: 'Off', unknown: 'Not loaded', loading: 'Loading …', saving: 'Saving …',
      saved: 'Saved.', loadError: 'Extras could not be loaded.',
      saveError: 'The change was not saved. Please try again.', retry: 'Try again',
    },
    ar: {
      title: 'إضافات ومرافق',
      note: 'فعّل الإضافات المتوفرة فعلياً في هذا الصالون فقط. تظهر هذه الإضافات في ملف الصالون العام.',
      labels: ['قهوة', 'مشروبات', 'واي فاي', 'موقف سيارات', 'دفع نقداً', 'دفع بالبطاقة', 'أبل باي', 'جوجل باي', 'مخصص لمستخدمي الكرسي المتحرك'],
      on: 'مفعّل', off: 'متوقف', unknown: 'لم يتم التحميل', loading: 'جارٍ التحميل …', saving: 'جارٍ الحفظ …',
      saved: 'تم الحفظ.', loadError: 'تعذر تحميل الإضافات.',
      saveError: 'لم يتم حفظ التغيير. يرجى المحاولة مجدداً.', retry: 'إعادة المحاولة',
    },
  };

  window.SALON_EXTRAS_CATALOG = catalog.slice();

  window.createSalonExtras = function (root, { request, language, isCurrent, copy }) {
    let salonId = null;
    let version = 0;
    let confirmed = null;
    let busy = false;
    let message = '';
    const heading = document.createElement('h3');
    const note = document.createElement('p');
    note.className = 'admin-note';
    note.id = `${root.id}-description`;
    const rows = document.createElement('div');
    rows.className = 'form-grid';
    const buttons = catalog.map((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.dataset.extraKey = key;
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-describedby', note.id);
      button.addEventListener('click', () => save(key));
      rows.append(button);
      return button;
    });
    const status = document.createElement('p');
    status.className = 'admin-note';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.addEventListener('click', () => load(salonId));
    root.replaceChildren(heading, note, rows, status, retry);

    function render() {
      const baseText = translations[language()] || translations.en;
      const text = copy ? Object.fromEntries(Object.keys(baseText).map(key => [key, key === 'labels' ? catalog.map((_, index) => copy('label' + index)) : copy(key)])) : baseText;
      root.hidden = !salonId;
      root.setAttribute('aria-busy', String(busy));
      heading.textContent = text.title;
      note.textContent = text.note;
      buttons.forEach((button, index) => {
        const active = confirmed ? confirmed.includes(catalog[index]) : null;
        button.disabled = busy || !confirmed || !isCurrent(salonId);
        button.setAttribute('aria-label', text.labels[index]);
        if (active !== null) button.setAttribute('aria-checked', String(active));
        else button.removeAttribute('aria-checked');
        button.textContent = `${text.labels[index]}: ${active === null ? text.unknown : active ? text.on : text.off}`;
        button.classList.toggle('btn-gold', active === true);
      });
      status.textContent = text[message] || '';
      retry.textContent = text.retry;
      retry.hidden = message !== 'loadError';
      retry.disabled = busy;
    }

    function readResponse(response) {
      const extras = response?.extras;
      if (!Array.isArray(extras) || !extras.every(key => catalog.includes(key))) {
        throw new Error('Invalid salon extras response');
      }
      return catalog.filter(key => extras.includes(key));
    }

    async function load(id) {
      // A save holds `busy` for its whole lifetime, so a background refresh that
      // lands mid-toggle must not wipe the just-confirmed state or re-disable
      // the buttons (that left the next toggle unable to dispatch).
      if (busy && confirmed) return;
      const currentVersion = ++version;
      salonId = id;
      confirmed = null;
      busy = Boolean(id);
      message = id ? 'loading' : '';
      render();
      if (!id) return;
      try {
        const response = await request(`/api/v1/salons/${encodeURIComponent(id)}/extras`);
        if (version !== currentVersion || !isCurrent(id)) return;
        confirmed = readResponse(response);
        message = '';
      } catch {
        if (version !== currentVersion || !isCurrent(id)) return;
        message = 'loadError';
      } finally {
        // Clear busy only if this load still owns the widget, so a background
        // openOwnerPanel refresh cannot re-disable an in-progress toggle.
        if (version === currentVersion && busy) { busy = false; render(); }
      }
    }

    async function save(key) {
      if (busy || !confirmed || !isCurrent(salonId)) return;
      const currentVersion = version;
      const id = salonId;
      const requested = confirmed.includes(key)
        ? confirmed.filter(value => value !== key)
        : catalog.filter(value => confirmed.includes(value) || value === key);
      busy = true;
      message = 'saving';
      render();
      try {
        // The PATCH response is authoritative, so recompute nothing locally.
        const response = await request(`/api/v1/salons/${encodeURIComponent(id)}/extras`, {
          method: 'PATCH', body: JSON.stringify({ extras: requested }),
        });
        if (version !== currentVersion || !isCurrent(id)) return;
        confirmed = readResponse(response);
        message = 'saved';
        render();
      } catch {
        if (version !== currentVersion || !isCurrent(id)) return;
        message = 'saveError';
      } finally {
        if (version === currentVersion && busy) { busy = false; render(); }
      }
    }
    render();
    return { load, render };
  };
})();
