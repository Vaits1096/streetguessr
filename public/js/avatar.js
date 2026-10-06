// Avatar pixel art de 48×48.
//
// Cada pieza se dibuja como formas planas con un "id" de zona. Después, un paso automático:
//   1. sombrea cada zona con una rampa de 5 tonos (luz arriba-izquierda, sombra abajo-derecha,
//      sombras con tinte frío y luces cálidas),
//   2. aplica encima los detalles (ojos, costuras, brillos…), que no se sombrean,
//   3. pone un contorno oscuro teñido del color de cada zona (sel-out), como en los sprites cuidados.
// Así todos los objetos comparten estilo aunque cada uno se defina con pocas líneas.
import { COLORS, parseAvatar } from './catalog.js';

export const N = 48;
const C = (N - 1);                       // espejo: x ↔ C - x
const INK = '#140f24';

// ---------- Color ----------
function hex(c) { const v = parseInt(c.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('');
}
const rampCache = new Map();
function ramp(base) {
  if (!rampCache.has(base)) {
    rampCache.set(base, {
      hi: mix(base, '#fffbea', 0.42),
      li: mix(base, '#fff3d6', 0.18),
      base,
      sh: mix(base, '#2b2350', 0.26),
      dk: mix(base, '#1d1838', 0.45),
    });
  }
  return rampCache.get(base);
}
export const shade = (c, t = 0.26) => mix(c, '#2b2350', t);
export const light = (c, t = 0.3) => mix(c, '#fff3d6', t);

// ---------- Lienzo ----------
class Grid {
  constructor() {
    this.col = new Array(N * N).fill(null);   // color base de la zona
    this.id = new Array(N * N).fill(null);    // zona (para sombrear por zonas)
    this.det = new Array(N * N).fill(null);   // detalle sin sombrear
    this.flat = new Array(N * N).fill(false); // zona que no se sombrea (p. ej. brillos, fuego)
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  /** rectángulo de zona */
  r(x, y, w, h, c, id = c, flat = false) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.inside(i, j)) continue;
      const k = j * N + i;
      this.col[k] = c; this.id[k] = id; this.det[k] = null; this.flat[k] = flat;
    }
  }
  /** rectángulo y su reflejo */
  s(x, y, w, h, c, id = c, flat = false) { this.r(x, y, w, h, c, id, flat); this.r(C - x - w + 1, y, w, h, c, id, flat); }
  /** forma simétrica: starts[i] = primera columna de la fila y0+i (se rellena hasta su reflejo) */
  shape(y0, starts, c, id = c) { starts.forEach((x, i) => { if (x != null) this.r(x, y0 + i, C - 2 * x + 1, 1, c, id); }); }
  /** detalle (no se sombrea); se pinta sobre lo que haya */
  d(x, y, c) { if (this.inside(x, y) && this.id[y * N + x] !== null) this.det[y * N + x] = c; else this.r(x, y, 1, 1, c, 'det:' + c, true); }
  ds(x, y, c) { this.d(x, y, c); this.d(C - x, y, c); }
  /** línea de detalle */
  dl(x, y, w, c) { for (let i = 0; i < w; i++) this.d(x + i, y, c); }
  dls(x, y, w, c) { this.dl(x, y, w, c); this.dl(C - x - w + 1, y, w, c); }
  /** borra (deja transparente) */
  clear(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inside(i, j)) { const k = j * N + i; this.col[k] = null; this.id[k] = null; this.det[k] = null; } }
  has(x, y) { return this.inside(x, y) && this.col[y * N + x] !== null; }
  same(x, y, id) { return this.inside(x, y) && this.id[y * N + x] === id; }

  /** Sombreado + detalles + contorno → array de colores finales */
  render(outline = true) {
    const out = new Array(N * N).fill(null);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = y * N + x, id = this.id[k];
      if (id === null) continue;
      if (this.det[k]) { out[k] = this.det[k]; continue; }
      if (this.flat[k]) { out[k] = this.col[k]; continue; }
      // longitud del tramo de la misma zona en horizontal y vertical
      let l = x; while (this.same(l - 1, y, id)) l--;
      let r = x; while (this.same(r + 1, y, id)) r++;
      let t = y; while (this.same(x, t - 1, id)) t--;
      let b = y; while (this.same(x, b + 1, id)) b++;
      const W = r - l + 1, H = b - t + 1;
      let v = 0;
      if (W >= 4 && x === l) v += 1;
      if (W >= 3 && x === r) v -= 1;
      if (W >= 9 && x === r - 1) v -= 1;
      if (H >= 4 && y === t) v += 1;
      if (H >= 3 && y === b) v -= 1;
      if (H >= 10 && y === b - 1) v -= 1;
      const R = ramp(this.col[k]);
      out[k] = v >= 2 ? R.hi : v === 1 ? R.li : v === 0 ? R.base : v === -1 ? R.sh : R.dk;
    }
    if (outline) {
      const add = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (out[y * N + x]) continue;
        const n = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].find(([i, j]) => this.inside(i, j) && out[j * N + i] && this.id[j * N + i] !== null);
        if (n) add.push([x, y, mix(this.col[n[1] * N + n[0]] || INK, INK, 0.78)]);
      }
      for (const [x, y, c] of add) out[y * N + x] = c;
    }
    return out;
  }
}

// ---------- Paleta fija ----------
const WHITE = '#f3f1ea', CLOUD = '#e9eef7', DARK = '#1d1a33', GOLD = '#f2c14e', RED = '#e0403f', BLUSH = '#f39aa6';
const EYE = '#231f3a', IRIS = '#4a6fd6', MOUTH = '#7a2333', TONGUE = '#e86a73';

