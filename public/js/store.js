// Acceso a Firestore: perfiles, partidas y rankings. Las reglas que validan todo esto están en firestore.rules.
//
// users/{uid}            perfil público: username, avatar, locality, totalPoints, gamesPlayed, bestScore,
//                        coins, items (objetos conseguidos), lastGame, lastGameAt, createdAt
// users/{uid}/private/me datos privados: age
// usernames/{minúsculas} { uid }  — garantiza que los nombres de jugador sean únicos
// games/{id}             cada partida: uid, cityId, cityName, score, hits, rounds, seconds, createdAt
// scores/{cityId}_{uid}  mejor partida y total por ciudad (ranking por ciudad)
// purchases/{sessionId}  compras con dinero real (solo las escribe el servidor tras el pago)
// daily/{día}/results/{uid}  reto diario (users/{uid}.dailyStreak y dailyLast para la racha)
// users/{uid}/friends/{otro} · requests/{de} · invites/{de}  amigos, solicitudes y retos
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, onSnapshot,
  getCountFromServer, runTransaction, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { ITEMS, COIN_PER_HIT } from './catalog.js';

export const USERNAME_RE = /^[A-Za-z0-9_.ÁÉÍÓÚÜÑáéíóúüñ-]{3,20}$/;
export const RANK_SIZE = 50;

const userRef = uid => doc(db, 'users', uid);
const privateRef = uid => doc(db, 'users', uid, 'private', 'me');
const nameRef = name => doc(db, 'usernames', name.toLowerCase());
const scoreRef = (cityId, uid) => doc(db, 'scores', `${cityId}_${uid}`);

export class UsernameTaken extends Error {}

export async function getProfile(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function getPrivate(uid) {
  const snap = await getDoc(privateRef(uid));
  return snap.exists() ? snap.data() : {};
}

/** Crea el jugador reservando el nombre. Lanza UsernameTaken si ya existe. */
export async function createProfile(uid, username, avatar) {
  await runTransaction(db, async tx => {
    const taken = await tx.get(nameRef(username));
    if (taken.exists()) throw new UsernameTaken();
    tx.set(nameRef(username), { uid });
    tx.set(userRef(uid), {
      username, avatar, locality: '',
      totalPoints: 0, gamesPlayed: 0, bestScore: 0, coins: 0, items: [], lastGame: '',
      createdAt: serverTimestamp(), lastGameAt: serverTimestamp(),
    });
  });
  return getProfile(uid);
}

/** Guarda los cambios del perfil y los propaga a las filas del ranking por ciudad. */
export async function updateProfile(uid, old, { username, avatar = old.avatar, locality, age }) {
  await runTransaction(db, async tx => {
    const changedKey = username.toLowerCase() !== old.username.toLowerCase();
    if (changedKey) {
      const taken = await tx.get(nameRef(username));
      if (taken.exists() && taken.data().uid !== uid) throw new UsernameTaken();
      if (!taken.exists()) tx.set(nameRef(username), { uid });
      tx.delete(nameRef(old.username));
    }
    tx.update(userRef(uid), { username, avatar, locality });
  });
  await setDoc(privateRef(uid), { age: age ?? null });

  if (username !== old.username || avatar !== old.avatar || locality !== old.locality) {
    await propagateToScores(uid, { username, avatar, locality });
  }
  return getProfile(uid);
}

/** Guarda el avatar (las reglas exigen que todas sus piezas sean gratis o del jugador). */
export async function saveAvatar(uid, old, avatar) {
  await setDoc(userRef(uid), { avatar }, { merge: true });
  await propagateToScores(uid, { username: old.username, avatar, locality: old.locality });
  return getProfile(uid);
}

async function propagateToScores(uid, fields) {
  const mine = await getDocs(query(collection(db, 'scores'), where('uid', '==', uid)));
  for (let i = 0; i < mine.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of mine.docs.slice(i, i + 400)) batch.update(d.ref, fields);
    await batch.commit();
  }
}

export class NotEnoughCoins extends Error {}

