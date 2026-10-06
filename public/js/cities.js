// Índice de municipios (data/municipios.json) y buscador de ciudades.
import { $, escapeHtml, norm, fmt } from './ui.js';

let index = null;   // [{ id, name, prov, lat, lon, n, key }]

export async function loadIndex() {
  if (index) return index;
  const res = await fetch('data/municipios.json');
  if (!res.ok) throw new Error('No se pudo cargar la lista de municipios');
  index = (await res.json()).map(([id, name, prov, lat, lon, n]) => ({ id, name, prov, lat, lon, n, key: norm(name) }));
  return index;
}

export const cityById = id => index?.find(c => c.id === id) || null;
export const cityLabel = c => (c.prov && c.prov !== c.name ? `${c.name} (${c.prov})` : c.name);

/** Busca municipios: primero los que empiezan por el texto, luego los que lo contienen; a igualdad, los más grandes. */
export function searchCities(q, limit = 30) {
  const k = norm(q);
  if (!k) return [...index].sort((a, b) => b.n - a.n).slice(0, limit);
  const out = [];
  for (const c of index) {
    const pos = c.key.indexOf(k);
    if (pos < 0 && !norm(c.prov).startsWith(k)) continue;
    const rank = pos === 0 ? 0 : pos > 0 && c.key[pos - 1] === ' ' ? 1 : pos > 0 ? 2 : 3;
    out.push([rank, c]);
  }
  out.sort((a, b) => a[0] - b[0] || b[1].n - a[1].n);
  return out.slice(0, limit).map(x => x[1]);
}

/** Busca un municipio a partir del texto de "localidad" del perfil. */
export function matchLocality(text) {
  if (!text || !index) return null;
  const exact = index.find(c => cityLabel(c) === text);
  if (exact) return exact;
  const k = norm(text.replace(/\(.*\)/, ''));
  return index.filter(c => c.key === k).sort((a, b) => b.n - a.n)[0] || null;
}

export function nearest(lat, lon) {
  let best = null, bd = Infinity;
  for (const c of index) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Rellena una <ul> con resultados clicables. */
export function renderCityList(ul, cities, onPick) {
  ul.innerHTML = cities.length ? '' : '<li class="empty">No hay ningún municipio con ese nombre.</li>';
  for (const c of cities) {
    const li = document.createElement('li');
    li.className = 'pick';
    li.innerHTML = `<span class="name">${escapeHtml(c.name)}<small>${escapeHtml(c.prov)}</small></span><span class="num">${fmt(c.n)} <small>calles</small></span>`;
    li.onclick = () => onPick(c);
    ul.appendChild(li);
  }
}
