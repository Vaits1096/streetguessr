// Tienda: packs de monedas y objetos exclusivos (Stripe), objetos con monedas y logros.
import { $, show, toast, setError, escapeHtml, fmt } from './ui.js';
import { ITEMS, PACKS, parseAvatar, encodeAvatar, owns, euros } from './catalog.js';
import { avatarImage } from './avatar.js';
import { buyWithCoins, getProfile, NotEnoughCoins } from './store.js';
import { auth } from './firebase.js';

const COIN = '<i class="coin"></i>';

/** Abre Stripe Checkout para un objeto premium o un pack de monedas. */
export async function startCheckout(sku) {
  let res;
  try {
    const token = await auth.currentUser.getIdToken();
    res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sku }),
    });
  } catch {
    throw new Error('Sin conexión con el servidor de pagos.');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('Los pagos necesitan el servidor de Cloudflare (npm run dev:cf en local).');
  if (!res.ok || !data.url) throw new Error(data.error || 'No se ha podido iniciar el pago.');
  location.href = data.url;
}

/**
 * Al volver de Stripe (?compra=ok&sku=…) espera a que el webhook entregue la compra.
 * Devuelve el perfil actualizado (o null si no había compra pendiente).
 */
export async function handleCheckoutReturn(uid, profile) {
  const params = new URLSearchParams(location.search);
  const status = params.get('compra');
  if (!status) return null;
  const id = params.get('sku');
  params.delete('compra');
  params.delete('sku');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  if (status !== 'ok') { toast('Compra cancelada. No se te ha cobrado nada.'); return null; }

  const name = ITEMS[id]?.name || PACKS[id]?.name || 'tu compra';
  toast(`¡Gracias! Entregando ${name}…`, 15000);
  const got = p => (PACKS[id] ? p.coins > profile.coins : (p.items || []).includes(id));
  for (let i = 0; i < 15; i++) {
    const p = await getProfile(uid);
    if (got(p)) { toast(`¡Ya tienes ${name}! 🎉`, 5000); return p; }
    await new Promise(r => setTimeout(r, 2000));
  }
  toast('El pago está hecho; la entrega está tardando. Recarga la página en un minuto.', 8000);
  return null;
}

export function setupShop({ getUser, getProfile: currentProfile, setProfile, onTryOn }) {
  const card = (img, name, sub, action) =>
    `<div class="shop-card">${img}<span class="nm">${escapeHtml(name)}</span><small>${sub}</small>${action}</div>`;
  const preview = id => {
    const cfg = parseAvatar(currentProfile().avatar);
    cfg[ITEMS[id].slot] = id;
    return `<img alt="" src="${avatarImage(encodeAvatar(cfg), 128)}">`;
  };

  function render() {
    const p = currentProfile();
    $('shopCoins').textContent = fmt(p.coins);

    $('shopPacks').innerHTML = Object.entries(PACKS).map(([id, pk]) =>
      `<div class="shop-card pack">${pk.tag ? `<span class="tag">${pk.tag}</span>` : ''}` +
      `<div class="coin-pile"><i class="coin"></i><b>${fmt(pk.coins)}</b></div><span class="nm">${escapeHtml(pk.name)}</span>` +
      `<button class="lp-btn yellow" data-buy="${id}">${euros(pk.eur)}</button></div>`).join('');

    const entries = Object.entries(ITEMS).filter(([, it]) => it.slot !== 'pet');
    const petCard = ([id, it]) => {
      const price = it.get === 'premium' ? euros(it.eur) : it.get === 'coins' ? `${COIN} ${fmt(it.price)}` : '';
      const action = owns(p, id) ? '<span class="done">✓ Es tuya</span>'
        : it.get === 'premium' ? `<button class="lp-btn yellow" data-buy="${id}">${price}</button>`
        : it.get === 'coins' ? `<button class="lp-btn ${p.coins >= it.price ? 'yellow' : 'ghost-light'}" data-coins="${id}">${price}</button>`
        : `<button class="lp-btn ghost-light" data-try="${id}">${fmt(Math.min(p[it.ach.stat] || 0, it.ach.min))} / ${fmt(it.ach.min)}</button>`;
      const sub = it.get === 'ach' ? escapeHtml(it.ach.label) : it.get === 'premium' ? 'Exclusiva' : 'Con monedas';
      return card(preview(id), it.name, sub, action);
    };
    $('shopPets').innerHTML = Object.entries(ITEMS).filter(([id, it]) => it.slot === 'pet' && it.get !== 'free').map(petCard).join('');
    $('shopPremium').innerHTML = entries.filter(([, it]) => it.get === 'premium').map(([id, it]) =>
      card(preview(id), it.name, 'Exclusivo', owns(p, id) ? '<span class="done">✓ Es tuyo</span>'
        : `<button class="lp-btn yellow" data-buy="${id}">${euros(it.eur)}</button>`)).join('');

    $('shopCoinItems').innerHTML = entries.filter(([, it]) => it.get === 'coins').map(([id, it]) =>
      card(preview(id), it.name, `<i class="coin"></i> ${fmt(it.price)} monedas`, owns(p, id) ? '<span class="done">✓ Es tuyo</span>'
        : `<button class="lp-btn ${p.coins >= it.price ? 'yellow' : 'ghost-light'}" data-coins="${id}"><i class="coin"></i> ${fmt(it.price)}</button>`)).join('');

    $('shopAch').innerHTML = entries.filter(([, it]) => it.get === 'ach').map(([id, it]) => {
      const have = p[it.ach.stat] || 0;
      return card(preview(id), it.name, escapeHtml(it.ach.label), owns(p, id) ? '<span class="done">✓ Conseguido</span>'
        : `<button class="lp-btn ghost-light" data-try="${id}">${fmt(Math.min(have, it.ach.min))} / ${fmt(it.ach.min)}</button>`);
    }).join('');
  }

  $('screen-shop').addEventListener('click', async e => {
    const b = e.target.closest('button[data-buy], button[data-coins], button[data-try]');
    if (!b) return;
    setError('shopError', '');
    if (b.dataset.try) return onTryOn(b.dataset.try);
    b.disabled = true;
    try {
      if (b.dataset.buy) {
        b.textContent = 'Abriendo pago…';
        await startCheckout(b.dataset.buy);
      } else {
        setProfile(await buyWithCoins(getUser().uid, b.dataset.coins));
        toast(`¡${ITEMS[b.dataset.coins].name} es tuyo! Póntelo en el editor de avatar.`);
        render();
      }
    } catch (err) {
      setError('shopError', err instanceof NotEnoughCoins ? 'No tienes monedas suficientes. ¡Acierta calles para ganar más!' : err.message);
      render();
    }
  });

  return {
    open() { show('shop'); setError('shopError', ''); render(); },
    render,
  };
}
