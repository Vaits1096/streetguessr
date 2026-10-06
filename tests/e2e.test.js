// Prueba de punta a punta en un navegador real contra los emuladores de Firebase. Ejecutar con: npm test
// Necesita Chromium de Playwright: npx playwright install chromium
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const SHOTS = process.env.SHOTS;   // carpeta opcional para guardar capturas
const AUTH = 'http://127.0.0.1:9099/emulator/v1/projects/demo-calles';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let server, browser, base;

before(async () => {
  await fetch(`${AUTH}/accounts`, { method: 'DELETE' });
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-calles/databases/(default)/documents', { method: 'DELETE' });
  server = createServer(async (req, res) => {
    const file = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
    try {
      const body = await readFile(join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0);
  base = `http://localhost:${server.address().port}/?emulador`;
  browser = await chromium.launch();
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); });

const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

async function verifyEmail(email) {
  const { oobCodes } = await (await fetch(`${AUTH}/oobCodes`)).json();
  const code = oobCodes.reverse().find(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  assert.ok(code, 'no se envió el correo de verificación');
  await fetch(code.oobLink);
}

/** Juega una partida respondiendo siempre la opción correcta `aciertos` veces y luego fallando hasta perder. */
async function playGame(page, hits) {
  let done = 0;
  for (;;) {
    await page.locator('#options .opt').first().waitFor();
    const answer = await page.evaluate(() => document.querySelector('#options').dataset.answer);
    const opts = page.locator('#options .opt');
    const names = await opts.allInnerTexts();
    const wantRight = done < hits;
    const i = names.findIndex(n => (n.replace(/^\d\s*/, '').trim() === answer) === wantRight);
    await opts.nth(i).click();
    if (wantRight) done++;
    await page.waitForTimeout(1100);   // las reglas exigen 1 s por ronda
    const next = page.locator('#next');
    if ((await next.innerText()).includes('resultado')) { await next.click(); break; }
    await next.click();
  }
}

test('registro con correo, partida, perfil y ranking', { timeout: 180_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__TEST__ = true; });
  await page.goto(base);

  // portada: ronda de prueba y elegir Logroño antes de tener cuenta
  await page.locator('#landing:not([hidden]) #lpDemoOptions button').first().waitFor({ timeout: 15_000 });
  await shot(page, '01-landing');
  await page.locator('#lpDemoOptions button').first().click();
  await page.locator('#lpDemoOptions button.correct').waitFor();
  await page.fill('#lpCitySearch', 'logroño');
  await page.locator('#lpCities button').first().click();
  await page.locator('#screen-login:not(.hidden)').waitFor();
  assert.match(await page.innerText('#authContext'), /Logroño/);
  assert.equal(await page.isVisible('#password2'), true, 'debería abrirse en modo «crear cuenta»');
  await page.fill('#email', 'ana@example.com');
  await page.fill('#password', 'secreto123');
  await page.fill('#password2', 'secreto123');
  await page.click('#emailSubmit');
  await page.locator('#screen-verify:not(.hidden)').waitFor();
  await shot(page, '02-verify');

  // verificación: la pantalla avanza sola
  await verifyEmail('ana@example.com');
  await page.locator('#screen-username:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.equal(await page.inputValue('#usernameInput'), 'ana');
  await page.fill('#usernameInput', 'Ana_Rioja');
  await shot(page, '03-username');
  await page.click('#usernameForm button[type=submit]');

  // inicio: avatar en grande y la ciudad de la portada ya elegida
  await page.locator('#home:not([hidden])').waitFor();
  assert.equal(await page.isVisible('#landing'), false);
  assert.equal(await page.innerText('#hmName'), 'Ana_Rioja');
  await page.waitForFunction(() => document.querySelector('#hmPickedName').textContent === 'Logroño');
  assert.match(await page.textContent('#hmPlay'), /Jugar en Logroño/);
  await shot(page, '04-home');
  await page.click('#hmPlay');
  await page.locator('#panel:not([hidden]) .opt').first().waitFor();
  assert.equal(await page.innerText('#cityName'), 'Logroño');
  await shot(page, '05-game');

  // partida: 4 aciertos (100+110+120+130 = 460) y 3 fallos → 4 monedas y el logro «primera partida»
  await playGame(page, 4);
  await page.locator('#screen-over:not(.hidden)').waitFor();
  await page.waitForFunction(() => /puesto/.test(document.querySelector('#finalRank').textContent), null, { timeout: 15_000 });
  assert.equal(await page.innerText('#finalScore'), '460');
  assert.match(await page.innerText('#finalRank'), /puesto 1\.º/);
  assert.match(await page.innerText('#finalCoins'), /\+4/);
  assert.match(await page.innerText('#finalUnlocks'), /Gorro de fiesta/);
  await shot(page, '06-over');

  // editor de avatar: ponerse el gorro de fiesta (ganado) sí; el gorro de lana (50 monedas) no se puede guardar
  await page.click('#userChip');
  await page.click('#menu [data-go=avatar]');
  await page.locator('#screen-avatar:not(.hidden)').waitFor();
  await page.click('#avTabs [data-tab=hat]');
  await page.click('#avGrid [data-item=hat_beanie]');
  assert.equal(await page.isDisabled('#avSave'), true);
  assert.match(await page.innerText('#avAction'), /Te faltan 46 monedas/);
  await page.click('#avGrid [data-item=hat_party]');
  await page.click('#avTabs [data-tab=hair]');
  await page.click('#avSwatches [data-swatch=hc_5]');
  await shot(page, '07-avatar');
  assert.equal(await page.isDisabled('#avSave'), false);
  await page.click('#avSave');
  await page.locator('#screen-over:not(.hidden)').waitFor();

  // tienda: sin el servidor de Cloudflare el pago avisa en vez de romperse
  await page.click('#userChip');
  await page.click('#menu [data-go=shop]');
  await page.locator('#screen-shop:not(.hidden)').waitFor();
  assert.equal(await page.innerText('#shopCoins'), '4');
  await shot(page, '08-shop');
  await page.click('#shopPacks [data-buy=coins_250]');
  await page.locator('#shopError:not([hidden])').waitFor();
  assert.match(await page.innerText('#shopError'), /servidor/);
  await page.click('#screen-shop [data-close]');

  // perfil
  await page.click('#userChip');
  await page.click('#menu [data-go=profile]');
  await page.locator('#screen-profile:not(.hidden)').waitFor();
  await page.waitForFunction(() => document.querySelector('#myCities li.pick'));
  assert.equal(await page.innerText('#profTotal'), '460');
  assert.equal(await page.innerText('#profCoins'), '4');
  await page.fill('#profName', 'AnaR');
  await page.fill('#profAge', '31');
  await page.fill('#profLocality', 'Logroño (La Rioja)');
  await page.click('#profileForm button[type=submit]');
  await page.locator('#profileOk:not([hidden])').waitFor();
  await shot(page, '09-profile');

  // ranking por ciudad con el nombre y el avatar nuevos
  await page.click('#screen-profile [data-close]');
  await page.click('#userChip');
  await page.click('#menu [data-go=ranking]');
  await page.locator('#rankList li .name').first().waitFor();
  assert.match(await page.innerText('#rankList li'), /AnaR/);
  await shot(page, '10-ranking-city');
  await page.click('#rankTabs [data-tab=world]');
  await page.waitForFunction(() => /460/.test(document.querySelector('#rankList').textContent));
  await page.click('#screen-ranking [data-close]');

  // inicio → otra ciudad
  await page.click('#overHome');
  await page.locator('#home:not([hidden])').waitFor();
  await page.click('#hmPickedChange');
  await page.fill('#hmCitySearch', 'haro');
  await page.locator('#hmCityList li.pick').first().click();
  await page.click('#hmPlay');
  await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'Haro' && !document.querySelector('.overlay:not(.hidden)'));

  // móvil
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '11-mobile-game');
  await page.click('#changeCity');
  await page.locator('#home:not([hidden])').waitFor();
  await shot(page, '12-mobile-home');

  // cerrar sesión vuelve a la portada
  await page.click('#userChip');
  await page.click('#menu [data-go=logout]');
  await page.locator('#landing:not([hidden])').waitFor();

  assert.deepEqual(errors, []);
});
