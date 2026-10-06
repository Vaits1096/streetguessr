// Punto de entrada: portada → login → verificación → nombre de jugador → inicio (avatar + ubicación) → partida.
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { configured, auth } from './firebase.js';
import { $, show, visible, toast, setError, paintAvatar, fmt } from './ui.js';
import * as game from './game.js';
import { setupLogin, setupVerify, logout } from './auth.js';
import { loadIndex, cityById, cityLabel } from './cities.js';
import {
  getProfile, createProfile, saveGame, cityPosition, myCityScore, claimAchievements, USERNAME_RE, UsernameTaken,
} from './store.js';
import { ITEMS, randomAvatar, earnedAchievements, parseAvatar, encodeAvatar } from './catalog.js';
import { avatarImage } from './avatar.js';
import { setupProfile } from './profile.js';
import { setupRanking } from './ranking.js';
import { setupLanding } from './landing.js';
import { setupHome } from './home.js';
import { setupEditor } from './editor.js';
import { setupShop, handleCheckoutReturn } from './shop.js';
import { setupVersus } from './versus.js';
import { setupDaily } from './daily.js';
import { setupFriends } from './friends.js';
import { sendInvite } from './store.js';

// base: lo que hay debajo al cerrar perfil, ranking, avatar o tienda ('home' | 'game' | 'over')
const session = { user: null, profile: null, base: 'home' };
const LAST_CITY = 'calles.lastCity';
const PENDING_CITY = 'calles.pendingCity';   // ciudad elegida en la portada antes de tener cuenta
const PENDING_ROOM = 'calles.pendingRoom';   // sala de un amigo (?sala=CÓDIGO) abierta antes de tener sesión

