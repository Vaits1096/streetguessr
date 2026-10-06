// Worker de Cloudflare: sirve la web estática y las dos rutas de pago.
//   POST /api/checkout        crea una sesión de Stripe Checkout para el jugador con sesión iniciada
//   POST /api/stripe-webhook  Stripe avisa del pago → se entrega el objeto o las monedas
//   GET  /api/arena           WebSocket del modo 1vs1 (server/arena.js)
//
// Variables (wrangler.jsonc / secretos de Cloudflare):
//   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT (secreto), STRIPE_SECRET_KEY (secreto), STRIPE_WEBHOOK_SECRET (secreto)
import { sku as findSku } from '../public/js/catalog.js';
import { verifyIdToken, getDoc, grantPurchase } from './firebase.js';
import { stripeApi, verifyStripeSignature } from './stripe.js';

export { Arena } from './arena.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export async function checkout(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  let user;
  try { user = await verifyIdToken(token, env); } catch { return json({ error: 'Inicia sesión para comprar.' }, 401); }
  if (!user.email_verified) return json({ error: 'Verifica tu correo antes de comprar.' }, 403);

  const { sku: id } = await request.json().catch(() => ({}));
  const item = findSku(id);
  if (!item) return json({ error: 'Ese producto no existe.' }, 400);

  try {
    const profile = await getDoc(env, `users/${user.sub}`);
    if (!profile) return json({ error: 'Crea tu jugador antes de comprar.' }, 400);
    if (item.kind === 'item' && (profile.items || []).includes(item.id)) return json({ error: 'Ya tienes este objeto.' }, 409);

    const origin = new URL(request.url).origin;
    const session = await stripeApi(env, 'POST', 'checkout/sessions', {
      mode: 'payment',
      locale: 'es',
      customer_email: user.email,
      client_reference_id: user.sub,
      metadata: { uid: user.sub, sku: item.id },
      line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: item.eur, product_data: { name: `StreetGuessr · ${item.name}` } } } },
      success_url: `${origin}/?compra=ok&sku=${encodeURIComponent(item.id)}`,
      cancel_url: `${origin}/?compra=cancelada`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('checkout', e);
    return json({ error: 'No se ha podido iniciar el pago. Inténtalo de nuevo.' }, 502);
  }
}

export async function webhook(request, env) {
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Firma no válida', { status: 400 });
  }
  const event = JSON.parse(payload);
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return new Response('ignorado');
  }
  const s = event.data.object;
  const item = findSku(s.metadata?.sku);
  const uid = s.metadata?.uid;
  if (s.payment_status !== 'paid' || !item || !uid) return new Response('ignorado');
  if (s.currency !== 'eur' || s.amount_total < item.eur) {
    console.error('importe inesperado', s.id, s.amount_total, s.currency);
    return new Response('importe inesperado');
  }
  try {
    const r = await grantPurchase(env, { sessionId: s.id, uid, sku: item, amount: s.amount_total, currency: s.currency });
    return new Response(r);
  } catch (e) {
    console.error('webhook', e);
    return new Response('Error al entregar la compra', { status: 500 });   // Stripe reintentará
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/api/checkout') return checkout(request, env);
    if (request.method === 'POST' && pathname === '/api/stripe-webhook') return webhook(request, env);
    // 1vs1: un único Durable Object lleva la cola y todas las partidas
    if (pathname === '/api/arena') return env.ARENA.get(env.ARENA.idFromName('global')).fetch(request);
    if (pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404);
    return env.ASSETS.fetch(request);
  },
};
