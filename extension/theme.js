// SmartSpend — Dark / Light theme toggle
// Applies theme only to the extension's root container, never to the host page
(function () {
  var KEY = 'ss_theme';
  var ROOT_SEL = '#ss-root';

  function getRootContainer() {
    return document.querySelector(ROOT_SEL);
  }

  function applyTheme(theme) {
    var root = getRootContainer();
    if (!root) return;
    root.classList.toggle('light-theme', theme === 'light');
  }

  function updateButtons() {
    var root = getRootContainer();
    if (!root) return;
    var isLight = root.classList.contains('light-theme');
    root.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.textContent = isLight ? '🌙' : '☀️';
      btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    });
  }

  function toggleTheme() {
    var root = getRootContainer();
    if (!root) return;
    var isLight = root.classList.contains('light-theme');
    var next = isLight ? 'dark' : 'light';
    localStorage.setItem(KEY, next);
    applyTheme(next);
    updateButtons();
  }

  var savedTheme = localStorage.getItem(KEY) || 'dark';

  // Only run FOUC prevention in extension pages, not as a content script on external sites
  if (window.location.protocol === 'chrome-extension:') {
    // Inject synchronous background color scoped to the extension root to prevent blank flash
    var foucStyle = document.createElement('style');
    foucStyle.id = 'ss-fouc';
    foucStyle.textContent = ROOT_SEL + '{background:' + (savedTheme === 'light' ? '#f1f5f9' : '#0f0f13') + '!important}';
    (document.head || document.documentElement).appendChild(foucStyle);
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Remove the FOUC prevention style once the page is ready
    var fouc = document.getElementById('ss-fouc');
    if (fouc) fouc.parentNode.removeChild(fouc);

    applyTheme(savedTheme);

    var root = getRootContainer();
    var toggleBtns = root ? root.querySelectorAll('.theme-toggle') : [];
    if (toggleBtns.length > 0) {
      toggleBtns.forEach(function (btn) {
        btn.addEventListener('click', toggleTheme);
      });
    }
    updateButtons();
  });
})();
