// A short run in WebKit, the engine of Safari: wall tablets are often iPads, and the
// rest of the browser tests run in Chromium only. It walks through what every home
// uses (the overview, a floor plan, a room and a lamp, the setup guide, placement mode)
// and asks for no errors on the way. Run with `tests/run.sh webkit`.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, harness, close, check, assertNoOverflow } = require('../browser/lib');

describe('WebKit', () => {
  // SMOKE_ENGINE=chromium runs the same steps in Chromium, to tell a WebKit problem from a broken test.
  const env = setup(process.env.SMOKE_ENGINE ?? 'webkit');

  test('house: overview, floor plan, room and lamp', async () => {
    const page = await harness(env, '?site=example-house');
    assert.equal(await page.getAttribute('.stage', 'data-view'), 'overview');
    // The pictures come through the login, as object URLs.
    assert.ok((await page.locator('.ov-img-day').first().getAttribute('href')).startsWith('blob:'));

    await page.locator('.tab[data-view="plan:house"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    assert.ok((await page.locator('.fp.is-active .fp-picture').getAttribute('href')).startsWith('blob:'));

    await page.locator('.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]').click();
    const panel = page.locator('aside.panel');
    await panel.locator('.panel-title', { hasText: 'Bedroom' }).waitFor();
    const before = await page.evaluate(() => window.store.get('light.bedroom').state);
    const sw = panel.locator('.light-list .switch').first();
    await sw.click();
    await page.waitForFunction((b) => window.store.get('light.bedroom').state !== b, before);
    await page.evaluate(() => window.store.flush());
    const after = await page.evaluate(() => window.store.get('light.bedroom').state);
    assert.equal(await sw.getAttribute('aria-checked'), String(after === 'on'));
    assert.equal(await page.locator('.fp[data-plan="house"] .fp-lamp[data-entity="light.bedroom"]').evaluate((n) => n.classList.contains('is-on')), after === 'on');

    await page.keyboard.press('Escape');
    await page.locator('.tab[data-view="overview"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'overview');
    await assertNoOverflow(page, 'house');
    check(page);
    await close(page);
  });

  test('apartment on a phone: the floor plan is the start view', async () => {
    const page = await harness(env, '?site=example-apartment', { width: 390, height: 844, touch: true });
    assert.equal(await page.getAttribute('.stage', 'data-view'), 'plan:apartment');
    assert.ok(await page.locator('.fp.is-active .fp-room').count() > 0);
    await assertNoOverflow(page, 'apartment');
    check(page);
    await close(page);
  });

  test('the setup guide opens, steps through and saves', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: /^(Inställningar|Setup)$/ }).click();
    await page.locator('.setup').waitFor();
    const steps = page.locator('.setup-step');
    const count = await steps.count();
    assert.ok(count >= 7);
    for (let i = 0; i < count; i++) {
      await steps.nth(i).click();
      assert.equal(await steps.nth(i).getAttribute('aria-current'), 'true');
    }
    await page.locator('.setup .chip-primary', { hasText: /^(Spara|Save)$/ }).first().click();
    await page.waitForFunction(() => window.harness.saved.length === 1 && window.harness.starts === 2);
    check(page);
    await close(page);
  });

  test('placement mode opens with every plan and its list', async () => {
    const page = await harness(env, '?site=example-house');
    await page.evaluate(async () => { window.harness.navigateEdit(true); await window.harness.ready; });
    await page.locator('.editor-list').waitFor();
    assert.equal(await page.locator('.fp-picture').count(), 2);
    check(page);
    await close(page);
  });
});
