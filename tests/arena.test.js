// Tests del servidor 1vs1 (server/arena.js) con un reloj simulado: no hace falta Cloudflare ni Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArenaCore, ROUNDS, FREEZE_MS, COUNTDOWN_MS, MAX_MATCH_MS, FORFEIT_MS, CPU_AFTER_MS, CPU_ALONE_MS, eloChange } from '../server/arena.js';

const ROUNDS_DATA = Array.from({ length: ROUNDS }, (_, i) => ({ target: `Calle ${i}`, options: [`Calle ${i}`, 'Otra A', 'Otra B', 'Otra C'] }));

function arena() {
  let t = 1_000_000;
  const saved = [], cities = [];
  const core = new ArenaCore({
    now: () => t,
    random: () => 0.5,
    loadRounds: async cityId => { cities.push(cityId); return { cityId, cityName: `Ciudad ${cityId}`, rounds: ROUNDS_DATA }; },
    randomCity: async () => '28079',
    saveResult: async r => { saved.push(r); },
  });
  const players = {};
  const join = (uid, elo = 1000) => {
    const conn = { msgs: [], send(m) { this.msgs.push(m); }, close() {} };
    core.join(conn, { uid, name: uid.toUpperCase(), avatar: 'px:x', elo });
    players[uid] = conn;
    return conn;
  };
  const last = (uid, type) => players[uid].msgs.filter(m => m.t === type).at(-1);
  const flush = () => new Promise(r => setImmediate(r));
  const advance = async ms => { t += ms; core.tick(); await flush(); };
  return { core, join, last, flush, advance, saved, cities, players, get t() { return t; } };
}

async function matched(a, uids = ['ana', 'bob'], city = '26089') {
  for (const uid of uids) a.join(uid);
  for (const uid of uids) a.core.message(uid, { t: 'search', mode: 'city', cityId: city });
  await a.flush();
  return a.last(uids[0], 'match');
}

test('dos jugadores en la misma ciudad se emparejan al momento con las mismas calles', async () => {
  const a = arena();
  const m = await matched(a);
  assert.ok(m);
  assert.equal(m.cityId, '26089');
  assert.deepEqual(a.last('bob', 'match').rounds, m.rounds);
  assert.equal(m.opp.name, 'BOB');
  assert.equal(m.startIn, COUNTDOWN_MS);
});

test('en ciudades distintas no se emparejan y acaban contra la CPU', async () => {
  const a = arena();
  a.join('ana'); a.join('bob');
  a.core.message('ana', { t: 'search', mode: 'city', cityId: '26089' });
  a.core.message('bob', { t: 'search', mode: 'city', cityId: '28079' });
  await a.advance(CPU_AFTER_MS - 1000);
  assert.equal(a.last('ana', 'match'), undefined);
  assert.equal(a.last('ana', 'cpu'), undefined);
  await a.advance(1000);
  assert.equal(a.last('ana', 'cpu').cityId, '26089');
  assert.equal(a.last('bob', 'cpu').cityId, '28079');
});

test('si no hay nadie más conectado, CPU enseguida', async () => {
  const a = arena();
  a.join('ana');
  a.core.message('ana', { t: 'search', mode: 'random' });
  await a.advance(CPU_ALONE_MS);
  assert.equal(a.last('ana', 'cpu').reason, 'nadie');
});

test('prioriza ELO parecido y con la espera acepta a cualquiera', async () => {
  const a = arena();
  a.join('ana', 1000); a.join('bob', 1400);
  a.core.message('ana', { t: 'search', mode: 'city', cityId: '26089' });
  a.core.message('bob', { t: 'search', mode: 'city', cityId: '26089' });
  await a.flush();
  assert.equal(a.last('ana', 'match'), undefined, '400 puntos de diferencia: todavía no');
  // llega alguien con ELO parecido: se empareja con él antes que con bob
  a.join('cai', 1040);
  a.core.message('cai', { t: 'search', mode: 'city', cityId: '26089' });
  await a.flush();
  assert.equal(a.last('ana', 'match').opp.uid, 'cai');
  // bob, solo con ELO lejano, acaba emparejado con quien haya cuando la ventana se abre del todo
  a.join('dan', 900);
  a.core.message('dan', { t: 'search', mode: 'city', cityId: '26089' });
  await a.advance(9000);
  assert.equal(a.last('bob', 'match').opp.uid, 'dan');
});