// ---------- Fondos (sin contorno) ----------
function vgrad(g, stops) {
  for (let y = 0; y < N; y++) {
    const t = y / (N - 1) * (stops.length - 1), i = Math.min(Math.floor(t), stops.length - 2);
    // bandas de color limpias, como en el pixel art clásico
    const c = mix(stops[i], stops[i + 1], Math.round((t - i) * 4) / 4);
    for (let x = 0; x < N; x++) g.d(x, y, c);
  }
}
function cloud(g, x, y, w) {
  g.dl(x + 2, y, w - 4, '#ffffff'); g.dl(x + 1, y + 1, w - 2, '#ffffff'); g.dl(x, y + 2, w, CLOUD); g.dl(x + 1, y + 3, w - 2, '#cdd8ea');
  g.dl(x + 3, y - 1, Math.max(2, w - 7), '#ffffff');
}
const BG = {
  bg_sky(g) {
    vgrad(g, ['#3d9be0', '#7cc8f2', '#c2ecf9']);
    cloud(g, 2, 9, 11); cloud(g, 33, 15, 13); cloud(g, 19, 4, 7);
    for (let x = 0; x < N; x++) { g.d(x, 44, '#7ec850'); g.d(x, 45, x % 3 ? '#5fae3d' : '#7ec850'); g.d(x, 46, '#4e9a34'); g.d(x, 47, '#3f8a2c'); }
  },
  bg_mint(g) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.d(x, y, (Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? '#93e6c9' : '#86dcbe');
    for (let y = 3; y < N; y += 6) for (let x = 3; x < N; x += 6) g.d(x, y, '#c4f5e3');
  },
  bg_sunset(g) {
    vgrad(g, ['#4b2f7a', '#a4407d', '#f0686e', '#ffa45c', '#ffd98a']);
    for (let y = 26; y < 36; y++) for (let x = 2; x < 16; x++) if ((x - 9) ** 2 + (y - 33) ** 2 < 45) g.d(x, y, y % 3 ? '#fff0b8' : '#ffe08a');
    for (let x = 0; x < N; x++) { const h = 40 + Math.round(Math.sin(x / 5) * 2); for (let y = h; y < N; y++) g.d(x, y, y === h ? '#5a3a78' : '#3b2556'); }
  },
  bg_spain(g) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.d(x, y, y < 12 || y >= 36 ? (y % 12 === 11 || y === 36 ? '#a50a19' : '#c60b1e') : (y === 12 ? '#ffd84d' : '#ffc400'));
    for (let x = 0; x < N; x += 2) { g.d(x, 0, '#d8243a'); g.d(x + 1, 13, '#ffe27a'); }
  },
  bg_city(g) {
    vgrad(g, ['#0d1633', '#1d2b5a', '#3a3f7a']);
    for (const [x, y] of [[4, 4], [12, 8], [40, 6], [30, 3], [20, 11], [44, 12]]) g.d(x, y, '#cfd8ff');
    for (let y = 3; y < 10; y++) for (let x = 33; x < 41; x++) if ((x - 37) ** 2 + (y - 6) ** 2 < 11 && !((x - 39) ** 2 + (y - 5) ** 2 < 8)) g.d(x, y, '#fff3c4');
    const b = [[0, 26, 7, '#141b3a'], [6, 20, 6, '#18204a'], [12, 30, 5, '#141b3a'], [31, 24, 6, '#18204a'], [37, 17, 8, '#141b3a'], [44, 28, 4, '#18204a']];
    for (const [x, y, w, c] of b) {
      for (let j = y; j < N; j++) for (let i = x; i < x + w; i++) g.d(i, j, c);
      g.dl(x, y, w, mix(c, '#5a6aa8', 0.4));
      for (let j = y + 2; j < 44; j += 3) for (let i = x + 1; i < x + w - 1; i += 2) if ((i * 7 + j * 13) % 5 > 1) g.d(i, j, (i + j) % 3 ? '#ffcf5a' : '#ff9f43');
    }
  },
  bg_stars(g) {
    vgrad(g, ['#05081a', '#0d1340', '#1a1550']);
    const s = [[3, 4], [9, 2], [27, 3], [5, 14], [44, 13], [2, 30], [42, 26], [45, 40], [7, 42], [18, 1], [13, 7], [36, 9], [22, 6], [39, 34], [1, 20]];
    s.forEach(([x, y], i) => g.d(x, y, i % 3 ? '#ffffff' : '#9fb4ff'));
    for (const [x, y, c] of [[40, 5, '#ffe9a0'], [6, 24, '#c9b6ff']]) { g.d(x, y, '#ffffff'); g.d(x - 1, y, c); g.d(x + 1, y, c); g.d(x, y - 1, c); g.d(x, y + 1, c); }
    for (let x = 10; x < 36; x++) if ((x * 5) % 7 < 3) g.d(x, 16 + Math.round(Math.sin(x / 4) * 2), '#2a2a6a');
  },
  bg_map(g) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.d(x, y, (x * 3 + y * 5) % 11 ? '#e3dcc6' : '#dbd3bb');
    for (const [x, y, w, h] of [[0, 0, 11, 13], [14, 0, 18, 7], [36, 0, 12, 17], [0, 17, 7, 13], [40, 22, 8, 12], [0, 35, 13, 13], [35, 38, 13, 10]]) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g.d(i, j, (i + j) % 4 ? '#b9d89a' : '#a9cc88');
    }
    for (let i = 0; i < N; i++) { g.d(i, 14, '#ffffff'); g.d(i, 15, '#ffffff'); g.d(12, i, '#ffffff'); g.d(13, i, '#ffffff'); g.d(34, i, '#ffffff'); g.d(35, i, '#ffffff'); }
    for (let i = 0; i < N; i++) { g.d(i, 32, '#ffd400'); g.d(i, 33, '#ffd400'); g.d(i, 34, '#e0b800'); }
    for (const [x, y] of [[5, 6], [24, 3], [42, 8]]) { g.d(x, y, '#e0403f'); g.d(x, y - 1, '#e0403f'); g.d(x - 1, y - 1, '#e0403f'); g.d(x + 1, y - 1, '#e0403f'); g.d(x, y - 2, '#ff7a6b'); }
  },
  bg_gold(g) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.max(Math.abs(x - 23.5), Math.abs(y - 23.5)) / 24, ring = Math.round(d * 6) / 6;
      g.d(x, y, mix('#fff3b0', '#b07a1e', ring + ((x + y) % 2 ? 0.03 : 0)));
    }
    for (const [x, y] of [[6, 7], [40, 10], [7, 38], [39, 40], [23, 3]]) {
      g.d(x, y, '#ffffff'); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.d(x + a, y + b, '#fff7d6'); g.d(x + 2, y, '#ffe9a0'); g.d(x - 2, y, '#ffe9a0'); g.d(x, y + 2, '#ffe9a0'); g.d(x, y - 2, '#ffe9a0');
    }
  },
};

// ---------- Cuerpo ----------
// Cabeza x13..34 y6..24 · brazos x11..14 / x33..36 · torso x15..32 y26..35 · piernas x16..22 / x25..31 · zapatos y42..44
const HEAD = [16, 14, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 14, 15, 17];   // y6..24
const TORSO = [16, 15, 15, 15, 15, 15, 15, 15, 15, 15];                                        // y26..35

function body(g, k, pose) {
  const [ay, ly] = pose;   // desplazamiento de brazos y piernas por fotograma
  g.s(20, 24, 4, 3, k.S, 'neck');
  g.r(11, 27 + ay.l, 4, 8, k.s, 'armL'); g.r(33, 27 + ay.r, 4, 8, k.s, 'armR');
  g.r(16, 38 + ly.l, 7, 4 - Math.max(0, ly.l), k.s, 'legL'); g.r(25, 38 + ly.r, 7, 4 - Math.max(0, ly.r), k.s, 'legR');
  g.shape(26, TORSO, k.t, 'torso');
}
function hands(g, k, pose) {
  const [ay] = pose;
  for (const [x, dy, id] of [[11, ay.l, 'handL'], [33, ay.r, 'handR']]) {
    g.r(x, 35 + dy, 4, 2, k.s, id); g.r(x + 1, 37 + dy, 2, 1, k.s, id);
  }
}
function head(g, k) {
  g.s(11, 14, 2, 5, k.s, 'ear');
  g.ds(12, 16, k.S); g.ds(12, 15, k.S);
  g.shape(6, HEAD, k.s, 'head');
  g.d(23, 19, shade(k.s, 0.18)); g.d(24, 19, shade(k.s, 0.18));   // nariz
}

