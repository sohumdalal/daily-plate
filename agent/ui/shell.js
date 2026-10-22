/*
 * What every page shares: the theme, the account menu at the top right, and
 * the unread count on the Notifications tab.
 *
 * Loaded in <head>, so the theme is set before the page first paints. The menu
 * is built into [data-account] once the page has loaded: your avatar, Settings,
 * and Light / Dark / System, the way Astropods lays its own out. The choice is
 * remembered per browser; System follows the operating system as it changes.
 */
(() => {
  const KEY = 'daily-plate:theme';
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)');

  /** 'light', 'dark' or 'system'. Light when nothing is stored. */
  function chosen() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'system' ? value : 'light';
    } catch {
      return 'light';
    }
  }

  function apply(choice) {
    root.dataset.theme = choice === 'system' ? (dark.matches ? 'dark' : 'light') : choice;
    for (const option of document.querySelectorAll('[data-theme-option]')) {
      option.setAttribute('aria-pressed', String(option.dataset.themeOption === choice));
    }
  }

  apply(chosen());
  dark.addEventListener('change', () => {
    if (chosen() === 'system') apply('system');
  });

  /** `just now`, `5m ago`, `3h ago`, `2d ago`. Shared so both tabs say it the same way. */
  function ago(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  }

  /**
   * Who is signed in, from /api/me: one request however many parts of the
   * page ask. Null when it fails, and the next call asks again.
   */
  let mine = null;
  function me() {
    mine ??= fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((who) => {
        if (!who) mine = null;
        return who;
      });
    return mine;
  }

  /**
   * The unread count on the Notifications tab, on every page. Re-read every
   * minute while the page is visible; the Notifications page sets it at once
   * whenever its own list changes.
   */
  function setUnread(count) {
    const tab = document.querySelector('.apptab[href="/notifications/"]');
    if (!tab) return;
    let badge = tab.querySelector('.apptab-count');
    if (!count) {
      badge?.remove();
      tab.removeAttribute('aria-label');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'apptab-count';
      badge.setAttribute('aria-hidden', 'true');
      tab.append(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    tab.setAttribute('aria-label', `Notifications, ${count} unread`);
  }

  async function readUnread() {
    if (document.hidden) return;
    try {
      const res = await fetch('/api/notifications/unread');
      if (res.ok) setUnread((await res.json()).unread);
    } catch {
      // Offline or the agent is down: keep the last count.
    }
  }

  window.DailyPlate = { ago, me, setUnread };

  // Lucide's sun, moon, monitor and settings, inline so they take currentColor.
  const ICONS = {
    light:
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  };

  function icon(name) {
    return `<svg class="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function avatarUrl(login) {
    return login ? `https://github.com/${encodeURIComponent(login)}.png?size=64` : '';
  }

  /** Your name, handle and avatar, once /api/me answers. */
  function fill(mount, me) {
    const name = me.name || me.login || 'You';
    mount.querySelector('.account-button').setAttribute('aria-label', `Account menu for ${name}`);
    mount.querySelector('.account-name').textContent = name;
    mount.querySelector('.account-login').textContent = me.login ? `@${me.login}` : '';
    for (const img of mount.querySelectorAll('.account-avatar')) {
      if (me.login) img.src = avatarUrl(me.login);
    }
  }

  function buildMenu(mount) {
    mount.innerHTML = `
      <button class="account-button" type="button" aria-haspopup="menu" aria-expanded="false"
              aria-label="Account menu">
        <img class="account-avatar" alt="" />
      </button>
      <div class="account-menu" role="menu" hidden>
        <div class="account-head">
          <img class="account-avatar" alt="" />
          <div class="account-who">
            <span class="account-name"></span>
            <span class="account-login"></span>
          </div>
        </div>
        <div class="account-sep" role="separator"></div>
        <a class="account-item" role="menuitem" href="/settings/">${icon('settings')}Settings</a>
        <div class="account-sep" role="separator"></div>
        <div class="theme-row" role="group" aria-label="Theme">
          ${['light', 'dark', 'system']
            .map(
              (t) =>
                `<button class="theme-option" type="button" data-theme-option="${t}" title="${t[0].toUpperCase() + t.slice(1)}" aria-label="Use the ${t} theme">${icon(t)}</button>`,
            )
            .join('')}
        </div>
      </div>`;
    const button = mount.querySelector('.account-button');
    const menu = mount.querySelector('.account-menu');
    const setOpen = (open) => {
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        setOpen(false);
        button.focus();
      }
    });
    for (const option of menu.querySelectorAll('[data-theme-option]')) {
      option.addEventListener('click', () => {
        try {
          localStorage.setItem(KEY, option.dataset.themeOption);
        } catch {
          // Private window or blocked storage: the choice lasts this page only.
        }
        apply(option.dataset.themeOption);
      });
    }
    apply(chosen());
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // The Notifications page counts its own list.
    if (location.pathname !== '/notifications/') {
      void readUnread();
      setInterval(readUnread, 60_000);
      document.addEventListener('visibilitychange', readUnread);
    }
    const mount = document.querySelector('[data-account]');
    if (!mount) return;
    buildMenu(mount);
    const who = await me();
    if (who) fill(mount, who);
  });
})();
