// Partidas 1vs1: cola, emparejamiento por ELO y arbitraje de cada partida.
//
// ArenaCore no sabe nada de WebSockets ni de Cloudflare (se prueba en tests/arena.test.js con un reloj
// simulado). Arena es el Durable Object que la conecta con los jugadores.
import { buildStreets, makeRounds, seeded } from '../public/js/rounds.js';
import { famousVersusRounds } from '../public/js/famous.js';
import { verifyIdToken, getDoc, saveCompetitive } from './firebase.js';

export const ROUNDS = 7;
export const FREEZE_MS = 3000;          // bloqueo tras un fallo
export const COUNTDOWN_MS = 4000;       // cuenta atrás antes de empezar
export const MAX_MATCH_MS = 5 * 60_000; // si nadie termina en 5 min gana quien vaya por delante
export const FORFEIT_MS = 15_000;       // desconectado más de esto en partida = abandono
export const ELO_START = 1000, ELO_K = 32;

// Emparejamiento: se busca un ELO parecido y la ventana se abre con el tiempo de espera
const WINDOW_BASE = 100, WINDOW_GROW = 50;      // ±100 al principio, +50 por segundo
const ANYONE_AFTER_MS = 8_000;                  // después, contra cualquiera disponible
export const CPU_AFTER_MS = 20_000;             // nadie compatible → contra la CPU
export const CPU_ALONE_MS = 5_000;              // y si no hay nadie más conectado en el mundo, antes
export const ROOM_TTL_MS = 30 * 60_000;         // una sala sin usar caduca a la media hora
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I para que se lean bien

export function eloChange(a, b, scoreA) {
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  return Math.round(ELO_K * (scoreA - expected));
}

export class ArenaCore {
  /**
   * deps.loadRounds(cityId, seed) → { cityId, cityName, rounds } · deps.randomCity() → cityId
   * deps.saveResult(result) · deps.now() · deps.random()
   */
  constructor(deps) {
    this.deps = { now: Date.now, random: Math.random, saveResult: async () => {}, ...deps };
    this.players = new Map();   // uid → { uid, name, avatar, elo, conn, search, matchId, goneAt }
    this.matches = new Map();   // id → partida
    this.rooms = new Map();     // código → { host, cityId, created } (salas privadas para jugar con un amigo)
  }
  now() { return this.deps.now(); }
  send(p, msg) { try { p?.conn?.send(msg); } catch { /* conexión cerrada */ } }

  // ---------- Conexiones ----------
  join(conn, profile) {
    const prev = this.players.get(profile.uid);
    if (prev?.conn && prev.conn !== conn) { this.send(prev, { t: 'replaced' }); prev.conn.close?.(); }
    const p = prev || { uid: profile.uid, search: null, matchId: null };
    Object.assign(p, { name: profile.name, avatar: profile.avatar, elo: profile.elo ?? ELO_START, conn, goneAt: null });
    this.players.set(p.uid, p);
    this.send(p, { t: 'ready', elo: p.elo, online: this.online() });
    // volver a una partida en curso (p. ej. tras recargar la página)
    const m = p.matchId && this.matches.get(p.matchId);
    if (m && !m.over) this.send(p, this.matchMsg(m, p.uid, true));
    return p;
  }

  leave(conn) {
    for (const p of this.players.values()) {
      if (p.conn !== conn) continue;
      p.conn = null;
      p.search = null;
      this.closeRooms(p.uid);
      if (p.matchId && this.matches.get(p.matchId) && !this.matches.get(p.matchId).over) p.goneAt = this.now();
      else this.players.delete(p.uid);
    }
  }

  online() { let n = 0; for (const p of this.players.values()) if (p.conn) n++; return n; }

  message(uid, msg) {
    const p = this.players.get(uid);
    if (!p) return;
    if (msg.t === 'search') return this.search(p, msg);
    if (msg.t === 'cancel') { p.search = null; return this.send(p, { t: 'cancelled' }); }
    if (msg.t === 'guess') return this.guess(p, msg.round, msg.name);
    if (msg.t === 'room-create') return this.createRoom(p, msg.cityId, msg.variant);
    if (msg.t === 'room-join') return this.joinRoom(p, msg.code);
    if (msg.t === 'room-close') return this.closeRooms(p.uid);
    if (msg.t === 'forfeit') {
      const m = this.matches.get(p.matchId);
      if (m && !m.over) return this.finish(m, this.opponentOf(m, p.uid), 'abandono');
    }
  }

