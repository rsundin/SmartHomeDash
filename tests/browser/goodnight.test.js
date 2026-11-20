// Goodnight (roadmap L2): the countdown on every screen, Cancel, the lights off when it
// ends, and the setup guide's settings. The countdown itself runs in Home Assistant
// (goodnight.py, tested in tests/ha); here the mock adapter plays that part.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check, assertNoOverflow } = require('./lib');

const houseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
const SENSOR = 'sensor.example_house_goodnight'; // sensor.py: a timestamp while it counts down
const setAll = (page, state) => page.evaluate((s) => {
  for (const id of window.__pvdRun.site.index.lights) { const x = window.store.get(id); if (x) window.store.update({ ...x, state: s }); }
  window.store.flush();
}, state);
const lit = (page) => page.evaluate(() => window.__pvdRun.site.index.lights.filter((id) => window.store.get(id)?.state === 'on'));

describe('goodnight', () => {
  const env = setup();

  test('the lights stay on, the countdown shows, then everything but the excluded lights turns off', async () => {
    const site = houseSite();
    site.goodnight = { minutes: 0.05 }; // three seconds
    site.all_lights = { exclude: ['light.facade'] };
    const page = await harness(env, '?site=example-house&kiosk', { width: 1080, height: 810, touch: true, prepare: serve(site) });
    await setAll(page, 'on');
    await page.locator('.top-actions .chip-lights').click();
    await page.locator('.lights-menu [data-action="goodnight"]').click();
    const bar = page.locator('.goodnight');
    await bar.waitFor();
    assert.match(await bar.textContent(), /Goodnight: everything off in 0:0[0-3]/);
    assert.ok(await bar.locator('[data-action="goodnight-cancel"]').isVisible(), 'Cancel is there in kiosk mode');
    assert.ok((await lit(page)).length > 5, 'the lights stay on during the countdown');
    await assertNoOverflow(page, 'countdown');

    await page.waitForFunction((id) => window.store.get(id)?.state === 'unknown', SENSOR, { timeout: 8000 });
    await page.waitForFunction(() => window.__pvdRun.site.index.lights.filter((id) => window.store.get(id)?.state === 'on').length === 1);
    assert.deepEqual(await lit(page), ['light.facade']);
    await page.evaluate(() => window.store.flush());
    assert.ok(await bar.isHidden(), 'the countdown is gone');
    check(page);
    await close(page);
  });

  test('Cancel stops it, and the countdown follows the sensor from Home Assistant', async () => {
    const page = await harness(env, '?site=example-house');
    await setAll(page, 'on');
    // Started somewhere else (another screen, an automation): this screen shows it too.
    await page.evaluate((id) => {
      const s = window.store.get(id);
      window.store.update({ ...s, state: new Date(Date.now() + 272000).toISOString() });
      window.store.flush();
    }, SENSOR);
    const bar = page.locator('.goodnight');
    await bar.waitFor();
    assert.match(await bar.textContent(), /in 4:3[12]/);

    // Started from the lights card, then cancelled.
    const card = page.locator('.side .card', { has: page.locator('h2', { hasText: 'Lights' }) });
    await card.locator('[data-action="goodnight"]').click();
    await page.waitForFunction(() => /in 4:5\d|in 5:00/.test(document.querySelector('.goodnight').textContent), null, { timeout: 3000 });
    await bar.locator('[data-action="goodnight-cancel"]').click();
    await page.waitForFunction((id) => window.store.get(id)?.state === 'unknown', SENSOR);
    await page.evaluate(() => window.store.flush());
    assert.ok(await bar.isHidden());
    assert.ok((await lit(page)).length > 5, 'nothing turned off');
    check(page);
    await close(page);
  });

  test('a sensor the user renamed is still followed', async () => {
    const site = houseSite();
    site.mock = { ...site.mock, entities: [...(site.mock?.entities ?? []),
      { entity: 'sensor.bedtime', attributes: { device_class: 'timestamp', planview_dash_site: 'example-house' } }] };
    const page = await harness(env, '?site=example-house', { prepare: serve(site) });
    assert.equal(await page.evaluate((id) => window.store.get(id), SENSOR), undefined);
    const card = page.locator('.side .card', { has: page.locator('h2', { hasText: 'Lights' }) });
    await card.locator('[data-action="goodnight"]').click();
    const bar = page.locator('.goodnight');
    await bar.waitFor();
    assert.ok(Date.parse(await page.evaluate(() => window.store.get('sensor.bedtime').state)) > Date.now());
    await bar.locator('[data-action="goodnight-cancel"]').click();
    await page.waitForFunction(() => window.store.get('sensor.bedtime')?.state === 'unknown');
    await page.evaluate(() => window.store.flush());
    assert.ok(await bar.isHidden());
    check(page);
    await close(page);
  });

  test('set in the setup guide: minutes, a script after, or turned off', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-step', { hasText: 'Buttons' }).click();
    const sec = page.locator('.setup-section', { has: page.locator('h3', { hasText: /^Goodnight$/ }) });
    await sec.getByLabel('Minutes before everything turns off').fill('10');
    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.saved.length === 1 && window.harness.starts === 2);
    await page.evaluate(() => window.harness.ready);
    assert.deepEqual(await page.evaluate(() => window.harness.saved[0].goodnight), { minutes: 10 });

    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-step', { hasText: 'Buttons' }).click();
    await sec.getByText('Show the Goodnight button').click();
    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.saved.length === 2 && window.harness.starts === 3);
    await page.evaluate(() => window.harness.ready);
    assert.deepEqual(await page.evaluate(() => window.harness.saved[1].goodnight), { enabled: false, minutes: 10 });
    assert.equal(await page.locator('[data-action="goodnight"]').count(), 0);
    check(page);
    await close(page);
  });
});
