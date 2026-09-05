/* Marketing Mentalist carousel: CSS scroll-snap + arrows, keyboard, live counter. ~2KB, no deps. */
(function () {
  'use strict';
  function init(root) {
    var track = root.querySelector('[data-mm-carousel-track]');
    if (!track) { return; }
    var prev = root.querySelector('[data-mm-carousel-prev]');
    var next = root.querySelector('[data-mm-carousel-next]');
    var counter = root.querySelector('[data-mm-carousel-counter]');
    var items = Array.prototype.slice.call(track.children);
    if (!items.length) { return; }

    track.setAttribute('role', 'region');
    track.setAttribute('aria-roledescription', 'carousel');
    track.setAttribute('tabindex', '0');

    function currentIndex() {
      var scrollLeft = track.scrollLeft;
      var best = 0, bestDist = Infinity;
      items.forEach(function (it, i) {
        var d = Math.abs(it.offsetLeft - scrollLeft);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }
    function updateCounter() {
      if (counter) { counter.textContent = (currentIndex() + 1) + ' / ' + items.length; }
      if (currentIndex() === items.length - 1 && window.mmDataLayer) { window.mmDataLayer('carousel_complete', {}); }
    }
    function goTo(i) {
      i = Math.max(0, Math.min(items.length - 1, i));
      items[i].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
    if (prev) { prev.addEventListener('click', function () { goTo(currentIndex() - 1); }); }
    if (next) { next.addEventListener('click', function () { goTo(currentIndex() + 1); }); }
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { goTo(currentIndex() + 1); }
      if (e.key === 'ArrowLeft') { goTo(currentIndex() - 1); }
    });
    var raf;
    track.addEventListener('scroll', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateCounter);
    }, { passive: true });
    updateCounter();

    // desktop drag-to-scroll
    var isDown = false, startX = 0, startScroll = 0;
    track.addEventListener('pointerdown', function (e) { isDown = true; startX = e.clientX; startScroll = track.scrollLeft; });
    window.addEventListener('pointermove', function (e) { if (isDown) { track.scrollLeft = startScroll - (e.clientX - startX); } });
    window.addEventListener('pointerup', function () { isDown = false; });
  }
  document.querySelectorAll('[data-mm-carousel]').forEach(init);
})();