  // ---------- Cola ----------
  /** variant: 'streets' (calles de una ciudad) | 'famous' (calles famosas de toda España, sin ciudad) */
  search(p, { mode, cityId, variant }) {
    if (p.matchId && !this.matches.get(p.matchId)?.over) return;
    variant = variant === 'famous' ? 'famous' : 'streets';
    if (variant === 'famous') { mode = 'random'; cityId = null; }
    if (mode !== 'city' && mode !== 'random') return;
    if (mode === 'city' && !(typeof cityId === 'string' && /^\d{5}$/.test(cityId))) return;
    p.matchId = null;
    p.search = { mode, variant, cityId: mode === 'city' ? cityId : null, since: this.now() };
    this.send(p, { t: 'searching', online: this.online() });
    this.tick();
  }

  // ---------- Salas privadas ----------
  createRoom(p, cityId, variant) {
    if (p.matchId && !this.matches.get(p.matchId)?.over) return;
    variant = variant === 'famous' ? 'famous' : 'streets';
    if (variant === 'famous') cityId = null;
    if (cityId != null && !(typeof cityId === 'string' && /^\d{5}$/.test(cityId))) return;
    this.closeRooms(p.uid);
    p.search = null;
    let code;
    do code = Array.from({ length: 5 }, () => ROOM_CHARS[Math.floor(this.deps.random() * ROOM_CHARS.length)]).join('');
    while (this.rooms.has(code));
    this.rooms.set(code, { host: p.uid, cityId: cityId || null, variant, created: this.now() });
    this.send(p, { t: 'room', code, cityId: cityId || null, variant });
  }

  joinRoom(p, code) {
    const key = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const room = this.rooms.get(key);
    const fail = message => this.send(p, { t: 'room-error', message });
    if (!room) return fail('Esa sala no existe o ya ha caducado.');
    if (room.host === p.uid) return fail('Es tu propia sala: envíale el enlace a un amigo.');
    const host = this.players.get(room.host);
    if (!host?.conn) return fail('Quien creó la sala ya no está conectado.');
    if (p.matchId && !this.matches.get(p.matchId)?.over) return fail('Ya estás en una partida.');
    this.rooms.delete(key);
    p.search = null;
    this.startMatch(host, p, { cityId: room.cityId, ranked: false, variant: room.variant });
  }

  closeRooms(uid) { for (const [code, r] of this.rooms) if (r.host === uid) this.rooms.delete(code); }

  window(p) {
    const waited = this.now() - p.search.since;
    return waited >= ANYONE_AFTER_MS ? Infinity : WINDOW_BASE + WINDOW_GROW * Math.floor(waited / 1000);
  }

  compatible(a, b) {
    if (a.search.variant !== b.search.variant) return false;
    if (a.search.mode === 'city' && b.search.mode === 'city') return a.search.cityId === b.search.cityId;
    return true;   // los que buscan "aleatorio" juegan donde quiera el otro (o donde toque si ambos son aleatorios)
  }

  /** Empareja a los que esperan, cae a la CPU si toca y vigila las partidas. Se llama cada segundo. */
  tick() {
    const now = this.now();
    const waiting = [...this.players.values()].filter(p => p.search && p.conn).sort((a, b) => a.search.since - b.search.since);
    const taken = new Set();
    for (const a of waiting) {
      if (taken.has(a.uid) || !a.search) continue;
      let best = null, bestDiff = Infinity;
      for (const b of waiting) {
        // (b.search puede haberse vaciado en esta misma vuelta si b ha pasado a jugar contra la CPU)
        if (b === a || taken.has(b.uid) || !b.search || !this.compatible(a, b)) continue;
        const diff = Math.abs(a.elo - b.elo);
        if (diff <= Math.max(this.window(a), this.window(b)) && diff < bestDiff) { best = b; bestDiff = diff; }
      }
      if (best) {
        taken.add(a.uid); taken.add(best.uid);
        this.startMatch(a, best, { cityId: a.search.cityId || best.search.cityId, ranked: true, variant: a.search.variant });
        continue;
      }
      const waited = now - a.search.since;
      const alone = this.online() <= 1;
      if (waited >= CPU_AFTER_MS || (alone && waited >= CPU_ALONE_MS)) {
        const s = a.search;
        a.search = null;
        this.send(a, { t: 'cpu', cityId: s.cityId, variant: s.variant, reason: alone ? 'nadie' : 'espera' });
      } else {
        const w = this.window(a);
        this.send(a, { t: 'searching', waited, online: this.online(), range: w === Infinity ? null : [a.elo - w, a.elo + w] });
      }
    }
    for (const m of this.matches.values()) this.watch(m, now);
    for (const [code, r] of this.rooms) if (now - r.created > ROOM_TTL_MS) this.rooms.delete(code);
  }

