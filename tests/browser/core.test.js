// Lights, temperature and energy flow on any home (roadmap V3): devices that are not
// responding, calls Home Assistant refuses, power units, both sign conventions for grid,
// battery and charger, Fahrenheit homes and thermostats that report little.
//
// The test data changes by itself every few seconds; each test stops it first
// (harness.stopTestData) and sets the states it needs.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const houseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
const NOT = 'not responding';

// Replaces states (attributes too, unless `keep`), then draws.
const put = (page, states, keep = true) => page.evaluate(([list, k]) => {
  for (const [id, state, attributes] of list) {
    const s = window.store.get(id) ?? { entity_id: id, attributes: {} };
    window.store.update({ ...s, state: String(state), attributes: k ? { ...s.attributes, ...(attributes ?? {}) } : { ...(attributes ?? {}) } });
  }
  window.store.flush();
}, [states, keep]);
// A device that drops out: Home Assistant keeps only its name.
const drop = (page, ids, state = 'unavailable') => page.evaluate(([list, st]) => {
  for (const id of list) {
    const s = window.store.get(id);
    window.store.update({ ...s, state: st, attributes: { friendly_name: s.attributes?.friendly_name } });
  }
  window.store.flush();
}, [ids, state]);
const start = async (env, query = '?site=example-house', opts = {}) => {
  const page = await harness(env, query, opts);
  await page.evaluate(() => window.harness.stopTestData());
  return page;
};
const toPlan = async (page, plan = 'house') => {
  await page.locator(`.views .tab[data-view="plan:${plan}"]`).click();
  await page.waitForFunction((p) => document.querySelector('.stage').dataset.view === `plan:${p}`, plan);
};
const openRoom = async (page, name) => {
  await page.locator(`.fp.is-active .fp-room[aria-label="${name}"]`).dispatchEvent('click');
  await page.locator('aside.panel.is-open .panel-title', { hasText: name }).waitFor();
};
const card = (page, title) => page.locator('.side .card', { has: page.locator('h2', { hasText: title }) });
const flows = (page) => page.evaluate(() => [...document.querySelectorAll('.ov-flow-line.is-on')].map((n) => n.dataset.flow).sort());
const endText = (page, k) => page.locator(`.ov-flow-tag[data-end="${k}"]`).evaluate((n) => (n.classList.contains('is-on') ? n.textContent.replace(/\s+/g, ' ').trim() : ''));
const says = (page) => page.locator('.energy-says').textContent();
const toast = (page) => page.locator('.toast.is-error');