// ---------- Ropa ----------
function torso(g, c, id = 'top') { g.shape(26, TORSO, c, id); }
function sleeves(g, c, pose, long, id = 'sleeve') {
  const [ay] = pose, h = long ? 8 : 4;
  g.r(11, 27 + ay.l, 4, h, c, id + 'L'); g.r(33, 27 + ay.r, 4, h, c, id + 'R');
  const cuff = shade(c, 0.22);
  g.dl(11, 27 + ay.l + h - 1, 4, cuff); g.dl(33, 27 + ay.r + h - 1, 4, cuff);
}
function folds(g, c) { const f = shade(c, 0.18); g.d(19, 31, f); g.d(20, 32, f); g.d(28, 30, f); g.d(27, 31, f); }
function vneck(g, k, c) {
  g.dls(21, 26, 3, k.s); g.dls(22, 27, 2, k.s); g.dls(23, 28, 1, k.s);
  const rim = shade(c, 0.3); g.ds(20, 26, rim); g.ds(21, 27, rim); g.ds(22, 28, rim);
}
const TOP = {
  top_tee(g, k, p) { torso(g, k.t); sleeves(g, k.t, p, false); vneck(g, k, k.t); folds(g, k.t); },
  top_hoodie(g, k, p) {
    torso(g, k.t); sleeves(g, k.t, p, true);
    g.dls(19, 26, 5, shade(k.t, 0.32)); g.dls(20, 27, 4, shade(k.t, 0.32));   // capucha
    g.r(18, 31, 12, 4, shade(k.t, 0.1), 'pocket'); g.dl(18, 31, 12, shade(k.t, 0.35));
    for (const x of [21, 26]) { g.d(x, 28, WHITE); g.d(x, 29, WHITE); g.d(x, 30, '#c9c6bd'); }
  },
  top_striped(g, k, p) {
    torso(g, k.t); sleeves(g, k.t, p, false);
    for (const y of [28, 31, 34]) { g.r(15, y, 18, 1, WHITE, 'stripe' + y); g.r(11, y, 4, 1, WHITE, 'sL' + y); g.r(33, y, 4, 1, WHITE, 'sR' + y); }
    vneck(g, k, k.t);
  },
  top_shirt(g, k, p) {
    torso(g, WHITE, 'shirt'); sleeves(g, WHITE, p, true);
    g.ds(20, 26, '#d8d4ca'); g.ds(21, 27, '#d8d4ca'); g.ds(19, 26, '#ffffff');
    g.r(22, 26, 4, 2, k.t, 'knot'); g.r(22, 28, 4, 5, k.t, 'tie'); g.r(23, 33, 2, 1, k.t, 'tie');
    g.d(24, 29, light(k.t, 0.35)); g.d(23, 31, shade(k.t, 0.25));
    for (const y of [29, 32]) g.d(20, y, '#c9c6bd');
  },
  top_jacket(g, k, p) {
    torso(g, k.t, 'jacket'); sleeves(g, k.t, p, true);
    g.r(20, 26, 8, 10, WHITE, 'inner');
    for (let i = 0; i < 4; i++) { g.d(19 + Math.min(i, 1), 26 + i, shade(k.t, 0.35)); g.d(28 - Math.min(i, 1), 26 + i, shade(k.t, 0.35)); }
    g.dl(15, 33, 5, shade(k.t, 0.2)); g.dl(28, 33, 5, shade(k.t, 0.2));
    g.d(18, 31, GOLD); g.d(29, 31, GOLD);
  },
  top_suit(g, k, p) {
    const c = '#2d3150';
    torso(g, c, 'suit'); sleeves(g, c, p, true);
    g.r(20, 26, 8, 6, WHITE, 'shirt'); g.r(22, 26, 4, 7, RED, 'tie'); g.r(23, 33, 2, 1, RED, 'tie');
    for (let i = 0; i < 6; i++) { g.d(20 + (i < 3 ? 0 : 1), 26 + i, '#454a72'); g.d(27 - (i < 3 ? 0 : 1), 26 + i, '#454a72'); }
    g.dl(16, 29, 3, WHITE); g.d(16, 28, RED);   // pañuelo
    g.d(20, 33, '#8b8fb3'); g.d(20, 35, '#8b8fb3');
  },
  top_jersey(g, k, p) {
    torso(g, k.t); sleeves(g, k.t, p, false);
    g.dl(11, 30 + p[0].l, 4, WHITE); g.dl(33, 30 + p[0].r, 4, WHITE);
    g.dls(20, 26, 4, WHITE); g.dls(21, 27, 3, k.s);
    const n = WHITE;   // "10"
    for (let y = 29; y < 34; y++) { g.d(20, y, n); g.d(23, y, n); g.d(26, y, n); }
    g.d(19, 30, n); g.dl(23, 29, 4, n); g.dl(23, 33, 4, n);
  },
  top_hero(g, k, p) {
    torso(g, k.t, 'hero'); sleeves(g, k.t, p, true);
    g.r(15, 34, 18, 2, GOLD, 'belt'); g.d(23, 34, '#fff3b0'); g.d(24, 34, '#fff3b0');
    // estrella en el pecho
    const y = 28;
    g.dl(23, y, 2, GOLD); g.dl(20, y + 1, 8, GOLD); g.dl(21, y + 2, 6, GOLD); g.dl(21, y + 3, 2, GOLD); g.dl(25, y + 3, 2, GOLD);
    g.d(23, y + 1, '#fff3b0');
  },
  top_gold(g, k, p) {
    torso(g, GOLD, 'gold'); sleeves(g, GOLD, p, true);
    g.r(22, 26, 4, 10, '#2b2b3a', 'inner');
    for (const [x, y] of [[17, 28], [30, 32], [12, 30], [35, 29], [19, 34]]) { g.d(x, y, '#ffffff'); }
    g.d(21, 30, '#fff3b0'); g.d(26, 30, '#fff3b0');
  },
};
const CAPE = {
  top_hero(g, k) {
    const starts = [14, 13, 12, 12, 11, 11, 11, 10, 10, 10, 10, 10, 10, 10, 11];   // y27..41
    g.shape(27, starts, '#b3263a', 'cape');
    for (const x of [10, 11, 15, 16, 31, 32, 36, 37]) g.clear(x, 41, 1, 1);
    g.clear(12, 41, 3, 1); g.clear(33, 41, 3, 1);
  },
};

