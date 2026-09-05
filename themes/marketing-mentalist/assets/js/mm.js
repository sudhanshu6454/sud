/* Marketing Mentalist: header compact, search overlay, mobile menu, TOC highlight, share, GA4 events. */
(function () {
  'use strict';

  function dl(event, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event }, params || {}));
  }
  window.mmDataLayer = dl;

  // header compacts after 80px scroll
  var header = document.getElementById('mm-header');
  if (header) {
    var sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:80px;height:1px;width:1px';
    document.body.prepend(sentinel);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        header.classList.toggle('is-compact', !entries[0].isIntersecting);
      }).observe(sentinel);
    }
  }

  // search overlay
  var searchTrigger = document.getElementById('mm-search-trigger');
  var searchClose = document.getElementById('mm-search-close');
  if (searchTrigger) {
    searchTrigger.addEventListener('click', function () {
      document.body.classList.add('mm-search-open');
      var input = document.getElementById('mm-s');
      if (input) { input.focus(); }
    });
  }
  if (searchClose) { searchClose.addEventListener('click', function () { document.body.classList.remove('mm-search-open'); }); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.body.classList.remove('mm-search-open');
      document.body.classList.remove('mm-menu-open');
    }
  });

  // mobile menu
  var menuToggle = document.getElementById('mm-menu-toggle');
  var menuClose = document.getElementById('mm-menu-close');
  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('mm-menu-open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (menuClose) { menuClose.addEventListener('click', function () { document.body.classList.remove('mm-menu-open'); }); }

  // TOC scroll highlight
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('[data-mm-toc] a[href^="#"]'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) {
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) { map[el.id] = a; }
    });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          tocLinks.forEach(function (a) { a.style.color = ''; });
          map[en.target.id].style.color = 'var(--mm-signal)';
        }
      });
    }, { rootMargin: '-10% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { obs.observe(document.getElementById(id)); });
  }

  // share / copy
  document.addEventListener('click', function (e) {
    var share = e.target.closest('[data-mm-share]');
    if (share) {
      e.preventDefault();
      var data = { title: share.dataset.title, url: share.dataset.url };
      dl('share', { channel: 'native' });
      if (navigator.share) { navigator.share(data).catch(function () {}); }
      else { window.open('https://x.com/intent/post?text=' + encodeURIComponent(data.title) + '&url=' + encodeURIComponent(data.url), '_blank', 'noopener'); }
      return;
    }
    var copy = e.target.closest('[data-mm-copy]');
    if (copy) {
      e.preventDefault();
      dl('share', { channel: 'copy_link' });
      var label = copy.textContent;
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = label; }, 1800); };
      if (navigator.clipboard) { navigator.clipboard.writeText(copy.dataset.url).then(done, done); } else { done(); }
      return;
    }
    var social = e.target.closest('a[href^="https://wa.me"],a[href*="linkedin.com/sharing"],a[href*="x.com/intent"]');
    if (social) { dl('share', { channel: social.dataset.channel || 'link' }); }
    var relatedCard = e.target.closest('.mm-card');
    if (relatedCard && relatedCard.closest('[data-mm-related]')) { dl('related_click', {}); }
    var embedPlay = e.target.closest('.mm-embed-play');
    if (embedPlay) { dl('video_play', {}); }
    var facetLink = e.target.closest('[data-mm-facet]');
    if (facetLink) { dl('filter_change', { type: facetLink.dataset.mmFacet }); }
    var battleBtn = e.target.closest('[data-mm-battle-vote]');
    if (battleBtn) { dl('battle_vote', { choice: battleBtn.dataset.mmBattleVote }); }
  });

  // sticky share pill after 25% scroll on singles
  var pill = document.getElementById('mm-share-pill');
  if (pill) {
    window.addEventListener('scroll', function () {
      var pct = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      pill.classList.toggle('is-visible', pct > 0.25);
    }, { passive: true });
  }

  // newsletter signup
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.matches('form') && form.querySelector('input[type=email]')) {
      var loc = form.closest('#newsletter') ? 'inline' : (form.closest('.mm-newsletter-box') ? 'sidebar' : 'band');
      dl('newsletter_signup', { location: loc });
    }
    if (form.id === 'mm-submit-campaign-form') { dl('campaign_submit', {}); }
    if (form.id === 'mm-advertise-form') { dl('advertise_enquiry', {}); }
    if (form.querySelector('#mm-s')) { dl('search', { term: (form.querySelector('#mm-s') || {}).value || '' }); }
  });

  // reading progress bar
  var progress = document.getElementById('mm-progress-fill');
  if (progress) {
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
    }, { passive: true });
  }

  // article/campaign view
  if (window.mmPageView) { dl(window.mmPageView.event, window.mmPageView.params); }
})();
