(() => {
  const list = document.getElementById('meetings-list');
  if (!list) return;

  const emptyState = document.getElementById('meetings-empty');
  const errorState = document.getElementById('meetings-error');
  const updatedBadge = document.getElementById('meetings-updated');
  const filters = Array.from(document.querySelectorAll('[data-meeting-filter]'));
  const calendarFallbackUrl = 'https://calendar.yandex.kz/embed/month?layer_ids=36506515&tz_id=Europe/Moscow&layer_names=ABA_pro%20%D0%9E%D0%B1%D1%83%D1%87%D0%B0%D1%8E%D1%89%D0%B8%D0%B5%20%D0%B2%D1%81%D1%82%D1%80%D0%B5%D1%87%D0%B8';

  let events = [];
  let activeFilter = 'all';

  function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTime(start, end, allDay = false) {
    if (allDay) return 'В течение дня';
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    const startText = formatter.format(start);
    if (!end) return startText;
    return `${startText}–${formatter.format(end)}`;
  }

  function formatWeekday(date) {
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      timeZone: 'Europe/Moscow'
    }).format(date);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  }

  function appendMeta(container, value) {
    if (!value) return;
    container.appendChild(createElement('span', '', value));
  }

  function eventMatches(event, filter) {
    if (filter === 'all') return true;
    if (filter === 'parents') return event.audienceKey === 'parents' || event.audienceKey === 'all';
    if (filter === 'specialists') return event.audienceKey === 'specialists' || event.audienceKey === 'all';
    if (filter === 'online') return event.formatKey === 'online';
    if (filter === 'offline') return event.formatKey === 'offline';
    return true;
  }

  function createCard(event, index) {
    const start = safeDate(event.start);
    if (!start) return null;
    const end = safeDate(event.end);

    const article = createElement('article', `meeting-event-card${index === 0 ? ' is-featured' : ''}`);

    const dateRow = createElement('div', 'meeting-date-row');
    const dateBlock = createElement('div', 'meeting-date-block');
    const dateParts = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      timeZone: 'Europe/Moscow'
    }).formatToParts(start);
    const dayText = dateParts.find((part) => part.type === 'day')?.value || '';
    const monthText = (dateParts.find((part) => part.type === 'month')?.value || '').replace('.', '');
    dateBlock.appendChild(createElement('span', 'meeting-date-day', dayText));
    dateBlock.appendChild(createElement('span', 'meeting-date-month', monthText));

    const dateInfo = createElement('div', 'meeting-date-info');
    dateInfo.appendChild(createElement('span', 'meeting-date-weekday', formatWeekday(start)));
    const timeText = formatTime(start, end, Boolean(event.allDay));
    dateInfo.appendChild(createElement('span', 'meeting-time', event.allDay ? timeText : `${timeText} по Москве`));
    dateRow.append(dateBlock, dateInfo);

    const content = createElement('div', 'meeting-card-content');
    if (event.audience) content.appendChild(createElement('p', 'meeting-category', event.audience));
    content.appendChild(createElement('h3', '', event.title || 'Обучающая встреча ABA_pro'));
    if (event.description) content.appendChild(createElement('p', 'meeting-description', event.description));

    const meta = createElement('div', 'meeting-meta');
    appendMeta(meta, event.format);
    appendMeta(meta, event.duration);
    appendMeta(meta, event.price);
    appendMeta(meta, event.location);
    if (meta.children.length) content.appendChild(meta);

    const actions = createElement('div', 'meeting-card-actions');
    const register = createElement('a', 'btn btn-primary', 'Записаться');
    register.href = event.registrationUrl || 'https://web.max.ru/53081620';
    if (event.registrationUrl && /^https?:\/\//i.test(event.registrationUrl)) {
      register.target = '_blank';
      register.rel = 'noopener noreferrer';
    }
    actions.appendChild(register);

    const details = createElement('a', 'btn btn-secondary', 'Подробнее');
    details.href = event.detailsUrl || calendarFallbackUrl;
    details.target = '_blank';
    details.rel = 'noopener noreferrer';
    actions.appendChild(details);

    content.appendChild(actions);
    article.append(dateRow, content);
    return article;
  }

  function render() {
    const filtered = events.filter((event) => eventMatches(event, activeFilter));
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    errorState.hidden = true;

    if (!filtered.length) {
      emptyState.hidden = false;
      list.hidden = true;
      return;
    }

    emptyState.hidden = true;
    list.hidden = false;
    filtered.forEach((event, index) => {
      const card = createCard(event, index);
      if (card) list.appendChild(card);
    });
  }

  filters.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.meetingFilter || 'all';
      filters.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      render();
    });
  });

  fetch(`data/meetings.json?v=${Date.now()}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (updatedBadge && data.updatedAt) {
        const updatedAt = safeDate(data.updatedAt);
        if (updatedAt) {
          const formatted = new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Moscow'
          }).format(updatedAt);
          updatedBadge.textContent = `Обновлено ${formatted} по Москве`;
        }
      }
      const now = new Date();
      events = Array.isArray(data.events)
        ? data.events
            .filter((event) => {
              const end = safeDate(event.end) || safeDate(event.start);
              return end && end.getTime() >= now.getTime() - 60 * 60 * 1000;
            })
            .sort((a, b) => safeDate(a.start) - safeDate(b.start))
        : [];
      render();
    })
    .catch((error) => {
      console.error('Не удалось загрузить встречи:', error);
      list.replaceChildren();
      list.hidden = true;
      emptyState.hidden = true;
      errorState.hidden = false;
      list.setAttribute('aria-busy', 'false');
    });
})();