/** Compra un objeto con monedas. */
export async function buyWithCoins(uid, itemId) {
  const price = ITEMS[itemId]?.price;
  if (ITEMS[itemId]?.get !== 'coins') throw new Error('Ese objeto no se vende con monedas');
  await runTransaction(db, async tx => {
    const p = (await tx.get(userRef(uid))).data();
    if (p.items.includes(itemId)) return;
    if (p.coins < price) throw new NotEnoughCoins();
    tx.update(userRef(uid), { coins: p.coins - price, items: [...p.items, itemId] });
  });
  return getProfile(uid);
}

/** Añade los objetos de logro ya ganados (las reglas comprueban cada logro). */
export async function claimAchievements(uid, ids) {
  for (const id of ids) {
    await runTransaction(db, async tx => {
      const p = (await tx.get(userRef(uid))).data();
      if (!p.items.includes(id)) tx.update(userRef(uid), { items: [...p.items, id] });
    });
  }
  return getProfile(uid);
}

/** Guarda una partida terminada y actualiza los totales del jugador y su fila de la ciudad. */
export async function saveGame(uid, result) {
  const gameRef = doc(collection(db, 'games'));
  const sRef = scoreRef(result.cityId, uid);
  await runTransaction(db, async tx => {
    const [u, s] = await Promise.all([tx.get(userRef(uid)), tx.get(sRef)]);
    const p = u.data();
    const prev = s.exists() ? s.data() : { best: 0, total: 0, games: 0 };
    tx.set(gameRef, {
      uid, cityId: result.cityId, cityName: result.cityName,
      score: result.score, hits: result.hits, rounds: result.rounds, seconds: result.seconds,
      createdAt: serverTimestamp(),
    });
    tx.update(userRef(uid), {
      totalPoints: p.totalPoints + result.score,
      gamesPlayed: p.gamesPlayed + 1,
      bestScore: Math.max(p.bestScore, result.score),
      coins: (p.coins || 0) + result.hits * COIN_PER_HIT,
      lastGame: gameRef.id,
      lastGameAt: serverTimestamp(),
    });
    tx.set(sRef, {
      uid, cityId: result.cityId, cityName: result.cityName,
      username: p.username, avatar: p.avatar, locality: p.locality,
      best: Math.max(prev.best, result.score),
      total: prev.total + result.score,
      games: prev.games + 1,
      lastGame: gameRef.id,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function cityRanking(cityId) {
  const q = query(collection(db, 'scores'), where('cityId', '==', cityId), orderBy('best', 'desc'), limit(RANK_SIZE));
  return (await getDocs(q)).docs.map(d => d.data());
}

export async function worldRanking() {
  const q = query(collection(db, 'users'), orderBy('totalPoints', 'desc'), limit(RANK_SIZE));
  return (await getDocs(q)).docs.filter(d => d.data().gamesPlayed > 0).map(d => ({ uid: d.id, ...d.data() }));
}

/** Ranking del modo 1vs1 por ELO (solo quien ha jugado alguna). */
export async function versusRanking() {
  const q = query(collection(db, 'users'), orderBy('elo', 'desc'), limit(RANK_SIZE));
  return (await getDocs(q)).docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.compPlayed > 0);
}

export async function myCityScore(cityId, uid) {
  const snap = await getDoc(scoreRef(cityId, uid));
  return snap.exists() ? snap.data() : null;
}

/** Posición (1 = primero) de una puntuación en el ranking de una ciudad. */
export async function cityPosition(cityId, best) {
  const q = query(collection(db, 'scores'), where('cityId', '==', cityId), where('best', '>', best));
  return (await getCountFromServer(q)).data().count + 1;
}

export async function worldPosition(totalPoints) {
  const q = query(collection(db, 'users'), where('totalPoints', '>', totalPoints));
  return (await getCountFromServer(q)).data().count + 1;
}

export async function myScores(uid) {
  const q = query(collection(db, 'scores'), where('uid', '==', uid), orderBy('best', 'desc'), limit(100));
  return (await getDocs(q)).docs.map(d => d.data());
}

// ---------- Reto diario ----------
const dailyRef = (day, uid) => doc(db, 'daily', String(day), 'results', uid);

export async function dailyResult(day, uid) {
  const snap = await getDoc(dailyRef(day, uid));
  return snap.exists() ? snap.data() : null;
}

/** Guarda el resultado del día y actualiza la racha en la misma escritura. */
export async function saveDaily(uid, profile, day, { score, hits, ms }) {
  const streak = profile.dailyLast === day - 1 ? (profile.dailyStreak || 0) + 1 : 1;
  const batch = writeBatch(db);
  batch.set(dailyRef(day, uid), { username: profile.username, avatar: profile.avatar, score, hits, ms, at: serverTimestamp() });
  batch.update(userRef(uid), { dailyLast: day, dailyStreak: streak });
  await batch.commit();
  return getProfile(uid);
}

export async function dailyRanking(day) {
  const q = query(collection(db, 'daily', String(day), 'results'), orderBy('score', 'desc'), orderBy('ms', 'asc'), limit(RANK_SIZE));
  return (await getDocs(q)).docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function dailyPosition(day, score) {
  const q = query(collection(db, 'daily', String(day), 'results'), where('score', '>', score));
  return (await getCountFromServer(q)).data().count + 1;
}

/** Racha vigente (si el último reto no fue hoy ni ayer, ya se ha perdido). */
export const currentStreak = (profile, today) => (profile?.dailyLast >= today - 1 ? profile.dailyStreak || 0 : 0);

// ---------- Amigos ----------
export class FriendError extends Error {}

/** Busca un jugador por su nombre (sin distinguir mayúsculas). */
export async function findPlayer(name) {
  const snap = await getDoc(nameRef(name.trim()));
  if (!snap.exists()) return null;
  const uid = snap.data().uid;
  const p = await getProfile(uid);
  return p && { uid, ...p };
}

export async function sendFriendRequest(me, profile, name) {
  const other = await findPlayer(name);
  if (!other) throw new FriendError(`No hay ningún jugador llamado «${name.trim()}».`);
  if (other.uid === me) throw new FriendError('Ese eres tú 🙂');
  // si el otro ya me había pedido amistad, se acepta directamente
  if ((await getDoc(doc(db, 'users', me, 'requests', other.uid))).exists()) { await acceptFriend(me, other.uid); return { other, accepted: true }; }
  try {
    await setDoc(doc(db, 'users', other.uid, 'requests', me), { name: profile.username, avatar: profile.avatar, at: serverTimestamp() });
  } catch {
    throw new FriendError(`Ya sois amigos o ya le has enviado una solicitud a ${other.username}.`);
  }
  return { other, accepted: false };
}

export async function acceptFriend(me, from) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', me, 'friends', from), { since: serverTimestamp() });
  batch.set(doc(db, 'users', from, 'friends', me), { since: serverTimestamp() });
  batch.delete(doc(db, 'users', me, 'requests', from));
  await batch.commit();
}

export const declineFriend = (me, from) => deleteDoc(doc(db, 'users', me, 'requests', from));

export async function removeFriend(me, other) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', me, 'friends', other));
  batch.delete(doc(db, 'users', other, 'friends', me));
  await batch.commit();
}

/** Reta a un amigo: le deja el código de una sala privada. */
export const sendInvite = (me, profile, friend, code) =>
  setDoc(doc(db, 'users', friend, 'invites', me), { code, name: profile.username, avatar: profile.avatar, at: serverTimestamp() });
export const deleteInvite = (me, from) => deleteDoc(doc(db, 'users', me, 'invites', from));

/** Avisos en tiempo real: amigos, solicitudes y retos. Devuelve la función para dejar de escuchar. */
export function watchSocial(uid, cb) {
  const state = { friends: [], requests: [], invites: [] };
  const sub = name => onSnapshot(collection(db, 'users', uid, name), snap => {
    state[name] = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    cb({ ...state });
  }, () => {});
  const stops = ['friends', 'requests', 'invites'].map(sub);
  return () => stops.forEach(f => f());
}
