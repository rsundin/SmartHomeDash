// The quick start in the setup guide: floor plans from Home Assistant's floors and
// areas on a fresh dashboard, with nothing drawn, and a picture added later.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

// A new dashboard as the integration creates it (the example house without entities),
// on a Home Assistant with two floors and nine areas, one of them on no floor.
function freshSite() {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'custom_components', 'smarthomedash', 'example', 'site.json'), 'utf8'));
  site.overview.zones = [];
  for (const plan of site.floorplans) for (const room of plan.rooms) { room.lights = []; delete room.climate; delete room.temperature; delete room.sensors; }
  for (const key of ['climates', 'weather', 'wall_screen']) delete site[key];
  Object.assign(site, { name: 'Fresh home', language: 'en', locale: 'en-GB', energy: {}, scenes: [], setup_pending: true });
  const area = (area_id, name, floor_id, ...entities) => ({ area_id, name, floor_id, entities });
  const areas = [
    area('kitchen', 'Kitchen', 'ground', 'light.kitchen_ceiling', 'light.kitchen_island', 'light.kitchen_cabinets', 'climate.kitchen'),
    area('living_room', 'Living room', 'ground', 'light.living_floor', 'light.living_ceiling', 'sensor.living_temperature'),
    area('hall', 'Hall', 'ground', 'light.hall'),
    area('laundry', 'Laundry', 'ground'),
    area('bedroom', 'Bedroom', 'upstairs', 'light.bedroom_ceiling', 'light.bedroom_bedside'),
    area('kids_room', 'Kids room', 'upstairs', 'light.kids_room'),
    area('bathroom', 'Bathroom', 'upstairs', 'light.bathroom'),
    area('study', 'Study', 'upstairs', 'light.study'),
    area('shed', 'Shed', null, 'light.shed'),
  ];
  const lights = areas.flatMap((a) => a.entities).filter((id) => id.startsWith('light.'));
  site.mock = {
    floors: [{ floor_id: 'upstairs', name: 'Upstairs', level: 1 }, { floor_id: 'ground', name: 'Ground floor', level: 0 }],
    areas,
    entities: [
      ...lights.map((id) => ({ entity: id, attributes: { brightness: null, supported_color_modes: ['brightness'] } })),
      { entity: 'climate.kitchen', attributes: { temperature: 21, current_temperature: 20.5, hvac_modes: ['heat', 'off'] } },
      { entity: 'sensor.living_temperature', attributes: { unit_of_measurement: '°C', device_class: 'temperature' } },
    ],
  };
  return site;
}

const serve = (site) => (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));