describe('lights, temperature and energy on any home', () => {
  const env = setup();

  test('lamps, an LED strip, temperatures and a thermostat that are not responding say so', async () => {
    const site = houseSite();
    site.floorplans[0].rooms.find((r) => r.id === 'kitchen').temperature = 'sensor.kitchen_temperature';
    const page = await start(env, '?site=example-house', { prepare: serve(site) });
    await drop(page, ['light.kitchen_ceiling', 'sensor.kitchen_temperature', 'climate.bedroom', 'light.facade']);
    await drop(page, ['light.kitchen_counter'], 'unknown');

    // Overview: the facade lamp is read out as not responding, not as off.
    const facade = page.locator('.ov-zonehit[data-zone="facade"]').first();
    assert.equal(await facade.getAttribute('aria-description'), NOT);
    assert.ok(await facade.evaluate((n) => n.classList.contains('is-silent')));
    // The lights card: the kitchen's lights say so instead of showing a switch that is just off.
    const kitchen = card(page, 'Lights').locator('li', { hasText: 'Kitchen' });
    assert.equal(await kitchen.locator('.tag').textContent(), NOT);
    // The heat card: a dash, never 0°.
    const bedroomHeat = card(page, 'Heat').locator('li', { hasText: 'Bedroom' });
    assert.equal(await bedroomHeat.locator('.mono').textContent(), '–');

    // The floor plan: dimmed lamp and strip, read out; rooms without a temperature say why.
    await toPlan(page);
    for (const id of ['light.kitchen_ceiling', 'light.kitchen_counter']) {
      const lamp = page.locator(`.fp.is-active [data-entity="${id}"]`);
      assert.ok(await lamp.evaluate((n) => n.classList.contains('is-silent')), `${id} is shown as not responding`);
      assert.equal(await lamp.getAttribute('aria-description'), NOT);
      assert.equal(await lamp.getAttribute('aria-pressed'), 'false');
    }
    for (const name of ['Kitchen', 'Bedroom']) {
      const room = page.locator(`.fp.is-active .fp-room[aria-label="${name}"]`);
      assert.equal(await room.getAttribute('aria-description'), NOT, `${name}: no temperature, said why`);
    }
    assert.doesNotMatch(await page.locator('.fp.is-active .fp-temp').allTextContents().then((t) => t.join(' ')), /(^|\s)0[.,]0°/);

    // The room panel: the thermostat cannot be set, the lights say so.
    await openRoom(page, 'Bedroom');
    const panel = page.locator('aside.panel');
    assert.equal(await panel.locator('.big-temp').textContent(), '–');
    assert.match(await panel.locator('.psec .muted.small').first().textContent(), /thermostat is not responding/);
    assert.ok(await panel.locator('.target .step').first().isDisabled());
    assert.ok(await panel.locator('.seg').first().isHidden(), 'no mode buttons');
    await openRoom(page, 'Kitchen');
    assert.match(await panel.locator('.psec').first().textContent(), /temperature sensor is not responding/);
    const rows = panel.locator('.light-list li');
    for (let i = 0; i < await rows.count(); i++) {
      assert.equal(await rows.nth(i).locator('.pct').textContent(), NOT);
      assert.ok(await rows.nth(i).locator('input[type="range"]').isDisabled());
    }

    // Back again: everything as normal.
    await put(page, [['light.kitchen_ceiling', 'on', { brightness: 255 }], ['climate.bedroom', 'heat', { temperature: 21, current_temperature: 20.4, hvac_modes: ['heat', 'off'] }]]);
    assert.equal(await rows.first().locator('.pct').textContent(), '100 %');
    assert.ok(!(await page.locator('.fp.is-active [data-entity="light.kitchen_ceiling"]').evaluate((n) => n.classList.contains('is-silent'))));
    assert.match(await page.locator('.fp.is-active .fp-label', { hasText: 'Bedroom' }).locator('.fp-temp').textContent(), /20\.4°/);
    check(page);
    await close(page);
  });

  test('energy and price sensors that are not responding: no 0 kW, and the sentence says what is missing', async () => {
    const page = await start(env);
    await put(page, [['sensor.solar_power', 3000], ['sensor.grid_power', -1000], ['sensor.battery_power', -500], ['sensor.car_charger_power', 0]]);
    assert.match(await says(page), /^The sun gives 3\.0 kW/);
    await drop(page, ['sensor.grid_power', 'sensor.nordpool_kwh_se3_sek']);

    const energy = card(page, 'Energy');
    assert.equal(await energy.locator('li', { hasText: 'From the grid' }).locator('.mono').textContent(), NOT);
    // What is known is still said; the grid is named as missing, and the house is not guessed.
    const text = await says(page);
    assert.match(text, /No reading from: Grid\./);
    assert.doesNotMatch(text, /sold to the grid/);
    assert.match(await endText(page, 'grid'), /Grid not responding/);
    assert.ok(!(await flows(page)).some((f) => f.includes('grid')), 'no line to or from the grid');
    // House usage comes from its own sensor now.
    await put(page, [['sensor.house_power', 1.4]]);
    assert.ok((await flows(page)).includes('solar>house'));

    // The price: a dash and a reason, not 0.00.
    const price = card(page, 'Price');
    await page.waitForFunction(() => /not responding/.test(document.querySelector('.side').textContent));
    assert.match(await price.textContent(), /The price sensor is not responding/);
    assert.match(await price.locator('.kpi').textContent(), /^–/);
    check(page);
    await close(page);
  });

  test('a call Home Assistant refuses is said on the screen and announced, with no unhandled error', async () => {
    const page = await start(env, '?site=example-house', { width: 1280, height: 800 });
    await put(page, [['light.kitchen_ceiling', 'off'], ['climate.living_room', 'heat', { temperature: 21, current_temperature: 20.5 }]]);
    await page.evaluate(() => { window.harness.failCalls = true; });

    // A lamp on the floor plan.
    await toPlan(page);
    await page.locator('.fp.is-active .fp-lamp[data-entity="light.kitchen_ceiling"]').press('Enter').catch(() => {});
    await page.locator('.fp.is-active .fp-lamp[data-entity="light.kitchen_ceiling"]').dispatchEvent('click');
    await toast(page).waitFor();
    assert.equal(await toast(page).getAttribute('role'), 'alert');
    assert.match(await toast(page).textContent(), /^Couldn't turn on \S/);

    // All on, in the header.
    await page.locator('.top-actions .chip-lights').click();
    await page.locator('.lights-menu [data-action="all-on"]').click();
    await page.waitForFunction(() => /devices/.test(document.querySelector('.toast.is-error')?.textContent));
    assert.match(await toast(page).textContent(), /^Couldn't turn on \d+ devices$/);
    assert.equal(await toast(page).count(), 1, 'one error at a time');

    // A scene and goodnight in the lights card.
    await card(page, 'Lights').locator('.scenes .chip', { hasText: 'Evening' }).click();
    await page.waitForFunction(() => /Evening/.test(document.querySelector('.toast.is-error')?.textContent));
    assert.equal(await toast(page).textContent(), "Couldn't start Evening");
    await card(page, 'Lights').locator('[data-action="goodnight"]').click();
    await page.waitForFunction(() => /Goodnight/.test(document.querySelector('.toast.is-error')?.textContent));

    // The thermostat's plus: the target goes back to what the thermostat says.
    await openRoom(page, 'Living room');
    const panel = page.locator('aside.panel');
    await panel.locator('.step[aria-label]').nth(1).click();
    assert.equal(await panel.locator('.target-val').textContent(), '21.5°');
    await page.waitForFunction(() => /Couldn't change/.test(document.querySelector('.toast.is-error')?.textContent), null, { timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('.target-val').textContent === '21.0°');

    // A lamp in the room panel.
    await panel.locator('.light-list .switch').first().click();
    await page.waitForFunction(() => /^Couldn't turn/.test(document.querySelector('.toast.is-error')?.textContent));
    const calls = await page.evaluate(() => window.harness.calls.map((c) => `${c.domain}.${c.service}`));
    for (const c of ['homeassistant.toggle', 'homeassistant.turn_on', 'scene.turn_on', 'planview_dash.goodnight', 'climate.set_temperature']) {
      assert.ok(calls.includes(c), `${c} was called`);
    }
    // Nothing changed, and no unhandled promise rejection or console error (check).
    assert.equal(await page.evaluate(() => window.store.get('light.kitchen_ceiling').state), 'off');
    check(page);
    await close(page);
  });

  test('a failed goodnight from the header still shows in the goodnight banner', async () => {
    const page = await start(env);
    await page.evaluate(() => { window.harness.failCalls = true; });
    await page.locator('.top-actions .chip-lights').click();
    await page.locator('.lights-menu [data-action="goodnight"]').click();
    await page.waitForFunction(() => /could not start/.test(document.querySelector('.goodnight')?.textContent ?? ''));
    assert.equal(await toast(page).count(), 0, 'said once, in the banner');
    check(page);
    await close(page);
  });

  test('power in W, kW, MW and mW; an unknown unit or none is a warning, not a silent guess', async () => {
    const page = await start(env);
    await put(page, [
      ['sensor.grid_power', 0.0025, { unit_of_measurement: 'MW' }],
      ['sensor.solar_power', 1500000, { unit_of_measurement: 'mW' }],
      ['sensor.house_power', 4000, { unit_of_measurement: 'W' }],
      ['sensor.battery_power', 0, { unit_of_measurement: 'kW' }],
      ['sensor.car_charger_power', 0, { unit_of_measurement: 'kW' }],
    ]);
    const energy = card(page, 'Energy');
    const row = (name) => energy.locator('li', { hasText: name }).locator('.mono').textContent();
    assert.equal(await row('From the grid'), '2.50 kW');
    assert.equal(await row('Solar'), '1.50 kW');
    assert.equal(await row('House usage'), '4.00 kW');
    assert.equal(await page.locator('.alert[data-key="unit"]').count(), 0, 'no warning while every unit is known');

    await put(page, [['sensor.battery_power', 3, { unit_of_measurement: 'kWh' }]]);
    const { attributes, ...charger } = await page.evaluate(() => window.store.get('sensor.car_charger_power'));
    await page.evaluate((s) => { window.store.update({ ...s, state: '2000', attributes: { friendly_name: s.attributes?.friendly_name } }); window.store.flush(); }, { ...charger, attributes });
    const warn = page.locator('.alert[data-key="unit"]');
    await warn.waitFor();
    assert.match(await warn.locator('summary').textContent(), /2 power sensors have a unit PlanView Dash doesn't recognise/);
    await warn.locator('summary').click();
    const items = (await warn.locator('li').allTextContents()).join('\n');
    assert.match(items, /"kWh" is not a power unit/);
    assert.match(items, /no unit, read as watts/);
    // kWh is not read as power; no unit is read as watts.
    assert.equal(await row('Battery'), '– kW');
    assert.equal(await row('Car charger'), '2.00 kW');
    check(page);
    await close(page);
  });

  // [name, true kW { solar, grid (+ buying), battery (+ giving), car }, the lines, words in the sentence, end labels]
  const CASES = [
    ['sunny, charging and selling', { solar: 5, grid: -2, battery: -1, car: 0 },
      ['solar>battery', 'solar>grid', 'solar>house'],
      'The sun gives 5.0 kW: 2.0 kW to the house, 1.0 kW to the battery and 2.0 kW sold to the grid.',
      { grid: /Selling 2\.0 kW/, battery: /Battery charging 1\.0 kW/ }],
    ['evening, buying and the battery giving', { solar: 0, grid: 1, battery: 0.5, car: 0 },
      ['battery>house', 'grid>house'],
      'The battery gives 0.5 kW to the house. The grid gives 1.0 kW to the house.',
      { grid: /Buying 1\.0 kW/, battery: /Battery giving 0\.5 kW/ }],
    ['the car and the battery charging from the grid', { solar: 0, grid: 4, battery: -1, car: 2 },
      ['grid>battery', 'grid>car', 'grid>house'],
      'The grid gives 4.0 kW: 1.0 kW to the house, 2.0 kW to the car and 1.0 kW to the battery.',
      { grid: /Buying 4\.0 kW/, battery: /Battery charging 1\.0 kW/, car: /Car charging 2\.0 kW/ }],
    ['night, solar reading slightly negative', { solar: -0.012, grid: 0.8, battery: 0, car: 0 },
      ['grid>house'],
      'The grid gives 0.8 kW to the house.',
      { grid: /Buying 0\.8 kW/ }],
  ];

  for (const invert of [false, true]) {
    test(`energy flow and sentence agree with ${invert ? 'inverted' : 'the usual'} signs for grid, battery and charger`, async () => {
      const site = houseSite();
      if (invert) Object.assign(site.energy, { grid_invert: true, battery_invert: true });
      const page = await start(env, '?site=example-house', { prepare: serve(site) });
      for (const [name, p, lines, sentence, ends] of CASES) {
        // What the sensors report: the inverted kind flips grid and battery, and reports the charger negative.
        const s = invert ? -1 : 1;
        await put(page, [
          ['sensor.solar_power', Math.round(p.solar * 1000)],
          ['sensor.grid_power', Math.round(s * p.grid * 1000)],
          ['sensor.battery_power', Math.round(s * p.battery * 1000)],
          ['sensor.car_charger_power', Math.round(s * p.car * 1000)],
        ]);
        assert.deepEqual(await flows(page), lines, `${name}: the lines`);
        assert.equal(await says(page), sentence, `${name}: the sentence`);
        for (const [k, re] of Object.entries(ends)) assert.match(await endText(page, k), re, `${name}: ${k}`);
        if (p.solar < 0) {
          assert.equal(await page.locator('.ov-solar-chip').evaluate((n) => n.style.opacity), '0', 'no solar label at night');
          assert.equal(await card(page, 'Energy').locator('li', { hasText: 'Solar' }).locator('.mono').textContent(), '0.00 kW', 'solar never below zero');
        }
        // The energy card shows the same signs as the sentence.
        const grid = await card(page, 'Energy').locator('li', { hasText: 'From the grid' }).locator('.mono').textContent();
        assert.equal(grid, `${p.grid.toFixed(2)} kW`, `${name}: the grid row`);
      }
      check(page);
      await close(page);
    });
  }

  test('a Fahrenheit home: thermostat steps of 1°, its range, and comfort in °F', async () => {
    const site = houseSite();
    site.mock = { ...site.mock, temperature_unit: '°F' };
    delete site.comfort; // the defaults, in °F
    site.floorplans[0].rooms.find((r) => r.id === 'kitchen').temperature = 'sensor.kitchen_temperature';
    const page = await start(env, '?site=example-house', { prepare: serve(site) });
    // As Home Assistant sends a thermostat that does not give its own step or range.
    await put(page, [
      ['climate.living_room', 'heat', { temperature: 68, current_temperature: 67.5, hvac_modes: ['heat', 'off'], hvac_action: 'idle' }],
      ['sensor.kitchen_temperature', 70, { unit_of_measurement: '°F' }],
    ], false);
    await toPlan(page);
    // 70 °F is comfortable, not warm (which it would be as 70 °C against 19–23).
    assert.equal(await page.locator('.fp.is-active .fp-room[aria-label="Kitchen"]').getAttribute('data-comfort'), 'ok');
    assert.equal(await page.locator('.fp.is-active .fp-room[aria-label="Living room"]').getAttribute('data-comfort'), 'ok');
    await openRoom(page, 'Living room');
    const panel = page.locator('aside.panel');
    await panel.locator('.step[aria-label]').nth(1).click();
    assert.equal(await panel.locator('.target-val').textContent(), '69.0°');
    await page.waitForFunction(() => window.harness.calls.some((c) => c.service === 'set_temperature'), null, { timeout: 3000 });
    const call = await page.evaluate(() => window.harness.calls.find((c) => c.service === 'set_temperature').data);
    assert.equal(call.temperature, 69, 'one degree up, not clamped to a Celsius range');
    check(page);
    await close(page);
  });

  test('a thermostat without a current temperature, presets or HVAC modes', async () => {
    const page = await start(env);
    await put(page, [['climate.bedroom', 'heat', { temperature: 20, hvac_action: 'idle', friendly_name: 'Bedroom' }]], false);
    assert.equal(await card(page, 'Heat').locator('li', { hasText: 'Bedroom' }).locator('.mono').textContent(), '– / 20.0°');
    await toPlan(page);
    const room = page.locator('.fp.is-active .fp-room[aria-label="Bedroom"]');
    assert.equal(await room.getAttribute('data-comfort'), 'none');
    assert.equal(await page.locator('.fp.is-active .fp-label', { hasText: 'Bedroom' }).locator('.fp-temp').textContent(), '');
    await openRoom(page, 'Bedroom');
    const panel = page.locator('aside.panel');
    assert.equal(await panel.locator('.big-temp').textContent(), '–');
    assert.equal(await panel.locator('.target-val').textContent(), '20.0°');
    assert.equal(await panel.locator('.seg:not([hidden])').count(), 0, 'no empty mode or preset rows');
    await panel.locator('.step[aria-label]').nth(1).click();
    await page.waitForFunction(() => window.harness.calls.some((c) => c.service === 'set_temperature'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.harness.calls.find((c) => c.service === 'set_temperature').data.temperature), 20.5);
    check(page);
    await close(page);
  });
});