test('aleatorio juega en la ciudad del otro; dos aleatorios, en una ciudad al azar', async () => {
  const a = arena();
  a.join('ana'); a.join('bob'); a.join('cai'); a.join('dan');
  a.core.message('ana', { t: 'search', mode: 'random' });
  a.core.message('bob', { t: 'search', mode: 'city', cityId: '37274' });
  await a.flush();
  assert.equal(a.last('ana', 'match').cityId, '37274');
  a.core.message('cai', { t: 'search', mode: 'random' });
  a.core.message('dan', { t: 'search', mode: 'random' });
  await a.flush();
  assert.equal(a.last('cai', 'match').cityId, '28079');
});

test('aciertos, fallos con bloqueo y victoria con ELO', async () => {
  const a = arena();
  await matched(a);
  a.core.message('ana', { t: 'guess', round: 0, name: 'Calle 0' });
  assert.equal(a.last('ana', 'verdict'), undefined, 'antes de la cuenta atrás no cuenta');
  await a.advance(COUNTDOWN_MS);

  a.core.message('ana', { t: 'guess', round: 0, name: 'Otra A' });
  assert.deepEqual(a.last('ana', 'verdict'), { t: 'verdict', round: 0, ok: false, frozenMs: FREEZE_MS });
  a.core.message('ana', { t: 'guess', round: 0, name: 'Calle 0' });
  assert.equal(a.last('ana', 'verdict').ok, false, 'bloqueada: aunque acierte no cuenta');
  await a.advance(FREEZE_MS);

  for (let r = 0; r < ROUNDS; r++) {
    a.core.message('ana', { t: 'guess', round: r, name: `Calle ${r}` });
    assert.equal(a.last('ana', 'verdict').ok, true);
    assert.equal(a.last('bob', 'opp').round, r + 1, 'el rival ve el avance');
  }
  a.core.message('bob', { t: 'guess', round: 0, name: 'Calle 0' });   // ya ha terminado

  const endA = a.last('ana', 'end'), endB = a.last('bob', 'end');
  assert.equal(endA.result, 'win');
  assert.equal(endB.result, 'loss');
  assert.equal(endA.you.delta, 16);
  assert.equal(endB.you.elo, 984);
  assert.equal(endB.opp.round, ROUNDS);
  assert.equal(a.saved.length, 1);
  assert.deepEqual(a.saved[0].players.map(p => [p.uid, p.after]), [['ana', 1016], ['bob', 984]]);
  assert.equal(a.saved[0].winner, 'ana');
});

test('una respuesta de otra ronda se ignora', async () => {
  const a = arena();
  await matched(a);
  await a.advance(COUNTDOWN_MS);
  a.core.message('ana', { t: 'guess', round: 3, name: 'Calle 3' });
  assert.equal(a.last('ana', 'verdict'), undefined);
});

test('desconectarse: si vuelves a tiempo sigues; si no, pierdes por abandono', async () => {
  const a = arena();
  await matched(a);
  await a.advance(COUNTDOWN_MS);
  a.core.message('ana', { t: 'guess', round: 0, name: 'Calle 0' });
  a.core.leave(a.players.ana);
  await a.advance(FORFEIT_MS - 1000);
  const again = a.join('ana');
  const resume = again.msgs.find(m => m.t === 'match');
  assert.equal(resume.resume, true);
  assert.equal(resume.you.round, 1);
  a.core.leave(again);
  await a.advance(FORFEIT_MS + 1000);
  assert.equal(a.last('bob', 'end').result, 'win');
  assert.equal(a.last('bob', 'end').reason, 'abandono');
});

test('rendirse da la victoria al rival', async () => {
  const a = arena();
  await matched(a);
  a.core.message('bob', { t: 'forfeit' });
  assert.equal(a.last('ana', 'end').result, 'win');
});

test('si se acaba el tiempo gana quien va por delante', async () => {
  const a = arena();
  await matched(a);
  await a.advance(COUNTDOWN_MS);
  a.core.message('bob', { t: 'guess', round: 0, name: 'Calle 0' });
  await a.advance(MAX_MATCH_MS);
  assert.equal(a.last('bob', 'end').result, 'win');
  assert.equal(a.last('bob', 'end').reason, 'tiempo');
});

test('ELO: ganar a alguien mejor da más puntos', () => {
  assert.equal(eloChange(1000, 1000, 1), 16);
  assert.ok(eloChange(1000, 1400, 1) > 25);
  assert.ok(eloChange(1400, 1000, 1) < 5);
  assert.equal(eloChange(1000, 1000, 0.5), 0);
});

