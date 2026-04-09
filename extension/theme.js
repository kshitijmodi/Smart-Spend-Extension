// SmartSpend — Dark / Light theme toggle
// Applies theme immediately (sync) from localStorage to prevent flash-of-wrong-theme
(function () {
  var KEY = 'ss_theme';

  function applyTheme(theme) {
    document.documentElement.classList.toggle('light-theme', theme === 'light');
  }

  function updateButtons() {
    var isLight = document.documentElement.classList.contains('light-theme');
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.textContent = isLight ? '🌙' : '☀️';
      btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    });
  }

  function toggleTheme() {
    var isLight = document.documentElement.classList.contains('light-theme');
    var next = isLight ? 'dark' : 'light';
    localStorage.setItem(KEY, next);
    applyTheme(next);
    updateButtons();
  }

  // Apply immediately to prevent FOUC
  var savedTheme = localStorage.getItem(KEY) || 'dark';
  applyTheme(savedTheme);

  // Inject synchronous background color to prevent blank flash before CSS loads
  var foucStyle = document.createElement('style');
  foucStyle.id = 'ss-fouc';
  foucStyle.textContent = 'html,body{background:' + (savedTheme === 'light' ? '#f1f5f9' : '#0f0f13') + '}';
  (document.head || document.documentElement).appendChild(foucStyle);

  document.addEventListener('DOMContentLoaded', function () {
    // Remove the FOUC prevention style once the page is ready
    var fouc = document.getElementById('ss-fouc');
    if (fouc) fouc.parentNode.removeChild(fouc);

    var toggleBtns = document.querySelectorAll('.theme-toggle');
    if (toggleBtns.length > 0) {
      toggleBtns.forEach(function (btn) {
        btn.addEventListener('click', toggleTheme);
      });
    }
    updateButtons();
  });
})();
