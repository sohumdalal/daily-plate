/*
 * Light or dark, remembered per browser. Loaded in <head> so the page never
 * paints in the wrong theme first. Any button with data-theme-toggle flips it.
 */
(() => {
  const KEY = 'daily-plate:theme';
  const root = document.documentElement;

  function stored() {
    try {
      return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.textContent = theme === 'dark' ? 'Light' : 'Dark';
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
    }
  }

  apply(stored());

  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Private window or blocked storage: the choice lasts this page only.
        }
        apply(next);
      });
    }
  });
})();
