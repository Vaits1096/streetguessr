// Editor del avatar pixel art: probarse cualquier pieza, comprar con monedas o con dinero real, y guardar.
import { $, show, toast, setError, escapeHtml, fmt } from './ui.js';
import { ITEMS, COLORS, parseAvatar, encodeAvatar, owns, euros } from './catalog.js';
import { drawAvatar, avatarImage, avatarPortrait } from './avatar.js';
import { saveAvatar, buyWithCoins, NotEnoughCoins } from './store.js';
import { startCheckout } from './shop.js';

const TABS = [
  { id: 'skin', label: 'Piel', swatch: 'skin' },
  { id: 'face', label: 'Cara' },
  { id: 'hair', label: 'Pelo', swatch: 'hc' },
  { id: 'top', label: 'Ropa', swatch: 'tc' },
  { id: 'bottom', label: 'Pantalón' },
  { id: 'shoes', label: 'Zapatos' },
  { id: 'hat', label: 'Sombrero' },
  { id: 'acc', label: 'Complementos' },
  { id: 'bg', label: 'Fondo' },
  { id: 'pet', label: '🐾 Mascota' },
];
const HEAD = new Set(['face', 'hair', 'hat', 'acc']);   // en estas se enseña el retrato, que se ve mejor
const ORDER = { free: 0, coins: 1, ach: 2, premium: 3 };

export function setupEditor({ getUser, getProfile, setProfile, onClose }) {
  let cfg = null, tab = 'face';

  const locked = () => Object.values(cfg).filter(id => !owns(getProfile(), id));

  function badge(id) {
    const it = ITEMS[id], p = getProfile();
    if (it.get === 'free') return '<span class="badge free">Gratis</span>';
    if (owns(p, id)) return '<span class="badge owned">✓ Tuyo</span>';
    if (it.get === 'coins') return `<span class="badge coins"><i class="coin"></i> ${fmt(it.price)}</span>`;
    if (it.get === 'ach') return '<span class="badge ach">🏆 Logro</span>';
    return `<span class="badge premium">${euros(it.eur)}</span>`;
  }

  function render() {
    const p = getProfile();
    drawAvatar($('avCanvas'), encodeAvatar(cfg));
    $('avCoins').textContent = fmt(p.coins);

    $('avTabs').innerHTML = TABS.map(t => `<button data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${t.label}</button>`).join('');

    const t = TABS.find(x => x.id === tab);
    $('avSwatches').innerHTML = t.swatch ? COLORS[t.swatch].map((c, i) => {
      const color = Array.isArray(c) ? c[0] : c, token = `${t.swatch}_${i}`;
      return `<button data-swatch="${token}" class="${cfg[t.swatch] === token ? 'sel' : ''}" style="background:${color}" aria-label="Color ${i + 1}"></button>`;
    }).join('') : '';

    const ids = Object.keys(ITEMS).filter(id => ITEMS[id].slot === tab)
      .sort((a, b) => (owns(p, b) - owns(p, a)) || ORDER[ITEMS[a].get] - ORDER[ITEMS[b].get] || (ITEMS[a].price || 0) - (ITEMS[b].price || 0));
    $('avGrid').innerHTML = ids.map(id => {
      const look = encodeAvatar({ ...cfg, ...(tab === 'hair' ? { hat: 'hat_none' } : {}), [tab]: id });
      const img = HEAD.has(tab) ? avatarPortrait(look) : avatarImage(look, 96);
      return `<button class="av-item ${cfg[tab] === id ? 'sel' : ''} ${owns(p, id) ? '' : 'locked'}" data-item="${id}">` +
        `<img alt="" src="${img}"><span class="nm">${escapeHtml(ITEMS[id].name)}</span>${badge(id)}</button>`;
    }).join('');

    renderAction();
  }

  function renderAction() {
    const box = $('avAction'), p = getProfile();
    const pending = locked();
    $('avSave').disabled = pending.length > 0;
    $('avSave').textContent = pending.length ? 'Desbloquea lo que llevas puesto para guardar' : 'Guardar avatar';
    if (!pending.length) { box.hidden = true; return; }
    const id = pending[0], it = ITEMS[id];
    box.hidden = false;
    if (it.get === 'coins') {
      const enough = p.coins >= it.price;
      box.innerHTML = `<b>${escapeHtml(it.name)}</b><small>${enough ? 'Cómpralo con tus monedas.' : `Te faltan ${fmt(it.price - p.coins)} monedas: acierta más calles o consigue un pack en la tienda.`}</small>` +
        `<button class="lp-btn ${enough ? 'yellow' : 'ghost-light'}" data-coins="${id}" ${enough ? '' : 'disabled'}>Comprar por <i class="coin"></i> ${fmt(it.price)}</button>`;
    } else if (it.get === 'ach') {
      const have = p[it.ach.stat] || 0;
      box.innerHTML = `<b>🏆 ${escapeHtml(it.name)}</b><small>${escapeHtml(it.ach.label)} para desbloquearlo. Llevas ${fmt(Math.min(have, it.ach.min))} de ${fmt(it.ach.min)}.</small>`;
    } else {
      box.innerHTML = `<b>✨ ${escapeHtml(it.name)}</b><small>Objeto exclusivo. Pago seguro con Stripe.</small>` +
        `<button class="lp-btn yellow" data-buy="${id}">Comprar por ${euros(it.eur)}</button>`;
    }
  }

  $('screen-avatar').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    setError('avError', '');
    if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
    if (b.dataset.swatch) { cfg[TABS.find(x => x.id === tab).swatch] = b.dataset.swatch; render(); return; }
    if (b.dataset.item) { cfg[tab] = b.dataset.item; render(); return; }
    if (b.dataset.coins) {
      b.disabled = true;
      try {
        setProfile(await buyWithCoins(getUser().uid, b.dataset.coins));
        toast(`¡${ITEMS[b.dataset.coins].name} es tuyo!`);
      } catch (err) {
        setError('avError', err instanceof NotEnoughCoins ? 'No tienes monedas suficientes.' : err.message);
      }
      render();
      return;
    }
    if (b.dataset.buy) {
      b.disabled = true;
      b.textContent = 'Abriendo pago…';
      try { await startCheckout(b.dataset.buy); } catch (err) { setError('avError', err.message); renderAction(); }
    }
  });

  $('avReset').onclick = () => { cfg = parseAvatar(getProfile().avatar); render(); };
  $('avSave').onclick = async () => {
    const btn = $('avSave');
    btn.disabled = true;
    try {
      const p = getProfile();
      setProfile(await saveAvatar(getUser().uid, p, encodeAvatar(cfg)));
      toast('Avatar guardado');
      onClose();
    } catch (err) {
      setError('avError', `No se ha podido guardar: ${err.message}`);
      btn.disabled = false;
    }
  };

  return {
    /** Abre el editor; `tryOn` (opcional) es un objeto para probárselo directamente. */
    open(tryOn) {
      cfg = parseAvatar(getProfile().avatar);
      if (tryOn && ITEMS[tryOn]) { tab = ITEMS[tryOn].slot; cfg[tab] = tryOn; }
      show('avatar');
      render();
    },
    refresh() { if (cfg) render(); },
  };
}
