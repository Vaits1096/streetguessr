// 1vs1 entre dos navegadores de verdad, a través del servidor de partidas (wrangler dev) y los emuladores.
// Necesita `npm run dev:cf` (con .dev.vars apuntando a los emuladores) además de `npm run emulators`.
// Si el servidor de Cloudflare no está en marcha, el test se salta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.CF_URL || 'http://127.0.0.1:8787';
const SHOTS = process.env.SHOTS;
const up = await fetch(BASE).then(r => r.ok, () => false);

let browser;
before(async () => { if (up) browser = await chromium.launch(); if (SHOTS) await mkdir(SHOTS, { recursive: true }); });
after(async () => { await browser?.close(); });

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(() => { window.__TEST__ = true; });
  await page.goto(`${BASE}/?emulador`);
  await page.locator('#landing:not([hidden])').waitFor({ timeout: 20_000 });
  await page.click('.lp-nav [data-auth=signup]');
  await page.fill('#email', `${name.toLowerCase()}${Date.now()}@example.com`);
  await page.fill('#password', 'secreto123');
  await page.fill('#password2', 'secreto123');
  await page.click('#emailSubmit');
  await page.locator('#screen-verify:not(.hidden)').waitFor();
  await page.click('#verifyEmu');
  await page.locator('#screen-username:not(.hidden)').waitFor();
  await page.fill('#usernameInput', name);
  await page.click('#usernameForm button[type=submit]');
  await page.locator('#home:not([hidden])').waitFor();
  return page;
}

async function searchIn(page, city) {
  await page.click('#hmModes [data-mode=versus]');
  await page.fill('#hmCitySearch', city);
  await page.locator('#hmCityList li.pick').first().click();
  await page.click('#hmPlay');
}

/** Responde bien la calle que toque. */
async function answerRight(page) {
  await page.waitForFunction(() => document.querySelector('#options .opt:not([disabled])'), null, { timeout: 10_000 });
  const answer = await page.evaluate(() => document.querySelector('#options').dataset.answer);
  const names = await page.locator('#options .opt').allInnerTexts();
  await page.locator('#options .opt').nth(names.findIndex(n => n.replace(/^\d\s*/, '').trim() === answer)).click();
  await page.waitForTimeout(800);
}

test('dos jugadores se emparejan en la misma ciudad y gana el más rápido', { skip: !up && 'servidor de partidas no disponible', timeout: 240_000 }, async () => {
  const ana = await player('AnaVs' + (Date.now() % 1000));
  const bob = await player('BobVs' + (Date.now() % 1000));
  await searchIn(ana, 'haro');
  await ana.locator('#screen-search:not(.hidden)').waitFor();
  await searchIn(bob, 'haro');

  // emparejados: presentación VS con el nombre del otro
  await ana.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 15_000 });
  await bob.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.match(await ana.innerText('#vsIntroOppName'), /BobVs/);
  assert.match(await ana.innerText('#vsIntroCity'), /Haro/);
  if (SHOTS) await ana.screenshot({ path: join(SHOTS, 'p1-intro.png') });

  // las mismas calles para los dos
  await ana.locator('#panel:not([hidden]) .opt').first().waitFor({ timeout: 10_000 });
  await bob.locator('#panel:not([hidden]) .opt').first().waitFor({ timeout: 10_000 });
  const first = s => s.evaluate(() => document.querySelector('#options').dataset.answer);
  assert.equal(await first(ana), await first(bob));
  assert.equal(await ana.locator('.walker-icon').count(), 2, 'se ven los dos personajes');

  // bob acierta 2 y se para; ana acierta las 7
  await answerRight(bob);
  await answerRight(bob);
  await ana.waitForFunction(() => document.querySelectorAll('#vsOppDots i.on').length === 2);
  for (let i = 0; i < 4; i++) await answerRight(ana);
  await bob.waitForFunction(() => document.querySelectorAll('#vsOppDots i.on').length === 4);
  if (SHOTS) await bob.screenshot({ path: join(SHOTS, 'p2-bob-playing.png') });
  for (let i = 0; i < 3; i++) await answerRight(ana);

  await ana.locator('#screen-vsover:not(.hidden)').waitFor({ timeout: 10_000 });
  await bob.locator('#screen-vsover:not(.hidden)').waitFor({ timeout: 10_000 });
  assert.equal(await ana.textContent('#vsResult'), '¡Victoria!');
  assert.equal(await bob.textContent('#vsResult'), 'Derrota');
  assert.match(await ana.innerText('#vsElo'), /1\.?016\s*\+16/);
  assert.match(await bob.innerText('#vsElo'), /984\s*-16/);
  if (SHOTS) { await ana.screenshot({ path: join(SHOTS, 'p3-win.png') }); await bob.screenshot({ path: join(SHOTS, 'p4-loss.png') }); }

  // el servidor ha guardado el ELO en Firestore: se ve en el perfil
  await ana.waitForTimeout(2500);
  await ana.click('#vsHome');
  await ana.waitForFunction(() => /1\.?016/.test(document.querySelector('#hmLeague').textContent));
  assert.match(await ana.innerText('#hmLeague'), /1 victorias · 0 derrotas/);

  assert.deepEqual([...ana.errors, ...bob.errors], []);
});

test('1 vs 1 de calles famosas: cada calle en su ciudad y sin pistas', { skip: !up && 'servidor de partidas no disponible', timeout: 240_000 }, async () => {
  const ana = await player('AnaFam' + (Date.now() % 1000));
  const bob = await player('BobFam' + (Date.now() % 1000));
  for (const p of [ana, bob]) {
    await p.click('#hmModes [data-mode=versus]');
    await p.click('#hmVariant [data-variant=famous]');
  }
  assert.equal(await ana.isVisible('#hmSearchBox'), false, 'no hace falta elegir ciudad');
  if (SHOTS) await ana.screenshot({ path: join(SHOTS, 'f1-home-famous.png') });
  await ana.click('#hmPlay');
  await ana.locator('#screen-search:not(.hidden)').waitFor();
  await bob.click('#hmPlay');
  await ana.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.match(await ana.innerText('#vsIntroCity'), /7 calles famosas/);
  await ana.locator('#panel:not([hidden]) .opt').first().waitFor({ timeout: 20_000 });
  assert.equal(await ana.textContent('#cityName'), '⭐ Calles famosas');
  assert.equal(await ana.locator('.street-label').count(), 0, 'sin nombres de calles vecinas');
  if (SHOTS) await ana.screenshot({ path: join(SHOTS, 'f2-famous-round.png') });
  for (let i = 0; i < 7; i++) await answerRight(ana);
  await ana.locator('#screen-vsover:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.equal(await ana.textContent('#vsResult'), '¡Victoria!');
  assert.match(await ana.innerText('#vsReason'), /7 calles famosas/);
  assert.deepEqual([...ana.errors, ...bob.errors], []);
});
