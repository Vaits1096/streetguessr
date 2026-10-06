// Mapa y lógica de una partida. No sabe nada de Firebase: al acabar llama a onGameOver(resultado).
import { $, escapeHtml } from './ui.js';
import { avatarSprite } from './avatar.js';
import { dist, buildStreets, pickDistractors as distractorsFor, shuffle } from './rounds.js';

export const LIVES = 3;
const PTS_BASE = 100, PTS_STREAK = 10, STREAK_CAP = 10;   // máximo 200 por acierto (lo comprueba firestore.rules)

// ---------- Mapa ----------
let map, renderer, baseLayer, labelLayer, targetLayer;
let city = null;      // { id, name, streets, ways, playable }
let state = null, current = null;
let onGameOver = () => {};

export function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 5, maxZoom: 20 }).setView([40.2, -3.7], 6);
  // lyrs=s: satélite de Google SIN etiquetas (lyrs=y mostraría los nombres de las calles)
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'], maxZoom: 20,
    attribution: 'Imágenes © Google · Calles © colaboradores de OpenStreetMap',
  }).addTo(map);
  renderer = L.canvas({ padding: 0.3 });
  labelLayer = L.layerGroup().addTo(map);
  map.on('zoomend moveend', drawLabels);

  $('next').onclick = onNext;
  $('recenter').onclick = recenter;
  document.addEventListener('keydown', e => {
    if (!current || current.showcase || document.querySelector('.overlay:not(.hidden)') || e.target.tagName === 'INPUT') return;
    if (current.versus) {
      if (e.key >= '1' && e.key <= '4') versusGuess(+e.key - 1);
      else if (e.key === 'c' || e.key === 'C') recenter();
      return;
    }
    if (!current.answered && e.key >= '1' && e.key <= '4') answer(+e.key - 1);
    else if (current.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNext(); }
    else if (e.key === 'c' || e.key === 'C') recenter();
  });
}

export function setGameOverHandler(fn) { onGameOver = fn; }

// ---------- Personajes andando por la calle ----------
// Hay uno por jugador: el tuyo y, en 1vs1, el del rival. Se guardan por clave ('me', 'opp').
let playerAvatar = null;
const walkers = {};

/** Avatar ("px:…") que camina por la calle de cada ronda (null = ninguno). */
export function setPlayerAvatar(text) {
  if (text === playerAvatar) return;
  playerAvatar = text;
  if (walkers.me && current) placeWalker('me', playerAvatar, current.target);
}

// El personaje tiene un tamaño fijo en el mundo (escala de maqueta): al alejar el mapa encoge como todo lo demás.
const WALKER_HEIGHT_M = 55;    // altura en el mapa, en metros (una persona real no se vería con el zoom de juego)
const WALKER_MAX_PX = 64;      // tope al acercarse, en píxeles de pantalla
const WALKER_MIN_PX = 3;       // por debajo de esta altura en pantalla no se dibuja

/** Píxeles de pantalla por píxel del sprite para un zoom y latitud dados. */
function walkerScale(zoom, lat, spriteH) {
  const metersPerPx = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** zoom);
  return Math.min(WALKER_HEIGHT_M / metersPerPx, WALKER_MAX_PX) / spriteH;
}

/**
 * Pone un personaje a pasear por una calle (sustituye al que hubiera con esa clave).
 * opts.label: nombre que se ve encima · opts.tag: 'me' | 'opp' (color de la etiqueta) · opts.offset: desfase del paseo
 */