const BOTTOM = {
  bottom_jeans(g, k, p) { pants(g, p, '#3b5dc9', 'jeans'); belt(g, '#5a3a22'); seam(g, p, '#6f8ae0'); },
  bottom_black(g, k, p) { pants(g, p, '#2e2e3e', 'black'); belt(g, '#16161f'); seam(g, p, '#4a4a60'); },
  bottom_track(g, k, p) { pants(g, p, '#22409a', 'track'); g.dl(16, 36, 16, '#17307a'); stripes(g, p, WHITE); },
  bottom_shorts(g, k, p) {
    const c = '#c2a26b';
    g.r(16, 36, 16, 2, c, 'shorts'); g.r(16, 38 + p[1].l, 7, 2, c, 'shL'); g.r(25, 38 + p[1].r, 7, 2, c, 'shR');
    g.dl(16, 39 + p[1].l, 7, shade(c, 0.25)); g.dl(25, 39 + p[1].r, 7, shade(c, 0.25)); g.d(23, 37, shade(c, 0.3)); g.d(24, 37, shade(c, 0.3));
  },
  bottom_skirt(g, k, p) {
    const c = '#c0396b';
    g.shape(36, [16, 15, 14, 14], c, 'skirt');
    for (const x of [17, 21, 26, 30]) { g.d(x, 38, shade(c, 0.3)); g.d(x, 39, shade(c, 0.3)); }
    g.dl(16, 36, 16, shade(c, 0.2));
  },
};
function pants(g, p, c, id) { g.r(16, 36, 16, 2, c, id); g.r(16, 38 + p[1].l, 7, 4 - Math.max(0, p[1].l), c, id + 'L'); g.r(25, 38 + p[1].r, 7, 4 - Math.max(0, p[1].r), c, id + 'R'); }
function belt(g, c) { g.dl(16, 36, 16, c); g.d(23, 36, GOLD); g.d(24, 36, GOLD); }
function seam(g, p, c) { g.d(19, 37, c); g.d(28, 37, c); g.d(23, 37, shade('#3b5dc9', 0.3)); }
function stripes(g, p, c) { for (let y = 36; y < 42; y++) { g.d(16, y + (y > 37 ? p[1].l : 0), c); g.d(31, y + (y > 37 ? p[1].r : 0), c); } }

const SHOES = {
  shoes_sneakers(g, k, p) { shoes(g, p, WHITE, '#b9b6c8', RED); },
  shoes_red(g, k, p) { shoes(g, p, RED, WHITE, WHITE); },
  shoes_gold(g, k, p) { shoes(g, p, GOLD, '#b07a1e', '#ffffff'); },
  shoes_boots(g, k, p) {
    g.r(16, 39 + p[1].l, 7, 3, '#6b3e26', 'bootL'); g.r(25, 39 + p[1].r, 7, 3, '#6b3e26', 'bootR');
    shoes(g, p, '#6b3e26', '#3d2416', '#a06a44');
  },
};
function shoes(g, p, c, sole, accent) {
  for (const [x0, dy, id] of [[15, p[1].l, 'shoeL'], [25, p[1].r, 'shoeR']]) {
    const mirror = id === 'shoeR';
    const X = x => (mirror ? C - x : x);
    const y = 42 + dy;
    g.r(mirror ? 25 : 16, y, 7, 1, c, id); g.r(mirror ? 25 : 15, y + 1, 8, 1, c, id); g.r(mirror ? 25 : 15, y + 2, 8, 1, sole, id + 's');
    g.d(X(17), y + 1, accent); g.d(X(18), y + 1, accent); g.d(X(19), y, accent);
    g.d(X(20), y, light(c, 0.4));
    void x0;
  }
}

// ---------- Caras ----------
function eyes(g, k, { lid = true, look = 0 } = {}) {
  for (const [x, m] of [[17, 1], [28, -1]]) {
    if (lid) g.dl(x, 14, 3, EYE);
    g.dl(x, 15, 3, EYE); g.dl(x, 16, 3, EYE); g.dl(x, 17, 3, EYE);
    g.d(m > 0 ? x : x + 2, 15, '#ffffff');                 // brillo
    g.d(m > 0 ? x + 2 : x, 17, IRIS);                      // reflejo del iris
    g.d(m > 0 ? x + 1 : x + 1, 16 + look, '#3a3560');
    if (lid) g.d(m > 0 ? x - 1 : x + 3, 14, EYE);          // pestaña
  }
}
function brows(g, k, y = 12) { g.dls(17, y, 3, shade(k.h, 0.3)); }
function smile(g) { g.ds(20, 20, MOUTH); g.dls(21, 21, 3, MOUTH); }
function blush(g) { g.dls(15, 19, 2, BLUSH); }
const FACE = {
  face_smile(g, k) { eyes(g, k); brows(g, k); smile(g); blush(g); },
  face_happy(g, k) {
    for (const x of [17, 28]) { g.d(x, 16, EYE); g.d(x + 1, 15, EYE); g.d(x + 2, 16, EYE); g.d(x, 17, EYE); g.d(x + 2, 17, EYE); }
    brows(g, k, 12);
    g.r(20, 20, 8, 1, MOUTH, 'mouth'); g.r(21, 21, 6, 2, MOUTH, 'mouth'); g.dl(21, 20, 6, '#ffffff'); g.dl(22, 22, 4, TONGUE); blush(g);
  },
  face_wink(g, k) {
    eyes(g, k);
    g.clear(28, 14, 3, 4); g.r(28, 14, 3, 4, k.s, 'head');
    g.dl(28, 16, 3, EYE); g.d(27, 15, EYE); g.d(31, 15, EYE);
    brows(g, k); smile(g); blush(g); g.d(26, 20, TONGUE);
  },
  face_cool(g, k) {
    for (const x of [17, 28]) { g.dl(x, 16, 3, EYE); g.dl(x, 17, 3, EYE); g.d(x === 17 ? 17 : 30, 16, '#ffffff'); g.dl(x - (x === 17 ? 1 : 0), 15, 4, shade(k.s, 0.3)); }
    g.dls(16, 12, 4, shade(k.h, 0.35)); g.dl(21, 21, 5, MOUTH); g.d(26, 20, MOUTH);
  },
  face_surprised(g, k) {
    eyes(g, k); g.dls(17, 11, 3, shade(k.h, 0.3));
    g.r(22, 20, 4, 3, MOUTH, 'mouth'); g.dl(23, 22, 2, TONGUE);
  },
  face_angry(g, k) {
    eyes(g, k, { lid: false });
    const b = shade(k.h, 0.4);
    g.d(16, 12, b); g.d(17, 12, b); g.d(18, 13, b); g.d(19, 13, b); g.d(20, 14, b);
    g.d(31, 12, b); g.d(30, 12, b); g.d(29, 13, b); g.d(28, 13, b); g.d(27, 14, b);
    g.dls(21, 21, 3, MOUTH); g.ds(20, 22, MOUTH);
  },
  face_star(g, k) {
    for (const x of [17, 28]) {
      g.d(x + 1, 13, GOLD); g.dl(x, 14, 3, GOLD); g.dl(x - 1, 15, 5, GOLD); g.dl(x, 16, 3, GOLD); g.d(x, 17, GOLD); g.d(x + 2, 17, GOLD);
      g.d(x + 1, 15, '#fff3b0');
    }
    g.r(20, 20, 8, 1, MOUTH, 'mouth'); g.r(21, 21, 6, 2, MOUTH, 'mouth'); g.dl(21, 20, 6, '#ffffff'); g.dl(22, 22, 4, TONGUE); blush(g);
  },
};

