/* Marketing Junkies: share, copy link, search toggle, TOC highlight. No dependencies. */
(function () {
  'use strict';
  var i18n = window.mjI18n || { copied: 'Link copied', copy: 'Copy link' };

  document.addEventListener('click', function (e) {
    var share = e.target.closest('[data-mj-share]');
    if (share) {
      e.preventDefault();
      var data = { title: share.dataset.title, url: share.dataset.url };
      if (navigator.share) { navigator.share(data).catch(function () {}); }
      else { window.open('https://x.com/intent/post?text=' + encodeURIComponent(data.title) + '&url=' + encodeURIComponent(data.url), '_blank', 'noopener'); }
      return;
    }
    var copy = e.target.closest('[data-mj-copy]');
    if (copy) {
      e.preventDefault();
      var done = function () { copy.textContent = i18n.copied; setTimeout(function () { copy.textContent = i18n.copy; }, 1800); };
      if (navigator.clipboard) { navigator.clipboard.writeText(copy.dataset.url).then(done, done); } else { done(); }
      return;
    }
    var search = e.target.closest('[data-mj-search]');
    if (search) {
      e.preventDefault();
      var box = document.getElementById('mj-search');
      box.classList.toggle('is-open');
      if (box.classList.contains('is-open')) { var input = box.querySelector('input[type=search]'); if (input) { input.focus(); } }
    }
  });

  var toc = document.querySelector('[data-mj-toc]');
  if (toc && 'IntersectionObserver' in window) {
    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var map = {};
    links.forEach(function (a) { var el = document.getElementById(a.getAttribute('href').slice(1)); if (el) { map[el.id] = a.parentNode; } });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          links.forEach(function (a) { a.parentNode.classList.remove('is-active'); });
          if (map[en.target.id]) { map[en.target.id].classList.add('is-active'); }
        }
      });
    }, { rootMargin: '-10% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { observer.observe(document.getElementById(id)); });
  }
})();
