// Catálogo de objetos del avatar. Solo datos (sin DOM): lo usan el juego, tools/gen_rules.mjs
// (para firestore.rules) y el servidor de pagos (functions/), así los precios están en un único sitio.
//
// Formas de conseguir un objeto:
//   free     lo tiene todo el mundo
//   coins    se compra con monedas (1 moneda por acierto en partida)
//   ach      se desbloquea al llegar a una cifra (stat ≥ min) — la comprueban las reglas de Firestore
//   premium  solo con dinero real (Stripe). Lo concede el servidor tras el pago.

export const COLORS = {
  skin: [['#ffe0bd', '#f1c27d'], ['#f5cba7', '#e0a985'], ['#e8b48a', '#c98d63'], ['#c68642', '#a0682e'], ['#8d5524', '#6e3f17'], ['#5c3a1e', '#432913']],
  hc: ['#2b1d14', '#5a3825', '#a8642a', '#e6c35c', '#dcdcdc', '#c0392b', '#3f6fd8', '#d65db1'],
  tc: ['#e43b44', '#f77622', '#feae34', '#63c74d', '#2e8b57', '#0099db', '#124e89', '#68386c', '#f6757a', '#f4f4f4'],
};

// Orden fijo de las piezas dentro del texto del avatar
export const SLOTS = [
  { id: 'skin', label: 'Piel', color: true },
  { id: 'face', label: 'Cara' },
  { id: 'hair', label: 'Pelo' },
  { id: 'hc', label: 'Color de pelo', color: true },
  { id: 'top', label: 'Ropa' },
  { id: 'tc', label: 'Color de ropa', color: true },
  { id: 'bottom', label: 'Pantalón' },
  { id: 'shoes', label: 'Zapatos' },
  { id: 'hat', label: 'Sombrero' },
  { id: 'acc', label: 'Complemento' },
  { id: 'bg', label: 'Fondo' },
  { id: 'pet', label: 'Mascota' },
];

const free = (slot, name) => ({ slot, name, get: 'free' });
const coins = (slot, name, price) => ({ slot, name, get: 'coins', price });
const ach = (slot, name, stat, min, label) => ({ slot, name, get: 'ach', ach: { stat, min, label } });
const premium = (slot, name, eur) => ({ slot, name, get: 'premium', eur });   // eur en céntimos

export const ITEMS = {
  face_smile: free('face', 'Sonrisa'),
  face_happy: free('face', 'Feliz'),
  face_wink: free('face', 'Guiño'),
  face_cool: free('face', 'Seguro'),
  face_surprised: coins('face', 'Sorpresa', 40),
  face_angry: coins('face', 'Enfadado', 40),
  face_star: ach('face', 'Ojos de estrella', 'bestScore', 1000, 'Consigue 1.000 puntos en una partida'),

  hair_short: free('hair', 'Corto'),
  hair_long: free('hair', 'Largo'),
  hair_bob: free('hair', 'Melena'),
  hair_spiky: free('hair', 'De punta'),
  hair_curly: free('hair', 'Rizado'),
  hair_bald: free('hair', 'Sin pelo'),
  hair_ponytail: coins('hair', 'Coleta', 60),
  hair_bun: coins('hair', 'Moño', 80),
  hair_afro: coins('hair', 'Afro', 100),
  hair_mohawk: coins('hair', 'Cresta', 120),

  top_tee: free('top', 'Camiseta'),
  top_hoodie: free('top', 'Sudadera'),
  top_striped: free('top', 'Rayas'),
  top_shirt: coins('top', 'Camisa y corbata', 80),
  top_jacket: coins('top', 'Chaqueta', 150),
  top_suit: coins('top', 'Traje', 300),
  top_jersey: ach('top', 'Camiseta de equipo', 'gamesPlayed', 10, 'Juega 10 partidas'),
  top_hero: premium('top', 'Superhéroe con capa', 199),
  top_gold: premium('top', 'Chaqueta dorada', 249),

  bottom_jeans: free('bottom', 'Vaqueros'),
  bottom_shorts: free('bottom', 'Bermudas'),
  bottom_skirt: free('bottom', 'Falda'),
  bottom_black: coins('bottom', 'Pantalón negro', 50),
  bottom_track: coins('bottom', 'Chándal', 80),

  shoes_sneakers: free('shoes', 'Zapatillas'),
  shoes_boots: free('shoes', 'Botas'),
  shoes_red: coins('shoes', 'Zapatillas rojas', 40),
  shoes_gold: premium('shoes', 'Zapatillas de oro', 99),

  hat_none: free('hat', 'Nada'),
  hat_cap: free('hat', 'Gorra'),
  hat_beanie: coins('hat', 'Gorro de lana', 50),
  hat_chef: coins('hat', 'Gorro de chef', 100),
  hat_headphones: coins('hat', 'Cascos', 120),
  hat_cowboy: coins('hat', 'Sombrero vaquero', 150),
  hat_party: ach('hat', 'Gorro de fiesta', 'gamesPlayed', 1, 'Juega tu primera partida'),
  hat_crown: ach('hat', 'Corona', 'bestScore', 2000, 'Consigue 2.000 puntos en una partida'),
  hat_montera: premium('hat', 'Montera', 149),
  hat_halo: premium('hat', 'Aureola', 199),

  acc_none: free('acc', 'Nada'),
  acc_glasses: free('acc', 'Gafas'),
  acc_sunglasses: coins('acc', 'Gafas de sol', 60),
  acc_mustache: coins('acc', 'Bigote', 40),
  acc_beard: coins('acc', 'Barba', 60),
  acc_scarf: coins('acc', 'Bufanda', 70),
  acc_monocle: coins('acc', 'Monóculo', 150),
  acc_medal: ach('acc', 'Medalla', 'totalPoints', 10000, 'Suma 10.000 puntos en total'),
  acc_pixelshades: premium('acc', 'Gafas pixeladas', 99),

  bg_sky: free('bg', 'Cielo'),
  bg_mint: free('bg', 'Menta'),
  bg_sunset: free('bg', 'Atardecer'),
  bg_spain: coins('bg', 'Rojigualda', 100),
  bg_city: coins('bg', 'Ciudad de noche', 120),
  bg_stars: coins('bg', 'Estrellas', 150),
  bg_map: ach('bg', 'Mapa', 'gamesPlayed', 50, 'Juega 50 partidas'),
  bg_gold: premium('bg', 'Oro', 199),

  // Mascotas: lo más caro del juego
  pet_none: free('pet', 'Sin mascota'),
  pet_cat: coins('pet', 'Gato', 2500),
  pet_dog: coins('pet', 'Perro', 3000),
  pet_penguin: coins('pet', 'Pingüino', 4000),
  pet_parrot: coins('pet', 'Loro', 5000),
  pet_hamster: ach('pet', 'Hámster', 'totalPoints', 50000, 'Suma 50.000 puntos en total'),
  pet_fox: premium('pet', 'Zorro', 499),
  pet_dragon: premium('pet', 'Dragón', 999),
};

