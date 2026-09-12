(function () {
  const fields = ['bookingIntakeEnabled', 'saloTicketIntakeEnabled', 'walkInIntakeEnabled'];
  const translations = {
    de: {
      title: 'Annahmekanäle', labels: ['Bookings / Termine', 'SALO Ticket', 'Walk-in'],
      note: 'Ausschalten stoppt nur neue Annahmen. Bestehende Buchungen, Tickets und laufende Behandlungen bleiben bestehen.',
      walkIn: 'Walk-in: Diese Einstellung wird gespeichert. Eine manuelle Walk-in-Annahme ist noch nicht verfügbar.',
      on: 'Ein', off: 'Aus', unknown: 'Noch nicht geladen', loading: 'Wird geladen …', saving: 'Wird gespeichert …',
      saved: 'Gespeichert.', loadError: 'Die Annahmekanäle konnten nicht geladen werden.',
      saveError: 'Die Änderung wurde nicht gespeichert. Bitte erneut versuchen.', retry: 'Erneut versuchen',
    },
    en: {
      title: 'Intake controls', labels: ['Bookings / Appointments', 'SALO Ticket', 'Walk-in'],
      note: 'Turning a channel off stops new intake only. Existing bookings, tickets and ongoing services continue.',
      walkIn: 'Walk-in: This setting is saved. Manual walk-in intake is not available yet.',
      on: 'On', off: 'Off', unknown: 'Not loaded', loading: 'Loading …', saving: 'Saving …',
      saved: 'Saved.', loadError: 'Intake controls could not be loaded.',
      saveError: 'The change was not saved. Please try again.', retry: 'Try again',
    },
    ar: {
      title: 'قنوات استقبال العملاء', labels: ['الحجوزات / المواعيد', 'SALO Ticket', 'Walk-in'],
      note: 'الإيقاف يمنع الاستقبال الجديد فقط. تبقى الحجوزات والتذاكر والخدمات الجارية كما هي.',
      walkIn: 'Walk-in: يتم حفظ هذا الإعداد. الاستقبال اليدوي دون موعد غير متاح بعد.',
      on: 'مفعّل', off: 'متوقف', unknown: 'لم يتم التحميل', loading: 'جارٍ التحميل …', saving: 'جارٍ الحفظ …',
      saved: 'تم الحفظ.', loadError: 'تعذر تحميل إعدادات الاستقبال.',
      saveError: 'لم يتم حفظ التغيير. يرجى المحاولة مجدداً.', retry: 'إعادة المحاولة',
    },
  };

  window.createSalonIntakeControls = function (root, { request, language, isCurrent }) {
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
    const buttons = fields.map(field => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.dataset.intakeField = field;
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-describedby', note.id);
      button.addEventListener('click', () => save(field));
      rows.append(button);
      return button;
    });
    const walkIn = document.createElement('p');
    walkIn.className = 'admin-note';
    const status = document.createElement('p');
    status.className = 'admin-note';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.addEventListener('click', () => load(salonId));
    root.replaceChildren(heading, note, rows, walkIn, status, retry);

    function render() {
      const text = translations[language()] || translations.en;
      root.hidden = !salonId;
      root.setAttribute('aria-busy', String(busy));
      heading.textContent = text.title;
      note.textContent = text.note;
      walkIn.textContent = text.walkIn;
      buttons.forEach((button, index) => {
        const value = confirmed?.[fields[index]];
        button.disabled = busy || !confirmed || !isCurrent(salonId);
        button.setAttribute('aria-label', text.labels[index]);
        if (typeof value === 'boolean') button.setAttribute('aria-checked', String(value));
        else button.removeAttribute('aria-checked');
        button.textContent = `${text.labels[index]}: ${value === undefined ? text.unknown : value ? text.on : text.off}`;
        button.classList.toggle('btn-gold', value === true);
      });
      status.textContent = text[message] || '';
      retry.textContent = text.retry;
      retry.hidden = message !== 'loadError';
      retry.disabled = busy;
    }

    function readResponse(response) {
      const controls = response?.intakeControls;
      if (!controls || !fields.every(field => typeof controls[field] === 'boolean')) {
        throw new Error('Invalid intake controls response');
      }
      return Object.fromEntries(fields.map(field => [field, controls[field]]));
    }

    async function load(id) {
      const currentVersion = ++version;
      salonId = id;
      confirmed = null;
      busy = Boolean(id);
      message = id ? 'loading' : '';
      render();
      if (!id) return;
      try {
        const response = await request(`/api/v1/salons/${encodeURIComponent(id)}/intake-controls`);
        if (version !== currentVersion || !isCurrent(id)) return;
        confirmed = readResponse(response);
        message = '';
      } catch {
        if (version !== currentVersion || !isCurrent(id)) return;
        message = 'loadError';
      } finally {
        if (version === currentVersion) { busy = false; render(); }
      }
    }

    async function save(field) {
      if (busy || !confirmed || !isCurrent(salonId)) return;
      const currentVersion = version;
      const id = salonId;
      busy = true;
      message = 'saving';
      render();
      try {
        const response = await request(`/api/v1/salons/${encodeURIComponent(id)}/intake-controls`, {
          method: 'PATCH', body: JSON.stringify({ [field]: !confirmed[field] }),
        });
        if (version !== currentVersion || !isCurrent(id)) return;
        confirmed = readResponse(response);
        message = 'saved';
      } catch {
        if (version !== currentVersion || !isCurrent(id)) return;
        message = 'saveError';
      } finally {
        if (version === currentVersion) { busy = false; render(); }
      }
    }
    render();
    return { load, render };
  };
})();