describe('quick start', () => {
  const env = setup();

  test('a fresh dashboard gets a floor plan per floor without drawing', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve(freshSite()) });
    await page.locator('.setup').waitFor();
    const quick = page.locator('.setup-section', { hasText: 'Start from my Home Assistant' });
    await quick.locator('p', { hasText: '9 in all' }).waitFor();
    await quick.locator('button', { hasText: 'Start from my Home Assistant' }).click();
    await page.locator('.setup-status', { hasText: 'Made 3 floor plans with 9 rooms' }).waitFor();
    assert.equal(await page.locator('.setup-step.is-active').textContent().then((s) => s.includes('Floor plans')), true, 'the guide shows the plans');

    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.starts === 2);
    await page.evaluate(() => window.harness.ready);
    const saved = await page.evaluate(() => window.harness.saved.at(-1));
    assert.equal(saved.setup_pending, undefined);
    assert.equal(saved.overview, undefined, 'the example overview goes with the example plans');
    assert.deepEqual(saved.floorplans.map((p) => [p.name, p.ha_floor ?? null, p.layout]), [
      ['Ground floor', 'ground', 'tiles'], ['Upstairs', 'upstairs', 'tiles'], ['Other rooms', null, 'tiles'],
    ]);
    const ground = saved.floorplans[0];
    assert.deepEqual(ground.rooms.map((r) => r.ha_area), ['hall', 'kitchen', 'laundry', 'living_room']);
    const width = (r) => r.area[1][0] - r.area[0][0];
    const room = (id) => ground.rooms.find((r) => r.ha_area === id);
    assert.ok(width(room('kitchen')) > width(room('laundry')), 'a room with more devices gets a wider tile');
    assert.equal(saved.floorplans.flatMap((p) => p.rooms).every((r) => r.lights.length === 0), true, 'lights are placed at start, not written');

    // The dashboard opens on the first plan: tiles, area lights on them, the thermostat in its room.
    assert.equal(await page.locator('.setup').count(), 0, 'the guide does not open again');
    const plan = page.locator('.fp.is-active');
    await plan.waitFor();
    assert.equal(await plan.getAttribute('data-plan'), ground.id);
    assert.ok(await plan.evaluate((n) => n.classList.contains('is-tiles')));
    assert.equal(await plan.locator('.fp-room').count(), 4);
    assert.equal(await plan.locator('.fp-tile').count(), 4);
    for (const id of ['light.kitchen_ceiling', 'light.kitchen_island', 'light.kitchen_cabinets', 'light.living_floor', 'light.hall']) {
      assert.equal(await plan.locator(`.fp-lamp[data-entity="${id}"]`).count(), 1, `${id} is on the plan`);
    }
    await page.evaluate(() => window.store.flush());
    assert.match(await plan.locator('.fp-temp').allTextContents().then((x) => x.join(' ')), /20[.,]5°/);
    assert.deepEqual(await page.locator('.views .tab').allTextContents(), ['Ground floor', 'Upstairs', 'Other rooms']);
    check(page);
    await close(page);
  });

  test('a picture added later keeps the rooms and asks to draw them', async () => {
    const site = freshSite();
    delete site.setup_pending;
    delete site.overview;
    site.floorplans = [{
      id: 'ground', name: 'Ground floor', ha_floor: 'ground', unit: 'px', layout: 'tiles',
      outline: [[0, 0], [1200, 0], [1200, 300], [0, 300]],
      rooms: [
        { id: 'kitchen', name: 'Kitchen', ha_area: 'kitchen', area: [[0, 0], [570, 0], [570, 300], [0, 300]], lights: [{ entity: 'light.kitchen_ceiling', name: 'Ceiling', at: [285, 150] }] },
        { id: 'hall', name: 'Hall', ha_area: 'hall', area: [[600, 0], [1200, 0], [1200, 300], [600, 300]], lights: [] },
      ],
    }];
    const picture = path.join(ROOT, 'custom_components', 'smarthomedash', 'example', 'example_plan_house.webp');
    // The harness only pretends to upload: the restarted dashboard finds the picture here.
    const prepare = async (page) => {
      await serve(site)(page);
      await page.route('**/sites/example-house/plan_ground.webp', (route) => route.fulfill({ contentType: 'image/webp', body: fs.readFileSync(picture) }));
    };
    const page = await harness(env, '?site=example-house', { prepare });
    await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
    await page.locator('.setup-step', { hasText: 'Floor plans' }).click();
    const section = page.locator('.setup-section', { has: page.locator('h3', { hasText: /^Ground floor$/ }) });
    await section.locator('p', { hasText: 'a tile per area' }).waitFor();
    await section.locator('input[type=file]').setInputFiles(picture);
    await section.locator('.setup-note', { hasText: 'Draw each room on the picture' }).waitFor();

    await section.locator('button', { hasText: 'Draw Kitchen' }).click();
    const svg = page.locator('.draw .draw-svg image');
    const box = await svg.boundingBox();
    for (const [fx, fy] of [[0.2, 0.2], [0.45, 0.2], [0.45, 0.6]]) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.locator('.draw .chip', { hasText: 'Done' }).click();
    assert.equal(await section.locator('button', { hasText: 'Draw Kitchen' }).count(), 0);
    assert.equal(await section.locator('button', { hasText: 'Draw Hall' }).count(), 1);

    await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
    await page.waitForFunction(() => window.harness.starts === 2);
    const plan = await page.evaluate(() => window.harness.saved.at(-1).floorplans[0]);
    assert.equal(plan.layout, undefined);
    assert.match(plan.image.src, /^plan_ground\.webp$/);
    const [kitchen, hall] = plan.rooms;
    assert.equal(kitchen.ha_area, 'kitchen');
    assert.equal(kitchen.redraw, undefined);
    assert.equal(kitchen.area.length, 3);
    assert.equal(hall.redraw, true, 'the hall still waits to be drawn');
    assert.equal(hall.ha_area, 'hall');
    const [w, h] = plan.image.bounds.slice(2);
    assert.deepEqual(hall.area[2], [w, h], 'the hall tile is stretched over the picture');
    const inside = ([x, y], poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    assert.ok(inside(kitchen.lights[0].at, kitchen.area), 'the kitchen light moves into the room as drawn');
    check(page);
    await close(page);
  });
});