function placeWalker(key, avatar, target, opts = {}) {
  removeWalker(key);
  if (!avatar || !target) return;
  // camino: el tramo más largo de la calle, recorrido de ida y vuelta
  const lenOf = w => w.reduce((t, p, i) => t + (i ? dist(w[i - 1], p) : 0), 0);
  const way = target.ways.reduce((a, b) => (lenOf(b) > lenOf(a) ? b : a));
  const cum = [0];
  for (let i = 1; i < way.length; i++) cum.push(cum[i - 1] + dist(way[i - 1], way[i]));
  const len = cum[cum.length - 1];
  if (!len) return;

  const frames = ['walkA', 'walkB', 'stand'].map(pose => avatarSprite(avatar, pose));
  const f = frames[0];
  const label = opts.label ? `<span class="walker-tag ${opts.tag || ''}">${escapeHtml(opts.label)}</span>` : '';
  const html = `<div class="walker">${label}<img alt="" src="${f.url}"></div>`;
  const marker = L.marker(way[0], {
    icon: L.divIcon({ className: 'walker-icon', html, iconSize: [f.w, f.h], iconAnchor: [f.footX, f.footY] }),
    interactive: false, keyboard: false, zIndexOffset: key === 'me' ? 1100 : 1000,
  }).addTo(map);

  // tamaño según el zoom (con el zoom de destino al empezar la animación, para que acompañe al mapa)
  const resize = zoom => {
    const el = marker.getElement();
    if (!el) return;
    const s = walkerScale(zoom, way[0][0], f.h);
    const W = f.w * s, H = f.h * s;
    el.style.display = H < WALKER_MIN_PX ? 'none' : '';
    el.classList.toggle('tiny', H < 24);
    Object.assign(el.style, { width: `${W}px`, height: `${H}px`, marginLeft: `${-f.footX * s}px`, marginTop: `${-f.footY * s}px` });
    const img = el.querySelector('img');
    img.style.width = `${W}px`;
    img.style.height = `${H}px`;
  };
  const onZoomAnim = e => resize(e.zoom);
  const onZoom = () => resize(map.getZoom());
  map.on('zoomanim', onZoomAnim);
  map.on('zoom zoomend', onZoom);
  resize(map.getZoom());

  const speed = Math.min(Math.max(len / 20, 3), 25);   // m/s: recorre la calle en unos 20 s
  const at = d => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const a = way[i - 1], b = way[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const segAt = d => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; return i; };
  const t0 = performance.now() - (opts.offset || 0) * 1000;
  let frame = -1, flip = false, lastSeg = null, raf = 0;
  const tick = now => {
    const s = ((now - t0) / 1000) * speed % (2 * len);
    const back = s > len, d = back ? 2 * len - s : s;
    marker.setLatLng(at(d));
    const el = marker.getElement();
    if (el) {
      const img = el.querySelector('img');
      const fi = Math.floor(now / 170) % 2;
      if (fi !== frame) { frame = fi; img.src = frames[fi].url; }
      // de cara hacia donde va el tramo actual. Solo se gira si el tramo va claramente a izquierda o derecha
      // en pantalla; en tramos casi verticales mantiene la orientación (si no, parpadea al girarse sin parar).
      const i = segAt(d), k = `${i}${back}`;
      if (k !== lastSeg) {
        lastSeg = k;
        const a = map.latLngToContainerPoint(way[back ? i : i - 1]), b = map.latLngToContainerPoint(way[back ? i - 1 : i]);
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > 0.35 * Math.hypot(dx, dy)) flip = dx < 0;
        el.querySelector('img').classList.toggle('flip', flip);
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  walkers[key] = { marker, stop: () => { cancelAnimationFrame(raf); map.off('zoomanim', onZoomAnim); map.off('zoom zoomend', onZoom); } };
}

function removeWalker(key) {
  const w = walkers[key];
  if (!w) return;
  w.stop();
  map.removeLayer(w.marker);
  delete walkers[key];
}
const startWalker = target => placeWalker('me', playerAvatar, target);
const stopWalker = () => { for (const k of Object.keys(walkers)) removeWalker(k); };

function cheer(key = 'me') {
  const el = walkers[key]?.marker.getElement()?.firstChild;
  if (!el) return;
  el.classList.remove('cheer');
  void el.offsetWidth;
  el.classList.add('cheer');
}
export const currentCity = () => city;
export const playing = () => !!current && !current.showcase;

// Datos de municipios ya descargados (el 1 vs 1 de calles famosas pasa por varias ciudades)
const cityCache = new Map();
function cityData(id) {
  if (!cityCache.has(id)) {
    cityCache.set(id, fetch(`data/m/${encodeURIComponent(id)}.json`).then(async res => {
      if (!res.ok) throw new Error(`No se pudo cargar el municipio (${res.status})`);
      const data = await res.json();
      return { data, ...buildStreets(data) };
    }).catch(e => { cityCache.delete(id); throw e; }));
    if (cityCache.size > 12) cityCache.delete(cityCache.keys().next().value);
  }
  return cityCache.get(id);
}
/** Una calle de cualquier municipio (aunque no sea el que está en el mapa). */
async function streetIn(cityId, name) {
  if (city?.id === cityId) return city.streets.find(x => x.name === name);
  return (await cityData(cityId)).streets.find(x => x.name === name);
}

/** Carga los datos de un municipio y los dibuja en el mapa. */
export async function loadCity(id) {
  const { data, streets, playable } = await cityData(id);
  const ways = [];
  for (const st of streets) {
    for (const w of st.ways) {
      let S = 90, W = 180, N = -90, E = -180;
      for (const [a, b] of w) { if (a < S) S = a; if (a > N) N = a; if (b < W) W = b; if (b > E) E = b; }
      ways.push({ s: st, pts: w, bb: [S, W, N, E] });
    }
  }

  if (baseLayer) map.removeLayer(baseLayer);
  if (targetLayer) { map.removeLayer(targetLayer); targetLayer = null; }
  // todas las calles en una sola capa de líneas tenues
  baseLayer = L.polyline(ways.map(w => w.pts), { renderer, color: '#ffffff', weight: 2, opacity: 0.35, interactive: false }).addTo(map);

  const [s, w, n, e] = data.bbox;
  const bounds = L.latLngBounds([s, w], [n, e]);
  map.setMaxBounds(bounds.pad(0.25));
  map.setMinZoom(Math.max(map.getBoundsZoom(bounds) - 1, 8));
  city = { id: data.id, name: data.name, prov: data.prov, center: data.center, streets, ways, playable };
  current = null;
  labelLayer.clearLayers();
  map.setView(data.center, 15);
  return city;
}

// ---------- Etiquetas de calles vecinas ----------
const measure = document.createElement('canvas').getContext('2d');
measure.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function drawLabels() {
  labelLayer.clearLayers();
  if (!current || !city || map.getZoom() < 15) return;
  if (current.hideLabels && !current.answered) return;   // calles famosas: los nombres vecinos delatarían la ciudad
  const view = map.getBounds().pad(0.1);
  const vS = view.getSouth(), vN = view.getNorth(), vW = view.getWest(), vE = view.getEast();
  const hidden = current.answered ? null : current.target.core;
  const boxes = [], candidates = [];

  for (const { s, pts: w, bb } of city.ways) {
    if (s === current.target && !current.answered) continue;
    if (s.core === hidden || w.length < 2) continue;
    if (bb[0] > vN || bb[2] < vS || bb[1] > vE || bb[3] < vW) continue;
    const pts = w.map(p => map.latLngToLayerPoint(p));
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); total += d; }
    const tw = measure.measureText(s.name).width + 8;
    if (total < tw) continue;
    // punto medio a lo largo del tramo
    let half = total / 2, i = 0;
    while (i < seg.length - 1 && half > seg[i]) { half -= seg[i]; i++; }
    const a = pts[i], b = pts[i + 1], t = seg[i] ? half / seg[i] : 0;
    const mid = L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const ll = map.layerPointToLatLng(mid);
    if (!view.contains(ll)) continue;
    let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    candidates.push({ name: s.name, mid, ll, ang, tw, total, solved: s === current.target });
  }
  // primero la calle resuelta y luego los tramos más largos
  candidates.sort((x, y) => (y.solved - x.solved) || (y.total - x.total));
  const placedNames = new Map();
  for (const c of candidates) {
    const r = c.ang * Math.PI / 180;
    const hw = (Math.abs(Math.cos(r)) * c.tw + Math.abs(Math.sin(r)) * 14) / 2;
    const hh = (Math.abs(Math.sin(r)) * c.tw + Math.abs(Math.cos(r)) * 14) / 2;
    const box = [c.mid.x - hw, c.mid.y - hh, c.mid.x + hw, c.mid.y + hh];
    if (boxes.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
    // no repetir el mismo nombre demasiado cerca
    const prev = placedNames.get(c.name) || [];
    if (prev.some(p => p.distanceTo(c.mid) < 250)) continue;
    boxes.push(box);
    prev.push(c.mid);
    placedNames.set(c.name, prev);
    const style = c.solved ? 'color:#ffd400;font-size:14px;' : '';
    const html = `<div style="${style}transform: translate(-50%,-50%) rotate(${c.ang.toFixed(1)}deg)">${escapeHtml(c.name)}</div>`;
    L.marker(c.ll, { icon: L.divIcon({ className: 'street-label', html, iconSize: [0, 0] }), interactive: false, keyboard: false })
      .addTo(labelLayer);
  }
}

// ---------- Partida ----------
export function newGame() {
  state = { round: 0, score: 0, streak: 0, hits: 0, lives: LIVES, used: new Set(), startedAt: Date.now() };
  nextRound();
}

/** Abandona la partida en curso sin guardar. */
export function stopGame() {
  stopWalker();
  clearTimeout(versus?.timer);
  versus = null;
  current = null;
  state = null;
  if (targetLayer) { map.removeLayer(targetLayer); targetLayer = null; }
  labelLayer.clearLayers();
}

const pickDistractors = target => distractorsFor(city.streets, target);

function nextRound() {
  let pool = city.playable.filter(s => !state.used.has(s.name));
  if (!pool.length) { state.used.clear(); pool = city.playable; }
  const target = pool[Math.random() * pool.length | 0];
  state.used.add(target.name);
  state.round++;
  const options = shuffle([target, ...pickDistractors(target)]);
  current = { target, options, answered: false };

  drawTarget(target);

  startWalker(target);

  const box = $('options');
  box.innerHTML = '';
  if (window.__TEST__) box.dataset.answer = target.name;   // solo para tests/e2e.test.js
  options.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = `<kbd>${i + 1}</kbd><span>${escapeHtml(s.name)}</span>`;
    b.onclick = () => answer(i);
    box.appendChild(b);
  });
  $('feedback').classList.remove('show');
  updateHud();
  recenter();
}

