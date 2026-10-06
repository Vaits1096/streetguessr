// Portada para quien no ha iniciado sesión: mapa con una calle de muestra, tarjeta para probar,
// cifras, buscador de ciudades y ranking en directo.
import { $, escapeHtml, avatarHtml, fmt } from './ui.js';
import { loadIndex, searchCities } from './cities.js';
import { worldRanking } from './store.js';
import * as game from './game.js';
import { randomAvatar, encodeAvatar, parseAvatar } from './catalog.js';
import { avatarImage } from './avatar.js';

// Desfile de avatares de muestra (con objetos y mascotas de la tienda)
const PARADE = [
  ['px:skin_1.face_happy.hair_bun.hc_7.top_hero.tc_6.bottom_track.shoes_red.hat_halo.acc_none.bg_gold.pet_dragon', 'Aureola · Dragón'],
  ['px:skin_3.face_cool.hair_short.hc_0.top_suit.tc_0.bottom_black.shoes_boots.hat_cowboy.acc_sunglasses.bg_city.pet_dog', 'Vaquero · Perro'],
  ['px:skin_0.face_smile.hair_long.hc_3.top_striped.tc_5.bottom_skirt.shoes_sneakers.hat_beanie.acc_glasses.bg_sky.pet_cat', 'Gorro de lana · Gato'],
  ['px:skin_4.face_star.hair_afro.hc_0.top_jersey.tc_3.bottom_shorts.shoes_gold.hat_crown.acc_none.bg_map.pet_fox', 'Corona · Zorro'],
  ['px:skin_2.face_wink.hair_mohawk.hc_5.top_jacket.tc_7.bottom_jeans.shoes_sneakers.hat_headphones.acc_pixelshades.bg_stars.pet_penguin', 'Cascos · Pingüino'],
  ['px:skin_5.face_happy.hair_curly.hc_1.top_hoodie.tc_0.bottom_jeans.shoes_red.hat_montera.acc_scarf.bg_spain.pet_parrot', 'Montera · Loro'],
];

// Ciudades con casco histórico vistoso y datos ligeros (< 200 KB)
const SHOWCASE = ['26089', '37274', '45168', '40194', '11012', '15078', '17079', '20069', '31201', '33044', '09059', '24089'];
const ROUNDS_PER_CITY = 4;
const AUTO_NEXT_MS = 9000, AFTER_ANSWER_MS = 5000;