// ---------- Pelo: capa de atrás (detrás de la cabeza) y de delante ----------
const CAP = [17, 15, 13, 12, 12, 12, 12];   // y3..9
function cap(g, k) {
  g.shape(3, CAP, k.h, 'hair');
  const s = shade(k.h, 0.22);
  for (const [x, y] of [[19, 5], [20, 6], [26, 4], [27, 5], [31, 7], [16, 7]]) g.d(x, y, s);
  g.dl(20, 4, 4, light(k.h, 0.35)); g.dl(18, 5, 2, light(k.h, 0.2));
}
const HAIR_BACK = {
  hair_long(g, k) { g.s(10, 9, 5, 21, k.h, 'hairBack'); g.ds(11, 29, shade(k.h, 0.2)); },
  hair_ponytail(g, k) {
    g.r(35, 8, 4, 3, k.h, 'tail'); g.r(36, 11, 5, 12, k.h, 'tail'); g.r(37, 23, 3, 3, k.h, 'tail');
    g.r(35, 9, 2, 2, '#e0403f', 'scrunchie', true);
  },
  hair_afro(g, k) {
    const starts = [17, 14, 12, 10, 9, 8, 8, 7, 7, 7, 7, 7, 7, 8, 8, 9, 10];   // y0..16
    g.shape(0, starts, k.h, 'afro');
    for (let y = 1; y < 17; y += 3) for (let x = 9 + (y % 2) * 2; x < 39; x += 5) g.d(x, y, shade(k.h, 0.2));
  },
  hair_bob(g, k) { g.s(11, 9, 4, 12, k.h, 'bobBack'); },
};
const HAIR = {
  hair_short(g, k) {
    cap(g, k);
    g.r(13, 10, 11, 1, k.h, 'fringe'); g.r(13, 11, 6, 1, k.h, 'fringe'); g.d(13, 12, k.h);
    g.s(12, 10, 2, 5, k.h, 'side');
  },
  hair_long(g, k) {
    cap(g, k);
    g.r(13, 10, 9, 1, k.h, 'fringe'); g.r(26, 10, 9, 1, k.h, 'fringe2'); g.r(13, 11, 5, 1, k.h, 'fringe'); g.r(30, 11, 5, 1, k.h, 'fringe2');
    g.s(12, 10, 3, 9, k.h, 'lock');
    g.ds(13, 18, shade(k.h, 0.2));
  },
  hair_bob(g, k) {
    cap(g, k);
    g.r(13, 10, 22, 2, k.h, 'bangs');
    for (let x = 14; x < 34; x += 3) g.d(x, 11, shade(k.h, 0.25));
    g.s(11, 10, 4, 10, k.h, 'bob'); g.ds(12, 19, shade(k.h, 0.3));
  },
  hair_spiky(g, k) {
    g.shape(4, [14, 13, 12, 12, 12, 12], k.h, 'hair');
    for (const x of [13, 18, 23, 28, 33]) {
      const xx = x > 23 ? x - 1 : x;
      g.r(xx, 2, 2, 2, k.h, 'spike' + x); g.r(xx + (x < 24 ? -1 : 1), 1, 1, 1, k.h, 'spike' + x);
    }
    g.r(13, 10, 4, 1, k.h, 'fringe'); g.r(20, 10, 3, 1, k.h, 'fringe'); g.r(27, 10, 4, 1, k.h, 'fringe'); g.d(14, 11, k.h); g.d(28, 11, k.h);
    g.s(12, 10, 2, 4, k.h, 'side'); g.dl(18, 4, 5, light(k.h, 0.35));
  },
  hair_curly(g, k) {
    g.shape(2, [16, 14, 12, 11, 11, 11, 11, 11, 12], k.h, 'curly');
    for (let y = 2; y < 11; y += 2) for (let x = 12 + (y % 4); x < 36; x += 4) { g.d(x, y, light(k.h, 0.3)); g.d(x + 1, y + 1, shade(k.h, 0.25)); }
    g.s(11, 10, 3, 6, k.h, 'curlSide');
    for (const x of [15, 19, 23, 27, 31]) g.r(x, 11, 2, 1, k.h, 'curlFringe');
  },
  hair_bald(g, k) { g.dl(17, 7, 4, light(k.s, 0.45)); g.dl(16, 8, 2, light(k.s, 0.3)); g.d(28, 7, light(k.s, 0.25)); },
  hair_ponytail(g, k) {
    cap(g, k);
    g.r(13, 10, 12, 1, k.h, 'fringe'); g.r(13, 11, 7, 1, k.h, 'fringe');
    g.s(12, 10, 2, 5, k.h, 'side');
  },
  hair_bun(g, k) {
    cap(g, k);
    g.shape(0, [20, 19, 19, 20], k.h, 'bun'); g.dl(21, 1, 3, light(k.h, 0.35));
    g.r(13, 10, 22, 1, k.h, 'fringe'); g.s(12, 10, 2, 5, k.h, 'side');
  },
  hair_afro(g, k) { g.shape(4, [15, 13, 13, 13, 13, 13, 13], k.h, 'afroFront'); for (let x = 14; x < 34; x += 3) g.d(x, 10, shade(k.h, 0.2)); },
  hair_mohawk(g, k) {
    g.r(21, 0, 6, 10, k.h, 'mohawk');
    for (let y = 1; y < 9; y += 2) { g.d(21, y, shade(k.h, 0.25)); g.d(26, y + 1, shade(k.h, 0.25)); }
    g.dl(22, 1, 2, light(k.h, 0.4));
    for (let y = 6; y < 10; y++) for (let x = 14 + (y % 2); x < 21; x += 2) { g.d(x, y, shade(k.s, 0.25)); g.d(C - x, y, shade(k.s, 0.25)); }
  },
};

