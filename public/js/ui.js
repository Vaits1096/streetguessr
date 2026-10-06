// Utilidades de interfaz compartidas.
import { avatarPortrait } from './avatar.js';

export const $ = id => document.getElementById(id);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { norm } from './rounds.js';

const SCREENS = ['loading', 'setup', 'login', 'verify', 'username', 'over', 'profile', 'ranking', 'avatar', 'shop', 'search', 'vsintro', 'vsover', 'room', 'friends', 'dailyover'];

/** Muestra una pantalla (o ninguna con null) y oculta las demás. */
export function show(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  $('menu').hidden = true;
}
export const visible = name => !$(`screen-${name}`).classList.contains('hidden');

let toastTimer;
export function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function setError(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

// ---------- Avatares ----------
// Un avatar es un texto "px:..." (ver js/catalog.js). Se aceptan aún los antiguos (emoji o imagen) por si acaso.
export function paintAvatar(el, avatar, name = '') {
  el.style.backgroundImage = '';
  el.style.backgroundColor = '';
  el.textContent = '';
  el.classList.toggle('px', !!avatar && avatar.startsWith('px:'));
  if (avatar && avatar.startsWith('px:')) {
    el.style.backgroundImage = `url("${avatarPortrait(avatar)}")`;
  } else if (avatar && avatar.startsWith('e:')) {
    const [, emoji, color] = avatar.split(':');
    el.textContent = emoji;
    el.style.backgroundColor = color;
  } else if (avatar && /^(data:image\/|https:\/\/)/.test(avatar)) {
    el.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
  } else {
    el.textContent = (name[0] || '?').toUpperCase();
    el.style.backgroundColor = '#555';
  }
}

export function avatarHtml(avatar, name, cls = '') {
  const span = document.createElement('span');
  span.className = `avatar ${cls}`;
  paintAvatar(span, avatar, name);
  return span.outerHTML;
}

export const fmt = n => (n || 0).toLocaleString('es-ES');