function drawTarget(target) {
  if (targetLayer) map.removeLayer(targetLayer);
  targetLayer = L.layerGroup([
    L.polyline(target.ways, { renderer, color: '#000', weight: 11, opacity: 0.45, interactive: false }),
    L.polyline(target.ways, { renderer, color: '#ffd400', weight: 7, opacity: 1, interactive: false, lineCap: 'round' }),
  ]).addTo(map);
}

export function recenter() {
  if (!current) return;
  const bounds = L.latLngBounds(current.target.ways.flat());
  const top = $('hud').offsetHeight + 24;
  const panelH = $('panel').offsetHeight;
  map.fitBounds(bounds, { paddingTopLeft: [40, top], paddingBottomRight: [40, panelH + 40], maxZoom: 17 });
  if (map.getZoom() < 15) map.setZoom(15);
}

function answer(i) {
  if (!current || current.answered) return;
  current.answered = true;
  const ok = current.quiz ? i === current.quiz.answer : current.options[i] === current.target;
  [...$('options').children].forEach((b, j) => {
    b.disabled = true;
    if (current.quiz ? j === current.quiz.answer : current.options[j] === current.target) b.classList.add('correct');
    else if (j === i) b.classList.add('wrong');
  });
  if (current.quiz) {
    if (ok) cheer();
    drawLabels();
    $('feedback').classList.add('show');
    document.activeElement?.blur();
    current.quiz.onAnswer(ok, Date.now() - current.quiz.t0);
    return;
  }
  if (ok) {
    state.streak++;
    state.hits++;
    const pts = PTS_BASE + Math.min(state.streak - 1, STREAK_CAP) * PTS_STREAK;
    state.score += pts;
    $('msg').textContent = `¡Correcto! +${pts}`;
    cheer();
    $('msg').style.color = 'var(--ok)';
  } else {
    state.streak = 0;
    state.lives--;
    $('msg').textContent = `Era ${current.target.name}`;
    $('msg').style.color = 'var(--bad)';
  }
  drawLabels();   // ahora también con el nombre de la calle resuelta
  updateHud();
  $('next').textContent = state.lives > 0 ? 'Siguiente ronda →' : 'Ver resultado';
  $('feedback').classList.add('show');
  document.activeElement?.blur();
}

