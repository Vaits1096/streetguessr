// Pantalla de ranking: por ciudad (mejor partida) y mundial (puntos totales).
import { $, show, escapeHtml, avatarHtml, fmt } from './ui.js';
import { cityRanking, worldRanking, versusRanking, cityPosition, worldPosition, myCityScore, dailyRanking, dailyResult, dailyPosition, RANK_SIZE } from './store.js';
import { todayNumber, dayLabel, DAILY_ROUNDS } from './famous.js';
import { searchCities, renderCityList, cityLabel } from './cities.js';

export function setupRanking({ getUser, getProfile, getDefaultCity }) {
  let tab = 'city';
  let city = null;   // { id, name, prov }
  let loadId = 0;

  for (const t of $('rankTabs').children) t.onclick = () => { tab = t.dataset.tab; render(); };

  const search = $('rankCitySearch'), suggest = $('rankCitySuggest');
  search.addEventListener('input', () => {
    const v = search.value.trim();
    suggest.hidden = !v;
    if (v) renderCityList(suggest, searchCities(v, 8), c => {
      city = c;
      search.value = '';
      suggest.hidden = true;
      render();
    });
  });

  const row = (pos, name, sub, avatar, value, me) =>
    `<li class="${me ? 'me' : ''}"><span class="pos">${pos}</span>${avatarHtml(avatar, name)}` +
    `<span class="name">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span><span class="num">${value}</span></li>`;

  async function render() {
    for (const t of $('rankTabs').children) t.classList.toggle('active', t.dataset.tab === tab);
    $('rankCityPicker').hidden = tab !== 'city';
    suggest.hidden = true;
    const list = $('rankList'), mine = $('rankMine'), title = $('rankTitle');
    const uid = getUser().uid;
    const id = ++loadId;
    list.innerHTML = '<li class="empty">Cargando…</li>';
    mine.textContent = '';

    try {
      if (tab === 'city') {
        if (!city) { title.textContent = 'Busca una ciudad para ver su ranking.'; list.innerHTML = ''; return; }
        title.textContent = `Mejor partida en ${cityLabel(city)}`;
        const [rows, me] = await Promise.all([cityRanking(city.id), myCityScore(city.id, uid)]);
        if (id !== loadId) return;
        list.innerHTML = rows.length ? rows.map((r, i) =>
          row(i + 1, r.username, r.locality, r.avatar, `${fmt(r.best)} <small>pts</small>`, r.uid === uid)).join('')
          : '<li class="empty">Nadie ha jugado aquí todavía. ¡Sé el primero!</li>';
        if (me && !rows.some(r => r.uid === uid)) {
          const pos = await cityPosition(city.id, me.best);
          if (id === loadId) mine.textContent = `Tu posición: ${fmt(pos)}.º con ${fmt(me.best)} puntos.`;
        } else if (!me) {
          mine.textContent = 'Aún no has jugado en esta ciudad.';
        }
      } else if (tab === 'daily') {
        const day = todayNumber();
        title.textContent = `Reto diario del ${dayLabel(day)} · ${DAILY_ROUNDS} calles famosas`;
        const [rows, me] = await Promise.all([dailyRanking(day), dailyResult(day, uid)]);
        if (id !== loadId) return;
        const secs = ms => `${Math.round(ms / 1000)} s`;
        list.innerHTML = rows.length ? rows.map((r, i) =>
          row(i + 1, r.username, `${r.hits}/${DAILY_ROUNDS} · ${secs(r.ms)}`, r.avatar, `${fmt(r.score)} <small>pts</small>`, r.uid === uid)).join('')
          : '<li class="empty">Nadie ha jugado el reto de hoy todavía. ¡Sé el primero!</li>';
        if (me && !rows.some(r => r.uid === uid)) {
          const pos = await dailyPosition(day, me.score);
          if (id === loadId) mine.textContent = `Tu posición: ${fmt(pos)}.º con ${fmt(me.score)} puntos.`;
        } else if (!me) mine.textContent = 'Aún no has jugado el reto de hoy.';
      } else if (tab === 'versus') {
        title.textContent = 'ELO del modo 1 vs 1 (sube al ganar y baja al perder)';
        const rows = await versusRanking();
        if (id !== loadId) return;
        list.innerHTML = rows.length ? rows.map((r, i) =>
          row(i + 1, r.username, `${fmt(r.compWins || 0)} V · ${fmt(r.compLosses || 0)} D`, r.avatar, `${fmt(r.elo)} <small>ELO</small>`, r.uid === uid)).join('')
          : '<li class="empty">Todavía no se ha jugado ningún 1 vs 1.</li>';
      } else {
        title.textContent = `Puntos totales sumando todas las partidas · top ${RANK_SIZE}`;
        const rows = await worldRanking();
        if (id !== loadId) return;
        list.innerHTML = rows.length ? rows.map((r, i) =>
          row(i + 1, r.username, r.locality, r.avatar, `${fmt(r.totalPoints)} <small>pts</small>`, r.uid === uid)).join('')
          : '<li class="empty">Todavía no hay partidas.</li>';
        const p = getProfile();
        if (p.gamesPlayed && !rows.some(r => r.uid === uid)) {
          const pos = await worldPosition(p.totalPoints);
          if (id === loadId) mine.textContent = `Tu posición: ${fmt(pos)}.º con ${fmt(p.totalPoints)} puntos.`;
        }
      }
    } catch (e) {
      if (id === loadId) list.innerHTML = `<li class="empty">No se ha podido cargar el ranking: ${escapeHtml(e.message)}</li>`;
    }
  }

  return {
    open(which = 'city') {
      tab = which;
      city = getDefaultCity() || city;
      search.value = '';
      show('ranking');
      render();
    },
  };
}