// ---------- Complementos ----------
const ACC = {
  acc_none() {},
  acc_glasses(g) {
    const f = '#2d2a48';
    for (const x of [15, 27]) { g.dl(x, 13, 6, f); g.dl(x, 18, 6, f); for (let y = 13; y < 19; y++) { g.d(x, y, f); g.d(x + 5, y, f); } g.d(x + 1, 14, '#bfe6ff'); }
    g.dl(21, 15, 6, f);
    g.d(13, 15, f); g.d(14, 15, f); g.d(33, 15, f); g.d(34, 15, f);
  },
  acc_sunglasses(g) {
    for (const x of [15, 27]) { g.dl(x, 13, 6, '#0d0b16'); for (let y = 14; y < 18; y++) g.dl(x, y, 6, y < 16 ? '#2b2b45' : '#151426'); g.d(x + 1, 14, '#8a8fb8'); g.d(x + 2, 14, '#5b5f88'); }
    g.dl(21, 14, 6, '#0d0b16'); g.d(13, 14, '#0d0b16'); g.d(14, 14, '#0d0b16'); g.d(33, 14, '#0d0b16'); g.d(34, 14, '#0d0b16');
  },
  acc_pixelshades(g) {
    g.dl(13, 13, 22, '#0d0b16');
    for (const x of [15, 26]) { g.dl(x, 14, 7, '#0d0b16'); g.dl(x + 1, 15, 5, '#0d0b16'); g.dl(x + 2, 16, 3, '#0d0b16'); g.d(x + 1, 14, '#ffffff'); g.d(x + 2, 14, '#ffffff'); g.d(x + 2, 15, '#ffffff'); }
  },
  acc_mustache(g, k) {
    const c = shade(k.h, 0.1);
    g.dl(19, 19, 10, c); g.dl(18, 20, 4, c); g.dl(26, 20, 4, c); g.d(17, 19, c); g.d(30, 19, c); g.d(17, 18, c); g.d(30, 18, c);
    g.dl(21, 19, 6, light(k.h, 0.2));
  },
  acc_beard(g, k) {
    g.s(12, 15, 2, 9, k.h, 'beardSide'); g.shape(21, [14, 14, 15, 16, 18, 20], k.h, 'beard');
    g.r(21, 20, 6, 2, k.s, 'head'); g.dl(21, 21, 6, MOUTH);
    for (const [x, y] of [[16, 23], [20, 25], [27, 24], [31, 22], [23, 26]]) g.d(x, y, shade(k.h, 0.25));
  },
  acc_scarf(g) {
    g.shape(24, [17, 16, 16], RED, 'scarf');
    for (const x of [19, 23, 27, 31]) { g.d(x, 24, WHITE); g.d(x, 25, WHITE); g.d(x - 1, 26, WHITE); }
    g.r(26, 27, 4, 7, RED, 'scarfEnd'); g.dl(26, 30, 4, WHITE); g.dl(26, 33, 4, '#ffb3b3');
  },
  acc_monocle(g) {
    for (let y = 13; y < 19; y++) { g.d(26, y, GOLD); g.d(31, y, GOLD); }
    g.dl(27, 12, 4, GOLD); g.dl(27, 19, 4, GOLD); g.d(28, 14, '#ffffff');
    for (let i = 0; i < 9; i++) g.d(32 + (i > 4 ? 1 : 0), 19 + i, i % 2 ? '#b07a1e' : GOLD);
  },
  acc_medal(g) {
    g.r(21, 26, 2, 4, '#0099db', 'ribbon'); g.r(25, 26, 2, 4, '#e0403f', 'ribbon2');
    g.shape(30, [21, 21, 21, 22], GOLD, 'medal');
    g.d(23, 31, '#fff3b0'); g.d(24, 32, '#b07a1e');
  },
};

// ---------- Sombreros ----------
const HAT = {
  hat_none() {},
  hat_cap(g, k) {
    g.shape(2, [18, 15, 14, 13, 13, 13, 13], k.t, 'cap');
    g.shape(9, [11, 10], shade(k.t, 0.25), 'visor');
    g.dl(12, 10, 24, shade(k.t, 0.45));
    g.r(21, 4, 6, 3, WHITE, 'logo'); g.d(22, 5, k.t); g.d(25, 5, k.t); g.d(23, 5, RED); g.d(24, 5, RED);
    g.d(23, 2, shade(k.t, 0.35)); g.d(24, 2, shade(k.t, 0.35));
    for (const x of [17, 30]) for (let y = 3; y < 9; y += 2) g.d(x, y, shade(k.t, 0.15));
  },
  hat_beanie(g, k) {
    g.shape(3, [17, 15, 14, 13, 13, 13], k.t, 'beanie');
    g.r(12, 9, 24, 3, shade(k.t, 0.15), 'rib');
    for (let x = 12; x < 36; x += 2) { g.d(x, 9, shade(k.t, 0.35)); g.d(x, 10, shade(k.t, 0.35)); g.d(x, 11, shade(k.t, 0.35)); }
    for (let x = 17; x < 31; x += 3) g.d(x, 6, light(k.t, 0.25));
    g.shape(0, [21, 20, 21], WHITE, 'pompom'); g.d(22, 1, '#d8d4ca'); g.d(25, 2, '#d8d4ca');
  },
  hat_chef(g) {
    g.shape(0, [17, 14, 13, 13, 13, 14], WHITE, 'puff');
    for (const [x, y] of [[18, 2], [23, 1], [28, 2], [16, 4], [31, 4]]) g.d(x, y, '#d9d6ce');
    g.r(13, 6, 22, 5, '#ffffff', 'band'); g.dl(13, 6, 22, '#d9d6ce'); g.dl(13, 10, 22, '#c9c6bd');
  },
  hat_headphones(g) {
    const b = '#2d2a48';
    g.shape(2, [16, 14, 13], b, 'band'); g.clear(16, 4, 16, 1); g.clear(15, 3, 18, 1); g.r(17, 3, 14, 1, b, 'band');
    g.s(11, 4, 2, 7, b, 'arm');
    g.s(8, 11, 5, 9, RED, 'cup'); g.s(10, 12, 2, 7, '#a82830', 'cushion');
    g.ds(9, 12, '#ff8a80'); g.ds(9, 13, '#ff8a80');
  },
  hat_cowboy(g) {
    const c = '#8b5a2b';
    g.shape(1, [17, 15, 15, 15, 15, 15, 15], c, 'crown'); g.clear(22, 1, 4, 1); g.d(22, 2, shade(c, 0.3)); g.d(25, 2, shade(c, 0.3));
    g.r(15, 7, 18, 2, '#3b2414', 'hatband'); g.d(17, 7, GOLD); g.d(18, 8, GOLD);
    g.shape(9, [6, 7], c, 'brim'); g.r(5, 7, 3, 2, c, 'brimL'); g.r(40, 7, 3, 2, c, 'brimR');
  },
  hat_party(g) {
    const stripes = ['#d65db1', '#feae34', '#4fb6e8'];
    for (let i = 0; i < 10; i++) {
      const w = 2 + i * 2;
      for (let x = 0; x < w; x++) g.r(23 - i + x, 1 + i, 1, 1, stripes[Math.floor((x + i * 2) / 3) % 3], 'cone');
    }
    g.shape(0, [22, 22], '#ffffff', 'pom'); g.clear(22, 0, 1, 1); g.clear(25, 0, 1, 1);
    g.d(22, 3, '#ffffff'); g.d(26, 6, '#ffffff');
  },
  hat_crown(g) {
    g.r(14, 6, 20, 4, GOLD, 'band');
    for (const x of [14, 22, 31]) { const w = x === 22 ? 4 : 3; g.r(x, 3, w, 3, GOLD, 'pt' + x); g.r(x + (w === 4 ? 1 : 1), 1, w - 2, 2, GOLD, 'pt' + x); }
    g.d(15, 1, GOLD); g.d(32, 1, GOLD);
    g.d(17, 7, RED); g.d(18, 7, RED); g.r(22, 7, 4, 2, '#2e86de', 'gem', true); g.d(22, 7, '#9fd1ff'); g.d(29, 7, RED); g.d(30, 7, RED);
    g.dl(14, 9, 20, '#b07a1e'); g.d(23, 2, '#fff3b0'); g.d(15, 4, '#fff3b0');
  },
  hat_montera(g) {
    const c = '#2a2840';
    g.s(11, 4, 8, 6, c, 'lobe'); g.r(18, 3, 12, 7, c, 'center');
    for (let y = 4; y < 10; y++) for (let x = 12 + (y % 2); x < 36; x += 2) g.d(x, y, (x + y) % 4 ? '#3a3858' : '#1d1b30');
    g.s(9, 9, 3, 3, c, 'macho'); g.ds(10, 10, '#4a4870');
    g.dl(18, 9, 12, '#b07a1e');
  },
  hat_halo(g) {
    for (let x = 15; x < 33; x++) { g.d(x, 0, x % 2 ? '#fff0a0' : '#ffe066'); g.d(x, 2, '#e6b800'); }
    g.d(14, 1, '#ffe066'); g.d(33, 1, '#ffe066');
    for (let x = 17; x < 31; x += 4) g.d(x, 1, '#fffbe0');
  },
};

