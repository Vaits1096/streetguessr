// Tests del servidor de pagos (server/worker.js) contra el emulador de Firestore, con la API de Stripe simulada.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import worker from '../server/worker.js';
import { DEFAULT_AVATAR } from '../public/js/catalog.js';

const PROJECT = 'demo-calles';
const ENV = {
  FIREBASE_PROJECT_ID: PROJECT,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  STRIPE_SECRET_KEY: 'sk_test_simulada',
  STRIPE_WEBHOOK_SECRET: 'whsec_simulado',
  ASSETS: { fetch: () => new Response('estático') },
};

let env;
const stripeCalls = [];
const realFetch = globalThis.fetch;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  // Stripe simulado: devuelve una sesión de Checkout y guarda lo que se le envió
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.stripe.com/')) {
      stripeCalls.push({ url: String(url), body: new URLSearchParams(String(init.body)) });
      return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    }
    return realFetch(url, init);
  };
});
after(async () => { globalThis.fetch = realFetch; await env.cleanup(); });
beforeEach(async () => {
  stripeCalls.length = 0;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', 'ana'), {
    username: 'Ana', avatar: DEFAULT_AVATAR, locality: '', totalPoints: 0, gamesPlayed: 0, bestScore: 0,
    coins: 10, items: ['hat_beanie'], lastGame: '', lastGameAt: Timestamp.now(), createdAt: Timestamp.now(),
  }));
});

const user = async () => {
  let data;
  await env.withSecurityRulesDisabled(async ctx => { data = (await getDoc(doc(ctx.firestore(), 'users', 'ana'))).data(); });
  return data;
};

/** Token como los del emulador de Auth (sin firmar). */
function idToken(claims = {}) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'ana', user_id: 'ana',
    email: 'ana@example.com', email_verified: true, iat: now, exp: now + 3600, ...claims,
  })}.`;
}

const call = (path, { token, body, headers = {}, env: e = ENV } = {}) => worker.fetch(new Request(`https://streetguessr.test${path}`, {
  method: 'POST',
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), e);

async function signed(event, secret = ENV.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))).toString('hex');
  return { body: payload, headers: { 'stripe-signature': `t=${t},v1=${mac}` } };
}

const paidEvent = (sku, amount, id = 'cs_test_1') => ({
  type: 'checkout.session.completed',
  data: { object: { id, payment_status: 'paid', amount_total: amount, currency: 'eur', metadata: { uid: 'ana', sku } } },
});

// ---------- /api/checkout ----------
test('checkout: sin sesión → 401', async () => {
  assert.equal((await call('/api/checkout', { body: { sku: 'hat_halo' } })).status, 401);
});

test('checkout: token sin firmar fuera del emulador → 401', async () => {
  const { FIREBASE_AUTH_EMULATOR_HOST, ...prod } = ENV;
  void FIREBASE_AUTH_EMULATOR_HOST;
  assert.equal((await call('/api/checkout', { token: idToken(), body: { sku: 'hat_halo' }, env: prod })).status, 401);
});

test('checkout: token de otro proyecto o sin verificar → rechazado', async () => {
  assert.equal((await call('/api/checkout', { token: idToken({ aud: 'otro' }), body: { sku: 'hat_halo' } })).status, 401);
  assert.equal((await call('/api/checkout', { token: idToken({ email_verified: false }), body: { sku: 'hat_halo' } })).status, 403);
});

test('checkout: productos que no se venden con dinero → 400', async () => {
  for (const sku of ['hat_beanie', 'hat_crown', 'face_smile', 'nada']) {
    assert.equal((await call('/api/checkout', { token: idToken(), body: { sku } })).status, 400, sku);
  }
});

test('checkout: objeto premium → URL de Stripe con el precio del catálogo', async () => {
  const res = await call('/api/checkout', { token: idToken(), body: { sku: 'hat_halo' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  const b = stripeCalls[0].body;
  assert.equal(b.get('line_items[0][price_data][unit_amount]'), '199');
  assert.equal(b.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(b.get('metadata[uid]'), 'ana');
  assert.equal(b.get('metadata[sku]'), 'hat_halo');
  assert.match(b.get('success_url'), /^https:\/\/streetguessr\.test\/\?compra=ok/);
});

test('checkout: pack de monedas', async () => {
  const res = await call('/api/checkout', { token: idToken(), body: { sku: 'coins_1500' } });
  assert.equal(res.status, 200);
  assert.equal(stripeCalls[0].body.get('line_items[0][price_data][unit_amount]'), '499');
});

test('checkout: objeto que ya tienes → 409', async () => {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', 'ana'), { items: ['hat_halo'] }, { merge: true }));
  assert.equal((await call('/api/checkout', { token: idToken(), body: { sku: 'hat_halo' } })).status, 409);
});

// ---------- /api/stripe-webhook ----------
test('webhook: firma incorrecta o caducada → 400', async () => {
  const bad = await signed(paidEvent('hat_halo', 199), 'whsec_otro');
  assert.equal((await call('/api/stripe-webhook', bad)).status, 400);
  const old = await signed(paidEvent('hat_halo', 199), ENV.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600);
  assert.equal((await call('/api/stripe-webhook', old)).status, 400);
  assert.deepEqual((await user()).items, ['hat_beanie']);
});

test('webhook: pago de objeto → se entrega una sola vez', async () => {
  const ev = await signed(paidEvent('hat_halo', 199));
  assert.equal(await (await call('/api/stripe-webhook', ev)).text(), 'ok');
  assert.deepEqual((await user()).items, ['hat_beanie', 'hat_halo']);
  // Stripe puede reenviar el mismo evento
  assert.equal(await (await call('/api/stripe-webhook', await signed(paidEvent('hat_halo', 199)))).text(), 'duplicate');
  assert.deepEqual((await user()).items, ['hat_beanie', 'hat_halo']);
});

test('webhook: pack de monedas suma una vez', async () => {
  await call('/api/stripe-webhook', await signed(paidEvent('coins_250', 99, 'cs_test_2')));
  await call('/api/stripe-webhook', await signed(paidEvent('coins_250', 99, 'cs_test_2')));
  assert.equal((await user()).coins, 260);
});

test('webhook: importe menor que el precio → no se entrega', async () => {
  await call('/api/stripe-webhook', await signed(paidEvent('hat_halo', 1)));
  await call('/api/stripe-webhook', await signed({ ...paidEvent('hat_halo', 199), data: { object: { ...paidEvent('hat_halo', 199).data.object, payment_status: 'unpaid' } } }));
  assert.deepEqual((await user()).items, ['hat_beanie']);
});

test('el worker sirve la web estática fuera de /api', async () => {
  const res = await worker.fetch(new Request('https://streetguessr.test/index.html'), ENV);
  assert.equal(await res.text(), 'estático');
});
