// Pantalla "Mi perfil": nombre de jugador, edad, localidad y estadísticas (el avatar tiene su propio editor).
import { $, show, setError, escapeHtml, fmt } from './ui.js';
import { drawAvatar } from './avatar.js';
import { getPrivate, updateProfile, myScores, USERNAME_RE, UsernameTaken } from './store.js';
import { loadIndex, cityLabel, searchCities } from './cities.js';

export function setupProfile({ getUser, getProfile, setProfile, onPlayCity, onEditAvatar }) {
  $('profEditAvatar').onclick = () => onEditAvatar();

  // sugerencias de localidad mientras se escribe
  $('profLocality').addEventListener('input', () => {
    const v = $('profLocality').value;
    $('localityList').innerHTML = v.length < 2 ? '' :
      searchCities(v, 12).map(c => `<option value="${escapeHtml(cityLabel(c))}">`).join('');
  });

  $('profileForm').onsubmit = async e => {
    e.preventDefault();
    setError('profileError', '');
    $('profileOk').hidden = true;
    const username = $('profName').value.trim();
    if (!USERNAME_RE.test(username)) return setError('profileError', 'El nombre de jugador debe tener de 3 a 20 caracteres: letras, números, «_», «.» o «-».');
    const ageText = $('profAge').value.trim();
    const age = ageText ? Math.round(+ageText) : null;
    if (age !== null && !(age >= 5 && age <= 120)) return setError('profileError', 'La edad debe estar entre 5 y 120.');
    const locality = $('profLocality').value.trim().slice(0, 60);
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const p = await updateProfile(getUser().uid, getProfile(), { username, locality, age });
      setProfile(p);
      $('profileOk').hidden = false;
    } catch (err) {
      setError('profileError', err instanceof UsernameTaken ? 'Ese nombre de jugador ya está cogido.' : `No se ha podido guardar: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  };

  return {
    async open() {
      const user = getUser(), p = getProfile();
      show('profile');
      setError('profileError', '');
      $('profileOk').hidden = true;
      $('profName').value = p.username;
      $('profLocality').value = p.locality || '';
      $('profAge').value = '';
      drawAvatar($('profAvatar'), p.avatar);
      $('profCoins').textContent = fmt(p.coins);
      $('profElo').textContent = fmt(p.elo ?? 1000);
      $('profVs').textContent = `${fmt(p.compWins || 0)}-${fmt(p.compLosses || 0)}`;
      $('profGames').textContent = fmt(p.gamesPlayed);
      $('profTotal').textContent = fmt(p.totalPoints);
      $('profBest').textContent = fmt(p.bestScore);

      const list = $('myCities');
      list.innerHTML = '<li class="empty">Cargando…</li>';
      const [priv, scores] = await Promise.all([getPrivate(user.uid), myScores(user.uid).catch(() => []), loadIndex()]);
      if (priv.age) $('profAge').value = priv.age;
      list.innerHTML = scores.length ? '' : '<li class="empty">Aún no has jugado ninguna partida.</li>';
      for (const s of scores) {
        const li = document.createElement('li');
        li.className = 'pick';
        li.title = `Jugar en ${s.cityName}`;
        li.innerHTML = `<span class="name">${escapeHtml(s.cityName)}<small>${fmt(s.games)} ${s.games === 1 ? 'partida' : 'partidas'} · ${fmt(s.total)} puntos en total</small></span><span class="num">${fmt(s.best)} <small>récord</small></span>`;
        li.onclick = () => onPlayCity(s.cityId);
        list.appendChild(li);
      }
    },
  };
}