// ---------- Mascotas (al lado del personaje, abajo a la derecha) ----------
const PET = {
  pet_none() {},
  pet_cat(g) {
    const c = '#f08a3c', w = '#fde8d0';
    g.r(38, 37, 8, 6, c, 'catBody'); g.r(37, 31, 8, 7, c, 'catHead');
    g.r(37, 29, 2, 2, c, 'earL'); g.r(43, 29, 2, 2, c, 'earR'); g.d(38, 30, '#ffb3a7'); g.d(43, 30, '#ffb3a7');
    g.r(46, 33, 1, 7, c, 'tail'); g.d(45, 33, c);
    g.r(39, 39, 4, 4, w, 'chest');
    g.d(39, 33, EYE); g.d(42, 33, EYE); g.d(40, 35, '#ff8fa0'); g.d(41, 35, '#ff8fa0');
    for (const x of [38, 41]) g.d(x, 31, shade(c, 0.3));
    g.d(38, 43, w); g.d(44, 43, w);
  },
  pet_dog(g) {
    const c = '#b7773d', w = '#f6e7d0';
    g.r(37, 37, 9, 6, c, 'dogBody'); g.r(36, 30, 8, 8, c, 'dogHead');
    g.r(35, 31, 2, 5, '#6e4421', 'earL'); g.r(43, 31, 2, 5, '#6e4421', 'earR');
    g.r(38, 34, 4, 4, w, 'snout'); g.d(39, 34, EYE); g.d(40, 34, EYE);
    g.d(37, 32, EYE); g.d(42, 32, EYE); g.d(39, 37, '#e86a73'); g.d(40, 37, '#e86a73');
    g.r(46, 35, 1, 3, c, 'tail'); g.r(39, 39, 3, 3, w, 'chest');
    g.d(38, 42, w); g.d(44, 42, w); g.r(37, 38, 1, 1, '#e0403f', 'collar', true); g.r(38, 38, 6, 1, '#e0403f', 'collar', true); g.d(40, 39, GOLD);
  },
  pet_penguin(g) {
    const b = '#2b2d4a', w = '#f4f4f4';
    g.r(38, 31, 7, 13, b, 'pBody'); g.r(39, 30, 5, 1, b, 'pBody');
    g.r(39, 35, 5, 8, w, 'belly'); g.r(40, 33, 3, 2, w, 'face');
    g.d(40, 33, EYE); g.d(42, 33, EYE); g.r(40, 35, 3, 1, '#f5a623', 'beak', true);
    g.r(38, 44, 3, 1, '#f5a623', 'feet', true); g.r(42, 44, 3, 1, '#f5a623', 'feet', true);
    g.r(37, 36, 1, 5, b, 'wing'); g.r(45, 36, 1, 5, b, 'wing2');
  },
  pet_parrot(g) {
    const gr = '#2fbf71', r = '#e0403f';
    g.r(36, 17, 6, 9, gr, 'parrot'); g.r(37, 15, 5, 3, r, 'pHead');
    g.r(42, 16, 2, 2, '#f5a623', 'pBeak', true); g.d(42, 17, '#c47d10');
    g.d(40, 16, EYE); g.d(39, 16, '#ffffff');
    g.r(37, 26, 3, 5, '#2e86de', 'pTail'); g.r(38, 31, 2, 2, r, 'pTail2');
    g.d(37, 20, shade(gr, 0.3)); g.d(38, 21, shade(gr, 0.3)); g.d(37, 22, '#feae34');
  },
  pet_hamster(g) {
    const c = '#e2b07a', w = '#fbecd6';
    g.r(38, 37, 8, 7, c, 'ham'); g.r(39, 36, 6, 1, c, 'ham');
    g.r(38, 35, 2, 2, c, 'hEar'); g.r(44, 35, 2, 2, c, 'hEar2'); g.d(39, 36, '#ffb3a7'); g.d(44, 36, '#ffb3a7');
    g.r(39, 40, 6, 4, w, 'hBelly'); g.d(40, 38, EYE); g.d(43, 38, EYE); g.d(41, 39, '#ff8fa0'); g.d(42, 39, '#ff8fa0');
    g.d(38, 39, '#f39aa6'); g.d(45, 39, '#f39aa6');
  },
  pet_fox(g) {
    const c = '#e8692a', w = '#fff4e6';
    g.r(37, 37, 8, 6, c, 'foxBody'); g.r(37, 31, 7, 6, c, 'foxHead');
    g.r(37, 29, 2, 2, c, 'fEar'); g.r(42, 29, 2, 2, c, 'fEar2'); g.d(37, 29, '#3a2418'); g.d(43, 29, '#3a2418');
    g.r(38, 34, 5, 3, w, 'fMuzzle'); g.d(40, 36, EYE); g.d(38, 32, EYE); g.d(42, 32, EYE);
    g.r(44, 33, 3, 8, c, 'fTail'); g.r(45, 31, 2, 3, w, 'fTailTip');
    g.r(39, 39, 3, 3, w, 'fChest'); g.r(37, 43, 2, 1, '#3a2418', 'paw', true); g.r(42, 43, 2, 1, '#3a2418', 'paw', true);
  },
  pet_dragon(g) {
    const c = '#7c5cff', b = '#ffd27a', wing = '#c06cff';
    // alas (detrás)
    g.r(40, 22, 7, 6, wing, 'wing'); g.clear(45, 22, 2, 2); g.d(46, 24, wing);
    for (let y = 23; y < 28; y++) g.d(43, y, shade(wing, 0.3));
    g.r(37, 26, 8, 9, c, 'dBody'); g.r(36, 20, 7, 7, c, 'dHead'); g.r(42, 23, 3, 3, c, 'dSnout');
    g.r(38, 29, 5, 5, b, 'dBelly'); for (let y = 30; y < 34; y += 2) g.dl(38, y, 5, shade(b, 0.2));
    g.d(37, 19, '#ffd27a'); g.d(41, 19, '#ffd27a'); g.d(37, 18, '#fff0c0'); g.d(41, 18, '#fff0c0');
    g.d(39, 22, '#ffffff'); g.d(40, 22, EYE); g.d(44, 24, EYE);
    g.r(44, 30, 3, 2, c, 'dTail'); g.d(46, 29, '#ff7a6b');
    g.r(37, 35, 2, 2, c, 'dLeg'); g.r(42, 35, 2, 2, c, 'dLeg2');
    g.r(45, 22, 2, 1, '#ff9f43', 'fire', true); g.d(46, 21, '#ffe066');
  },
};

