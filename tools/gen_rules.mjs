// Copia el catálogo de public/js/catalog.js a firestore.rules (piezas gratis, precios en monedas y logros).
// Uso: node tools/gen_rules.mjs          → actualiza firestore.rules
//      node tools/gen_rules.mjs --check  → falla si firestore.rules no está al día
import { readFileSync, writeFileSync } from 'node:fs';
import { FREE_TOKENS, ITEMS } from '../public/js/catalog.js';

const file = new URL('../firestore.rules', import.meta.url);
const START = '    // <catalogo> generado por tools/gen_rules.mjs a partir de public/js/catalog.js; no editar a mano\n';
const END = '    // </catalogo>\n';

const q = s => `'${s}'`;
const entries = Object.entries(ITEMS);
const prices = entries.filter(([, it]) => it.get === 'coins').map(([id, it]) => `${q(id)}: ${it.price}`);
const achs = entries.filter(([, it]) => it.get === 'ach')
  .map(([id, it]) => `${q(id)}: {'stat': ${q(it.ach.stat)}, 'min': ${it.ach.min}}`);
const wrap = (list, indent = '        ') => list.map(x => indent + x).join(',\n');

const block = START +
  `    function freeTokens() {\n      return [\n${wrap(FREE_TOKENS.map(q))}\n      ];\n    }\n` +
  `    function coinPrices() {\n      return {\n${wrap(prices)}\n      };\n    }\n` +
  `    function achievements() {\n      return {\n${wrap(achs)}\n      };\n    }\n` +
  END;

const rules = readFileSync(file, 'utf8');
const a = rules.indexOf(START), b = rules.indexOf(END);
if (a < 0 || b < 0) throw new Error('No encuentro los marcadores <catalogo> en firestore.rules');
const next = rules.slice(0, a) + block + rules.slice(b + END.length);

if (process.argv.includes('--check')) {
  if (next !== rules) { console.error('firestore.rules no está al día: ejecuta node tools/gen_rules.mjs'); process.exit(1); }
  console.log('firestore.rules al día');
} else {
  writeFileSync(file, next);
  console.log(`firestore.rules: ${FREE_TOKENS.length} piezas gratis, ${prices.length} precios, ${achs.length} logros`);
}
