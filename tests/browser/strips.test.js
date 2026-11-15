// LED strips (roadmap L3): a light drawn as a line or a surface on the floor plan and
// the overview. Tapping it anywhere, its colour and brightness, light mode without
// blur, and drawing, moving and undoing one in placement mode.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const COUNTER = 'light.kitchen_counter'; // a line strip in the example house
const houseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('shd:example-house:draft')));
const lightIn = (cfg, id) => cfg.floorplans.flatMap((p) => p.rooms).flatMap((r) => r.lights ?? []).find((l) => l.entity === id);
const toPlan = async (page) => {
  await page.locator('.views .tab[data-view="plan:house"]').click();
  await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
  await page.waitForTimeout(600); // the roof lifts first
};
// Where a point of the drawing is on the screen.
const onScreen = (page, svgSelector, [x, y]) => page.locator(svgSelector).evaluate((svg, [px, py]) => {
  const p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM());
  return [p.x, p.y];
}, [x, y]);
const set = (page, id, patch) => page.evaluate(([e, p]) => {
  const s = window.store.get(e);
  window.store.update({ ...s, ...p, attributes: { ...s.attributes, ...(p.attributes ?? {}) } });
  window.store.flush();
}, [id, patch]);
const restarted = async (page, n) => {
  await page.waitForFunction((k) => window.harness.starts >= k, n);
  await page.evaluate(() => window.harness.ready);
};