function onNext() {
  if (current?.quiz && current.answered) return current.quiz.onNext();
  if (!state) return;
  if (state.lives > 0) return nextRound();
  const result = {
    cityId: city.id, cityName: city.name,
    score: state.score, hits: state.hits, rounds: state.round,
    seconds: Math.round((Date.now() - state.startedAt) / 1000),
  };
  current = null;
  onGameOver(result);
}

function updateHud() {
  $('round').textContent = state.round;
  $('score').textContent = state.score;
  $('streak').textContent = state.streak;
  const l = Math.max(state.lives, 0);
  $('lives').textContent = '♥'.repeat(l) + '♡'.repeat(LIVES - l);
}

// ---------- Muestra para la portada (sin partida ni puntos) ----------
/**
 * Ilumina una calle al azar cerca del centro de la ciudad cargada y vuela hasta ella.
 * `padding` son las opciones paddingTopLeft/paddingBottomRight de Leaflet para dejar sitio al texto.
 */
export function showcaseRound(padding) {
  if (!city) return null;
  const near = city.playable.filter(s => s.len < 1200 && dist(s.c, city.center) < 1500);
  const pool = near.length >= 8 ? near : city.playable;
  const target = pool[Math.random() * pool.length | 0];
  const options = shuffle([target, ...pickDistractors(target)]);
  current = { target, options, answered: false, showcase: true };
  labelLayer.clearLayers();
  drawTarget(target);
  startWalker(target);
  map.flyToBounds(L.latLngBounds(target.ways.flat()), { ...padding, maxZoom: 17, duration: 1.4 });
  return { target, options };
}

