// Placement mode and the setup guide, through the harness, which restarts the
// dashboard in place the way the Home Assistant panel does.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check, centre } = require('./lib');

const lampAt = (page, id) => page.locator(`.fp.is-active .fp-lamp[data-entity="${id}"] .fp-lamp-ring`)
  .evaluate((n) => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))]);

describe('editing', () => {
  const env = setup();

  test('placement mode opens and closes in place', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Place' }).click();
    await page.waitForFunction(() => window.harness.starts === 2 && document.body.classList.contains('is-editing'));
    await page.evaluate(() => window.harness.ready);
    await page.locator('aside.editor').waitFor();
    assert.equal(await page.locator('aside.editor').count(), 1);
    await page.locator('.editor-exit').click();
    await page.waitForFunction(() => window.harness.starts === 3 && !document.body.classList.contains('is-editing'));
    await page.evaluate(() => window.harness.ready);
    assert.equal(await page.locator('aside.editor').count(), 0, 'placement mode leaves nothing behind');
    check(page);
    await close(page);
  });

  test('drag a lamp in placement mode', async () => {
    const page = await harness(env, '?site=example-house&edit');
    await page.locator('aside.editor').waitFor();
    await page.locator('.views .tab[data-view="plan:house"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await page.waitForTimeout(600); // the roof lifts first

    const id = 'light.office';
    const from = await lampAt(page, id);
    const [x, y] = await centre(page.locator(`.fp.is-active .fp-lamp[data-entity="${id}"] .fp-lamp-core`));
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 2, y + i * 2);
    assert.ok(await page.locator('.fp-lamp.is-dragging').count(), 'the lamp follows the pointer');
    await page.mouse.up();

    // Saved as a draft, then the dashboard restarts on the same plan with the lamp moved.
    await page.waitForFunction(() => window.harness.starts >= 2);
    await page.evaluate(() => window.harness.ready);
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    const to = await lampAt(page, id);
    assert.ok(to[0] > from[0] && to[1] > from[1], `moved from ${from} to ${to}`);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('shd:example-house:draft')));
    const room = draft.floorplans.find((p) => p.id === 'house').rooms.find((r) => r.lights.some((l) => l.entity === id));
    assert.deepEqual(room.lights.find((l) => l.entity === id).at, to);
    await page.locator('.lamp-tag:not([hidden])', { hasText: id }).waitFor();
    check(page);
    await close(page);
  });

  test('every setup guide step renders, on both examples', async () => {
    for (const site of ['example-house', 'example-apartment']) {
      const page = await harness(env, `?site=${site}`);
      await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
      const steps = page.locator('.setup .setup-step');
      const n = await steps.count();
      assert.ok(n >= 7, `${site}: ${n} steps`);
      for (let i = 0; i < n; i++) {
        await steps.nth(i).click();
        assert.equal(await steps.nth(i).getAttribute('aria-current'), 'true');
        const body = page.locator('.setup-body');
        assert.ok((await body.locator('.setup-section, .setup-field, .setup-intro, p').count()) > 0, `${site}: step ${i + 1} has content`);
      }
      check(page);
      await close(page);
    }
  });

  test('linking a floor plan to a building from the floor plan step', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-step', { hasText: 'Floor plans' }).click();
    const garagePlan = page.locator('.setup-section', { has: page.locator('h3', { hasText: /^Garage$/ }) });
    const pick = garagePlan.getByLabel('Building on the overview picture');
    assert.equal(await pick.inputValue(), 'garage', 'shows the building that opens it');

    // The house now opens the garage plan; the garage building lets go of it.
    await pick.selectOption('house');
    const housePlan = page.locator('.setup-section', { has: page.locator('h3', { hasText: /^House$/ }) });
    assert.equal(await housePlan.getByLabel('Building on the overview picture').inputValue(), '', 'a building opens one plan');

    // The overview step shows the same link, in words.
    await page.locator('.setup-step', { hasText: 'Overview picture' }).click();
    const opens = page.locator('.setup-rooms select[aria-label="Floor plan"]');
    assert.deepEqual(await opens.evaluateAll((ns) => ns.map((n) => n.selectedOptions[0].textContent)), ['Opens: Garage', 'Opens: no floor plan']);

    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.saved.length === 1);
    const saved = await page.evaluate(() => window.harness.saved[0].overview.buildings.map((b) => [b.id, b.floorplan ?? null]));
    assert.deepEqual(saved, [['house', 'garage'], ['garage', null]]);
    await page.waitForFunction(() => window.harness.starts === 2);
    await page.evaluate(() => window.harness.ready);
    check(page);
    await close(page);
  });

  test('closing the setup guide without changes', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-head .chip', { hasText: 'Close' }).click();
    assert.equal(await page.locator('.setup').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('shd:example-house:setupLater')), 'true');
    assert.equal(await page.evaluate(() => window.harness.saved.length), 0);
    check(page);
    await close(page);
  });

  test('closing the setup guide with changes asks first', async () => {
    const page = await harness(env, '?site=example-house');
    const openGuide = async () => {
      await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
      await page.locator('.setup-step').first().click();
      await page.locator('.setup-body input.setup-input').first().fill('Test house');
    };

    // Discard: closes, nothing saved.
    await openGuide();
    await page.locator('.setup-head .chip', { hasText: 'Close' }).click();
    assert.equal(await page.locator('.setup').count(), 1, 'still open, asking');
    await page.locator('.setup-status .chip-danger').click();
    assert.equal(await page.locator('.setup').count(), 0);
    assert.equal(await page.evaluate(() => window.harness.saved.length), 0);

    // Save: the config is saved through the panel and the dashboard restarts with it.
    await openGuide();
    await page.locator('.setup-head .chip', { hasText: 'Close' }).click();
    await page.locator('.setup-status .chip-primary').click();
    await page.waitForFunction(() => window.harness.saved.length === 1 && window.harness.starts === 2);
    await page.evaluate(() => window.harness.ready);
    const saved = await page.evaluate(() => window.harness.saved[0]);
    assert.equal(saved.name, 'Test house');
    assert.equal(saved.setup_pending, undefined);
    assert.equal(await page.locator('header h1').textContent(), 'Test house');
    check(page);
    await close(page);
  });
  test('devices missing in Home Assistant are listed and removed in placement mode', async () => {
    const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
    const room = (name) => site.floorplans.flatMap((p) => p.rooms).find((r) => r.name === name);
    (room('Kitchen').sensors ??= []).push('binary_sensor.old_kitchen_motion');
    (room('Office').sensors ??= []).push('binary_sensor.renamed_office_door');
    const prepare = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
    const page = await harness(env, '?site=example-house', { prepare });

    const warning = page.locator('.alerts details.alert[data-key="missing"]');
    await warning.locator('summary', { hasText: '2 devices in the dashboard no longer exist in Home Assistant' }).waitFor();
    await warning.locator('summary').click();
    await warning.locator('li', { hasText: 'binary_sensor.old_kitchen_motion · Kitchen' }).waitFor();

    // One comes back (renamed back in Home Assistant): the count follows.
    const officeBack = () => page.evaluate(() => window.store.update({ entity_id: 'binary_sensor.renamed_office_door', state: 'off', attributes: { device_class: 'door' } }));
    await officeBack();
    await warning.locator('summary', { hasText: '1 device in the dashboard no longer exists in Home Assistant' }).waitFor();

    // The link opens placement mode with only the missing devices listed. The test data
    // start over, so the office door is missing again until it reports.
    await warning.locator('.alert-action').click();
    await page.waitForFunction(() => window.harness.starts === 2 && document.body.classList.contains('is-editing'));
    await page.evaluate(() => window.harness.ready);
    const list = page.locator('aside.editor .editor-list');
    await list.locator('.editor-missing .editor-ent', { hasText: 'binary_sensor.old_kitchen_motion' }).waitFor();
    assert.equal(await list.locator('section').count(), 1, 'only the missing devices are listed');
    assert.equal(await list.locator('.editor-ent').count(), 2);

    await list.locator('.editor-ent', { hasText: 'binary_sensor.old_kitchen_motion' }).click();
    await page.locator('aside.editor .editor-sel .chip', { hasText: 'Remove from the dashboard' }).click();
    await page.waitForFunction(() => window.harness.starts === 3);
    await page.evaluate(() => window.harness.ready);
    await list.locator('.editor-ent', { hasText: 'binary_sensor.renamed_office_door' }).waitFor();
    assert.equal(await list.locator('.editor-ent').count(), 1, 'removed from the list');
    await officeBack();
    await page.locator('aside.editor .editor-list', { hasText: 'Every device in site.json exists in Home Assistant.' }).waitFor();
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('shd:example-house:draft')));
    const kitchen = draft.floorplans.flatMap((p) => p.rooms).find((r) => r.name === 'Kitchen');
    assert.ok(!kitchen.sensors.includes('binary_sensor.old_kitchen_motion'));
    assert.ok(draft.floorplans.flatMap((p) => p.rooms).find((r) => r.name === 'Office').sensors.includes('binary_sensor.renamed_office_door'));

    await page.locator('aside.editor .editor-list .chip', { hasText: 'Show all devices' }).click();
    assert.ok(await page.locator('aside.editor .editor-list section').count() > 1);
    check(page);
    await close(page);
  });
  test('placement mode puts lights first and folds away what matters less', async () => {
    const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
    const temp = { unit_of_measurement: '°C', device_class: 'temperature' };
    site.mock.entities = [
      { entity: 'light.garden_path', name: 'Garden path' },
      { entity: 'light.facade_spot', name: 'Facade spot' },
      { entity: 'switch.coffee_maker', name: 'Coffee maker' },
      { entity: 'sensor.router_temperature', name: 'Router temperature', attributes: temp },
      { entity: 'sensor.fridge_temperature', name: 'Fridge temperature', attributes: temp, entity_category: 'diagnostic' },
    ];
    // A spot in the same Home Assistant area as the facade lamps, on a device placed there.
    site.mock.devices = [{ id: 'facade_spot', name: 'Facade spot', area_id: 'outdoor_facade', entities: { 'light.facade_spot': null } }];
    const prepare = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
    const page = await harness(env, '?site=example-house&edit', { prepare });
    const list = page.locator('aside.editor .editor-list');
    const group = (kind) => list.locator(`section[data-kind="${kind}"]`);
    const row = (kind, id) => group(kind).locator('.editor-ent', { hasText: id });

    assert.deepEqual(await list.locator('section').evaluateAll((n) => n.map((x) => x.dataset.kind)), ['lights', 'temperature', 'climate', 'cameras', 'switches']);
    // A light with no room is shown; one in the facade's area joins the facade by itself.
    await row('lights', 'light.garden_path').waitFor();
    assert.match(await row('lights', 'light.facade_spot').textContent(), /placed automatically/);
    // A temperature sensor in no room, and a device's own diagnostic sensor, wait under "Show 2 more".
    assert.equal(await row('temperature', 'sensor.router_temperature').count(), 0);
    assert.equal(await row('temperature', 'sensor.fridge_temperature').count(), 0);
    await group('temperature').locator('.editor-more', { hasText: 'Show 2 more' }).click();
    await row('temperature', 'sensor.router_temperature').waitFor();
    await row('temperature', 'sensor.fridge_temperature').waitFor();
    // Switches are folded away; search finds them anyway.
    assert.equal(await row('switches', 'switch.coffee_maker').count(), 0);
    await group('switches').locator('.editor-more', { hasText: 'Show 1 more' }).waitFor();
    await page.locator('#editor-search').fill('coffee');
    await row('switches', 'switch.coffee_maker').waitFor();
    check(page);
    await close(page);

    // On the dashboard the facade lamps switch the spot too.
    const dash = await harness(env, '?site=example-house', { prepare });
    await dash.evaluate(() => window.store.update({ ...window.store.get('light.facade'), state: 'off' }));
    await dash.evaluate(() => window.store.update({ ...window.store.get('light.facade_spot'), state: 'off' }));
    await dash.locator('.ov-zonehit[data-zone="facade"]').first().click();
    await dash.waitForFunction(() => window.store.get('light.facade_spot').state === 'on');
    check(dash);
    await close(dash);
  });
});
