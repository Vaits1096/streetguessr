// Llamadas a Stripe sin SDK (fetch + WebCrypto), para que funcionen igual en el Worker y en Node.

const enc = new TextEncoder();

/** Convierte {a: {b: 1}} en a[b]=1, el formato que espera la API de Stripe. */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripeApi(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params && form(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${data.error?.message || res.status}`);
  return data;
}

/**
 * Comprueba la cabecera Stripe-Signature (HMAC-SHA256 de "timestamp.cuerpo" con el secreto del webhook).
 * https://docs.stripe.com/webhooks#verify-manually
 */
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=');
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - +t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const expected = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => timingSafeEqual(s, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