/** Muestra el nombre de la calle de muestra en el mapa. */
export function revealShowcase(ok) {
  if (!current?.showcase) return;
  current.answered = true;
  if (ok) cheer();
  drawLabels();
}

// ---------- 1vs1 ----------
// La partida la arbitra el servidor (o la CPU en local): aquí solo se enseña. Cada intento se manda con onGuess
// y el árbitro contesta con versusVerdict(); el avance del rival llega con versusOpponent().
let versus = null;
export const VS_ROUNDS = 7;

/**
 * Empieza un 1vs1 en la ciudad ya cargada.
 * rounds: [{ target, options }] (nombres) · me / opp: { avatar, name } · onGuess(ronda, nombre)
 */
/**
 * rounds: [{ target, options }] con nombres de calles de la ciudad cargada, o, en la variante de calles famosas,
 * [{ cityId, street, target, options }] (cada calle en su ciudad; target/options son los textos de las opciones).
 */
export function startVersus({ rounds, me, opp, onGuess, myRound = 0, oppRound = 0 }) {
  stopGame();
  versus = { rounds, me, opp, onGuess, myRound, oppRound, frozenUntil: 0, pending: false, wrong: new Set(), timer: 0 };
  showVersusRound();
  placeOpponent();
}

async function showVersusRound() {
  const v = versus;
  v.wrong = new Set();
  v.pending = false;
  const r = v.rounds[v.myRound];
  const box = $('options');
  box.innerHTML = '';
  $('feedback').classList.remove('show');
  if (!r) {   // has terminado: el rival sigue en su calle
    current = null;
    removeWalker('me');
    if (targetLayer) { map.removeLayer(targetLayer); targetLayer = null; }
    labelLayer.clearLayers();
    return;
  }
  if (r.cityId && city?.id !== r.cityId) {   // calles famosas: cada una en su ciudad
    current = null;
    box.innerHTML = '<p class="loading-round">Viajando a la siguiente calle…</p>';
    await loadCity(r.cityId);
    if (versus !== v || v.rounds[v.myRound] !== r) return;
    box.innerHTML = '';
  }
  const st = city.streets.find(x => x.name === (r.street || r.target));
  current = { target: st, options: r.options.map(name => ({ name })), answered: false, versus: true, hideLabels: !!r.cityId };
  drawTarget(st);
  placeWalker('me', v.me.avatar, st, { label: v.me.name, tag: 'me' });
  placeOpponent();
  if (window.__TEST__) box.dataset.answer = r.target;
  current.options.forEach((st, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = `<kbd>${i + 1}</kbd><span>${escapeHtml(st.name)}</span>`;
    b.onclick = () => versusGuess(i);
    box.appendChild(b);
  });
  recenter();
  drawLabels();
}