describe('LED strips', () => {
  const env = setup();

  test('a line on the floor plan: tapped anywhere along it, glowing in the light\'s colour and brightness', async () => {
    const page = await harness(env, '?site=example-house');
    await toPlan(page);
    const strip = page.locator(`.fp.is-active .fp-strip[data-entity="${COUNTER}"]`);
    assert.equal(await strip.getAttribute('role'), 'button');
    assert.equal(await strip.getAttribute('aria-label'), 'Counter lights: turn on or off');
    assert.equal(await strip.locator('polyline.fp-strip-hit').getAttribute('points'), '100,108 405,108 405,170');
    assert.equal(await page.locator(`.fp.is-active .fp-lamp[data-entity="${COUNTER}"] .fp-lamp-ring`).count(), 0, 'no round lamp for it');

    // Far from its middle, on each of its two legs.
    for (const at of [[130, 108], [405, 160]]) {
      const before = await page.evaluate((e) => window.store.get(e).state, COUNTER);
      const [x, y] = await onScreen(page, '.fp.is-active .fp-svg', at);
      await page.mouse.click(x, y);
      await page.waitForFunction(([e, b]) => window.store.get(e).state !== b, [COUNTER, before]);
      await page.evaluate(() => window.store.flush());
      assert.equal(await strip.getAttribute('aria-pressed'), String(before !== 'on'));
    }

    // Colour and brightness: a blue light at half brightness.
    const glow = page.locator('.fp.is-active .fp-strip-glow').first();
    await set(page, COUNTER, { state: 'on', attributes: { brightness: 128, rgb_color: [0, 0, 255], color_mode: 'rgb' } });
    assert.equal(await glow.evaluate((n) => Number(n.style.opacity).toFixed(2)), '0.50');
    assert.equal(await glow.locator('.fp-strip-bloom').evaluate((n) => getComputedStyle(n).stroke), 'rgb(0, 0, 255)');
    assert.ok(await strip.evaluate((n) => n.classList.contains('is-on')));
    await set(page, COUNTER, { state: 'off' });
    assert.equal(await glow.evaluate((n) => n.style.opacity), '0');
    assert.equal(await strip.getAttribute('aria-pressed'), 'false');

    // A long press opens the room, like on a lamp.
    const [x, y] = await onScreen(page, '.fp.is-active .fp-svg', [250, 108]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.locator('aside.panel.is-open .panel-title', { hasText: 'Kitchen' }).waitFor();
    await page.mouse.up();
    check(page);
    await close(page);
  });

  test('a surface on the floor plan is tapped anywhere inside it', async () => {
    const site = houseSite();
    const bedroom = site.floorplans[0].rooms.find((r) => r.id === 'bedroom');
    bedroom.lights = [{ entity: 'light.bedroom', name: 'Ceiling cove', area: [[450, 95], [680, 95], [680, 330], [450, 330]] }];
    const page = await harness(env, '?site=example-house', { prepare: serve(site) });
    await toPlan(page);
    const strip = page.locator('.fp.is-active .fp-strip.is-area[data-entity="light.bedroom"]');
    assert.equal(await strip.locator('polygon.fp-strip-hit').count(), 1);
    await set(page, 'light.bedroom', { state: 'off' });
    const [x, y] = await onScreen(page, '.fp.is-active .fp-svg', [470, 310]); // a corner of it, away from the room's label
    await page.mouse.click(x, y);
    await page.waitForFunction(() => window.store.get('light.bedroom').state === 'on');
    await page.evaluate(() => window.store.flush());
    const face = page.locator('.fp.is-active .fp-strip-glow.is-area .fp-strip-bloom');
    assert.equal(await face.evaluate((n) => n.tagName), 'polygon');
    assert.notEqual(await face.evaluate((n) => getComputedStyle(n).fill), 'none', 'the surface is filled with light');
    assert.equal(await page.locator('.fp.is-active .fp-strip-glow.is-area').evaluate((n) => n.style.opacity !== '0'), true);
    check(page);
    await close(page);
  });

  test('light mode: a plain coloured line, no blur', async () => {
    const normal = await harness(env, '?site=example-house');
    await toPlan(normal);
    assert.match(await normal.locator('.fp.is-active .fp-strip-bloom').first().evaluate((n) => getComputedStyle(n).filter), /url\(/, 'blurred otherwise');
    await close(normal);

    const page = await harness(env, '?site=example-house&lite');
    assert.ok(await page.evaluate(() => document.body.classList.contains('is-lite')));
    await toPlan(page);
    await set(page, COUNTER, { state: 'on', attributes: { brightness: 255, rgb_color: [255, 0, 0], color_mode: 'rgb' } });
    const bloom = page.locator('.fp.is-active .fp-strip-bloom').first();
    assert.equal(await bloom.evaluate((n) => getComputedStyle(n).filter), 'none');
    assert.equal(await bloom.evaluate((n) => getComputedStyle(n).stroke), 'rgb(255, 0, 0)');
    assert.equal(await page.locator('.fp.is-active .fp-strip-glow').first().evaluate((n) => n.style.opacity), '1');
    check(page);
    await close(page);
  });

  test('outdoor strips on the overview: a line and a surface, each switching its lamp', async () => {
    const site = houseSite();
    const facade = site.overview.zones.find((z) => z.id === 'facade');
    facade.lamps = [{ type: 'line', line: [[455, 470], [630, 385]], width: 6 }]; // no "at": the middle is worked out
    site.overview.zones.find((z) => z.id === 'entrance').lamps = [{ type: 'area', area: [[820, 350], [880, 330], [880, 380], [820, 400]] }];
    const page = await harness(env, '?site=example-house', { prepare: serve(site) });
    const line = page.locator('.ov-striphit.is-line[data-zone="facade"]');
    const face = page.locator('.ov-striphit.is-area[data-zone="entrance"]');
    assert.equal(await line.evaluate((n) => n.tagName), 'polyline');
    assert.equal(await face.evaluate((n) => n.tagName), 'polygon');
    assert.equal(await page.locator('.ov-zone[data-zone="facade"] .ov-lamp-strip.is-line polyline').count(), 3);

    await set(page, 'light.facade', { state: 'off' });
    assert.equal(await line.getAttribute('aria-pressed'), 'false');
    const [x, y] = await onScreen(page, '.ov-upper', [480, 458]); // near one end, on the line
    await page.mouse.click(x, y);
    await page.waitForFunction(() => window.store.get('light.facade').state === 'on');
    await set(page, 'light.facade', { state: 'on', attributes: { brightness: 255, rgb_color: [0, 255, 0], color_mode: 'rgb' } });
    assert.equal(await line.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.ov-zone[data-zone="facade"]').evaluate((n) => n.style.opacity), '1');
    assert.equal(await page.locator('.ov-zone[data-zone="facade"] .ov-strip-bloom').first().evaluate((n) => getComputedStyle(n).stroke), 'rgb(0, 255, 0)');

    await set(page, 'light.entrance', { state: 'off' });
    const [fx, fy] = await onScreen(page, '.ov-upper', [850, 365]);
    await page.mouse.click(fx, fy);
    await page.waitForFunction(() => window.store.get('light.entrance').state === 'on');
    check(page);
    await close(page);
  });

  test('placement mode: draw a lamp as a line, bend it, set its width, move it, and make it a spot again', async () => {
    const page = await harness(env, '?site=example-house&edit');
    await page.locator('aside.editor').waitFor();
    await toPlan(page);
    const id = 'light.office';
    const was = lightIn(houseSite(), id).at;

    // Pick the lamp, then Line: the shape editor opens on a first line through the lamp.
    await page.locator(`.fp.is-active .fp-lamp[data-entity="${id}"] .fp-lamp-hit`).click();
    const controls = page.locator('.editor-strip');
    assert.equal(await controls.locator('[data-action="shape-spot"]').getAttribute('aria-pressed'), 'true');
    await controls.locator('[data-action="shape-line"]').click();
    const shape = page.locator('.draw.shape-strip');
    await shape.locator('polyline.shape-body.is-open').waitFor({ state: 'attached' }); // a level line has no height to be "visible"
    assert.equal(await shape.locator('.shape-corner').count(), 2);
    assert.equal(await shape.locator('.shape-mid').count(), 1, 'a line has no edge back to its start');
    assert.match(await shape.locator('.draw-bar').textContent(), /glows along the whole line/);

    // Drag the dot in the middle down: a bend. Then try to remove points until two are left.
    const mid = await shape.locator('.shape-mid').boundingBox();
    await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2 + i * 5);
    await page.mouse.up();
    assert.equal(await shape.locator('.shape-corner').count(), 3);
    await shape.locator('.chip-primary').click();

    await restarted(page, 2);
    let light = lightIn(await draft(page), id);
    assert.equal(light.line.length, 3);
    assert.equal(light.area, undefined);
    assert.ok(light.line[1][1] > light.line[0][1], 'the bend went down');
    assert.equal(light.name, lightIn(houseSite(), id).name, 'its name is kept');
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    const strip = page.locator(`.fp.is-active .fp-strip[data-entity="${id}"]`);
    await strip.waitFor();
    assert.equal(await page.locator('.editor-strip [data-action="shape-line"]').getAttribute('aria-pressed'), 'true');

    // Width.
    await page.locator('.editor-strip-width').fill('12');
    await page.locator('.editor-strip-width').blur();
    await restarted(page, 3);
    light = lightIn(await draft(page), id);
    assert.equal(light.width, 12);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');

    // Drag it by one end: every point moves as far as the pointer did.
    await page.waitForTimeout(700); // the plan settles after the restart
    const before = light.line;
    const [x, y] = await onScreen(page, '.fp.is-active .fp-svg', before[0]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 2, y - i);
    await page.mouse.up();
    await restarted(page, 4);
    light = lightIn(await draft(page), id);
    const d = [light.line[0][0] - before[0][0], light.line[0][1] - before[0][1]];
    assert.ok(d[0] > 5 && d[1] < -2, `moved by ${d}`);
    assert.deepEqual(light.line, before.map(([px, py]) => [px + d[0], py + d[1]]), 'the shape is kept');
    assert.equal(light.width, 12);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');

    // Undo takes the move back; Spot makes it a round lamp in the middle of the strip.
    await page.keyboard.press('Control+z');
    await restarted(page, 5);
    assert.deepEqual(lightIn(await draft(page), id).line, before);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await page.locator('.editor-strip [data-action="shape-spot"]').click();
    await restarted(page, 6);
    light = lightIn(await draft(page), id);
    assert.equal(light.line, undefined);
    assert.equal(light.width, undefined);
    assert.ok(Math.abs(light.at[0] - was[0]) < 60 && Math.abs(light.at[1] - was[1]) < 60, `back near ${was}: ${light.at}`);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    assert.equal(await page.locator(`.fp.is-active .fp-lamp[data-entity="${id}"] .fp-lamp-ring`).count(), 1);
    check(page);
    await close(page);
  });

  test('placement mode: a surface on the plan, and an outdoor lamp drawn as a line', async () => {
    const page = await harness(env, '?site=example-house&edit');
    await page.locator('aside.editor').waitFor();
    await toPlan(page);
    await page.locator('.fp.is-active .fp-lamp[data-entity="light.office"] .fp-lamp-hit').click();
    await page.locator('.editor-strip [data-action="shape-area"]').click();
    const shape = page.locator('.draw.shape-strip');
    await shape.locator('polygon.shape-body').waitFor();
    assert.equal(await shape.locator('.shape-corner').count(), 4);
    assert.equal(await shape.locator('.shape-mid').count(), 4);
    // Cancel changes nothing.
    await shape.locator('.chip', { hasText: 'Cancel' }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('shd:example-house:draft')), null);
    await page.locator('.editor-strip [data-action="shape-area"]').click();
    await shape.locator('.chip-primary').click();
    await restarted(page, 2);
    const light = lightIn(await draft(page), 'light.office');
    assert.equal(light.area.length, 4);
    assert.equal(light.line, undefined);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await page.locator('.fp.is-active .fp-strip.is-area[data-entity="light.office"]').waitFor();

    // Outdoors: the second lamp of the facade becomes a line; the others stay as they were.
    await page.locator('.views .tab[data-view="overview"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'overview');
    await page.waitForTimeout(700);
    await page.locator('.ov-zonehit[data-zone="facade"][data-lamp="1"]').click();
    await page.locator('.editor-strip [data-action="shape-line"]').click();
    await shape.locator('polyline.shape-body.is-open').waitFor({ state: 'attached' }); // a level line has no height to be "visible"
    await shape.locator('.chip-primary').click();
    await restarted(page, 3);
    const lamps = (await draft(page)).overview.zones.find((z) => z.id === 'facade').lamps;
    assert.equal(lamps.length, 3);
    assert.equal(lamps[1].type, 'line');
    assert.equal(lamps[1].line.length, 2);
    assert.deepEqual(lamps[0], houseSite().overview.zones.find((z) => z.id === 'facade').lamps[0]);
    await page.locator('.ov-striphit.is-line[data-zone="facade"][data-lamp="1"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.editor-strip [data-action="shape-line"]').getAttribute('aria-pressed'), 'true');
    check(page);
    await close(page);
  });
});
