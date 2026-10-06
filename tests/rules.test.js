// Tests de firestore.rules contra el emulador. Ejecutar con: npm test
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, orderBy, getDocs,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { DEFAULT_AVATAR } from '../public/js/catalog.js';
import assert from 'node:assert/strict';
import { todayNumber } from '../public/js/famous.js';

let env;
const verified = { email_verified: true };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-calles',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const dbFor = (uid, claims = verified) => env.authenticatedContext(uid, claims).firestore();
const AV = DEFAULT_AVATAR;
const withPiece = (from, to) => AV.replace(from, to);

function newProfileBatch(db, uid, username) {
  const b = writeBatch(db);
  b.set(doc(db, 'usernames', username.toLowerCase()), { uid });
  b.set(doc(db, 'users', uid), {
    username, avatar: AV, locality: '',
    totalPoints: 0, gamesPlayed: 0, bestScore: 0, coins: 0, items: [], lastGame: '',
    createdAt: serverTimestamp(), lastGameAt: serverTimestamp(),
  });
  return b;
}

/** Crea un perfil (sin pasar por las reglas) con la última partida hace una hora. */
async function seedProfile(uid, username, extra = {}) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'usernames', username.toLowerCase()), { uid });
    await setDoc(doc(db, 'users', uid), {
      username, avatar: AV, locality: 'Logroño',
      totalPoints: 0, gamesPlayed: 0, bestScore: 0, coins: 0, items: [], lastGame: '',
      createdAt: Timestamp.fromMillis(Date.now() - 3600e3), lastGameAt: Timestamp.fromMillis(Date.now() - 3600e3),
      ...extra,
    });
  });
}

/** Igual que saveGame() de js/store.js, pero con valores manipulables. */
function gameBatch(db, uid, { score, hits, rounds = hits + 3, prevUser, prevScore, override = {} }) {
  const g = doc(collection(db, 'games'));
  const cityId = '26089', cityName = 'Logroño';
  const ps = prevScore || { best: 0, total: 0, games: 0 };
  const b = writeBatch(db);
  b.set(g, { uid, cityId, cityName, score, hits, rounds, seconds: 60, createdAt: serverTimestamp(), ...override.game });
  b.update(doc(db, 'users', uid), {
    totalPoints: prevUser.totalPoints + score, gamesPlayed: prevUser.gamesPlayed + 1,
    bestScore: Math.max(prevUser.bestScore, score), coins: prevUser.coins + hits,
    lastGame: g.id, lastGameAt: serverTimestamp(), ...override.user,
  });
  b.set(doc(db, 'scores', `${cityId}_${uid}`), {
    uid, cityId, cityName, username: prevUser.username, avatar: prevUser.avatar, locality: prevUser.locality,
    best: Math.max(ps.best, score), total: ps.total + score, games: ps.games + 1,
    lastGame: g.id, updatedAt: serverTimestamp(), ...override.score,
  });
  return b;
}

async function userData(uid) {
  let data;
  await env.withSecurityRulesDisabled(async ctx => { data = (await getDoc(doc(ctx.firestore(), 'users', uid))).data(); });
  return data;
}

// ---------- Perfiles ----------
test('un usuario verificado puede crear su jugador', async () => {
  await assertSucceeds(newProfileBatch(dbFor('ana'), 'ana', 'Ana_23').commit());
});

test('sin verificar el correo no se puede crear el jugador', async () => {
  await assertFails(newProfileBatch(dbFor('ana', { email_verified: false }), 'ana', 'Ana').commit());
});

test('no se puede coger un nombre que ya existe (sin distinguir mayúsculas)', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(newProfileBatch(dbFor('bob'), 'bob', 'ANA').commit());
});

test('no se puede crear un jugador con puntos', async () => {
  const db = dbFor('ana');
  const b = writeBatch(db);
  b.set(doc(db, 'usernames', 'ana'), { uid: 'ana' });
  b.set(doc(db, 'users', 'ana'), {
    username: 'ana', avatar: AV, locality: '', totalPoints: 99999, gamesPlayed: 0, bestScore: 0, coins: 0, items: [],
    lastGame: '', createdAt: serverTimestamp(), lastGameAt: serverTimestamp(),
  });
  await assertFails(b.commit());
});

