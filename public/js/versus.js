// Modo 1vs1: búsqueda de rival, partida y resultado.
// El rival puede ser una persona (servidor /api/arena, ver server/arena.js) o la CPU (aquí mismo).
// Las dos fuentes hablan el mismo "idioma" de mensajes: match, verdict, opp, end.
import { $, show, toast, setError, paintAvatar, escapeHtml, fmt } from './ui.js';
import * as game from './game.js';
import { drawAvatar } from './avatar.js';
import { makeRounds } from './rounds.js';
import { famousVersusRounds } from './famous.js';
import { auth } from './firebase.js';
import { loadIndex, cityById } from './cities.js';

const ROUNDS = 7, FREEZE_MS = 3000, COUNTDOWN_MS = 4000;
const CPU_AVATAR = 'px:skin_0.face_cool.hair_mohawk.hc_6.top_suit.tc_5.bottom_black.shoes_red.hat_headphones.acc_pixelshades.bg_city.pet_none';
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- Conexión con el servidor ----------
function connect(token, onMessage, onClose) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/arena`);
  let opened = false;
  ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'auth', token })); };
  ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch { /* mensaje raro */ } };
  ws.onclose = () => onClose(opened);
  return { send: m => ws.readyState === 1 && ws.send(JSON.stringify(m)), close: () => { ws.onclose = null; ws.close(); } };
}

// ---------- Rival CPU ----------
/** Simula al servidor: arbitra tus respuestas y hace avanzar a la CPU con tiempos según tu ELO. */
function cpuSession(rounds, elo, emit) {
  const base = Math.min(16, Math.max(5, 12 - (elo - 1000) / 80)) * 1000;   // ms por calle
  const start = Date.now() + COUNTDOWN_MS;
  const me = { round: 0, frozenUntil: 0, times: [] }, cpu = { round: 0, times: [] };
  const timers = [];
  let over = false;
  const finish = winner => {
    if (over) return;
    over = true;
    timers.forEach(clearTimeout);
    emit({ t: 'end', reason: 'completa', result: winner, cpu: true,
      you: { delta: 0, round: me.round, times: me.times }, opp: { round: cpu.round, times: cpu.times } });
  };
  // calendario de la CPU: cada calle tarda base ± 40 %, y a veces falla (3 s de bloqueo)
  let t = COUNTDOWN_MS;
  for (let r = 0; r < ROUNDS; r++) {
    t += base * (0.6 + Math.random() * 0.8) + (Math.random() < 0.2 ? FREEZE_MS : 0);
    timers.push(setTimeout(() => {
      cpu.round = r + 1;
      cpu.times.push(Date.now() - start);
      emit({ t: 'opp', round: cpu.round });
      if (cpu.round >= ROUNDS) finish('loss');
    }, t));
  }
  return {
    send(m) {
      if (over) return;
      if (m.t === 'forfeit') return finish('loss');
      if (m.t !== 'guess') return;
      const now = Date.now();
      if (now < start || m.round !== me.round) return;
      if (now < me.frozenUntil) return emit({ t: 'verdict', round: m.round, ok: false, frozenMs: me.frozenUntil - now });
      if (m.name === rounds[m.round].target) {
        me.round++;
        me.times.push(now - start);
        emit({ t: 'verdict', round: m.round, ok: true });
        if (me.round >= ROUNDS) finish('win');
      } else {
        me.frozenUntil = now + FREEZE_MS;
        emit({ t: 'verdict', round: m.round, ok: false, frozenMs: FREEZE_MS });
      }
    },
    close() { over = true; timers.forEach(clearTimeout); },
  };
}

// ---------- Controlador ----------
export function setupVersus({ getUser, getProfile, refreshProfile, onHome, setGameUi, onRoomCreated }) {
  let session = null;        // conexión o CPU
  let last = null;           // { mode, city } para "Otra partida"
  let match = null;          // partida en curso { rounds, opp, start, … }
  let searchTimer = 0, clockTimer = 0, searchSince = 0;

  const close = () => {
    session?.close();
    session = null;
    clearInterval(searchTimer);
    clearInterval(clockTimer);
  };

  // ---------- Búsqueda ----------
  /** variant: 'streets' (calles de una ciudad) | 'famous' (calles famosas de toda España) */
  async function search(mode, city, variant = 'streets') {
    close();
    if (variant === 'famous' && mode === 'city') mode = 'random';
    last = { mode, city, variant };
    if (mode === 'cpu') return startCpu(city, '', variant);
    show('search');
    setError('searchError', '');
    paintAvatar($('searchAv'), getProfile().avatar);
    $('searchWhere').textContent = variant === 'famous' ? 'para un duelo de calles famosas' : mode === 'city' ? `en ${city.name}` : 'en cualquier ciudad de España';
    $('searchOnline').textContent = '';
    $('searchRange').textContent = '';
    searchSince = Date.now();
    searchTimer = setInterval(() => { $('searchTime').textContent = fmtTime(Date.now() - searchSince); }, 250);
    $('searchTime').textContent = '0:00';

    let token;
    try { token = await getUser().getIdToken(); } catch { return fallbackToCpu(city, 'Sin conexión.'); }
    session = connect(token, msg => onMessage(msg), opened => {
      if (match && !match.over) return reconnect();
      if (session && !match) fallbackToCpu(city, opened ? 'Se ha cortado la conexión.' : 'El modo online necesita el servidor de StreetGuessr.');
    });
    session.pending = { t: 'search', mode, cityId: city?.id, variant };
  }

  // ---------- Salas privadas (amistosas) ----------
  /** Crea una sala y enseña el código y el enlace. opts.friend: { uid, name } para avisarle. */
  async function createRoom(city, opts = {}) {
    close();
    const variant = opts.variant || 'streets';
    if (variant === 'famous') city = null;
    last = { mode: 'room', city, friend: opts.friend, variant };
    show('room');
    setError('roomError', '');
    $('roomCode').textContent = '·····';
    $('roomLink').value = '';
    const where = variant === 'famous' ? 'Duelo de calles famosas de toda España' : city ? `Jugaréis en ${city.name}` : 'Jugaréis en una ciudad al azar';
    $('roomWhere').textContent = `${where}${opts.friend?.name ? ` · le avisamos a ${opts.friend.name}` : ''}.`;
    $('roomStatus').textContent = 'Creando la sala…';
    await open({ t: 'room-create', cityId: city?.id, variant }, 'Las salas necesitan el servidor de StreetGuessr.');
  }

  async function joinRoom(code) {
    close();
    last = { mode: 'join', code };
    show('search');
    setError('searchError', '');
    paintAvatar($('searchAv'), getProfile().avatar);
    $('searchWhere').textContent = `Entrando en la sala ${code.toUpperCase()}…`;
    $('searchOnline').textContent = '';
    $('searchRange').textContent = 'Partida amistosa';
    $('searchTime').textContent = '';
    await open({ t: 'room-join', code }, 'Las salas necesitan el servidor de StreetGuessr.');
  }

  /** Conecta y manda `first` en cuanto el servidor acepte la sesión. */
  async function open(first, offlineMsg) {
    let token;
    try { token = await getUser().getIdToken(); } catch { return roomFail('Sin conexión.'); }
    session = connect(token, msg => onMessage(msg), () => {
      if (match && !match.over) return reconnect();
      if (session && !match) roomFail(offlineMsg);
    });
    session.pending = first;
  }

  function roomFail(message) {
    setError(last?.mode === 'room' ? 'roomError' : 'searchError', message);
  }

  $('roomCancel').onclick = () => { session?.send({ t: 'room-close' }); close(); onHome(); };
  $('roomCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('roomLink').value); toast('Enlace copiado.'); } catch { $('roomLink').select(); }
  };
  $('roomShare').onclick = async () => {
    const url = $('roomLink').value;
    if (!url) return;
    const text = `¿Te atreves con un 1 vs 1 en StreetGuessr? Sala ${$('roomCode').textContent}`;
    try {
      if (navigator.share) await navigator.share({ title: 'StreetGuessr', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Enlace copiado: envíaselo a tu amigo.'); }
    } catch { /* cancelado */ }
  };

  function fallbackToCpu(city, why) {
    close();
    setError('searchError', `${why} Juegas contra la CPU.`);
    setTimeout(() => startCpu(city, why, last?.variant), 1500);
  }

  async function reconnect() {
    try {
      const token = await getUser().getIdToken();
      session = connect(token, msg => onMessage(msg), () => { if (match && !match.over) toast('Se ha perdido la conexión con la partida.', 6000); });
    } catch { /* se avisa al cerrar */ }
  }

  $('searchCancel').onclick = () => { session?.send({ t: 'cancel' }); close(); onHome(); };

  async function startCpu(city, why, variant = 'streets') {
    close();
    const elo = getProfile().elo ?? 1000;
    if (variant === 'famous') {
      const rounds = famousVersusRounds(ROUNDS);
      session = cpuSession(rounds, elo, onMessage);
      return onMessage({
        t: 'match', cityId: null, cityName: 'Calles famosas de España', variant, rounds, startIn: COUNTDOWN_MS, elapsed: 0,
        you: { elo, round: 0 }, opp: { name: 'CPU', avatar: CPU_AVATAR, elo: null, round: 0, cpu: true }, note: why,
      });
    }
    let target = city;
    if (!target) {
      const big = (await loadIndex()).filter(c => c.n >= 500);
      target = big[Math.random() * big.length | 0];
    }
    show('loading');
    try { await game.loadCity(target.id); } catch (e) { toast(e.message, 6000); return onHome(); }
    const rounds = makeRounds(game.currentCity(), ROUNDS);
    session = cpuSession(rounds, elo, onMessage);
    onMessage({
      t: 'match', cityId: target.id, cityName: target.name, rounds, startIn: COUNTDOWN_MS, elapsed: 0,
      you: { elo, round: 0 }, opp: { name: 'CPU', avatar: CPU_AVATAR, elo: null, round: 0, cpu: true }, note: why,
    });
  }

  // ---------- Mensajes del árbitro ----------
  async function onMessage(msg) {
    if (msg.t === 'ready') {
      if (session?.pending) { session.send(session.pending); session.pending = null; }
    } else if (msg.t === 'searching') {
      $('searchOnline').textContent = msg.online > 1 ? `${fmt(msg.online)} jugadores conectados` : 'Eres el único conectado ahora mismo';
      $('searchRange').textContent = msg.range ? `ELO ${fmt(Math.max(0, msg.range[0]))}–${fmt(msg.range[1])}` : 'Buscando a cualquiera';
    } else if (msg.t === 'cpu') {
      const city = msg.cityId ? cityById(msg.cityId) : null;
      setError('searchError', msg.reason === 'nadie' ? 'No hay nadie jugando ahora mismo: juegas contra la CPU.' : 'No hay rivales disponibles: juegas contra la CPU.');
      setTimeout(() => startCpu(city, 'cpu', msg.variant), 1200);
    } else if (msg.t === 'error') {
      roomFail(msg.message);
    } else if (msg.t === 'room') {
      $('roomCode').textContent = msg.code;
      $('roomLink').value = `${location.origin}${location.pathname}?sala=${msg.code}${location.search.includes('emulador') ? '&emulador' : ''}`;
      $('roomStatus').textContent = 'Esperando a tu amigo… La partida empieza en cuanto entre.';
      if (last?.friend) onRoomCreated?.(last.friend, msg.code);
    } else if (msg.t === 'room-error') {
      roomFail(msg.message);
    } else if (msg.t === 'match') {
      await begin(msg);
    } else if (msg.t === 'verdict') {
      if (match && msg.round === game.versusState()?.myRound) {
        game.versusVerdict(msg);
        if (msg.ok) { match.me.round = msg.round + 1; paintDots(); }
      }
    } else if (msg.t === 'opp') {
      if (!match) return;
      match.opp.round = msg.round;
      game.versusOpponent(msg.round);
      paintDots();
    } else if (msg.t === 'end') {
      end(msg);
    } else if (msg.t === 'replaced') {
      toast('Has abierto StreetGuessr en otra pestaña.', 6000);
    }
  }

  async function begin(msg) {
    clearInterval(searchTimer);
    const me = getProfile();
    if (!msg.opp.cpu && msg.cityId && game.currentCity()?.id !== msg.cityId) {
      show('loading');
      try { await game.loadCity(msg.cityId); } catch (e) { toast(e.message, 6000); session?.send({ t: 'forfeit' }); return onHome(); }
    }
    match = {
      rounds: msg.rounds, cityName: msg.cityName, over: false, cpu: !!msg.opp.cpu, ranked: msg.ranked !== false && !msg.opp.cpu,
      famous: msg.variant === 'famous',
      start: Date.now() + Math.max(0, msg.startIn) - (msg.elapsed || 0),
      me: { name: me.username, avatar: me.avatar, elo: msg.you.elo, round: msg.you.round || 0 },
      opp: { name: msg.opp.name || 'Rival', avatar: msg.opp.avatar, elo: msg.opp.elo, round: msg.opp.round || 0 },
    };
    $('cityName').textContent = msg.variant === 'famous' ? '⭐ Calles famosas' : msg.cityName;
    // presentación con cuenta atrás (si se vuelve a una partida empezada, directamente al juego)
    if (msg.startIn > 0) {
      show('vsintro');
      drawAvatar($('vsIntroMe'), match.me.avatar);
      drawAvatar($('vsIntroOpp'), match.opp.avatar);
      $('vsIntroMeName').textContent = match.me.name;
      $('vsIntroOppName').textContent = match.opp.name;
      const friendly = !match.cpu && !match.ranked;
      $('vsIntroMeElo').textContent = match.cpu ? 'Partida de práctica' : friendly ? 'Amistosa' : `ELO ${fmt(match.me.elo)}`;
      $('vsIntroOppElo').textContent = match.cpu ? 'Sin ELO en juego' : friendly ? 'No cuenta para el ELO' : `ELO ${fmt(match.opp.elo)}`;
      $('vsIntroCity').textContent = match.famous ? `⭐ ${ROUNDS} calles famosas de ${ROUNDS} ciudades` : `📍 ${msg.cityName} · ${ROUNDS} calles`;
      const tick = () => {
        const left = match.start - Date.now();
        if (left > 0) { $('vsCount').textContent = Math.ceil(left / 1000); requestAnimationFrame(tick); }
        else play(msg);
      };
      tick();
    } else play(msg);
  }

  function play() {
    show(null);
    setGameUi(true, true);
    paintAvatar($('vsMeAv'), match.me.avatar, match.me.name);
    paintAvatar($('vsOppAv'), match.opp.avatar, match.opp.name);
    $('vsMeName').textContent = match.me.name;
    $('vsOppName').textContent = match.opp.name;
    paintDots();
    game.startVersus({
      rounds: match.rounds,
      me: { avatar: match.me.avatar, name: match.me.name },
      opp: { avatar: match.opp.avatar, name: match.opp.name },
      myRound: match.me.round, oppRound: match.opp.round,
      onGuess: (round, name) => session?.send({ t: 'guess', round, name }),
    });
    clearInterval(clockTimer);
    clockTimer = setInterval(() => { $('vsClock').textContent = fmtTime(Date.now() - match.start); }, 250);
  }

  function paintDots() {
    const dots = n => Array.from({ length: ROUNDS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    $('vsMeDots').innerHTML = dots(match.me.round);
    $('vsOppDots').innerHTML = dots(match.opp.round);
  }

  function end(msg) {
    if (!match) return;
    match.over = true;
    clearInterval(clockTimer);
    session?.close();
    session = null;
    const title = { win: '¡Victoria!', loss: 'Derrota', draw: 'Empate' }[msg.result];
    $('vsResult').textContent = title;
    $('vsResult').className = msg.result;
    $('vsReason').textContent = {
      completa: msg.result === 'win' ? `Has acertado las ${ROUNDS} calles${match.famous ? ' famosas' : ` de ${match.cityName}`} antes que ${match.opp.name}.` : `${match.opp.name} ha acertado las ${ROUNDS} calles antes que tú.`,
      abandono: msg.result === 'win' ? `${match.opp.name} ha abandonado la partida.` : 'Has abandonado la partida.',
      tiempo: 'Se acabaron los 5 minutos: gana quien iba por delante.',
    }[msg.reason] || '';
    const side = (p, r, times) => `<span class="avatar"></span><b>${escapeHtml(p.name)}</b>` +
      `<small>${r}/${ROUNDS} calles${r >= ROUNDS ? ` · ${fmtTime(times.at(-1))}` : ''}</small>`;
    $('vsFinalMe').innerHTML = side(match.me, msg.you.round, msg.you.times);
    $('vsFinalOpp').innerHTML = side(match.opp, msg.opp.round, msg.opp.times);
    paintAvatar($('vsFinalMe').firstChild, match.me.avatar, match.me.name);
    paintAvatar($('vsFinalOpp').firstChild, match.opp.avatar, match.opp.name);
    $('vsFinalMe').classList.toggle('winner', msg.result === 'win');
    $('vsFinalOpp').classList.toggle('winner', msg.result === 'loss');
    $('vsAgain').textContent = last?.mode === 'room' ? 'Nueva sala' : 'Otra partida';
    $('vsElo').innerHTML = match.cpu ? 'Partida contra la CPU: no cambia tu ELO.'
      : !match.ranked ? 'Partida amistosa: no cambia el ELO.'
      : `ELO <b>${fmt(msg.you.elo)}</b> <span class="${msg.you.delta >= 0 ? 'up' : 'down'}">${msg.you.delta >= 0 ? '+' : ''}${msg.you.delta}</span>`;
    show('vsover');
    if (match.ranked) setTimeout(refreshProfile, 1500);   // el servidor guarda el ELO en Firestore
  }

  $('vsAgain').onclick = () => {
    match = null;
    if (last.mode === 'room') return createRoom(last.city, { friend: last.friend, variant: last.variant });
    if (last.mode === 'join') return onHome();
    search(last.mode, last.city, last.variant);
  };
  $('vsHome').onclick = () => { match = null; onHome(); };

  return {
    search,
    createRoom,
    joinRoom,
    /** Rendirse (botón de salir durante la partida). */
    forfeit() { if (match && !match.over) session?.send({ t: 'forfeit' }); },
    active: () => !!match && !match.over,
    stop() { close(); match = null; },
  };
}
