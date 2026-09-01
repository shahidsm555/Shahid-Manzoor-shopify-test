/* ==========================================================================
   Gift Guide banner
   Behaviour for sections/gift-guide-banner.liquid.
   Only job: open and close the mobile top-bar menu. Vanilla JS, no libraries.
   The <script> tag is deferred, so the DOM is ready when this runs.
   ========================================================================== */

(function () {
  'use strict';

  /**
   * Wire the hamburger toggle for a single banner instance.
   * @param {HTMLElement} banner - element carrying [data-gg-banner]
   */
  function initBanner(banner) {
    var toggle = banner.querySelector('[data-gg-toggle]');
    var menu = banner.querySelector('[data-gg-menu]');

    if (!toggle || !menu) return;

    toggle.addEventListener('click', function () {
      var isOpen = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Close the menu when a link inside it is followed or the viewport grows
    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.querySelectorAll('[data-gg-banner]').forEach(initBanner);
})();
