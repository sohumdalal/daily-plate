/**
 * The Board tab: the page hands Mova its element and the four calls it
 * needs, and Mova draws everything else (agent/mova/src/board).
 */

async function request(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function api(how, id) {
  if (how === 'get') return request('/api/board');
  if (how === 'think') return request(`/api/board/think/${encodeURIComponent(id)}`, { method: 'POST' });
  return request(`/api/board/${how}`, { method: 'POST' });
}

const mount = document.getElementById('board');
// Module scripts run in order, so Mova's bundle has set window.Mova by now
// unless it failed to load.
if (window.Mova) {
  window.Mova.board(mount, api).catch((err) => {
    mount.innerHTML = '<div class="state-error" role="alert"><p class="empty-title">The board did not load.</p><p class="empty-caption"></p></div>';
    mount.querySelector('.empty-caption').textContent = err.message;
  });
} else {
  mount.innerHTML = '<div class="state-error" role="alert"><p class="empty-title">The board did not load.</p><p class="empty-caption">Its scripts did not arrive. Reload the page.</p></div>';
}
