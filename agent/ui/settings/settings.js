/*
 * The Settings page. For now it only shows whose plate this is; each new
 * setting adds a section to index.html and its wiring here.
 */
(async () => {
  // The Plate tab's sheet keeps .shell hidden until a page marks itself ready.
  document.body.classList.add('ready');
  const me = await fetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!me) return;
  document.getElementById('me-name').textContent = me.name || me.login;
  document.getElementById('me-login').textContent = me.login ? `@${me.login}` : '';
  if (me.login) {
    document.getElementById('me-avatar').src =
      `https://github.com/${encodeURIComponent(me.login)}.png?size=64`;
  }
})();