test('nombre de jugador no válido', async () => {
  await assertFails(newProfileBatch(dbFor('ana'), 'ana', 'a b').commit());
  await assertFails(newProfileBatch(dbFor('ana'), 'ana', 'x').commit());
});

test('cambiar nombre libera el anterior y reserva el nuevo', async () => {
  await seedProfile('ana', 'Ana');
  const db = dbFor('ana');
  const b = writeBatch(db);
  b.set(doc(db, 'usernames', 'anita'), { uid: 'ana' });
  b.delete(doc(db, 'usernames', 'ana'));
  b.update(doc(db, 'users', 'ana'), { username: 'Anita', avatar: withPiece('face_smile', 'face_wink'), locality: 'Haro' });
  await assertSucceeds(b.commit());
});

test('no se puede cambiar el nombre a uno sin reservar ni borrar el de otro', async () => {
  await seedProfile('ana', 'Ana');
  await seedProfile('bob', 'Bob');
  const db = dbFor('ana');
  await assertFails(updateDoc(doc(db, 'users', 'ana'), { username: 'Libre' }));
  await assertFails(deleteDoc(doc(db, 'usernames', 'bob')));
});

test('no se pueden tocar los puntos editando el perfil', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { totalPoints: 5000 }));
});

test('no se puede editar el perfil de otro', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(updateDoc(doc(dbFor('bob'), 'users', 'ana'), { locality: 'Haro' }));
});

test('la edad solo la ve su dueño', async () => {
  await seedProfile('ana', 'Ana');
  await assertSucceeds(setDoc(doc(dbFor('ana'), 'users/ana/private/me'), { age: 30 }));
  await assertFails(setDoc(doc(dbFor('ana'), 'users/ana/private/me'), { age: 3 }));
  await assertSucceeds(getDoc(doc(dbFor('ana'), 'users/ana/private/me')));
  await assertFails(getDoc(doc(dbFor('bob'), 'users/ana/private/me')));
});

// ---------- Partidas ----------
test('guardar una partida válida', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertSucceeds(gameBatch(dbFor('ana'), 'ana', { score: 1350, hits: 10, prevUser }).commit());
  const u = await userData('ana');
  if (u.totalPoints !== 1350 || u.gamesPlayed !== 1 || u.bestScore !== 1350) throw new Error(JSON.stringify(u));
});

test('segunda partida en la misma ciudad suma al total y mantiene el récord', async () => {
  await seedProfile('ana', 'Ana', { totalPoints: 1350, gamesPlayed: 1, bestScore: 1350, lastGame: 'x' });
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'scores', '26089_ana'), {
    uid: 'ana', cityId: '26089', cityName: 'Logroño', username: 'Ana', avatar: AV, locality: 'Logroño',
    best: 1350, total: 1350, games: 1, lastGame: 'x', updatedAt: Timestamp.now(),
  }));
  const prevUser = await userData('ana');
  await assertSucceeds(gameBatch(dbFor('ana'), 'ana', {
    score: 300, hits: 3, prevUser, prevScore: { best: 1350, total: 1350, games: 1 },
  }).commit());
});

test('puntuación imposible para los aciertos', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 5000, hits: 10, prevUser }).commit());
});

test('rondas que no cuadran con 3 vidas', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, rounds: 10, prevUser }).commit());
});

test('la partida suma una moneda por acierto y no más', async () => {
  await seedProfile('ana', 'Ana', { coins: 5 });
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser, override: { user: { coins: 500 } } }).commit());
  await assertSucceeds(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser }).commit());
  if ((await userData('ana')).coins !== 15) throw new Error('esperaba 15 monedas');
});

test('total del jugador inflado', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser, override: { user: { totalPoints: 99999 } } }).commit());
});

test('récord de la ciudad inflado', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser, override: { score: { best: 99999 } } }).commit());
});

test('fila del ranking con el nombre de otro', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser, override: { score: { username: 'Bob' } } }).commit());
});

