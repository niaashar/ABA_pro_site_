(() => {
  const list = document.getElementById('meetings-list');
  if (!list) return;

  const carousel = document.getElementById('meetings-carousel');
  const prevButton = document.getElementById('meetings-prev');
  const nextButton = document.getElementById('meetings-next');
  const dots = document.getElementById('meetings-dots');
  const emptyState = document.getElementById('meetings-empty');
  const errorState = document.getElementById('meetings-error');
  const updatedBadge = document.getElementById('meetings-updated');
  const filters = Array.from(document.querySelectorAll('[data-meeting-filter]'));
  const fullCalendar = document.querySelector('.full-calendar-details');
  const calendarFrame = document.querySelector('.yandex-calendar-frame');
  const calendarFallbackUrl = 'https://calendar.yandex.ru/embed/month?layer_ids=36506515&tz_id=Europe/Moscow&layer_names=ABA_pro%20%D0%9E%D0%B1%D1%83%D1%87%D0%B0%D1%8E%D1%89%D0%B8%D0%B5%20%D0%B2%D1%81%D1%82%D1%80%D0%B5%D1%87%D0%B8';

  let events = [];
  let activeFilter = 'all';
  let activeSlide = 0;
  let scrollFrame = 0;
  let resizeTimer = 0;

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

  function appendMeta(container, value, className = '') {
    if (!value) return;
    container.appendChild(createElement('span', className, value));
  }

  function eventMatches(event, filter) {
    if (filter === 'all') return true;
    if (filter === 'parents') return event.audienceKey === 'parents' || event.audienceKey === 'all';
    if (filter === 'specialists') return event.audienceKey === 'specialists' || event.audienceKey === 'all';
    if (filter === 'online') return event.formatKey === 'online';
    if (filter === 'offline') return event.formatKey === 'offline';
    return true;
  }

  function normalizeCalendarUrl(value) {
    if (!value) return calendarFallbackUrl;
    try {
      const url = new URL(value, window.location.href);
      if (url.hostname === 'calendar.yandex.kz') url.hostname = 'calendar.yandex.ru';
      return url.href;
    } catch (_) {
      return calendarFallbackUrl;
    }
  }

  function createDetails(event) {
    const hasDescription = Boolean(event.description);
    const hasExtraMeta = Boolean(event.duration || event.location);
    if (!hasDescription && !hasExtraMeta) return null;

    const details = createElement('details', 'meeting-card-details');
    const summary = createElement('summary', 'meeting-card-details-summary');
    summary.appendChild(createElement('span', '', 'Подробнее о встрече'));
    summary.appendChild(createElement('span', 'meeting-card-details-arrow', '⌄'));
    details.appendChild(summary);

    const body = createElement('div', 'meeting-card-details-body');
    if (event.description) body.appendChild(createElement('p', 'meeting-description', event.description));

    if (event.duration || event.location) {
      const extra = createElement('div', 'meeting-details-meta');
      if (event.duration) {
        const row = createElement('p', '');
        row.appendChild(createElement('strong', '', 'Продолжительность: '));
        row.appendChild(document.createTextNode(event.duration));
        extra.appendChild(row);
      }
      if (event.location) {
        const row = createElement('p', '');
        row.appendChild(createElement('strong', '', 'Место: '));
        row.appendChild(document.createTextNode(event.location));
        extra.appendChild(row);
      }
      body.appendChild(extra);
    }

    details.appendChild(body);
    return details;
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

    const meta = createElement('div', 'meeting-meta meeting-meta-primary');
    appendMeta(meta, event.format, 'meeting-format');
    appendMeta(meta, event.price, 'meeting-price');
    if (meta.children.length) content.appendChild(meta);

    const details = createDetails(event);
    if (details) content.appendChild(details);

    const actions = createElement('div', 'meeting-card-actions');
    const register = createElement('a', 'btn btn-primary', 'Записаться');
    register.href = event.registrationUrl || 'https://web.max.ru/53081620';
    if (/^https?:\/\//i.test(register.href)) {
      register.target = '_blank';
      register.rel = 'noopener noreferrer';
    }
    actions.appendChild(register);

    const calendarLink = createElement('a', 'btn btn-secondary', 'Посмотреть в календаре');
    calendarLink.href = calendarFallbackUrl;
    calendarLink.target = '_blank';
    calendarLink.rel = 'noopener noreferrer';
    actions.appendChild(calendarLink);

    content.appendChild(actions);
    article.append(dateRow, content);
    return article;
  }

  function visibleCardsCount() {
    if (window.matchMedia('(max-width: 680px)').matches) return 1;
    if (window.matchMedia('(max-width: 1040px)').matches) return 2;
    return 3;
  }

  function cards() {
    return Array.from(list.querySelectorAll('.meeting-event-card:not(.meeting-card-skeleton)'));
  }

  function maxSlideIndex() {
    return Math.max(0, cards().length - visibleCardsCount());
  }

  function cardStep() {
    const first = cards()[0];
    if (!first) return 0;
    const styles = window.getComputedStyle(list);
    const gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
    return first.getBoundingClientRect().width + gap;
  }

  function updateCarouselState() {
    const allCards = cards();
    const maxIndex = Math.max(0, allCards.length - visibleCardsCount());
    const step = cardStep();
    activeSlide = step ? Math.round(list.scrollLeft / step) : 0;
    activeSlide = Math.max(0, Math.min(activeSlide, maxIndex));

    if (prevButton) prevButton.disabled = activeSlide <= 0;
    if (nextButton) nextButton.disabled = activeSlide >= maxIndex;
    carousel?.classList.toggle('is-static', maxIndex === 0);

    if (dots) {
      Array.from(dots.children).forEach((dot, index) => {
        const active = index === activeSlide;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }
  }

  function rebuildDots() {
    if (!dots) return;
    dots.replaceChildren();
    const count = maxSlideIndex() + 1;
    for (let index = 0; index < count; index += 1) {
      const dot = createElement('button', 'meetings-carousel-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Показать встречи: позиция ${index + 1}`);
      dot.addEventListener('click', () => scrollToSlide(index));
      dots.appendChild(dot);
    }
    dots.hidden = cards().length === 0;
    updateCarouselState();
  }

  function scrollToSlide(index, behavior = 'smooth') {
    const maxIndex = maxSlideIndex();
    activeSlide = Math.max(0, Math.min(index, maxIndex));
    const step = cardStep();
    list.scrollTo({ left: activeSlide * step, behavior });
    window.setTimeout(updateCarouselState, behavior === 'smooth' ? 260 : 0);
  }

  function resetCarousel() {
    list.scrollLeft = 0;
    activeSlide = 0;
    window.requestAnimationFrame(() => {
      rebuildDots();
      updateCarouselState();
    });
  }

  function render() {
    const filtered = events.filter((event) => eventMatches(event, activeFilter));
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    errorState.hidden = true;

    if (!filtered.length) {
      emptyState.hidden = false;
      if (carousel) carousel.hidden = true;
      if (dots) dots.hidden = true;
      return;
    }

    emptyState.hidden = true;
    if (carousel) carousel.hidden = false;
    filtered.forEach((event, index) => {
      const card = createCard(event, index);
      if (card) list.appendChild(card);
    });
    resetCarousel();
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

  prevButton?.addEventListener('click', () => scrollToSlide(activeSlide - 1));
  nextButton?.addEventListener('click', () => scrollToSlide(activeSlide + 1));

  list.addEventListener('scroll', () => {
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = window.requestAnimationFrame(updateCarouselState);
  }, { passive: true });

  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      rebuildDots();
      scrollToSlide(Math.min(activeSlide, maxSlideIndex()), 'auto');
    }, 120);
  });

  fullCalendar?.addEventListener('toggle', () => {
    if (fullCalendar.open && calendarFrame && !calendarFrame.src) {
      calendarFrame.src = calendarFallbackUrl;
    }
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
      if (carousel) carousel.hidden = true;
      if (dots) dots.hidden = true;
      emptyState.hidden = true;
      errorState.hidden = false;
      list.setAttribute('aria-busy', 'false');
    });
})();
