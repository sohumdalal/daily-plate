/*
 * The Settings page. For now it only shows whose plate this is; each new
 * setting adds a section to index.html and its wiring here.
 */
const $ = (id) => document.getElementById(id);

async function loadMe() {
  $('me-error').hidden = true;
  $('me-row').hidden = false;
  const me = await window.DailyPlate.me();
  if (!me) {
    $('me-row').hidden = true;
    $('me-error').hidden = false;
    return;
  }
  document.getElementById('me-name').textContent = me.name || me.login;
  document.getElementById('me-login').textContent = me.login ? `@${me.login}` : '';
  if (me.login) {
    document.getElementById('me-avatar').src =
      `https://github.com/${encodeURIComponent(me.login)}.png?size=64`;
  }
}

$('me-retry').addEventListener('click', loadMe);
loadMe();