async function placeOpponent() {
  const v = versus, round = v.oppRound, r = v.rounds[round];
  if (!r) return removeWalker('opp');
  const st = r.cityId ? await streetIn(r.cityId, r.street).catch(() => null) : city.streets.find(x => x.name === r.target);
  if (versus !== v || v.oppRound !== round || !st) return;
  placeWalker('opp', v.opp.avatar, st, { label: v.opp.name, tag: 'opp', offset: 6 });
}

function versusGuess(i) {
  const v = versus;
  if (!v || !current?.versus || v.pending || current.answered || v.wrong.has(i) || Date.now() < v.frozenUntil) return;
  v.pending = true;
  v.last = i;
  v.onGuess(v.myRound, current.options[i].name);
}

/** Lo que dice el árbitro de tu último intento: { ok, frozenMs }. */
export function versusVerdict({ ok, frozenMs = 0 }) {
  const v = versus;
  if (!v || !current?.versus) return;
  v.pending = false;
  const btns = [...$('options').children];
  const msg = $('msg');
  if (ok) {
    current.answered = true;
    btns.forEach(b => { b.disabled = true; });
    btns[v.last]?.classList.add('correct');
    cheer();
    drawLabels();
    msg.textContent = '¡Correcto!';
    msg.style.color = 'var(--ok)';
    $('feedback').classList.add('show');
    v.myRound++;
    v.timer = setTimeout(showVersusRound, 650);
    return;
  }
  v.wrong.add(v.last);
  btns[v.last]?.classList.add('wrong');
  v.frozenUntil = Date.now() + frozenMs;
  btns.forEach(b => { b.disabled = true; });
  $('feedback').classList.add('show');
  msg.style.color = 'var(--bad)';
  const countdown = () => {
    const left = Math.ceil((v.frozenUntil - Date.now()) / 1000);
    if (versus !== v || current?.answered) return;
    if (left > 0) {
      msg.textContent = `¡Fallo! Bloqueado ${left} s`;
      v.timer = setTimeout(countdown, 200);
    } else {
      $('feedback').classList.remove('show');
      btns.forEach((b, j) => { b.disabled = v.wrong.has(j); });
    }
  };
  countdown();
}

/** El rival ha llegado a la ronda `round` (7 = ha terminado). */
export function versusOpponent(round) {
  if (!versus || round === versus.oppRound) return;
  const advanced = round > versus.oppRound;
  versus.oppRound = round;
  placeOpponent();
  if (advanced && versus.rounds[round]) cheer('opp');
}

export const versusState = () => versus && { myRound: versus.myRound, oppRound: versus.oppRound };

// ---------- Reto diario: una pregunta sobre una calle concreta ----------
/**
 * Muestra una calle de la ciudad cargada con opciones dadas (textos).
 * answer: índice correcto · onAnswer(ok, ms) · onNext() al pulsar el botón de seguir
 */
export function startQuiz({ target, options, answer, onAnswer, onNext, hideLabels = true, nextText = 'Siguiente →' }) {
  stopGame();
  const st = city.streets.find(x => x.name === target);
  current = { target: st, options: options.map(name => ({ name })), answered: false, hideLabels, quiz: { answer, onAnswer, onNext, t0: Date.now() } };
  labelLayer.clearLayers();
  drawTarget(st);
  startWalker(st);
  const box = $('options');
  box.innerHTML = '';
  if (window.__TEST__) box.dataset.answer = options[answer];
  options.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = `<kbd>${i + 1}</kbd><span>${escapeHtml(name)}</span>`;
    b.onclick = () => answer_(i);
    box.appendChild(b);
  });
  $('feedback').classList.remove('show');
  $('next').textContent = nextText;
  recenter();
}
const answer_ = i => answer(i);
