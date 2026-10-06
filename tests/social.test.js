// Reto diario, amigos y salas privadas, con dos navegadores. Necesita `npm run dev:cf` y `npm run emulators`;
// si el servidor de Cloudflare no está en marcha, se salta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.CF_URL || 'http://127.0.0.1:8787';
const SHOTS = process.env.SHOTS;
const up = await fetch(BASE).then(r => r.ok, () => false);
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

let browser;
before(async () => { if (up) browser = await chromium.launch(); if (SHOTS) await mkdir(SHOTS, { recursive: true }); });
after(async () => { await browser?.close(); });

async function player(name, path = '/?emulador') {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(() => { window.__TEST__ = true; });
  await page.goto(BASE + path);
  await page.locator('#landing:not([hidden])').waitFor({ timeout: 20_000 });
  if (!(await page.isVisible('#screen-login'))) await page.click('.lp-nav [data-auth=signup]');
  await page.click('#authTabs [data-mode=signup]');
  await page.fill('#email', `${name.toLowerCase()}@example.com`);
  await page.fill('#password', 'secreto123');
  await page.fill('#password2', 'secreto123');
  await page.click('#emailSubmit');
  await page.locator('#screen-verify:not(.hidden)').waitFor();
  await page.click('#verifyEmu');
  await page.locator('#screen-username:not(.hidden)').waitFor();
  await page.fill('#usernameInput', name);
  await page.click('#usernameForm button[type=submit]');
  return page;
}

async function pickOption(page, right) {
  await page.waitForFunction(() => document.querySelector('#options .opt:not([disabled])'), null, { timeout: 10_000 });
  const answer = await page.evaluate(() => document.querySelector('#options').dataset.answer);
  const names = await page.locator('#options .opt').allInnerTexts();
  const i = names.findIndex(n => (n.replace(/^\d\s*/, '').trim() === answer) === right);
  await page.locator('#options .opt').nth(i).click();
}

const stamp = Date.now() % 100000;

test('reto diario, amigos, reto a un amigo y sala por enlace', { skip: !up && 'servidor no disponible', timeout: 300_000 }, async () => {
  const ana = await player(`Ana${stamp}`);
  await ana.locator('#home:not([hidden])').waitFor();

  // ---------- reto diario: es el primer modo y el que sale por defecto ----------
  assert.equal(await ana.getAttribute('#hmModes .tab.active', 'data-mode'), 'daily');
  assert.deepEqual(await ana.locator('#hmModes .tab').evaluateAll(b => b.map(x => x.dataset.mode)), ['daily', 'solo', 'versus']);
  await ana.waitForFunction(() => !document.querySelector('#hmDailyPlay').disabled);
  await shot(ana, 's1-home-daily');
  await ana.click('#hmDailyPlay');
  await ana.locator('#panel:not([hidden]) .opt').first().waitFor({ timeout: 20_000 });
  assert.equal(await ana.locator('.street-label').count(), 0, 'sin nombres de calles vecinas antes de responder');
  await shot(ana, 's2-daily-round');
  for (const right of [true, false, true, true, false]) {
    await pickOption(ana, right);
    await ana.locator('#feedback.show').waitFor();
    await ana.click('#next');
  }
  await ana.locator('#screen-dailyover:not(.hidden)').waitFor({ timeout: 20_000 });
  await ana.waitForFunction(() => /racha/.test(document.querySelector('#dailyInfo').textContent), null, { timeout: 10_000 });
  assert.equal(await ana.textContent('#dailySquares'), '🟩🟥🟩🟩🟥');
  assert.match(await ana.innerText('#dailyInfo'), /3 de 5 calles · puesto \d+\.º de hoy · 🔥 racha de 1 día/);
  await shot(ana, 's3-daily-over');
  await ana.click('#dailyHome');
  await ana.waitForFunction(() => !document.querySelector('#hmDailyDone').hidden);
  assert.equal(await ana.isDisabled('#hmDailyPlay'), true, 'solo una vez al día');
  assert.equal(await ana.textContent('#hmStreak'), '1');

  // ---------- amigos ----------
  const bob = await player(`Bob${stamp}`);
  await bob.locator('#home:not([hidden])').waitFor();
  await ana.click('#hmFriends');
  await ana.fill('#friendName', `bob${stamp}`);
  await ana.click('#friendAdd button');
  await ana.locator('#friendOk:not([hidden])').waitFor();
  assert.match(await ana.innerText('#friendOk'), /Solicitud enviada/);
  await bob.locator('#friendsBadge:not([hidden])').waitFor({ timeout: 10_000 });
  await bob.click('#hmFriends');
  await bob.locator('#friendRequests [data-accept]').click();
  await bob.locator('#friendList [data-challenge]').waitFor({ timeout: 10_000 });
  await ana.locator('#friendList [data-challenge]').waitFor({ timeout: 10_000 });
  assert.match(await ana.innerText('#friendList'), new RegExp(`Bob${stamp}`));
  await shot(ana, 's4-friends');

  // ---------- reto a un amigo: sala privada + aviso ----------
  await ana.click('#friendList [data-challenge]');
  await ana.locator('#screen-room:not(.hidden)').waitFor();
  await ana.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.querySelector('#roomCode').textContent), null, { timeout: 10_000 });
  await shot(ana, 's5-room');
  await bob.click('#screen-friends [data-close]');
  await bob.locator('#friendsBadge:not([hidden])').waitFor({ timeout: 10_000 });
  await bob.click('#hmFriends');
  await bob.locator('#friendInvites [data-join]').click();
  await ana.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.match(await ana.innerText('#vsIntroMeElo'), /Amistosa/);
  await ana.locator('#panel:not([hidden]) .opt').first().waitFor({ timeout: 10_000 });
  for (let i = 0; i < 7; i++) { await pickOption(ana, true); await ana.waitForTimeout(750); }
  await ana.locator('#screen-vsover:not(.hidden)').waitFor({ timeout: 10_000 });
  assert.equal(await ana.textContent('#vsResult'), '¡Victoria!');
  assert.match(await ana.innerText('#vsElo'), /amistosa: no cambia el ELO/);
  assert.equal(await ana.textContent('#vsAgain'), 'Nueva sala');
  await bob.locator('#screen-vsover:not(.hidden)').waitFor({ timeout: 10_000 });

  // ---------- sala por enlace ----------
  await bob.click('#vsHome');
  await bob.click('#hmModes [data-mode=versus]');
  await bob.click('#hmVsRoom');
  await bob.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.querySelector('#roomCode').textContent), null, { timeout: 10_000 });
  const link = await bob.inputValue('#roomLink');
  assert.match(link, /\?sala=[A-Z2-9]{5}/);
  await ana.click('#vsHome');
  await ana.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await ana.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 20_000 });
  await bob.locator('#screen-vsintro:not(.hidden)').waitFor({ timeout: 15_000 });
  assert.equal(new URL(ana.url()).searchParams.get('sala'), null, 'el código se quita de la barra de direcciones');

  assert.deepEqual([...ana.errors, ...bob.errors], []);
});
