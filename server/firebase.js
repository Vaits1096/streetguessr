// Acceso a Firebase desde el Worker sin SDK: verificación del token de sesión y escrituras en Firestore
// por REST con la cuenta de servicio. Con FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST usa los emuladores.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
const bytesToB64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jsonB64url = obj => bytesToB64url(enc.encode(JSON.stringify(obj)));

// ---------- Token de sesión (Firebase ID token) ----------
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, until: 0 };

async function jwks() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('No se pudieron leer las claves de Google');
  const maxAge = +(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  jwksCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

/** Devuelve el contenido del token si es válido para este proyecto; lanza un error si no. */
export async function verifyIdToken(token, env) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('token mal formado');
  const [h, p, sig] = parts;
  const header = JSON.parse(dec.decode(b64urlToBytes(h)));
  const payload = JSON.parse(dec.decode(b64urlToBytes(p)));
  const pid = env.FIREBASE_PROJECT_ID;

  if (!env.FIREBASE_AUTH_EMULATOR_HOST) {   // los tokens del emulador no van firmados
    if (header.alg !== 'RS256') throw new Error('algoritmo no válido');
    const jwk = (await jwks()).find(k => k.kid === header.kid);
    if (!jwk) throw new Error('clave desconocida');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), enc.encode(`${h}.${p}`));
    if (!ok) throw new Error('firma no válida');
  }
  const now = Date.now() / 1000;
  if (payload.aud !== pid || payload.iss !== `https://securetoken.google.com/${pid}`) throw new Error('token de otro proyecto');
  if (!(payload.exp > now) || payload.iat > now + 300 || !payload.sub) throw new Error('token caducado');
  return payload;
}

// ---------- Firestore por REST ----------
let tokenCache = { token: null, until: 0 };

/** Token de acceso OAuth de la cuenta de servicio (FIREBASE_SERVICE_ACCOUNT = JSON descargado de la consola). */
async function accessToken(env) {
  if (env.FIRESTORE_EMULATOR_HOST) return 'owner';
  if (tokenCache.token && Date.now() < tokenCache.until) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${jsonB64url({ alg: 'RS256', typ: 'JWT' })}.${jsonB64url({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', b64urlToBytes(pem.replace(/\+/g, '-').replace(/\//g, '_')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${bytesToB64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`OAuth: ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  tokenCache = { token: access_token, until: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

const dbPath = env => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const apiRoot = env => (env.FIRESTORE_EMULATOR_HOST ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1` : 'https://firestore.googleapis.com/v1');

async function firestore(env, method, path, body) {
  const res = await fetch(`${apiRoot(env)}/${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(env)}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return res;
}

/** Lee un documento y lo devuelve como objeto plano (solo los tipos que usamos), o null si no existe. */
export async function getDoc(env, path) {
  const res = await firestore(env, 'GET', `${dbPath(env)}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path}: ${res.status}`);
  return fromFields((await res.json()).fields || {});
}

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
const fromFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

/**
 * Entrega una compra: crea purchases/{sessionId} (solo si no existe, para no entregar dos veces)
 * y en la misma escritura añade el objeto o suma las monedas al jugador.
 * Devuelve 'ok' o 'duplicate'.
 */
export async function grantPurchase(env, { sessionId, uid, sku, amount, currency }) {
  const base = dbPath(env);
  const give = sku.kind === 'item'
    ? { fieldPath: 'items', appendMissingElements: { values: [{ stringValue: sku.id }] } }
    : { fieldPath: 'coins', increment: { integerValue: String(sku.coins) } };
  const res = await firestore(env, 'POST', `${base}:commit`, {
    writes: [
      {
        update: {
          name: `${base}/purchases/${sessionId}`,
          fields: {
            uid: { stringValue: uid }, sku: { stringValue: sku.id }, kind: { stringValue: sku.kind },
            amount: { integerValue: String(amount) }, currency: { stringValue: currency },
            createdAt: { timestampValue: new Date().toISOString() },
          },
        },
        currentDocument: { exists: false },
      },
      { transform: { document: `${base}/users/${uid}`, fieldTransforms: [give] }, currentDocument: { exists: true } },
    ],
  });
  if (res.ok) return 'ok';
  if (await getDoc(env, `purchases/${sessionId}`)) return 'duplicate';
  throw new Error(`Firestore commit: ${res.status} ${await res.text()}`);
}

// ---------- Resultado de un 1vs1 ----------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

/** Guarda la partida en matches/{id} y actualiza ELO y victorias/derrotas de los dos jugadores. */
export async function saveCompetitive(env, r) {
  const base = dbPath(env);
  const inc = n => ({ increment: { integerValue: String(n) } });
  const writes = [{
    update: {
      name: `${base}/matches/${r.id}`,
      fields: {
        cityId: toValue(r.cityId), cityName: toValue(r.cityName), reason: toValue(r.reason), winner: toValue(r.winner),
        uids: toValue(r.players.map(p => p.uid)), players: toValue(r.players), ranked: toValue(r.ranked !== false), variant: toValue(r.variant || 'streets'),
        createdAt: { timestampValue: new Date().toISOString() },
      },
    },
    currentDocument: { exists: false },
  }];
  for (const p of r.ranked === false ? [] : r.players) {   // las amistosas no tocan ELO ni estadísticas
    const result = r.winner === null ? 'compDraws' : r.winner === p.uid ? 'compWins' : 'compLosses';
    writes.push({
      update: { name: `${base}/users/${p.uid}`, fields: { elo: toValue(p.after) } },
      updateMask: { fieldPaths: ['elo'] },
      updateTransforms: [{ fieldPath: 'compPlayed', ...inc(1) }, { fieldPath: result, ...inc(1) }],
      currentDocument: { exists: true },
    });
  }
  const res = await firestore(env, 'POST', `${base}:commit`, { writes });
  if (!res.ok) throw new Error(`Firestore commit: ${res.status} ${await res.text()}`);
}