test('sala privada: el amigo entra con el código y juegan una amistosa sin ELO', async () => {
  const a = arena();
  a.join('ana'); a.join('bob');
  a.core.message('ana', { t: 'room-create', cityId: '26089' });
  const { code } = a.last('ana', 'room');
  assert.match(code, /^[A-Z2-9]{5}$/);
  a.core.message('ana', { t: 'room-join', code });
  assert.match(a.last('ana', 'room-error').message, /propia sala/);
  a.core.message('bob', { t: 'room-join', code: code.toLowerCase() });
  await a.flush();
  const m = a.last('bob', 'match');
  assert.equal(m.cityId, '26089');
  assert.equal(m.ranked, false);
  assert.equal(m.opp.uid, 'ana');
  await a.advance(COUNTDOWN_MS);
  for (let r = 0; r < ROUNDS; r++) a.core.message('bob', { t: 'guess', round: r, name: `Calle ${r}` });
  assert.equal(a.last('bob', 'end').result, 'win');
  assert.equal(a.last('bob', 'end').you.delta, 0);
  assert.equal(a.saved[0].ranked, false);
  a.join('cai');
  a.core.message('cai', { t: 'room-join', code });
  assert.match(a.last('cai', 'room-error').message, /no existe/);
});

test('sala privada: caduca y desaparece si el anfitrión se va', async () => {
  const a = arena();
  a.join('ana'); a.join('bob');
  a.core.message('ana', { t: 'room-create' });
  const { code } = a.last('ana', 'room');
  a.core.leave(a.players.ana);
  a.core.message('bob', { t: 'room-join', code });
  assert.match(a.last('bob', 'room-error').message, /no existe/);
  a.join('ana');
  a.core.message('ana', { t: 'room-create' });
  const second = a.last('ana', 'room').code;
  await a.advance(31 * 60_000);
  a.core.message('bob', { t: 'room-join', code: second });
  assert.match(a.last('bob', 'room-error').message, /no existe/);
});

test('sala sin ciudad: se juega en una al azar', async () => {
  const a = arena();
  a.join('ana'); a.join('bob');
  a.core.message('ana', { t: 'room-create' });
  a.core.message('bob', { t: 'room-join', code: a.last('ana', 'room').code });
  await a.flush();
  assert.equal(a.last('ana', 'match').cityId, '28079');
});

test('calles famosas: solo se empareja con quien busca lo mismo y cada calle es de una ciudad', async () => {
  const a = arena();
  a.join('ana'); a.join('bob'); a.join('cai');
  a.core.message('ana', { t: 'search', mode: 'random', variant: 'famous' });
  a.core.message('bob', { t: 'search', mode: 'random' });                       // calles de una ciudad
  await a.flush();
  assert.equal(a.last('ana', 'match'), undefined, 'variantes distintas no se mezclan');
  a.core.message('cai', { t: 'search', mode: 'city', cityId: '26089', variant: 'famous' });   // la ciudad se ignora
  await a.flush();
  const m = a.last('ana', 'match');
  assert.equal(m.opp.uid, 'cai');
  assert.equal(m.variant, 'famous');
  assert.equal(m.cityId, null);
  assert.equal(new Set(m.rounds.map(r => r.cityId)).size, ROUNDS);
  assert.ok(m.rounds.every(r => r.street && r.options.includes(r.target)));
  await a.advance(COUNTDOWN_MS);
  a.core.message('ana', { t: 'guess', round: 0, name: m.rounds[0].target });
  assert.equal(a.last('ana', 'verdict').ok, true);
  a.core.message('ana', { t: 'guess', round: 1, name: m.rounds[1].options.find(o => o !== m.rounds[1].target) });
  assert.equal(a.last('ana', 'verdict').ok, false);
});

test('sala de calles famosas', async () => {
  const a = arena();
  a.join('ana'); a.join('bob');
  a.core.message('ana', { t: 'room-create', cityId: '26089', variant: 'famous' });
  assert.equal(a.last('ana', 'room').variant, 'famous');
  a.core.message('bob', { t: 'room-join', code: a.last('ana', 'room').code });
  await a.flush();
  assert.equal(a.last('bob', 'match').variant, 'famous');
  assert.equal(a.cities.length, 0, 'no hace falta cargar ninguna ciudad en el servidor');
});
