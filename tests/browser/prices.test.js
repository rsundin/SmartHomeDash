// Electricity prices at their own resolution (roadmap Q4): hourly, quarter-hourly and
// start/end lists placed by time, days when the clocks change, the cheapest window
// across midnight, Home Assistant's Nord Pool action, and the price card on test data.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const ENTITIES = '../../custom_components/smarthomedash/frontend/js/entities.js';
const TZ = 'Europe/Stockholm';

// The house example with its price entity set to another test format.
function withPrices(prices) {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
  site.mock.prices = prices;
  return site;
}
const serve = (site, at) => async (page) => {
  if (at) await page.clock.setFixedTime(new Date(at));
  await page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
};

describe('prices', () => {
  const env = setup();

  test('slots by time: hours, quarter-hours, start/end lists and the days the clocks change', async () => {
    const page = await harness(env, '?site=example-house', { timezoneId: TZ });
    const r = await page.evaluate(async (url) => {
      const E = await import(url);
      const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);
      const day = (iso) => E.dayBounds(new Date(iso));
      const nov = day('2026-11-10T12:00:00');
      const hourly = E.toSlots(Array.from({ length: 24 }, (_, i) => i), nov);
      const quarters = E.toSlots(Array.from({ length: 96 }, (_, i) => i), nov);
      // A start/end list, out of order, with an entry from another day.
      const raw = E.toSlots([
        { start: '2026-11-10T13:15:00+01:00', end: '2026-11-10T13:30:00+01:00', value: 2 },
        { start: '2026-11-10T13:00:00+01:00', end: '2026-11-10T13:15:00+01:00', value: 1 },
        { start: '2026-11-11T00:00:00+01:00', end: '2026-11-11T00:15:00+01:00', value: 9 },
        { start: '2026-11-10T13:30:00+01:00', price: 3 },
      ], nov);
      // 25 hours on 25 October 2026 (100 quarters), 23 hours on 29 March 2026 (92).
      const autumn = day('2026-10-25T12:00:00');
      const spring = day('2026-03-29T12:00:00');
      const long = E.toSlots(Array.from({ length: 100 }, (_, i) => i), autumn);
      const short = E.toSlots(Array.from({ length: 92 }, (_, i) => i), spring);
      const at = (slots, iso) => E.slotAt(slots, Date.parse(iso))?.value ?? null;
      return {
        hourly: [hourly.length, hm(hourly[13].start), at(hourly, '2026-11-10T13:59:00+01:00')],
        quarters: [quarters.length, hm(quarters[53].start), at(quarters, '2026-11-10T13:20:00+01:00')],
        raw: [raw.length, raw.map((x) => x.value).join(','), hm(raw[2].end)],
        autumn: [(autumn[1] - autumn[0]) / 3600e3, long.length, hm(long[99].start), at(long, '2026-10-25T02:30:00+02:00'), at(long, '2026-10-25T02:30:00+01:00'), at(long, '2026-10-25T23:50:00+01:00')],
        spring: [(spring[1] - spring[0]) / 3600e3, short.length, at(short, '2026-03-29T03:00:00+02:00'), at(short, '2026-03-29T23:50:00+02:00')],
      };
    }, ENTITIES);
    assert.deepEqual(r.hourly, [24, '13:00', 13]);
    assert.deepEqual(r.quarters, [96, '13:15', 53]);
    assert.deepEqual(r.raw, [3, '1,2,3', '13:45'], 'placed by time; the last entry ends a slot length later');
    assert.deepEqual(r.autumn, [25, 100, '23:45', 10, 14, 99], '02:30 happens twice and has two prices');
    assert.deepEqual(r.spring, [23, 92, 8, 91], '02:00–03:00 does not exist');
    check(page);
    await close(page);
  });

  test('cheapest window: in slots, across midnight, and from the Nord Pool action', async () => {
    const page = await harness(env, '?site=example-house', { timezoneId: TZ });
    const r = await page.evaluate(async (url) => {
      const E = await import(url);
      const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);
      const now = new Date('2026-11-10T22:10:00+01:00');
      const today = E.toSlots(Array.from({ length: 24 }, (_, h) => (h >= 22 ? 1 : 5)), E.dayBounds(now));
      const tomorrow = E.toSlots(Array.from({ length: 24 }, (_, h) => (h < 2 ? 1 : 5)), E.dayBounds(now, 1));
      const night = E.cheapestWindow([...today, ...tomorrow], now.getTime(), 3);
      // Quarter-hours: the cheapest hour starts at a quarter past.
      const q = E.toSlots(Array.from({ length: 96 }, (_, i) => (i >= 41 && i < 45 ? 1 : 4)), E.dayBounds(now));
      const quarter = E.cheapestWindow(q, new Date('2026-11-10T08:00:00+01:00').getTime(), 1);
      // A gap breaks a run.
      const gap = E.cheapestWindow(today.filter((x, i) => i !== 23), now.getTime(), 2);
      const np = E.nordpoolSlots({ SE3: [
        { start: '2026-11-10T11:15:00+00:00', end: '2026-11-10T11:30:00+00:00', price: 812.5 },
        { start: '2026-11-10T11:00:00+00:00', end: '2026-11-10T11:15:00+00:00', price: 640 },
      ] });
      return {
        night: [hm(night.start), hm(night.end), night.avg],
        quarter: [hm(quarter.start), hm(quarter.end), quarter.avg],
        gap,
        nordpool: np.map((x) => [hm(x.start), x.value]),
      };
    }, ENTITIES);
    assert.deepEqual(r.night, ['22:00', '01:00', 1], 'from the slot running now, into tomorrow');
    assert.deepEqual(r.quarter, ['10:15', '11:15', 1]);
    assert.equal(r.gap, null);
    assert.deepEqual(r.nordpool, [['12:00', 0.64], ['12:15', 0.8125]], 'per MWh to per kWh, sorted by time');
    check(page);
    await close(page);
  });

  test('the card on 96 quarter-hour prices: the slot now and the cheapest window across midnight', async () => {
    const at = '2026-11-10T22:50:00+01:00';
    const page = await harness(env, '?site=example-house', { timezoneId: TZ, prepare: serve(withPrices({ minutes: 15 }), at) });
    const card = page.locator('.card', { has: page.locator('.pbars') });
    await card.waitFor();
    assert.equal(await card.locator('.pbars rect').count(), 96, 'one bar per quarter-hour');
    assert.equal(await card.locator('.pbars rect.now').getAttribute('data-start'), '22:45');
    assert.ok(await card.locator('.pbars').evaluate((n) => n.classList.contains('is-quarters')));

    // The cheapest three hours, worked out here from the prices in the store.
    const { today, tomorrow } = await page.evaluate(() => {
      const a = window.store.get('sensor.nordpool_kwh_se3_sek').attributes;
      return { today: a.today, tomorrow: a.tomorrow };
    });
    assert.equal(today.length, 96);
    assert.equal(tomorrow.length, 96);
    const all = [...today, ...tomorrow];
    let best = null;
    for (let i = 91; i + 12 <= all.length; i++) {
      const avg = all.slice(i, i + 12).reduce((a, b) => a + b, 0) / 12;
      if (!best || avg < best.avg - 1e-9) best = { i, avg };
    }
    const clock = (i) => { const h = Math.floor(i / 4) % 24, m = (i % 4) * 15; return m ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : String(h).padStart(2, '0'); };
    const text = await card.locator('.price-best').textContent();
    assert.ok(text.includes(`${clock(best.i)}–${clock(best.i + 12)}`), `"${text}" names ${clock(best.i)}–${clock(best.i + 12)}`);
    assert.equal(/tomorrow/.test(text), best.i >= 96);
    assert.ok(text.includes(best.avg.toFixed(2)), `"${text}" has the average ${best.avg.toFixed(2)}`);
    check(page);
    await close(page);
  });

  test('the card reads start/end lists and the Nord Pool action', async () => {
    for (const format of ['raw', 'action']) {
      const page = await harness(env, '?site=example-house', { timezoneId: TZ, prepare: serve(withPrices({ minutes: 15, format }), '2026-11-10T09:05:00+01:00') });
      const card = page.locator('.card', { hasText: 'Electricity price today' });
      await card.locator('.pbars rect').first().waitFor();
      assert.equal(await card.locator('.pbars rect').count(), 96, `${format}: one bar per quarter-hour`);
      assert.equal(await card.locator('.pbars rect.now').getAttribute('data-start'), '09:00', format);
      assert.match(await card.locator('.price-best').textContent(), /Cheapest 3 hours/);
      check(page);
      await close(page);
    }
  });
});