const HAT_COVERS = new Set(['hat_cap', 'hat_beanie', 'hat_chef', 'hat_cowboy', 'hat_montera']);

// ---------- Composición ----------
function palette(cfg) {
  const idx = (token, list) => list[+token.split('_')[1]] ?? list[0];
  const [s, S] = idx(cfg.skin, COLORS.skin);
  return { s, S, h: idx(cfg.hc, COLORS.hc), t: idx(cfg.tc, COLORS.tc) };
}

// Fotogramas de andar: [brazos {l, r}, piernas {l, r}] en píxeles (negativo = arriba)
export const POSES = {
  stand: [{ l: 0, r: 0 }, { l: 0, r: 0 }],
  walkA: [{ l: -1, r: 1 }, { l: -1, r: 0 }],
  walkB: [{ l: 1, r: -1 }, { l: 0, r: -1 }],
};

/** Rejilla final 48×48 del avatar: { bg, fg } (arrays de colores, null = transparente). */
export function compose(text, pose = 'stand') {
  const cfg = parseAvatar(text);
  const k = palette(cfg);
  const p = POSES[pose] || POSES.stand;
  const g = new Grid();
  CAPE[cfg.top]?.(g, k, p);
  HAIR_BACK[cfg.hair]?.(g, k, p);
  body(g, k, p);
  (BOTTOM[cfg.bottom] || BOTTOM.bottom_jeans)(g, k, p);
  (SHOES[cfg.shoes] || SHOES.shoes_sneakers)(g, k, p);
  (TOP[cfg.top] || TOP.top_tee)(g, k, p);
  hands(g, k, p);
  head(g, k);
  if (cfg.acc === 'acc_scarf' || cfg.acc === 'acc_medal') ACC[cfg.acc](g, k);
  (FACE[cfg.face] || FACE.face_smile)(g, k);
  if (cfg.acc === 'acc_beard' || cfg.acc === 'acc_mustache') ACC[cfg.acc](g, k);
  (HAIR[cfg.hair] || HAIR.hair_short)(g, k);
  if (HAT_COVERS.has(cfg.hat)) g.clear(0, 0, N, 5);   // lo que asome por encima de un sombrero que cubre la cabeza
  if (!['acc_beard', 'acc_mustache', 'acc_scarf', 'acc_medal'].includes(cfg.acc)) (ACC[cfg.acc] || ACC.acc_none)(g, k);
  (HAT[cfg.hat] || HAT.hat_none)(g, k);
  PET[cfg.pet]?.(g, k);
  const fg = g.render(true);

  const b = new Grid();
  (BG[cfg.bg] || BG.bg_sky)(b);
  const bg = b.render(false);
  // sombra en el suelo
  for (let x = 13; x < 35; x++) for (const y of [45, 46]) {
    if (y === 46 && (x < 16 || x > 31)) continue;
    const i = y * N + x; if (bg[i]) bg[i] = mix(bg[i], '#1d1838', 0.3);
  }
  return { bg, fg };
}

function toImageData(ctx, px) {
  const img = ctx.createImageData(N, N);
  px.forEach((c, i) => {
    if (!c) return;
    const [r, g, b] = hex(c);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  });
  return img;
}

/** Pinta el avatar en un canvas de 48×48 (se escala con CSS: image-rendering: pixelated). */
export function drawAvatar(canvas, text, { background = true, pose = 'stand' } = {}) {
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');
  const { bg, fg } = compose(text, pose);
  ctx.putImageData(toImageData(ctx, fg.map((c, i) => c || (background ? bg[i] : null))), 0, 0);
  return canvas;
}

const cache = new Map();
function scaled(text, sx, sy, sw, sh, size, opts) {
  const key = [text, sx, sy, sw, sh, size, opts.background, opts.pose].join('|');
  if (cache.has(key)) return cache.get(key);
  const full = drawAvatar(document.createElement('canvas'), text, opts);
  const out = document.createElement('canvas');
  out.width = Math.round(size * sw / sh);
  out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/png');
  if (cache.size > 600) cache.clear();
  cache.set(key, url);
  return url;
}

/** Retrato (cabeza y hombros) para los círculos del ranking y el menú. */
export const avatarPortrait = text => scaled(text, 6, 0, 36, 36, 108, { background: true });

/** Avatar completo como imagen (tarjetas de la tienda y el editor). */
export const avatarImage = (text, size = 144) => scaled(text, 0, 0, N, N, size, { background: true });

/**
 * Sprite sin fondo para el mapa, recortado al personaje (y su mascota), en el fotograma pedido.
 * Devuelve { url, w, h } en píxeles del sprite (sin escalar).
 */
export function avatarSprite(text, pose) {
  const x0 = 4, y0 = 0, w = 44, h = 47;
  // a 4× con píxeles duros: así el navegador lo puede mostrar a cualquier tamaño sin que los píxeles salgan desiguales
  return { url: scaled(text, x0, y0, w, h, h * 4, { background: false, pose }), w, h, footX: 24 - x0, footY: 45 - y0 };
}