  // ---------- Partida ----------
  /** opts.cityId: ciudad (si no, una al azar) · opts.ranked: false en salas privadas (no cambia el ELO) */
  async startMatch(a, b, { cityId: wanted = null, ranked = true, variant = 'streets' } = {}) {
    // fuera de la cola antes de cualquier espera, para que el siguiente tick no los vuelva a emparejar
    a.search = null; b.search = null;
    this.closeRooms(a.uid); this.closeRooms(b.uid);
    const id = `m${this.now().toString(36)}${Math.floor(this.deps.random() * 1e6).toString(36)}`;
    a.matchId = id; b.matchId = id;
    let data;
    try {
      const seed = Math.floor(this.deps.random() * 2 ** 31);
      if (variant === 'famous') {
        data = { cityId: null, cityName: 'Calles famosas de España', rounds: famousVersusRounds(ROUNDS, seeded(seed)) };
      } else {
        const cityId = wanted || await this.deps.randomCity();
        data = await this.deps.loadRounds(cityId, seed);
      }
    } catch {
      a.matchId = null; b.matchId = null;
      for (const p of [a, b]) this.send(p, { t: 'error', message: 'No se ha podido preparar la partida. Vuelve a buscar.' });
      return;
    }
    const start = this.now() + COUNTDOWN_MS;
    const m = {
      id, cityId: data.cityId, cityName: data.cityName, rounds: data.rounds, start, end: start + MAX_MATCH_MS, over: false, ranked, variant,
      p: {
        [a.uid]: { round: 0, frozenUntil: 0, times: [] },
        [b.uid]: { round: 0, frozenUntil: 0, times: [] },
      },
      uids: [a.uid, b.uid],
      elo: { [a.uid]: a.elo, [b.uid]: b.elo },
    };
    this.matches.set(id, m);
    for (const p of [a, b]) this.send(p, this.matchMsg(m, p.uid, false));
  }

  opponentOf(m, uid) { return m.uids[0] === uid ? m.uids[1] : m.uids[0]; }

  matchMsg(m, uid, resume) {
    const opp = this.players.get(this.opponentOf(m, uid));
    return {
      t: 'match', id: m.id, cityId: m.cityId, cityName: m.cityName, rounds: m.rounds,
      startIn: m.start - this.now(), elapsed: Math.max(0, this.now() - m.start), ranked: m.ranked, variant: m.variant,
      you: { elo: m.elo[uid], round: m.p[uid].round },
      opp: { uid: opp?.uid, name: opp?.name, avatar: opp?.avatar, elo: m.elo[opp?.uid], round: m.p[opp?.uid]?.round ?? 0 },
      resume,
    };
  }

  guess(p, round, name) {
    const m = this.matches.get(p.matchId);
    if (!m || m.over) return;
    const now = this.now(), me = m.p[p.uid];
    if (now < m.start || round !== me.round || me.round >= ROUNDS) return;
    if (now < me.frozenUntil) return this.send(p, { t: 'verdict', round, ok: false, frozenMs: me.frozenUntil - now });
    const opp = this.players.get(this.opponentOf(m, p.uid));
    if (name === m.rounds[round].target) {
      me.round++;
      me.times.push(now - m.start);
      this.send(p, { t: 'verdict', round, ok: true });
      this.send(opp, { t: 'opp', round: me.round });
      if (me.round >= ROUNDS) this.finish(m, p.uid, 'completa');
    } else {
      me.frozenUntil = now + FREEZE_MS;
      this.send(p, { t: 'verdict', round, ok: false, frozenMs: FREEZE_MS });
    }
  }