// Packs de monedas (Stripe). eur en céntimos.
export const PACKS = {
  coins_250: { name: '250 monedas', coins: 250, eur: 99 },
  coins_1500: { name: '1.500 monedas', coins: 1500, eur: 499, tag: 'Más popular' },
  coins_4000: { name: '4.000 monedas', coins: 4000, eur: 999, tag: 'Mejor precio' },
};

/** Lo que se puede comprar con dinero real: objetos premium y packs de monedas. */
export function sku(id) {
  if (PACKS[id]) return { kind: 'coins', id, name: PACKS[id].name, eur: PACKS[id].eur, coins: PACKS[id].coins };
  const it = ITEMS[id];
  if (it && it.get === 'premium') return { kind: 'item', id, name: it.name, eur: it.eur };
  return null;
}

export const COIN_PER_HIT = 1;   // lo comprueban las reglas: monedas += aciertos

// Piezas que no hay que desbloquear: colores y objetos gratis
export const FREE_TOKENS = [
  ...COLORS.skin.map((_, i) => `skin_${i}`),
  ...COLORS.hc.map((_, i) => `hc_${i}`),
  ...COLORS.tc.map((_, i) => `tc_${i}`),
  ...Object.keys(ITEMS).filter(id => ITEMS[id].get === 'free'),
];

// ---------- Texto del avatar: "px:skin_1.face_smile.hair_short.hc_1.top_tee.tc_5..." ----------
export const DEFAULT_AVATAR = 'px:skin_1.face_smile.hair_short.hc_1.top_tee.tc_5.bottom_jeans.shoes_sneakers.hat_none.acc_none.bg_sky.pet_none';

export function parseAvatar(text) {
  const out = Object.fromEntries(parseTokens(DEFAULT_AVATAR));
  if (typeof text === 'string' && text.startsWith('px:')) {
    for (const [slot, token] of parseTokens(text)) out[slot] = token;
  }
  return out;
}
function parseTokens(text) {
  return text.slice(3).split('.').map((token, i) => [SLOTS[i]?.id, token]).filter(([slot, token]) => slot && validToken(slot, token));
}
function validToken(slot, token) {
  const color = /^(skin|hc|tc)_(\d+)$/.exec(token);
  if (color) return color[1] === slot && +color[2] < COLORS[slot].length;
  return ITEMS[token]?.slot === slot;
}

export const encodeAvatar = cfg => 'px:' + SLOTS.map(s => cfg[s.id]).join('.');

/** Avatar al azar solo con piezas gratis (para jugadores nuevos). */
export function randomAvatar() {
  const pick = a => a[Math.random() * a.length | 0];
  const freeOf = slot => Object.keys(ITEMS).filter(id => ITEMS[id].slot === slot && ITEMS[id].get === 'free');
  return encodeAvatar({
    skin: `skin_${Math.random() * COLORS.skin.length | 0}`,
    face: pick(freeOf('face')),
    hair: pick(freeOf('hair').filter(h => h !== 'hair_bald')),
    hc: `hc_${Math.random() * 6 | 0}`,
    top: pick(freeOf('top')),
    tc: `tc_${Math.random() * COLORS.tc.length | 0}`,
    bottom: pick(freeOf('bottom')),
    shoes: pick(freeOf('shoes')),
    hat: Math.random() < 0.3 ? 'hat_cap' : 'hat_none',
    acc: Math.random() < 0.25 ? 'acc_glasses' : 'acc_none',
    bg: pick(freeOf('bg')),
    pet: 'pet_none',
  });
}

/** Objetos de logro que el jugador ya ha ganado y aún no tiene. */
export function earnedAchievements(profile) {
  const owned = new Set(profile.items || []);
  return Object.entries(ITEMS)
    .filter(([id, it]) => it.get === 'ach' && !owned.has(id) && (profile[it.ach.stat] || 0) >= it.ach.min)
    .map(([id]) => id);
}

export const owns = (profile, id) => {
  const it = ITEMS[id];
  return !it || it.get === 'free' || (profile.items || []).includes(id);
};

export const euros = cents => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
