// Calles jugables y rondas (calle + 4 opciones). Sin DOM: lo usan el navegador (js/game.js) y el
// servidor de partidas 1vs1 (server/arena.js), así los dos generan las rondas exactamente igual.

/** Normaliza para comparar: sin tildes, minúsculas, sin signos. */
export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const TYPE_RE = /^(calle|carrer|kalea|rua|avenida|avinguda|plaza|placa|praza|plazuela|paseo|passeig|travesia|camino|cami|ronda|glorieta|carretera|pasaje|passatge|callejon|bajada|cuesta|costa|urbanizacion|parque|senda|via|acceso|circunvalacion|costanilla|barrio|poligono|rambla|calleja|calzada|bulevar)\b/;
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'dels', 'les', 'do', 'da', 'dos', 'das', 'd', 'l']);
export const core = name => norm(name).replace(TYPE_RE, '').split(' ').filter(w => w && !STOP.has(w)).join(' ');
export const typeOf = name => { const m = norm(name).match(TYPE_RE); return m ? m[1] : 'otro'; };
export const NOT_PLAYABLE = /^(acceso|aparcamiento|salida|entrada|parking)\b/i;

export function dist(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const x = dLon * Math.cos((a[0] + b[0]) / 2 * toR);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

/** Decodifica un tramo [lat0, lon0, dlat1, dlon1, ...] en unidades de 1e-5 grados. */
export function decodeWay(a) {
  const out = [];
  let la = 0, lo = 0;
  for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; out.push([la / 1e5, lo / 1e5]); }
  return out;
}

/** Generador aleatorio con semilla (mulberry32), para poder repetir una partida en los tests. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(a, random = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Calles de un municipio (data/m/<id>.json) con longitud, centro y forma normalizada del nombre.
 * Devuelve { streets, playable }.
 */
export function buildStreets(data) {
  const streets = data.streets.map(([name, encoded]) => {
    const s = { name, ways: encoded.map(decodeWay), len: 0, core: core(name), type: typeOf(name) };
    let la = 0, lo = 0, n = 0;
    for (const w of s.ways) {
      for (let i = 0; i < w.length; i++) {
        if (i) s.len += dist(w[i - 1], w[i]);
        la += w[i][0]; lo += w[i][1]; n++;
      }
    }
    s.c = [la / n, lo / n];
    return s;
  });
  const playable = streets.filter(s => s.len > 90 && s.core.length > 2 && !NOT_PLAYABLE.test(s.name));
  return { streets, playable };
}

/** 3 calles para despistar: del mismo tipo (calle/avenida/plaza…) y cercanas, con nombres distintos. */
export function pickDistractors(streets, target, random = Math.random) {
  const pool = streets.filter(s => s !== target && s.core !== target.core && s.core.length > 2 && !NOT_PLAYABLE.test(s.name));
  const scored = pool.map(s => ({ s, d: dist(target.c, s.c) + (s.type === target.type ? 0 : 1500) + random() * 1500 }));
  scored.sort((a, b) => a.d - b.d);
  const out = [], cores = new Set([target.core]);
  for (const { s } of scored) {
    if (cores.has(s.core)) continue;
    cores.add(s.core);
    out.push(s);
    if (out.length === 3) break;
  }
  return out;
}

/** `n` rondas sin repetir calle: [{ target: nombre, options: [4 nombres] }] */
export function makeRounds({ streets, playable }, n, random = Math.random) {
  const pool = shuffle([...playable], random);
  const rounds = [], used = new Set();
  for (const target of pool) {
    if (rounds.length === n) break;
    if (used.has(target.core)) continue;
    used.add(target.core);
    const options = shuffle([target, ...pickDistractors(streets, target, random)], random).map(s => s.name);
    rounds.push({ target: target.name, options });
  }
  return rounds;
}
