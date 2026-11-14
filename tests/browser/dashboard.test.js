// The dashboard in use, through the harness (the panel code with test data):
// buildings, rooms and lamps, night mode, kiosk, pinch zoom, warnings and badges,
// and the energy flow.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, harness, close, check, assertNoOverflow, centre } = require('./lib');

const lampState = (page, id) => page.evaluate((x) => window.store.get(x)?.state, id);
// The store redraws on the next frame; this draws pending changes now, before reading the page.
const drawn = (page) => page.evaluate(() => window.store.flush());

describe('dashboard', () => {
  const env = setup();

  test('open a building, open a room and switch a lamp', async () => {
    const page = await harness(env, '?site=example-house');
    assert.equal(await page.getAttribute('.stage', 'data-view'), 'overview');

    // Tapping the house lifts the roof and opens its floor plan.
    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    assert.ok(await page.locator('.fp[data-plan="house"]').evaluate((n) => n.classList.contains('is-active')));
    assert.ok(await page.locator('.back').isVisible(), 'back to the overview is offered');

    // Tapping a room opens its panel.
    await page.locator('.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]').click();
    const panel = page.locator('aside.panel');
    await panel.locator('.panel-title', { hasText: 'Bedroom' }).waitFor();
    assert.equal(await panel.getAttribute('aria-hidden'), 'false');
    assert.ok(await page.locator('.fp-room[aria-label="Bedroom"]').evaluate((n) => n.classList.contains('is-selected')));

    // The switch in the panel toggles the lamp, and the lamp on the plan follows.
    const before = await lampState(page, 'light.bedroom');
    const sw = panel.locator('.light-list .switch').first();
    await sw.click();
    await page.waitForFunction((b) => window.store.get('light.bedroom').state !== b, before);
    await drawn(page);
    const after = await lampState(page, 'light.bedroom');
    assert.equal(await sw.getAttribute('aria-checked'), String(after === 'on'));
    const lamp = page.locator('.fp[data-plan="house"] .fp-lamp[data-entity="light.bedroom"]');
    assert.equal(await lamp.evaluate((n) => n.classList.contains('is-on')), after === 'on');

    // A tap on a lamp on the plan toggles it straight away.
    await page.keyboard.press('Escape');
    await lamp.click();
    await page.waitForFunction((b) => window.store.get('light.bedroom').state !== b, after);
    await drawn(page);
    assert.equal(await lamp.evaluate((n) => n.classList.contains('is-on')), before === 'on');

    // Escape closes the panel; the back button returns to the overview.
    await page.locator('.back').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'overview');
    check(page);
    await close(page);
  });

  test('night mode follows the header button', async () => {
    const page = await harness(env, '?site=example-house');
    const btn = page.locator('.top-actions .chip', { hasText: /Auto/ });
    await btn.click(); // auto → night
    await page.waitForFunction(() => document.querySelector('.stage').classList.contains('is-night'));
    await page.locator('.top-actions .chip', { hasText: 'Night' }).waitFor(); // the header button says Night now
    const dusk = await page.locator('.ov-img-night').first().evaluate((n) => Number(n.closest('.view').style.getPropertyValue('--dusk')));
    assert.equal(dusk, 1, 'the evening picture is shown in full');
    await page.locator('.top-actions .chip', { hasText: 'Night' }).click(); // night → day
    await page.waitForFunction(() => !document.querySelector('.stage').classList.contains('is-night'));
    assert.equal(await page.evaluate(() => localStorage.getItem('shd:example-house:night')), '"day"');
    check(page);
    await close(page);
  });

  test('kiosk mode hides the buttons and the clock leaves it', async () => {
    const page = await harness(env, '?site=example-house&kiosk', { width: 1080, height: 810, touch: true });
    assert.ok(await page.evaluate(() => document.body.classList.contains('is-kiosk')));
    assert.equal(await page.locator('.top-actions .chip', { hasText: 'Setup' }).isVisible(), false);
    await assertNoOverflow(page, 'kiosk');
    // Hold the clock for two seconds.
    const [x, y] = await centre(page.locator('.clock'));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(2200);
    await page.mouse.up();
    await page.waitForFunction(() => !document.body.classList.contains('is-kiosk'));
    assert.ok(await page.locator('.top-actions .chip', { hasText: 'Setup' }).isVisible());
    check(page);
    await close(page);
  });

  test('pinch zoom with two fingers, and a tap still works after', async () => {
    const page = await harness(env, '?site=example-house', { width: 390, height: 844, touch: true });
    const box = await page.locator('.stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })),
    });
    // Record whether each touchmove was consumed, split by zoomed or not (read after the
    // dashboard's own handlers, at the window).
    await page.evaluate(() => {
      window.__moves = { zoomed: new Set(), unzoomed: new Set() };
      const zoomed = () => document.querySelector('.stage').classList.contains('is-zoomed');
      window.addEventListener('touchmove', (e) => {
        const set = window.__moves[zoomed() || e.touches.length > 1 ? 'zoomed' : 'unzoomed'];
        if (e.cancelable) set.add(e.defaultPrevented); // the browser's own scroll sends moves nobody can consume
      }, { passive: true });
    });
    // One finger on the picture at its normal size is left to the page (it may scroll).
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [[cx, cy - i * 20]]);
    await touch('touchEnd', []);

    await touch('touchStart', [[cx - 20, cy], [cx + 20, cy]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 20 - i * 12, cy], [cx + 20 + i * 12, cy]]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => document.querySelector('.stage').classList.contains('is-zoomed'));
    const scale = await page.locator('.zoom-layer').evaluate((n) => Number(/scale\(([\d.]+)\)/.exec(n.style.transform)?.[1]));
    assert.ok(scale > 2 && scale <= 4, `zoomed to ${scale}`);
    assert.ok(await page.locator('.zoom-reset').isVisible());
    await assertNoOverflow(page, 'zoomed');

    // One finger drags the zoomed picture without opening anything.
    const t0 = await page.locator('.zoom-layer').evaluate((n) => n.style.transform);
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx + i * 10, cy + i * 6]]);
    await touch('touchEnd', []);
    assert.notEqual(await page.locator('.zoom-layer').evaluate((n) => n.style.transform), t0, 'drag pans');
    assert.equal(await page.getAttribute('.stage', 'data-view'), 'overview', 'a drag is not a tap');

    // The drag was the dashboard's own: the browser got no touchmove to scroll with. A fast
    // drag that lifts would otherwise start a fling in the browser, which swallows the
    // next tap. No wait before the tap: it must work right after the finger lifts.
    assert.deepEqual(await page.evaluate(() => ({ zoomed: [...window.__moves.zoomed], unzoomed: [...window.__moves.unzoomed] })), { zoomed: [true], unzoomed: [false] },
      'touchmoves are consumed while zoomed or pinching, and left to the page otherwise');
    await page.locator('.zoom-reset').tap();
    await page.waitForFunction(() => !document.querySelector('.stage').classList.contains('is-zoomed'));
    check(page);
    await close(page);
  });

  test('warnings and badges follow the sensors', async () => {
    const page = await harness(env, '?site=example-house');
    const alerts = page.locator('.alerts');
    // The example starts with the bedroom window open while heating, and a low battery.
    await alerts.locator('.alert', { hasText: 'Bedroom' }).waitFor();
    await alerts.locator('details.alert', { hasText: 'battery' }).click();
    await alerts.locator('details.alert li', { hasText: 'Smoke detector battery' }).waitFor();

    // A tap on the window warning opens the room on its plan.
    await alerts.locator('button.alert', { hasText: 'Bedroom' }).click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await page.locator('aside.panel .panel-title', { hasText: 'Bedroom' }).waitFor();
    const plan = page.locator('.fp[data-plan="house"]');
    assert.equal(await plan.locator('.fp-badge.is-open').count(), 1, 'open window badge on the plan');

    // Closing the window clears the warning and the badge.
    await page.evaluate(() => {
      const s = window.store.get('binary_sensor.bedroom_window');
      window.store.update({ ...s, state: 'off' });
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('.alert')].some((n) => /Bedroom/.test(n.textContent)));
    assert.equal(await plan.locator('.fp-badge.is-open').count(), 0);

    // Smoke raises an alarm badge and an alarm warning.
    await page.evaluate(() => {
      const s = window.store.get('binary_sensor.kitchen_smoke');
      window.store.update({ ...s, state: 'on' });
    });
    await alerts.locator('.alert[data-level="alert"]').waitFor();
    assert.equal(await plan.locator('.fp-badge.is-alarm').count(), 1);
    // Presence outlines the room.
    assert.ok(await plan.locator('.fp-room[aria-label="Living room"]').evaluate((n) => n.classList.contains('is-occupied')));
    check(page);
    await close(page);
  });

  test('energy flow in day mode', async () => {
    const page = await harness(env, '?site=example-house');
    // Auto → Night → Day: the test data then shows midday sun.
    await page.locator('.top-actions .chip', { hasText: /Auto/ }).click();
    await page.locator('.top-actions .chip', { hasText: 'Night' }).click();
    await page.waitForFunction(() => Number(window.store.get('sensor.solar_power')?.state) > 0, null, { timeout: 8000 });
    await drawn(page);
    const flows = await page.locator('.ov-flow-track').count();
    assert.ok(flows >= 1, 'flow lines are drawn');
    const words = (await page.locator('.ov-flow text').allTextContents()).join(' ');
    assert.match(words, /kW/);
    const card = await page.locator('.layout').textContent();
    assert.match(card, /sun gives/i);
    check(page);
    await close(page);
  });
});
