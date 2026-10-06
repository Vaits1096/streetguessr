// Reto diario: todas las calles famosas existen en los datos y el reto de cada día es estable y variado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAMOUS, dailyRounds, todayNumber, dailyPoints, famousVersusRounds, famousLabel, DAILY_ROUNDS } from '../public/js/famous.js';
import { buildStreets } from '../public/js/rounds.js';

test('cada calle famosa existe en su ciudad', () => {
  const cache = {};
  for (const f of FAMOUS) {
    cache[f.cityId] ||= buildStreets(JSON.parse(readFileSync(new URL(`../public/data/m/${f.cityId}.json`, import.meta.url), 'utf8'))).streets;
    assert.ok(cache[f.cityId].some(s => s.name === f.name), `${f.name} (${f.cityName})`);
  }
});

test('el reto de un día es siempre el mismo, con 5 ciudades distintas y opciones de otras ciudades', () => {
  for (let day = 20000; day < 20400; day++) {
    const a = dailyRounds(day), b = dailyRounds(day);
    assert.deepEqual(a.map(r => r.famous.name), b.map(r => r.famous.name));
    assert.equal(a.length, DAILY_ROUNDS);
    assert.equal(new Set(a.map(r => r.famous.cityId)).size, DAILY_ROUNDS);
    for (const r of a) {
      assert.equal(r.options.length, 4);
      assert.equal(r.options[r.answer], r.famous);
      assert.equal(new Set(r.options.map(o => o.cityId)).size, 4);
    }
  }
  assert.notDeepEqual(dailyRounds(20000).map(r => r.famous.name), dailyRounds(20001).map(r => r.famous.name));
});

test('el día cambia a medianoche de España', () => {
  // 5 oct 2026, 23:30 en Madrid (21:30 UTC) y 00:30 del 6 (22:30 UTC)
  assert.equal(todayNumber(new Date('2026-10-05T21:30:00Z')) + 1, todayNumber(new Date('2026-10-05T22:30:00Z')));
});

test('puntos: 100 por acierto y hasta 100 más por rapidez', () => {
  assert.equal(dailyPoints(true, 2000), 200);
  assert.equal(dailyPoints(true, 13_000), 150);
  assert.equal(dailyPoints(true, 60_000), 100);
  assert.equal(dailyPoints(false, 1000), 0);
});

test('1 vs 1 de calles famosas: 7 ciudades distintas y la opción correcta entre las 4', () => {
  const rounds = famousVersusRounds(7);
  assert.equal(rounds.length, 7);
  assert.equal(new Set(rounds.map(r => r.cityId)).size, 7);
  for (const r of rounds) {
    assert.ok(r.options.includes(r.target));
    assert.equal(r.target, famousLabel(FAMOUS.find(f => f.cityId === r.cityId && f.name === r.street)));
  }
});
