// Reto diario: 3 calles famosas de España, las mismas para todo el mundo ese día. Una partida al día.
import { $, show, toast, escapeHtml, fmt } from './ui.js';
import * as game from './game.js';
import { dailyRounds, todayNumber, dayLabel, famousLabel, dailyPoints, DAILY_ROUNDS } from './famous.js';
import { dailyResult, saveDaily, dailyPosition, currentStreak } from './store.js';

export function setupDaily({ getUser, getProfile, setProfile, onHome, onRanking, setGameUi }) {
  let run = null, statusCache = null;

  /** Estado del reto de hoy para el inicio: { day, result, streak } */
  async function status() {
    const day = todayNumber(), uid = getUser().uid;
    if (statusCache?.day !== day || statusCache.uid !== uid) statusCache = { day, uid, result: await dailyResult(day, uid).catch(() => null) };
    return { day, result: statusCache.result, streak: currentStreak(getProfile(), day) };
  }

  async function start() {
    const day = todayNumber();
    if ((await status()).result) { toast('Ya has jugado el reto de hoy. ¡Vuelve mañana!'); return onHome(); }
    run = { day, rounds: dailyRounds(day), i: 0, results: [], score: 0, quitArmed: 0 };
    next();
  }

  async function next() {
    const r = run.rounds[run.i];
    show('loading');
    try { await game.loadCity(r.famous.cityId); } catch (e) { toast(e.message, 6000); run = null; return onHome(); }
    show(null);
    setGameUi(true, 'daily');
    $('cityName').textContent = `Reto diario · ${run.i + 1} de ${DAILY_ROUNDS}`;
    paintHud();
    game.startQuiz({
      target: r.famous.name,
      options: r.options.map(famousLabel),
      answer: r.answer,
      nextText: run.i < DAILY_ROUNDS - 1 ? 'Siguiente calle →' : 'Ver resultado',
      onAnswer: (ok, ms) => {
        const pts = dailyPoints(ok, ms);
        run.results.push({ ok, ms, pts, famous: r.famous });
        run.score += pts;
        $('msg').textContent = ok ? `¡Correcto! +${pts}` : `Era ${famousLabel(r.famous)}`;
        $('msg').style.color = ok ? 'var(--ok)' : 'var(--bad)';
        paintHud();
      },
      onNext: () => { run.i++; if (run.i < DAILY_ROUNDS) next(); else finish(); },
    });
  }

  function paintHud() {
    $('round').textContent = `${Math.min(run.i + 1, DAILY_ROUNDS)}/${DAILY_ROUNDS}`;
    $('score').textContent = run.score;
  }

  const squares = results => results.map(r => (r.ok ? '🟩' : '🟥')).join('');

  async function finish() {
    const r = run;
    run = null;
    // las calles que falten (si sale antes de acabar) cuentan como falladas
    for (let i = r.results.length; i < DAILY_ROUNDS; i++) r.results.push({ ok: false, ms: 0, pts: 0, famous: r.rounds[i].famous });
    game.stopGame();
    setGameUi(false);
    const hits = r.results.filter(x => x.ok).length;
    const ms = r.results.reduce((t, x) => t + x.ms, 0);
    show('dailyover');
    $('dailyOverDate').textContent = `Reto del ${dayLabel(r.day)}`;
    $('dailyScore').textContent = fmt(r.score);
    $('dailySquares').textContent = squares(r.results);
    $('dailyRecap').innerHTML = r.results.map(x =>
      `<li class="${x.ok ? 'hit' : 'miss'}"><span>${x.ok ? '✓' : '✗'}</span><b>${escapeHtml(x.famous.label)}</b><small>${escapeHtml(x.famous.cityName)}</small><em>${x.pts ? `+${x.pts}` : ''}</em></li>`).join('');
    $('dailyInfo').textContent = 'Guardando…';
    $('dailyShare').onclick = () => share(r);
    try {
      setProfile(await saveDaily(getUser().uid, getProfile(), r.day, { score: r.score, hits, ms }));
      statusCache = { day: r.day, uid: getUser().uid, result: { score: r.score, hits, ms } };
      const pos = await dailyPosition(r.day, r.score);
      const streak = getProfile().dailyStreak;
      $('dailyInfo').textContent = `${hits} de ${DAILY_ROUNDS} calles · puesto ${fmt(pos)}.º de hoy · 🔥 racha de ${streak} ${streak === 1 ? 'día' : 'días'}`;
    } catch (e) {
      $('dailyInfo').textContent = `No se ha podido guardar: ${e.message}`;
    }
  }

  async function share(r) {
    const text = `StreetGuessr · reto del ${dayLabel(r.day)}\n${squares(r.results)} ${r.score} puntos\n¿Las adivinas tú?`;
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: 'StreetGuessr', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Resultado copiado: pégalo donde quieras.'); }
    } catch { /* cancelado */ }
  }

  $('dailyRanking').onclick = () => onRanking();
  $('dailyHome').onclick = () => onHome();

  return {
    start,
    status,
    active: () => !!run,
    /** Salir a mitad: el reto cuenta como terminado (si no, se podría repetir sabiendo las respuestas). */
    quit() { if (run) finish(); },
  };
}