  watch(m, now) {
    if (m.over) {
      if (now - m.end > 60_000) this.matches.delete(m.id);
      return;
    }
    for (const uid of m.uids) {
      const p = this.players.get(uid);
      if (!p || (p.goneAt && now - p.goneAt > FORFEIT_MS)) return this.finish(m, this.opponentOf(m, uid), 'abandono');
    }
    if (now >= m.end) {
      // tiempo: gana quien haya acertado más; a igualdad, quien llegó antes a su último acierto
      const [a, b] = m.uids, pa = m.p[a], pb = m.p[b];
      let winner = null;
      if (pa.round !== pb.round) winner = pa.round > pb.round ? a : b;
      else if (pa.round > 0) winner = pa.times[pa.round - 1] < pb.times[pb.round - 1] ? a : b;
      this.finish(m, winner, 'tiempo');
    }
  }

  finish(m, winner, reason) {
    if (m.over) return;
    m.over = true;
    m.end = this.now();
    const [a, b] = m.uids;
    const score = winner === a ? 1 : winner === b ? 0 : 0.5;
    const d = m.ranked ? eloChange(m.elo[a], m.elo[b], score) : 0;
    const after = { [a]: m.elo[a] + d, [b]: m.elo[b] - d };
    for (const uid of m.uids) {
      const p = this.players.get(uid), opp = this.opponentOf(m, uid);
      if (p) { p.elo = after[uid]; p.matchId = null; }
      this.send(p, {
        t: 'end', reason, ranked: m.ranked, result: winner === null ? 'draw' : winner === uid ? 'win' : 'loss',
        you: { elo: after[uid], delta: after[uid] - m.elo[uid], round: m.p[uid].round, times: m.p[uid].times },
        opp: { elo: after[opp], round: m.p[opp].round, times: m.p[opp].times },
      });
      if (p && !p.conn) this.players.delete(uid);
    }
    this.deps.saveResult({
      id: m.id, cityId: m.cityId, cityName: m.cityName, reason, winner, ranked: m.ranked, variant: m.variant,
      players: m.uids.map(uid => ({ uid, before: m.elo[uid], after: after[uid], round: m.p[uid].round, ms: m.p[uid].times.at(-1) ?? null })),
    }).catch(() => {});
  }
}

// ---------- Durable Object ----------
const RANDOM_CITY_MIN_STREETS = 500;   // las ciudades al azar son de las grandes, para que haya juego

export class Arena {
  constructor(state, env) {
    this.env = env;
    this.origin = null;
    this.cityIndex = null;
    this.core = new ArenaCore({
      loadRounds: (cityId, seed) => this.loadRounds(cityId, seed),
      randomCity: () => this.randomCity(),
      saveResult: r => saveCompetitive(this.env, r),
    });
    this.interval = null;
  }

  async asset(path) {
    const url = `${this.origin}/${path}`;
    const res = this.env.ASSETS ? await this.env.ASSETS.fetch(new Request(url)) : await fetch(url);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
  async loadRounds(cityId, seed) {
    const data = await this.asset(`data/m/${cityId}.json`);
    return { cityId, cityName: data.name, rounds: makeRounds(buildStreets(data), ROUNDS, seeded(seed)) };
  }
  async randomCity() {
    this.cityIndex ||= (await this.asset('data/municipios.json')).filter(c => c[5] >= RANDOM_CITY_MIN_STREETS);
    return this.cityIndex[Math.floor(Math.random() * this.cityIndex.length)][0];
  }

  async fetch(request) {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('Se esperaba un WebSocket', { status: 426 });
    this.origin ||= new URL(request.url).origin;
    this.interval ||= setInterval(() => this.core.tick(), 1000);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = { send: msg => server.send(JSON.stringify(msg)), close: () => server.close(4000, 'otra sesión') };
    let uid = null;
    server.addEventListener('message', async ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!uid) {
        if (msg.t !== 'auth') return;
        try {
          const user = await verifyIdToken(msg.token, this.env);
          const profile = await getDoc(this.env, `users/${user.sub}`);
          if (!profile) throw new Error('sin jugador');
          uid = user.sub;
          this.core.join(conn, { uid, name: profile.username, avatar: profile.avatar, elo: profile.elo });
        } catch {
          conn.send({ t: 'error', message: 'No se ha podido comprobar tu sesión.' });
          server.close(4001, 'auth');
        }
        return;
      }
      this.core.message(uid, msg);
    });
    const gone = () => this.core.leave(conn);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