export function setupLanding({ onAuth }) {
  const root = $('landing');
  const hero = root.querySelector('.lp-hero');
  let active = false, heroVisible = true, timer = null, token = 0, rounds = 0, round = null, cities = [];

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-auth]');
    if (b) onAuth(b.dataset.auth);
  });
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }, { root, threshold: 0.35 }).observe(hero);
  const nav = root.querySelector('.lp-nav');
  root.addEventListener('scroll', () => nav.classList.toggle('scrolled', root.scrollTop > 40), { passive: true });

  // ---------- Calle de muestra ----------
  /** Hueco libre del mapa entre el texto y la tarjeta, como padding de Leaflet. */
  function padding() {
    const H = hero.getBoundingClientRect(), W = innerWidth;
    const text = root.querySelector('.lp-hero-text').getBoundingClientRect();
    const demo = $('lpDemo').getBoundingClientRect();
    if (W <= 820) {
      const top = text.bottom - H.top + 16;
      const bottom = Math.max(innerHeight - (demo.top - H.top) + 16, 40);
      return { paddingTopLeft: [24, top], paddingBottomRight: [24, Math.min(bottom, innerHeight - top - 120)] };
    }
    return { paddingTopLeft: [text.right + 48, 110], paddingBottomRight: [48, Math.max(innerHeight - (demo.top - H.top) + 24, 60)] };
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (heroVisible && !document.hidden && !document.querySelector('.overlay:not(.hidden)')) next();
      else schedule(2000);
    }, ms);
  }

  async function next() {
    clearTimeout(timer);
    if (!active) return;
    const my = ++token;
    const c = game.currentCity();
    if (!c || !SHOWCASE.includes(c.id) || (rounds && rounds % ROUNDS_PER_CITY === 0)) {
      const ids = SHOWCASE.filter(id => id !== c?.id);
      try { await game.loadCity(ids[Math.random() * ids.length | 0]); } catch { return schedule(5000); }
      if (my !== token || !active) return;
    }
    rounds++;
    $('lpDemo').hidden = false;   // visible antes de medir el hueco libre del mapa
    round = game.showcaseRound(padding());
    if (!round) return;
    renderDemo();
    setHeroCity(game.currentCity().name);
    schedule(AUTO_NEXT_MS);
  }

  function setHeroCity(name) {
    const el = $('lpHeroCity');
    if (el.textContent === name) return;
    el.classList.add('swap');
    setTimeout(() => { el.textContent = name; el.classList.remove('swap'); }, 300);
  }

  function renderDemo() {
    const c = game.currentCity();
    $('lpDemo').hidden = false;
    $('lpDemoCity').textContent = `📍 ${c.name}${c.prov && c.prov !== c.name ? ` · ${c.prov}` : ''}`;
    $('lpDemoMsg').textContent = '';
    const box = $('lpDemoOptions');
    box.innerHTML = '';
    round.options.forEach(s => {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.onclick = () => answer(s);
      box.appendChild(b);
    });
  }

  function answer(chosen) {
    const ok = chosen === round.target;
    [...$('lpDemoOptions').children].forEach((b, i) => {
      b.disabled = true;
      if (round.options[i] === round.target) b.classList.add('correct');
      else if (round.options[i] === chosen) b.classList.add('wrong');
    });
    const msg = $('lpDemoMsg');
    msg.textContent = ok ? '¡Correcto! Crea tu cuenta y suma puntos.' : 'Casi… mira el nombre en el mapa.';
    msg.style.color = ok ? 'var(--ok)' : 'var(--bad)';
    game.revealShowcase(ok);
    schedule(AFTER_ANSWER_MS);
  }
  $('lpDemoNext').onclick = () => next();

  // ---------- Ciudades ----------
  const renderCities = q => {
    const list = searchCities(q, 24);
    $('lpCities').innerHTML = list.length ? list.map((c, i) =>
      `<button data-i="${i}"><span class="n"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.prov)}</small></span><span class="c">${fmt(c.n)}</span></button>`).join('')
      : '<p class="none">No hay ningún municipio con ese nombre (solo están los que tienen al menos 40 calles).</p>';
    cities = list;
  };
  $('lpCitySearch').addEventListener('input', e => renderCities(e.target.value));
  $('lpCities').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) onAuth('signup', cities[+b.dataset.i]);
  });

  async function loadStats() {
    try {
      const index = await loadIndex();
      $('lpStatCities').textContent = fmt(index.length);
      $('lpStatStreets').textContent = fmt(index.reduce((t, c) => t + c.n, 0));
      $('lpKickerCities').textContent = `+${fmt(Math.floor(index.length / 100) * 100)}`;
      renderCities($('lpCitySearch').value);
    } catch { /* las cifras por defecto del HTML valen */ }
  }

  async function loadBoard() {
    const ol = $('lpBoard');
    try {
      const rows = (await worldRanking()).slice(0, 5);
      ol.innerHTML = rows.length ? rows.map((r, i) =>
        `<li><span class="pos">${i + 1}</span>${avatarHtml(r.avatar, r.username)}` +
        `<span class="name">${escapeHtml(r.username)}${r.locality ? `<small>${escapeHtml(r.locality)}</small>` : ''}</span>` +
        `<span class="pts">${fmt(r.totalPoints)}</span></li>`).join('')
        : '<li class="empty">Aún no ha jugado nadie.<br>¡Estrena el ranking!</li>';
    } catch {
      ol.innerHTML = '<li class="empty">El ranking no está disponible ahora mismo.</li>';
    }
  }

  return {
    show() {
      if (active) return;
      active = true;
      // un personaje al azar (con mascota) pasea por las calles de muestra
      const pets = ['pet_dog', 'pet_cat', 'pet_fox', 'pet_penguin', 'pet_dragon'];
      game.setPlayerAvatar(encodeAvatar({ ...parseAvatar(randomAvatar()), pet: pets[Math.random() * pets.length | 0] }));
      root.hidden = false;
      root.scrollTop = 0;
      loadStats();
      loadBoard();
      $('lpParade').innerHTML = PARADE.map(([a, label]) => `<figure><img alt="" src="${avatarImage(a, 192)}"><figcaption>${label}</figcaption></figure>`).join('');
      next();
    },
    hide() {
      if (!active) return;
      active = false;
      token++;
      clearTimeout(timer);
      root.hidden = true;
      game.stopGame();
    },
  };
}
