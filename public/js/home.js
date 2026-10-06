// Pantalla de inicio tras el login: tu avatar en grande, elegir ubicación y jugar.
import { $, fmt, escapeHtml } from './ui.js';
import { drawAvatar } from './avatar.js';
import { searchCities, renderCityList, matchLocality, nearest, cityById } from './cities.js';
import { todayNumber, dayLabel, DAILY_ROUNDS } from './famous.js';
import * as game from './game.js';

const RECENT = 'streetguessr.recentCities';
const level = points => Math.floor(Math.sqrt((points || 0) / 250)) + 1;

export function setupHome({ getProfile, onPlay, onVersus, onRoom, onJoin, onDaily, onDailyRanking, dailyStatus, onFriends, onEdit, onShop, onRanking }) {
  const root = $('home');
  let picked = null, loading = null, mode = 'daily', variant = 'streets';

  // ---------- Modo: clásico o 1vs1 ----------
  for (const b of $('hmModes').children) b.onclick = () => setMode(b.dataset.mode);
  function setMode(m) {
    mode = m;
    for (const b of $('hmModes').children) b.classList.toggle('active', b.dataset.mode === m);
    const daily = m === 'daily';
    $('hmVsButtons').hidden = m !== 'versus';
    $('hmVariant').hidden = m !== 'versus';
    // en ordenador el 1 vs 1 usa un panel más ancho a dos columnas
    $('hmMain').classList.toggle('vs-wide', m === 'versus');
    root.querySelector('.hm-play').classList.toggle('vs', m === 'versus');
    $('hmLeague').hidden = m !== 'versus';
    $('hmDaily').hidden = !daily;
    $('hmEyebrow').textContent = daily ? `Reto del ${dayLabel(todayNumber())} · igual para todos`
      : m === 'versus' ? 'Competitivo · 7 calles · gana el más rápido' : 'Nueva partida';
    $('hmTitle').textContent = daily ? '¿Reconoces estas calles famosas?' : m === 'versus' ? '¿Contra quién juegas?' : '¿Dónde juegas hoy?';
    paintLeague();
    if (daily) {
      $('hmPicked').hidden = true;
      $('hmSearchBox').hidden = true;
      $('hmPlay').hidden = true;
      paintDaily();
    } else {
      $('hmPlay').hidden = false;
      setPicked(picked);
    }
  }
  async function paintDaily() {
    const btn = $('hmDailyPlay');
    btn.disabled = true;
    const st = await dailyStatus().catch(() => null);
    if (!st) { btn.disabled = false; return; }
    $('hmStreak').textContent = st.streak;
    $('hmDailyCount').textContent = DAILY_ROUNDS;
    $('hmDailyDone').hidden = !st.result;
    if (st.result) {
      $('hmDailyDone').innerHTML = `Hoy: <b>${st.result.hits}/${DAILY_ROUNDS}</b> calles · <b>${fmt(st.result.score)}</b> puntos. ¡Vuelve mañana para un reto nuevo!`;
      btn.textContent = 'Ya has jugado hoy';
    } else {
      btn.textContent = 'Jugar el reto de hoy';
      btn.disabled = false;
    }
  }
  $('hmDailyPlay').onclick = () => onDaily();
  $('hmDailyRank').onclick = () => onDailyRanking();
  $('hmFriends').onclick = () => onFriends();
  $('hmVsRoom').onclick = () => onRoom(variant === 'famous' ? null : picked, variant);
  $('hmJoin').onsubmit = e => {
    e.preventDefault();
    const code = $('hmJoinCode').value.trim().toUpperCase();
    if (/^[A-Z2-9]{5}$/.test(code)) { $('hmJoinCode').value = ''; onJoin(code); }
    else $('hmJoinCode').focus();
  };
  function paintLeague() {
    const p = getProfile();
    if (!p) return;
    const w = p.compWins || 0, l = p.compLosses || 0;
    $('hmLeague').innerHTML = `<span class="elo">🏆 ELO ${fmt(p.elo ?? 1000)}</span> ${w || l ? `${fmt(w)} victorias · ${fmt(l)} derrotas` : 'Aún no has jugado ningún 1 vs 1'}`;
  }
  for (const b of $('hmVariant').children) b.onclick = () => setVariant(b.dataset.variant);
  function setVariant(v) {
    variant = v;
    for (const b of $('hmVariant').children) b.classList.toggle('active', b.dataset.variant === v);
    setPicked(picked);
  }
  $('hmVsRandom').onclick = () => onVersus('random', null, variant);
  $('hmVsCpu').onclick = () => onVersus('cpu', variant === 'famous' ? null : picked, variant);

  $('hmEdit').onclick = () => onEdit();
  $('hmCoins').onclick = $('hmShop').onclick = () => onShop();
  $('hmRanking').onclick = () => onRanking();

  // ---------- Buscador ----------
  const input = $('hmCitySearch'), list = $('hmCityList');
  let sel = 0;
  const refresh = () => {
    renderCityList(list, searchCities(input.value, input.value ? 30 : 8), pick);
    sel = 0;
    list.firstElementChild?.classList.add('sel');
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('li.pick')];
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[sel]?.classList.remove('sel');
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[sel].classList.add('sel');
      items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[sel]?.click();
    }
  });
  $('hmPickedChange').onclick = () => { setPicked(null); setTimeout(() => input.focus(), 30); };

  function quickChips() {
    const box = $('hmQuick');
    box.innerHTML = '';
    const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; box.appendChild(b); return b; };
    const home = matchLocality(getProfile()?.locality);
    if (home) add(`🏠 ${home.name}`, () => pick(home));
    for (const id of recent()) {
      const c = cityById(id);
      if (c && c !== home) add(`🕑 ${c.name}`, () => pick(c));
    }
    if ('geolocation' in navigator) {
      const b = add('📍 Cerca de mí', () => {
        b.textContent = '📍 Buscando…';
        navigator.geolocation.getCurrentPosition(
          p => { b.textContent = '📍 Cerca de mí'; pick(nearest(p.coords.latitude, p.coords.longitude)); },
          () => { b.textContent = '📍 No disponible'; },
          { timeout: 10000, maximumAge: 600000 });
      });
    }
  }

  function pick(c) {
    setPicked(c);
    remember(c.id);
    // se carga ya en el mapa de fondo para que la partida empiece al instante
    loading = game.loadCity(c.id).catch(e => { loading = null; throw e; });
    loading.catch(() => {});
  }

  function setPicked(c) {
    picked = c;
    if (mode === 'daily') return;
    if (mode === 'daily') return;
    const famous = mode === 'versus' && variant === 'famous';
    // calles famosas: no hace falta elegir ciudad
    $('hmPicked').hidden = famous || !c;
    $('hmSearchBox').hidden = famous || !!c;
    $('hmVsRandom').hidden = famous;
    const btn = $('hmPlay');
    btn.disabled = !c && !famous;
    btn.textContent = famous ? '⚔️ Buscar rival'
      : mode === 'versus' ? (c ? `⚔️ Buscar rival en ${c.name}` : 'Elige ciudad para buscar rival')
      : (c ? `Jugar en ${c.name} →` : 'Elige una ubicación');
    $('hmVsCpu').innerHTML = `🤖 Contra la CPU <small>${famous ? 'calles famosas' : c ? `en ${escapeHtml(c.name)}` : 'ciudad al azar'}</small>`;
    $('hmVsRoom').innerHTML = `👥 Sala con un amigo <small>${famous ? 'calles famosas · te damos un enlace' : 'te damos un enlace'}</small>`;
    if (c) {
      $('hmPickedName').textContent = c.name;
      $('hmPickedInfo').textContent = `${c.prov} · ${fmt(c.n)} calles`;
    } else {
      input.value = '';
      refresh();
      loading = null;
    }
  }

  $('hmPlay').onclick = async () => {
    if (mode === 'versus' && variant === 'famous') return onVersus('random', null, 'famous');
    if (!picked) return;
    if (mode === 'versus') return onVersus('city', picked, 'streets');
    const btn = $('hmPlay');
    btn.disabled = true;
    btn.textContent = 'Cargando…';
    try {
      if (!loading || game.currentCity()?.id !== picked.id) loading = game.loadCity(picked.id);
      await loading;
      onPlay(picked);
    } catch (e) {
      btn.textContent = `No se ha podido cargar ${picked.name}`;
    } finally {
      btn.disabled = false;
      if (picked) setPicked(picked);
    }
  };

  function paint() {
    const p = getProfile();
    drawAvatar($('hmAvatar'), p.avatar);
    $('hmName').textContent = p.username;
    $('hmLevel').textContent = `Nivel ${level(p.totalPoints)}`;
    $('hmStats').textContent = p.gamesPlayed
      ? `${fmt(p.gamesPlayed)} ${p.gamesPlayed === 1 ? 'partida' : 'partidas'} · récord ${fmt(p.bestScore)} · ${fmt(p.totalPoints)} puntos`
      : '¡Tu primera partida te espera!';
    $('hmCoinCount').textContent = fmt(p.coins);
    paintLeague();
    if (mode === 'daily') paintDaily();
  }

  return {
    /** Muestra el inicio. `preselect` (opcional) deja elegida esa ciudad. */
    show(preselect, wantMode) {
      root.hidden = false;
      if (wantMode) mode = wantMode;
      if (preselect) pick(preselect);
      else if (!picked) setPicked(null);
      setMode(mode);
      paint();
      quickChips();
    },
    hide() { root.hidden = true; },
    get picked() { return mode === 'daily' ? null : picked; },
    get variant() { return variant; },
    refresh: paint,
    get visible() { return !root.hidden; },
  };
}

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; }
}
function remember(id) {
  try { localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 3))); } catch {}
}

