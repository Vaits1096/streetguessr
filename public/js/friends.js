// Amigos: añadir por nombre de jugador, solicitudes, retos (salas privadas del 1 vs 1) y la lista de amigos.
import { $, show, visible, toast, setError, escapeHtml, avatarHtml, fmt } from './ui.js';
import {
  watchSocial, sendFriendRequest, acceptFriend, declineFriend, removeFriend, deleteInvite, getProfile, FriendError,
} from './store.js';

const level = points => Math.floor(Math.sqrt((points || 0) / 250)) + 1;

export function setupFriends({ getUser, getProfile: me, onChallenge, onJoinRoom }) {
  let stop = null, state = { friends: [], requests: [], invites: [] };
  const profiles = new Map();   // uid → perfil público (caché)
  let seenInvites = new Set(), removeArmed = null;

  function badge() {
    const n = state.requests.length + state.invites.length;
    for (const id of ['friendsBadge', 'menuFriendsBadge']) { $(id).hidden = !n; $(id).textContent = n; }
  }

  async function profileOf(uid) {
    if (!profiles.has(uid)) profiles.set(uid, getProfile(uid).catch(() => null));
    return profiles.get(uid);
  }

  async function render() {
    const row = (av, name, sub, actions) =>
      `<li>${avatarHtml(av, name)}<span class="name">${escapeHtml(name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="actions">${actions}</span></li>`;

    $('friendInvitesBox').hidden = !state.invites.length;
    $('friendInvites').innerHTML = state.invites.map(i =>
      row(i.avatar, i.name, 'te reta a un 1 vs 1 amistoso', `<button class="primary small" data-join="${i.uid}">Jugar</button><button class="ghost" data-dismiss="${i.uid}">×</button>`)).join('');

    $('friendRequestsBox').hidden = !state.requests.length;
    $('friendRequests').innerHTML = state.requests.map(r =>
      row(r.avatar, r.name, 'quiere ser tu amigo', `<button class="primary small" data-accept="${r.uid}">Aceptar</button><button class="ghost" data-decline="${r.uid}">Rechazar</button>`)).join('');

    const list = $('friendList');
    if (!state.friends.length) {
      list.innerHTML = '<li class="empty">Aún no tienes amigos en StreetGuessr. ¡Añade a alguien por su nombre de jugador!</li>';
      return;
    }
    const people = (await Promise.all(state.friends.map(async f => ({ uid: f.uid, p: await profileOf(f.uid) })))).filter(x => x.p);
    people.sort((a, b) => (b.p.elo ?? 1000) - (a.p.elo ?? 1000));
    list.innerHTML = people.map(({ uid, p }) => row(p.avatar, p.username,
      `Nivel ${level(p.totalPoints)} · ELO ${fmt(p.elo ?? 1000)} · récord ${fmt(p.bestScore)}${p.locality ? ` · ${escapeHtml(p.locality)}` : ''}`,
      `<button class="primary small" data-challenge="${uid}">⚔️ Retar</button><button class="ghost" data-remove="${uid}">${removeArmed === uid ? '¿Seguro?' : 'Quitar'}</button>`)).join('');
  }

  $('friendAdd').onsubmit = async e => {
    e.preventDefault();
    setError('friendError', '');
    $('friendOk').hidden = true;
    const name = $('friendName').value.trim();
    if (!name) return;
    try {
      const { other, accepted } = await sendFriendRequest(getUser().uid, me(), name);
      $('friendOk').textContent = accepted ? `¡Ahora eres amigo de ${other.username}!` : `Solicitud enviada a ${other.username}.`;
      $('friendOk').hidden = false;
      $('friendName').value = '';
    } catch (err) {
      setError('friendError', err instanceof FriendError ? err.message : `No se ha podido enviar: ${err.message}`);
    }
  };

  $('screen-friends').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const uid = getUser().uid, d = b.dataset;
    try {
      if (d.accept) await acceptFriend(uid, d.accept);
      else if (d.decline) await declineFriend(uid, d.decline);
      else if (d.dismiss) await deleteInvite(uid, d.dismiss);
      else if (d.join) {
        const inv = state.invites.find(i => i.uid === d.join);
        await deleteInvite(uid, d.join);
        if (inv) onJoinRoom(inv.code);
      } else if (d.challenge) {
        onChallenge({ uid: d.challenge, name: (await profileOf(d.challenge))?.username });
      } else if (d.remove) {
        if (removeArmed !== d.remove) { removeArmed = d.remove; render(); setTimeout(() => { removeArmed = null; if (visible('friends')) render(); }, 3000); return; }
        removeArmed = null;
        await removeFriend(uid, d.remove);
      }
    } catch (err) {
      setError('friendError', `No se ha podido: ${err.message}`);
    }
  });

  return {
    /** Empieza a escuchar solicitudes y retos (se llama al entrar). */
    start(uid) {
      stop?.();
      seenInvites = null;
      stop = watchSocial(uid, s => {
        state = s;
        badge();
        // aviso de retos nuevos (no los que ya estaban al entrar)
        const ids = new Set(s.invites.map(i => i.uid + i.code));
        if (seenInvites) for (const i of s.invites) if (!seenInvites.has(i.uid + i.code)) toast(`⚔️ ${i.name} te reta a un 1 vs 1. Abre Amigos para jugar.`, 7000);
        seenInvites = ids;
        if (visible('friends')) render();
      });
    },
    stop() { stop?.(); stop = null; state = { friends: [], requests: [], invites: [] }; badge(); },
    open() {
      show('friends');
      setError('friendError', '');
      $('friendOk').hidden = true;
      profiles.clear();
      render();
    },
  };
}
