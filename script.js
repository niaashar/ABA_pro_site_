document.addEventListener('DOMContentLoaded', () => {
  const burger = document.querySelector('.burger');
  const menu = document.querySelector('.menu');

  const closeMenu = () => {
    if (!burger || !menu) return;
    menu.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  };

  if (burger && menu) {
    burger.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });
    document.addEventListener('click', (event) => {
      if (!menu.classList.contains('open')) return;
      if (!menu.contains(event.target) && !burger.contains(event.target)) closeMenu();
    });
  }

  const revealElements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealElements.forEach((element) => io.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add('visible'));
  }

  const getVisibleCount = () => {
    if (window.innerWidth <= 680) return 1;
    if (window.innerWidth <= 980) return 2;
    return 3;
  };

  const setupCarousel = ({
    rootSelector,
    viewportSelector,
    trackSelector,
    slideSelector,
    prevSelector,
    nextSelector,
    dotsSelector,
    dotClass,
    dotLabel,
    activeSlides = false
  }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return null;

    const viewport = root.querySelector(viewportSelector);
    const track = root.querySelector(trackSelector);
    const slides = Array.from(root.querySelectorAll(slideSelector));
    const prev = root.querySelector(prevSelector);
    const next = root.querySelector(nextSelector);
    const dots = document.querySelector(dotsSelector);
    if (!viewport || !track || !slides.length || !dots) return null;

    const slideStep = () => {
      const first = slides[0];
      if (!first) return viewport.clientWidth;
      const styles = getComputedStyle(track);
      const gap = parseFloat(styles.columnGap || styles.gap || 0);
      return first.getBoundingClientRect().width + gap;
    };

    const pageStarts = () => {
      const count = getVisibleCount();
      const maxStart = Math.max(0, slides.length - count);
      const starts = [];
      for (let index = 0; index <= maxStart; index += count) starts.push(index);
      if (!starts.includes(maxStart)) starts.push(maxStart);
      return [...new Set(starts)];
    };

    const renderDots = (starts, activePage) => {
      if (dots.children.length !== starts.length) {
        dots.replaceChildren();
        starts.forEach((startIndex, pageIndex) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = dotClass;
          dot.setAttribute('aria-label', `${dotLabel} ${pageIndex + 1}`);
          dot.addEventListener('click', () => {
            viewport.scrollTo({ left: startIndex * slideStep(), behavior: 'smooth' });
          });
          dots.appendChild(dot);
        });
      }
      Array.from(dots.children).forEach((dot, index) => {
        const active = index === activePage;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-current', active ? 'true' : 'false');
      });
    };

    const update = () => {
      const count = getVisibleCount();
      const step = slideStep();
      const start = Math.min(
        Math.max(0, slides.length - count),
        Math.max(0, Math.round(viewport.scrollLeft / step))
      );
      const starts = pageStarts();
      let activePage = 0;
      let nearestDistance = Infinity;
      starts.forEach((pageStart, index) => {
        const distance = Math.abs(pageStart - start);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          activePage = index;
        }
      });

      if (activeSlides) {
        slides.forEach((slide, index) => {
          slide.classList.toggle('is-active', index >= start && index < start + count);
        });
      }
      renderDots(starts, activePage);
      if (prev) prev.disabled = viewport.scrollLeft <= 2;
      if (next) next.disabled = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2;
    };

    prev?.addEventListener('click', () => {
      viewport.scrollBy({ left: -slideStep(), behavior: 'smooth' });
    });
    next?.addEventListener('click', () => {
      viewport.scrollBy({ left: slideStep(), behavior: 'smooth' });
    });
    viewport.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    viewport.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prev?.click();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next?.click();
      }
    });
    window.addEventListener('resize', update);
    update();

    return { root, viewport, slides, update };
  };

  const reviews = setupCarousel({
    rootSelector: '[data-reviews-carousel]',
    viewportSelector: '.reviews-viewport',
    trackSelector: '.reviews-track',
    slideSelector: '.review-slide',
    prevSelector: '.reviews-prev',
    nextSelector: '.reviews-next',
    dotsSelector: '[data-reviews-dots]',
    dotClass: 'reviews-dot',
    dotLabel: 'Перейти к группе отзывов',
    activeSlides: true
  });

  setupCarousel({
    rootSelector: '[data-services-carousel]',
    viewportSelector: '.services-viewport',
    trackSelector: '.services-track',
    slideSelector: '.base-service-slide',
    prevSelector: '.services-prev',
    nextSelector: '.services-next',
    dotsSelector: '[data-services-dots]',
    dotClass: 'services-dot',
    dotLabel: 'Перейти к группе базовых услуг',
    activeSlides: true
  });

  setupCarousel({
    rootSelector: '[data-packages-carousel]',
    viewportSelector: '.packages-viewport',
    trackSelector: '.packages-track',
    slideSelector: '.package-slide',
    prevSelector: '.packages-prev',
    nextSelector: '.packages-next',
    dotsSelector: '[data-packages-dots]',
    dotClass: 'packages-dot',
    dotLabel: 'Перейти к группе пакетов услуг',
    activeSlides: true
  });

  if (reviews) {
    const { slides } = reviews;
    const lightbox = document.querySelector('.review-lightbox');
    const lightboxImage = lightbox?.querySelector('img');
    let currentLightboxIndex = 0;

    const openLightbox = (index) => {
      if (!lightbox || !lightboxImage || !slides[index]) return;
      currentLightboxIndex = index;
      const sourceImage = slides[index].querySelector('img');
      lightboxImage.src = sourceImage.src;
      lightboxImage.alt = sourceImage.alt;
      if (typeof lightbox.showModal === 'function') lightbox.showModal();
      else lightbox.setAttribute('open', '');
    };

    const moveLightbox = (delta) => {
      openLightbox((currentLightboxIndex + delta + slides.length) % slides.length);
    };

    slides.forEach((slide, index) => slide.addEventListener('click', () => openLightbox(index)));
    lightbox?.querySelector('.review-lightbox-close')?.addEventListener('click', () => lightbox.close());
    lightbox?.querySelector('.review-lightbox-prev')?.addEventListener('click', () => moveLightbox(-1));
    lightbox?.querySelector('.review-lightbox-next')?.addEventListener('click', () => moveLightbox(1));
    lightbox?.addEventListener('click', (event) => {
      if (event.target === lightbox) lightbox.close();
    });
    lightbox?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') moveLightbox(-1);
      if (event.key === 'ArrowRight') moveLightbox(1);
    });
  }
});