// Enlace de invitación: se guarda y se quita de la barra de direcciones
{
  const params = new URLSearchParams(location.search);
  const code = (params.get('sala') || '').toUpperCase();
  if (/^[A-Z2-9]{5}$/.test(code)) {
    storage(PENDING_ROOM, code);
    params.delete('sala');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}`.replace('emulador=', 'emulador') : '') + location.hash);
  }
}

game.initMap();

if (!configured) {
  show('setup');
} else {
  const login = setupLogin();
  const landing = setupLanding({ onAuth: openAuth });
  const verify = setupVerify(user => enterVerified(user));
  const getUser = () => session.user;
  const getMe = () => session.profile;
  const setProfile = p => { session.profile = p; paintPlayer(); };

  const home = setupHome({
    getProfile: getMe,
    onPlay: c => playCity(c),
    onVersus: (mode, city, variant) => { session.base = 'versus'; home.hide(); versus.search(mode, city, variant); },
    onRoom: (city, variant) => { session.base = 'versus'; home.hide(); versus.createRoom(city, { variant }); },
    onJoin: code => { session.base = 'versus'; home.hide(); versus.joinRoom(code); },
    onDaily: () => { session.base = 'daily'; home.hide(); daily.start(); },
    onDailyRanking: () => rankingScreen.open('daily'),
    dailyStatus: () => daily.status(),
    onFriends: () => friends.open(),
    onEdit: () => editor.open(),
    onShop: () => shop.open(),
    onRanking: () => rankingScreen.open('city'),
  });
  const editor = setupEditor({ getUser, getProfile: getMe, setProfile, onClose: () => closeModal() });
  const shop = setupShop({ getUser, getProfile: getMe, setProfile, onTryOn: id => editor.open(id) });
  const profileScreen = setupProfile({
    getUser, getProfile: getMe, setProfile,
    onPlayCity: id => { const c = cityById(id); if (c) playCity(c); },
    onEditAvatar: () => editor.open(),
  });
  const versus = setupVersus({
    getUser, getProfile: getMe,
    refreshProfile: async () => setProfile(await getProfile(session.user.uid)),
    onHome: () => showHome(currentCityEntry()),
    setGameUi,
    // retar a un amigo: cuando la sala está creada le llega el aviso
    onRoomCreated: (friend, code) => sendInvite(session.user.uid, session.profile, friend.uid, code)
      .then(() => toast(`Le hemos enviado el reto a ${friend.name}.`))
      .catch(() => toast('No se ha podido avisar a tu amigo: envíale el enlace.', 6000)),
  });
  const daily = setupDaily({
    getUser, getProfile: getMe, setProfile,
    onHome: () => showHome(),
    onRanking: () => rankingScreen.open('daily'),
    setGameUi,
  });
  const friends = setupFriends({
    getUser, getProfile: getMe,
    onChallenge: friend => { session.base = 'versus'; show(null); home.hide(); versus.createRoom(home.picked ?? null, { friend, variant: home.variant }); },
    onJoinRoom: code => { session.base = 'versus'; show(null); home.hide(); versus.joinRoom(code); },
  });
  const rankingScreen = setupRanking({
    getUser, getProfile: getMe,
    getDefaultCity: () => game.currentCity() || cityById(storage(LAST_CITY)),
  });

  // ---------- Sesión ----------
  onAuthStateChanged(auth, async user => {
    verify.stop();
    session.user = user;
    session.profile = null;
    game.stopGame();
    setGameUi(false);
    home.hide();
    friends.stop();
    $('userChip').hidden = true;
    if (!user) {
      show(null);
      landing.show();
      if (storage(PENDING_ROOM)) openAuth('login', null, 'Te han invitado a un 1 vs 1. Entra o crea tu cuenta para jugar.');
      return;
    }
    landing.hide();
    if (!user.emailVerified) {
      show('verify');
      return verify.open(user);
    }
    enterVerified(user);
  });

  async function enterVerified(user) {
    show('loading');
    try {
      const [profile] = await Promise.all([getProfile(user.uid), loadIndex()]);
      session.profile = profile;
      if (!profile) return askUsername(user);
      enterGame();
    } catch (e) {
      toast(`No se ha podido cargar tu perfil: ${e.message}`, 8000);
      logout();
    }
  }

  function askUsername(user) {
    show('username');
    setError('usernameError', '');
    const base = (user.displayName || (user.email || '').split('@')[0]).replace(/\s+/g, '').replace(/[^A-Za-z0-9_.ÁÉÍÓÚÜÑáéíóúüñ-]/g, '');
    $('usernameInput').value = base.slice(0, 20);
    setTimeout(() => $('usernameInput').select(), 50);
  }

  $('usernameForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('usernameInput').value.trim();
    if (!USERNAME_RE.test(name)) return setError('usernameError', 'De 3 a 20 caracteres: letras, números, «_», «.» o «-». Sin espacios.');
    const btn = e.submitter;
    btn.disabled = true;
    try {
      session.profile = await createProfile(session.user.uid, name, randomAvatar());
      enterGame({ firstTime: true });
    } catch (err) {
      setError('usernameError', err instanceof UsernameTaken ? 'Ese nombre ya lo tiene otro jugador. Prueba con otro.' : `No se ha podido crear el jugador: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  };

  async function enterGame({ firstTime = false } = {}) {
    paintPlayer();
    $('userChip').hidden = false;
    friends.start(session.user.uid);
    const pendingCity = cityById(storage(PENDING_CITY, null));
    showHome(pendingCity, pendingCity ? 'solo' : undefined);
    const room = storage(PENDING_ROOM, null);
    if (room) { session.base = 'versus'; home.hide(); versus.joinRoom(room); }
    if (firstTime) toast('¡Bienvenido! Este es tu avatar: personalízalo cuando quieras.', 5000);
    // logros que se hubieran quedado sin reclamar
    const missing = earnedAchievements(session.profile);
    if (missing.length) setProfile(await claimAchievements(session.user.uid, missing).catch(() => session.profile));
    const bought = await handleCheckoutReturn(session.user.uid, session.profile);
    if (bought) { setProfile(bought); editor.refresh(); shop.render(); }
  }

  function paintPlayer() {
    const p = session.profile;
    if (!p) return;
    paintAvatar($('chipAvatar'), p.avatar, p.username);
    paintAvatar($('menuAvatar'), p.avatar, p.username);
    $('menuName').textContent = p.username;
    $('menuEmail').textContent = session.user.email || '';
    $('menuCoins').textContent = fmt(p.coins);
    game.setPlayerAvatar(p.avatar);
    if (home.visible) home.refresh();
  }

  // ---------- Ventana de acceso (desde la portada) ----------
  async function openAuth(mode, city, context) {
    storage(PENDING_CITY, city ? city.id : null);
    login.setMode(mode === 'login' ? 'login' : 'signup');
    $('authContext').textContent = context || (city ? `Crea tu cuenta gratis para jugar en ${city.name}. Si ya tienes una, entra con ella.`
      : mode === 'login' ? 'Bienvenido de nuevo. Tus partidas y tu ranking te esperan.'
      : 'Es gratis. Guarda tus partidas y compite en el ranking de tu ciudad.');
    if (mode === 'google' && await login.google()) return;
    show('login');
    if (mode !== 'google') setTimeout(() => $('email').focus(), 50);
  }
  $('authClose').onclick = () => show(null);

  // ---------- Inicio y partida ----------
  const currentCityEntry = () => game.currentCity() && cityById(game.currentCity().id);

  function showHome(preselect, mode) {
    session.base = 'home';
    versus.stop();
    game.stopGame();
    setGameUi(false);
    show(null);
    home.show(preselect, mode);
  }

  async function playCity(c) {
    home.hide();
    show('loading');
    try {
      if (game.currentCity()?.id !== c.id) await game.loadCity(c.id);
    } catch (e) {
      toast(e.message, 6000);
      return showHome();
    }
    storage(LAST_CITY, c.id);
    $('cityName').textContent = c.name;
    $('cityName').title = cityLabel(c);
    startGame();
  }

  function startGame() {
    session.base = 'game';
    show(null);
    setGameUi(true);
    game.newGame();
  }

  game.setGameOverHandler(async result => {
    session.base = 'over';
    show('over');
    $('finalScore').textContent = fmt(result.score);
    $('finalInfo').textContent = `${result.hits} ${result.hits === 1 ? 'calle acertada' : 'calles acertadas'} en ${result.rounds} rondas en ${result.cityName}.`;
    $('finalCoins').hidden = !result.hits;
    $('finalCoins').innerHTML = `+${fmt(result.hits)} <i class="coin"></i>`;
    $('finalUnlocks').hidden = true;
    $('finalRank').textContent = 'Guardando partida…';
    try {
      const prevBest = session.profile.bestScore;
      await saveGame(session.user.uid, result);
      let p = await getProfile(session.user.uid);
      const unlocked = earnedAchievements(p);
      if (unlocked.length) p = await claimAchievements(session.user.uid, unlocked);
      setProfile(p);
      showUnlocks(unlocked);
      const mine = await myCityScore(result.cityId, session.user.uid);
      const pos = await cityPosition(result.cityId, mine.best);
      const record = result.score > 0 && result.score === mine.best && mine.games > 1 ? '¡Nuevo récord en esta ciudad! ' : '';
      $('finalRank').textContent = `${record}Tu récord aquí: ${fmt(mine.best)} puntos · puesto ${fmt(pos)}.º del ranking de ${result.cityName}.` +
        (p.bestScore > prevBest && prevBest > 0 ? ' ¡Y es tu mejor partida de siempre!' : '');
    } catch (e) {
      $('finalRank').textContent = `No se ha podido guardar la partida: ${e.message}`;
    }
  });

  function showUnlocks(ids) {
    const box = $('finalUnlocks');
    box.hidden = !ids.length;
    box.innerHTML = '';
    for (const id of ids) {
      const cfg = parseAvatar(session.profile.avatar);
      cfg[ITEMS[id].slot] = id;
      const d = document.createElement('div');
      d.innerHTML = `<img alt="" src="${avatarImage(encodeAvatar(cfg), 80)}"><span>¡Desbloqueado!<br>${ITEMS[id].name}</span>`;
      d.style.cursor = 'pointer';
      d.title = 'Probártelo';
      d.onclick = () => editor.open(id);
      box.appendChild(d);
    }
  }

  $('again').onclick = startGame;
  $('overHome').onclick = () => showHome(currentCityEntry());
  $('overRanking').onclick = () => rankingScreen.open('city');
  // Salir de la partida. En un 1vs1 es rendirse, así que pide confirmación pulsando otra vez.
  // En el reto diario salir cuenta como terminado, así que también se confirma.
  let quitArmed = 0;
  $('changeCity').onclick = () => {
    const inVersus = versus.active(), inDaily = daily.active();
    if (!inVersus && !inDaily) return showHome(currentCityEntry());
    const label = inVersus ? '← Rendirse' : '← Salir';
    if (Date.now() - quitArmed < 3000) {
      quitArmed = 0;
      $('changeCity').textContent = label;
      return inVersus ? versus.forfeit() : daily.quit();
    }
    quitArmed = Date.now();
    $('changeCity').textContent = inVersus ? '¿Rendirte? Pulsa otra vez' : '¿Salir? El reto contará como terminado';
    setTimeout(() => { if (Date.now() - quitArmed >= 3000) $('changeCity').textContent = label; }, 3100);
  };

  // ---------- Menú de usuario ----------
  $('userChip').onclick = e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });
  $('menu').addEventListener('click', e => {
    const go = e.target.closest('button')?.dataset.go;
    if (!go) return;
    $('menu').hidden = true;
    if (go === 'home') showHome(currentCityEntry());
    else if (go === 'friends') friends.open();
    else if (go === 'avatar') editor.open();
    else if (go === 'shop') shop.open();
    else if (go === 'profile') profileScreen.open();
    else if (go === 'ranking') rankingScreen.open('city');
    else if (go === 'logout') logout();
  });

  // Perfil, ranking, avatar y tienda se abren encima de lo que haya; al cerrarlos se vuelve ahí
  function closeModal() {
    if (['game', 'versus', 'daily'].includes(session.base) && game.playing()) show(null);
    else if (session.base === 'over') show('over');
    else { show(null); home.show(); }
  }
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeModal; });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (['profile', 'ranking', 'avatar', 'shop', 'friends'].some(visible)) closeModal();
    else if (visible('login')) show(null);
  });
}

/** mode: 'solo' (clásico) | 'versus' (1 vs 1, o true por compatibilidad) | 'daily' (reto diario) */
function setGameUi(on, mode = 'solo') {
  if (mode === true) mode = 'versus';
  $('hud').hidden = !on;
  $('panel').hidden = !on;
  $('soloStats').hidden = mode === 'versus';
  $('vsBar').hidden = mode !== 'versus';
  document.body.classList.toggle('versus', on && mode === 'versus');
  document.body.classList.toggle('daily', on && mode === 'daily');
  $('changeCity').textContent = mode === 'versus' ? '← Rendirse' : mode === 'daily' ? '← Salir' : '← Inicio';
}

/** localStorage tolerante a errores: storage(k) lee; storage(k, v) escribe (null borra) y devuelve el valor anterior. */
function storage(key, value) {
  try {
    const prev = localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, value);
    return prev;
  } catch {
    return null;
  }
}
