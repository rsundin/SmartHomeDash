// Whole-house lights (roadmap L1): All on and All off in the header and the lights card,
// lights left out of them, and the setup guide's switch for showing them.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check, assertNoOverflow } = require('./lib');

const houseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
// Every light on the dashboard, including the ones picked up from areas, and how many are on.
const lights = (page) => page.evaluate(() => window.__shdRun.site.index.lights.map((id) => [id, window.store.get(id)?.state]));
const states = async (page) => Object.fromEntries(await lights(page));
const setAll = (page, state) => page.evaluate((s) => {
  for (const id of window.__shdRun.site.index.lights) { const x = window.store.get(id); if (x) window.store.update({ ...x, state: s }); }
  window.store.flush();
}, state);

describe('all lights on and off', () => {
  const env = setup();

  test('the header turns everything on in one tap and off in two', async () => {
    const page = await harness(env, '?site=example-house');
    await setAll(page, 'off');
    const btn = page.locator('.top-actions .chip-lights');
    assert.equal(await btn.evaluate((n) => n.classList.contains('is-on')), false);
    await btn.click();
    const menu = page.locator('.lights-menu');
    assert.ok(await menu.isVisible());
    await menu.locator('[data-action="all-on"]').click();
    await page.waitForFunction(() => window.__shdRun.site.index.lights.every((id) => window.store.get(id)?.state !== 'off'));
    assert.ok(await menu.isHidden(), 'the menu closes after a choice');
    await page.evaluate(() => window.store.flush());
    assert.ok(await btn.evaluate((n) => n.classList.contains('is-on')), 'the lamp shows that lights are on');
    assert.ok((await lights(page)).length > 5, 'area lights are included');

    // Off asks for a second tap.
    await btn.click();
    const off = menu.locator('[data-action="all-off"]');
    await off.click();
    assert.ok(await off.evaluate((n) => n.classList.contains('is-armed')));
    await page.waitForTimeout(300);
    assert.ok(Object.values(await states(page)).every((s) => s === 'on'), 'nothing turned off after one tap');
    await off.click();
    await page.waitForFunction(() => window.__shdRun.site.index.lights.every((id) => window.store.get(id)?.state === 'off'));
    check(page);
    await close(page);
  });

  test('the lights card has both buttons, and excluded lights are left alone', async () => {
    const site = houseSite();
    site.all_lights = { exclude: ['light.facade'] };
    const page = await harness(env, '?site=example-house', { prepare: serve(site) });
    await setAll(page, 'off');
    const card = page.locator('.side .card', { has: page.locator('h2', { hasText: 'Lights' }) });
    await card.locator('[data-action="all-on"]').click();
    await page.waitForFunction(() => window.store.get('light.entrance')?.state === 'on');
    await page.waitForTimeout(300);
    const s = await states(page);
    assert.equal(s['light.facade'], 'off', 'the excluded light stays off');
    assert.ok(Object.entries(s).filter(([id]) => id !== 'light.facade').every(([, v]) => v === 'on'));

    await page.evaluate(() => { const x = window.store.get('light.facade'); window.store.update({ ...x, state: 'on' }); });
    const off = card.locator('[data-action="all-off"]');
    await off.click();
    await off.click();
    await page.waitForFunction(() => window.store.get('light.entrance')?.state === 'off');
    await page.waitForTimeout(300);
    assert.equal((await states(page))['light.facade'], 'on', 'the excluded light stays on');
    check(page);
    await close(page);
  });

  test('the header control stays in kiosk mode and fits a phone', async () => {
    const page = await harness(env, '?site=example-house&kiosk', { width: 390, height: 844, touch: true });
    const btn = page.locator('.top-actions .chip-lights');
    assert.ok(await btn.isVisible(), 'visible in kiosk mode');
    await btn.click();
    assert.ok(await page.locator('.lights-menu [data-action="all-on"]').isVisible());
    await assertNoOverflow(page, 'kiosk with the lights menu open');
    // A tap outside closes it.
    await page.mouse.click(200, 600);
    assert.ok(await page.locator('.lights-menu').isHidden());
    check(page);
    await close(page);
  });

  test('turned off in the setup guide, the buttons are gone', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-step', { hasText: 'Buttons' }).click();
    const sec = page.locator('.setup-section', { has: page.locator('h3', { hasText: 'All on and all off' }) });
    await sec.getByLabel('Facade').uncheck();
    await sec.getByText('Show the All on and All off buttons').click();
    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.saved.length === 1 && window.harness.starts === 2);
    await page.evaluate(() => window.harness.ready);
    assert.deepEqual(await page.evaluate(() => window.harness.saved[0].all_lights), { enabled: false, exclude: ['light.facade'] });
    // The lamp in the header stays for Goodnight, without All on and All off.
    assert.equal(await page.locator('[data-action="all-on"], [data-action="all-off"]').count(), 0);
    assert.equal(await page.locator('.side [data-action="all-off"]').count(), 0);
    check(page);
    await close(page);
  });
});