test('partidas demasiado seguidas (menos de 1 s por ronda)', async () => {
  await seedProfile('ana', 'Ana', { lastGameAt: Timestamp.now() });
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('ana'), 'ana', { score: 1000, hits: 10, prevUser }).commit());
});

test('no se puede guardar una partida a nombre de otro', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await assertFails(gameBatch(dbFor('bob'), 'ana', { score: 1000, hits: 10, prevUser }).commit());
});

test('una partida suelta sin actualizar perfil ni ranking', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(setDoc(doc(collection(dbFor('ana'), 'games')), {
    uid: 'ana', cityId: '26089', cityName: 'Logroño', score: 100, hits: 1, rounds: 4, seconds: 5, createdAt: serverTimestamp(),
  }));
});

// ---------- Ranking ----------
test('el ranking se puede leer y propagar un cambio de nombre', async () => {
  await seedProfile('ana', 'Ana');
  const prevUser = await userData('ana');
  await gameBatch(dbFor('ana'), 'ana', { score: 1350, hits: 10, prevUser }).commit();
  const db = dbFor('bob');
  const rows = await assertSucceeds(getDocs(query(collection(db, 'scores'), where('cityId', '==', '26089'), orderBy('best', 'desc'))));
  if (rows.size !== 1) throw new Error('esperaba 1 fila');

  // cambio de nombre en el perfil y luego en su fila del ranking
  const ana = dbFor('ana');
  const b = writeBatch(ana);
  b.set(doc(ana, 'usernames', 'anita'), { uid: 'ana' });
  b.delete(doc(ana, 'usernames', 'ana'));
  b.update(doc(ana, 'users', 'ana'), { username: 'Anita' });
  await b.commit();
  await assertSucceeds(updateDoc(doc(ana, 'scores', '26089_ana'), { username: 'Anita' }));
  await assertFails(updateDoc(doc(ana, 'scores', '26089_ana'), { username: 'Otro' }));
  await assertFails(updateDoc(doc(ana, 'scores', '26089_ana'), { best: 99999 }));
});

// ---------- Avatar, monedas y objetos ----------
test('el avatar inicial solo puede llevar piezas gratis', async () => {
  await assertSucceeds(newProfileBatch(dbFor('ana'), 'ana', 'Ana').commit());
  await env.clearFirestore();
  const db = dbFor('bob');
  const b2 = writeBatch(db);
  b2.set(doc(db, 'usernames', 'bob'), { uid: 'bob' });
  b2.set(doc(db, 'users', 'bob'), {
    username: 'Bob', avatar: withPiece('hat_none', 'hat_crown'), locality: '',
    totalPoints: 0, gamesPlayed: 0, bestScore: 0, coins: 0, items: [], lastGame: '',
    createdAt: serverTimestamp(), lastGameAt: serverTimestamp(),
  });
  await assertFails(b2.commit());
});

test('ponerse un objeto: gratis sí, sin tenerlo no, teniéndolo sí', async () => {
  await seedProfile('ana', 'Ana', { items: ['hat_cowboy'] });
  const ref = doc(dbFor('ana'), 'users', 'ana');
  await assertSucceeds(updateDoc(ref, { avatar: withPiece('hat_none', 'hat_cap') }));
  await assertFails(updateDoc(ref, { avatar: withPiece('hat_none', 'hat_halo') }));
  await assertSucceeds(updateDoc(ref, { avatar: withPiece('hat_none', 'hat_cowboy') }));
  await assertFails(updateDoc(ref, { avatar: 'e:🦊:#e5484d' }));
});

test('comprar con monedas descuenta el precio exacto', async () => {
  await seedProfile('ana', 'Ana', { coins: 100, items: ['acc_beard'] });
  const ref = doc(dbFor('ana'), 'users', 'ana');
  await assertFails(updateDoc(ref, { coins: 90, items: ['acc_beard', 'hat_beanie'] }));     // cuesta 50
  await assertFails(updateDoc(ref, { coins: 100, items: ['acc_beard', 'hat_beanie'] }));
  await assertFails(updateDoc(ref, { coins: 50, items: ['hat_beanie'] }));                  // quitando otro
  await assertSucceeds(updateDoc(ref, { coins: 50, items: ['acc_beard', 'hat_beanie'] }));
  await assertFails(updateDoc(ref, { coins: -70, items: ['acc_beard', 'hat_beanie', 'hat_cowboy'] }));  // sin saldo
});

