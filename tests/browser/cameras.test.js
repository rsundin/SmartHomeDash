// Cameras on the picture (roadmap H4): markers on the floor plan and the overview, the
// wedge on motion, the camera window with stepping and stills in light mode, placing and
// turning a camera in placement mode, and the doorbell still using the same window.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check, centre } = require('./lib');

const houseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('shd:example-house:draft')));
const toPlan = async (page) => {
  await page.locator('.views .tab[data-view="plan:house"]').click();
  await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
  await page.waitForTimeout(600); // the roof lifts first
};

describe('cameras', () => {
  const env = setup();

  test('a camera on the plan: the wedge turns red on motion, a tap opens it, arrows step to the next', async () => {
    const site = houseSite();
    site.floorplans[0].cameras.push({ entity: 'camera.back_yard', at: [80, 990], name: 'Back yard' });
    const page = await harness(env, '?site=example-house', { prepare: serve(site) });
    await toPlan(page);
    const cam = page.locator('.fp.is-active .cam[data-entity="camera.garden"]');
    assert.equal(await cam.getAttribute('aria-label'), 'Show the camera Garden');
    assert.equal(await cam.locator('.cam-wedge').count(), 1, 'a wedge where an angle is set');
    assert.equal(await page.locator('.fp.is-active .cam[data-entity="camera.back_yard"] .cam-wedge').count(), 0, 'no wedge without an angle');
    assert.equal(await cam.evaluate((n) => n.classList.contains('is-motion')), false);
    await page.evaluate(() => { const x = window.store.get('binary_sensor.garden_motion'); window.store.update({ ...x, state: 'on' }); window.store.flush(); });
    assert.ok(await cam.evaluate((n) => n.classList.contains('is-motion')), 'red on motion');

    await cam.locator('.cam-hit').click();
    const win = page.locator('.bell[role="dialog"]');
    await win.waitFor();
    assert.equal(await win.locator('.panel-title').textContent(), 'Garden');
    assert.match(await win.locator('.bell-cam').getAttribute('src'), /^data:image\/svg/);
    await win.locator('[data-action="camera-next"]').click();
    assert.equal(await win.locator('.panel-title').textContent(), 'Back yard');
    assert.match(await win.textContent(), /2 \/ 2/);
    await win.locator('[data-action="camera-next"]').click();
    assert.equal(await win.locator('.panel-title').textContent(), 'Garden', 'wraps around');
    await page.keyboard.press('Escape');
    assert.equal(await win.count(), 0, 'Escape closes it');
    check(page);
    await close(page);
  });

  test('on the overview, and stills only in light mode', async () => {
    const page = await harness(env, '?site=example-house&lite');
    const cam = page.locator('.ov .cam[data-entity="camera.driveway"]');
    await cam.waitFor();
    await cam.locator('.cam-hit').click();
    const img = page.locator('.bell .bell-cam');
    await img.waitFor();
    // A still has a time stamp added, and it is renewed every two seconds.
    const first = await img.getAttribute('src');
    assert.match(first, /[?&]t=\d+$/);
    await page.waitForFunction((f) => document.querySelector('.bell .bell-cam')?.getAttribute('src') !== f, first, { timeout: 4000 });
    await page.locator('.bell .icon-btn').click();
    assert.equal(await page.locator('.bell').count(), 0);
    check(page);
    await close(page);
  });

  test('place a camera, turn it and give it a motion sensor in placement mode', async () => {
    const site = houseSite();
    (site.mock.entities ??= []).push({ entity: 'camera.porch', name: 'Porch' });
    const page = await harness(env, '?site=example-house&edit', { prepare: serve(site) });
    await page.locator('aside.editor').waitFor();
    await toPlan(page);
    const group = page.locator('.editor-list section[data-kind="cameras"]');
    await group.locator('.editor-ent', { hasText: 'Porch' }).click();
    assert.match(await page.locator('.editor-status').textContent(), /Tap where the camera is/);
    // Outside every room is fine for a camera.
    const box = await page.locator('.fp.is-active .fp-svg').boundingBox();
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await page.waitForFunction(() => window.harness.starts >= 2);
    await page.evaluate(() => window.harness.ready);
    let saved = (await draft(page)).floorplans.find((p) => p.id === 'house').cameras.find((c) => c.entity === 'camera.porch');
    assert.ok(saved && saved.at.length === 2, 'placed on the plan');

    // Turn it right twice, then link a motion sensor.
    await page.locator('.editor-sel [data-action="cam-right"]').click();
    await page.waitForFunction(() => window.harness.starts >= 3);
    await page.evaluate(() => window.harness.ready);
    await page.locator('.editor-sel [data-action="cam-right"]').click();
    await page.waitForFunction(() => window.harness.starts >= 4);
    await page.evaluate(() => window.harness.ready);
    await page.locator('.editor-sel select').selectOption('binary_sensor.garden_motion');
    await page.waitForFunction(() => window.harness.starts >= 5);
    await page.evaluate(() => window.harness.ready);
    saved = (await draft(page)).floorplans.find((p) => p.id === 'house').cameras.find((c) => c.entity === 'camera.porch');
    assert.equal(saved.angle, 90);
    assert.equal(saved.motion, 'binary_sensor.garden_motion');

    // Dragging moves it and keeps the direction.
    await toPlan(page);
    const [x, y] = await centre(page.locator('.fp.is-active .cam[data-entity="camera.porch"] .cam-dot'));
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x - i * 3, y - i * 3);
    await page.mouse.up();
    await page.waitForFunction(() => window.harness.starts >= 6);
    await page.evaluate(() => window.harness.ready);
    const moved = (await draft(page)).floorplans.find((p) => p.id === 'house').cameras.find((c) => c.entity === 'camera.porch');
    assert.ok(moved.at[0] < saved.at[0] && moved.at[1] < saved.at[1], `moved from ${saved.at} to ${moved.at}`);
    assert.equal(moved.angle, 90);
    check(page);
    await close(page);
  });

  test('the doorbell opens in the same window', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Kiosk mode' }).click();
    await page.locator('.sheet .chip', { hasText: /doorbell/i }).click();
    const win = page.locator('.bell[role="dialog"]');
    await win.waitFor();
    assert.match(await win.textContent(), /Closes in \d+ s/);
    assert.equal(await win.locator('[data-action="camera-next"]').count(), 0, 'one camera, no arrows');
    await win.click({ position: { x: 5, y: 5 } });
    assert.equal(await win.count(), 0, 'a tap outside closes it');
    check(page);
    await close(page);
  });
});