test('los objetos premium no se pueden comprar con monedas', async () => {
  await seedProfile('ana', 'Ana', { coins: 99999 });
  const ref = doc(dbFor('ana'), 'users', 'ana');
  await assertFails(updateDoc(ref, { items: ['hat_halo'] }));
  await assertFails(updateDoc(ref, { coins: 99999 - 199, items: ['hat_halo'] }));
  await assertFails(updateDoc(ref, { coins: 99999, items: ['coins_4000'] }));
});

test('los logros solo se reclaman al cumplirlos', async () => {
  await seedProfile('ana', 'Ana', { gamesPlayed: 9 });
  await assertFails(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { items: ['top_jersey'] }));   // 10 partidas
  await assertSucceeds(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { items: ['hat_party'] }));  // 1 partida
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'users', 'ana'), { gamesPlayed: 10 }));
  await assertSucceeds(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { items: ['hat_party', 'top_jersey'] }));
});

test('las compras con dinero real solo las escribe el servidor', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(setDoc(doc(dbFor('ana'), 'purchases', 'cs_test'), { uid: 'ana', sku: 'hat_halo' }));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'purchases', 'cs_test'), { uid: 'ana', sku: 'hat_halo' }));
  await assertSucceeds(getDoc(doc(dbFor('ana'), 'purchases', 'cs_test')));
  await assertFails(getDoc(doc(dbFor('bob'), 'purchases', 'cs_test')));
});

test('mascotas: carísimas con monedas, las premium solo con dinero real', async () => {
  await seedProfile('ana', 'Ana', { coins: 2600 });
  const ref = doc(dbFor('ana'), 'users', 'ana');
  await assertFails(updateDoc(ref, { coins: 2600 - 499, items: ['pet_fox'] }));
  await assertFails(updateDoc(ref, { coins: 0, items: ['pet_dog'] }));          // cuesta 3.000
  await assertSucceeds(updateDoc(ref, { coins: 100, items: ['pet_cat'] }));     // 2.500
  await assertSucceeds(updateDoc(ref, { avatar: withPiece('pet_none', 'pet_cat') }));
  await assertFails(updateDoc(ref, { avatar: withPiece('pet_none', 'pet_dragon') }));
});

test('los avatares de 11 piezas (antes de las mascotas) siguen siendo válidos', async () => {
  await seedProfile('ana', 'Ana');
  await assertSucceeds(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { avatar: AV.replace('.pet_none', '').replace('face_smile', 'face_wink') }));
});

// ---------- Reto diario ----------
const TODAY = todayNumber();
const dailyBatch = (db, uid, day, { score = 350, hits = 2, streak = 1, user = {} } = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, 'daily', String(day), 'results', uid), { username: 'Ana', avatar: AV, score, hits, ms: 20000, at: serverTimestamp() });
  b.update(doc(db, 'users', uid), { dailyLast: day, dailyStreak: streak, ...user });
  return b;
};

test('reto diario: un resultado válido y la racha empieza en 1', async () => {
  await seedProfile('ana', 'Ana');
  await assertSucceeds(dailyBatch(dbFor('ana'), 'ana', TODAY).commit());
  assert.equal((await userData('ana')).dailyStreak, 1);
});

test('reto diario: solo una vez al día', async () => {
  await seedProfile('ana', 'Ana');
  await dailyBatch(dbFor('ana'), 'ana', TODAY).commit();
  await assertFails(dailyBatch(dbFor('ana'), 'ana', TODAY, { streak: 1 }).commit());
});

test('reto diario: puntos imposibles, día equivocado o nombre de otro', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(dailyBatch(dbFor('ana'), 'ana', TODAY, { score: 900, hits: 3 }).commit());
  await assertFails(dailyBatch(dbFor('ana'), 'ana', TODAY + 5).commit());
  await assertFails(dailyBatch(dbFor('ana'), 'ana', TODAY - 5).commit());
  const db = dbFor('ana');
  await assertFails(setDoc(doc(db, 'daily', String(TODAY), 'results', 'ana'), { username: 'Otro', avatar: AV, score: 0, hits: 0, ms: 1, at: serverTimestamp() }));
});

test('reto diario: la racha sube si jugaste ayer y vuelve a 1 si no', async () => {
  await seedProfile('ana', 'Ana', { dailyLast: TODAY - 1, dailyStreak: 4 });
  await assertFails(dailyBatch(dbFor('ana'), 'ana', TODAY, { streak: 9 }).commit());
  await assertSucceeds(dailyBatch(dbFor('ana'), 'ana', TODAY, { streak: 5 }).commit());
  await seedProfile('bob', 'Bob', { dailyLast: TODAY - 3, dailyStreak: 4 });
  const db = dbFor('bob');
  const b = writeBatch(db);
  b.set(doc(db, 'daily', String(TODAY), 'results', 'bob'), { username: 'Bob', avatar: AV, score: 0, hits: 0, ms: 1, at: serverTimestamp() });
  b.update(doc(db, 'users', 'bob'), { dailyLast: TODAY, dailyStreak: 5 });
  await assertFails(b.commit());
});

test('reto diario: la racha no se toca sin jugar', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(updateDoc(doc(dbFor('ana'), 'users', 'ana'), { dailyLast: TODAY, dailyStreak: 50 }));
});

// ---------- Amigos ----------
const request = (db, to, from, name) => setDoc(doc(db, 'users', to, 'requests', from), { name, avatar: AV, at: serverTimestamp() });
function acceptBatch(db, me, from) {
  const b = writeBatch(db);
  b.set(doc(db, 'users', me, 'friends', from), { since: serverTimestamp() });
  b.set(doc(db, 'users', from, 'friends', me), { since: serverTimestamp() });
  b.delete(doc(db, 'users', me, 'requests', from));
  return b;
}

test('amigos: solicitud, aceptar y retar', async () => {
  await seedProfile('ana', 'Ana');
  await seedProfile('bob', 'Bob');
  await assertFails(request(dbFor('ana'), 'bob', 'ana', 'Otro'));          // con nombre falso
  await assertSucceeds(request(dbFor('ana'), 'bob', 'ana', 'Ana'));
  await assertFails(getDoc(doc(dbFor('cai'), 'users', 'bob', 'requests', 'ana')));
  // sin solicitud no se puede ser amigo a la fuerza
  await assertFails(setDoc(doc(dbFor('cai'), 'users', 'bob', 'friends', 'cai'), { since: serverTimestamp() }));
  await assertSucceeds(acceptBatch(dbFor('bob'), 'bob', 'ana').commit());
  await assertSucceeds(getDocs(collection(dbFor('ana'), 'users', 'ana', 'friends')));
  // retos: solo entre amigos
  await assertSucceeds(setDoc(doc(dbFor('ana'), 'users', 'bob', 'invites', 'ana'), { code: 'ABCDE', name: 'Ana', avatar: AV, at: serverTimestamp() }));
  await seedProfile('cai', 'Cai');
  await assertFails(setDoc(doc(dbFor('cai'), 'users', 'bob', 'invites', 'cai'), { code: 'ABCDE', name: 'Cai', avatar: AV, at: serverTimestamp() }));
  // cualquiera de los dos puede romper la amistad
  await assertSucceeds(deleteDoc(doc(dbFor('ana'), 'users', 'bob', 'friends', 'ana')));
  await assertFails(deleteDoc(doc(dbFor('cai'), 'users', 'ana', 'friends', 'bob')));
});

test('amigos: no puedes leer la lista de amigos de otro', async () => {
  await seedProfile('ana', 'Ana');
  await assertFails(getDocs(collection(dbFor('bob'), 'users', 'ana', 'friends')));
});
