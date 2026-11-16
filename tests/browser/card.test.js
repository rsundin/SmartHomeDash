// The card for other dashboards (frontend/card.js), in a stand-in Home Assistant
// dashboard (card-harness.html): the picture in a frame, the visual editor and the
// card picker's suggestions.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, open, close, check, assertNoOverflow } = require('./lib');

async function cardPage(env, opts = {}, query = '') {
  const page = await open(env, `tests/browser/card-harness.html${query}`, opts);
  await page.waitForFunction(() => window.harness?.ready);
  await page.evaluate(() => window.harness.ready);
  return page;
}

// The dashboard inside the n:th card's frame, once it has drawn.
async function frameOf(page, n = 0) {
  const frame = page.frameLocator('smarthomedash-card iframe').nth(n);
  await frame.locator('.stage[data-view]').waitFor();
  return frame;
}

const view = (frame) => frame.locator('.stage').getAttribute('data-view');
const lampOn = (page, id) => page.evaluate((e) => window.harness.hass.states[e].state === 'on', id);

describe('card', () => {
  const env = setup();

  for (const size of [{ name: 'phone', width: 390, height: 844, touch: true }, { name: 'desktop', width: 1280, height: 800 }]) {
    test(`a sections view on a ${size.name}: only the picture, as high as the grid makes it`, async () => {
      const page = await cardPage(env, size);
      await page.evaluate(() => { window.harness.addCard({ site: 'example-house' }, { grid: true }); });
      const frame = await frameOf(page);
      assert.equal(await view(frame), 'overview');
      assert.ok(await frame.locator('body').evaluate((n) => n.classList.contains('is-embed')));
      for (const hidden of ['.top', '.side', '.alerts']) {
        assert.equal(await frame.locator(hidden).first().isVisible(), false, `${hidden} is not shown in a card`);
      }
      const card = await page.locator('smarthomedash-card').boundingBox();
      const slot = await page.locator('.fit-rows').boundingBox();
      assert.equal(Math.round(card.height), Math.round(slot.height), 'the card fills the height of its grid slot');
      const stage = await frame.locator('.stage').boundingBox();
      assert.ok(Math.abs(stage.width - card.width) <= 2 && Math.abs(stage.height - card.height) <= 2, 'the picture fills the card');
      await assertNoOverflow(page, `card harness ${size.name}`);
      const inside = await frame.locator('html').evaluate((n) => [n.scrollWidth, n.clientWidth, n.scrollHeight, n.clientHeight]);
      assert.ok(inside[0] <= inside[1] && inside[2] <= inside[3], `nothing scrolls inside the frame: ${inside}`);
      check(page);
      await close(page);
    });
  }

  test('tapping a building opens its floor plan, a room its panel, and lamps go through Home Assistant', async () => {
    const page = await cardPage(env);
    await page.evaluate(() => { window.harness.addCard({ site: 'example-house' }); });
    const frame = await frameOf(page);
    assert.equal(Math.round((await page.locator('smarthomedash-card').boundingBox()).height), 400, '400 px when nothing else is said');

    await frame.locator('.ov-bld[aria-label*="House"]').click();
    await frame.locator('.stage[data-view="plan:house"]').waitFor();
    await frame.locator('.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]').click();
    const panel = frame.locator('aside.panel');
    await panel.locator('.panel-title', { hasText: 'Bedroom' }).waitFor();

    // The switch calls Home Assistant's service; the lamp follows the next `hass` object.
    const before = await lampOn(page, 'light.bedroom');
    await panel.locator('.light-list .switch').first().click();
    await page.waitForFunction((b) => (window.harness.hass.states['light.bedroom'].state === 'on') !== b, before);
    const call = await page.evaluate(() => window.harness.calls.at(-1));
    assert.match(`${call[0]}.${call[1]}`, /^(light|homeassistant)\.(toggle|turn_on|turn_off)$/);
    assert.deepEqual([].concat(call[2].entity_id), ['light.bedroom']);
    const lamp = frame.locator('.fp[data-plan="house"] .fp-lamp[data-entity="light.bedroom"]');
    await frame.locator(`.fp-lamp[data-entity="light.bedroom"]${before ? ':not(.is-on)' : '.is-on'}`).first().waitFor({ state: 'attached' });

    // A change made elsewhere in Home Assistant reaches the picture too.
    await page.evaluate((s) => window.harness.setState('light.bedroom', s), before ? 'on' : 'off');
    await frame.locator(`.fp-lamp[data-entity="light.bedroom"]${before ? '.is-on' : ':not(.is-on)'}`).first().waitFor({ state: 'attached' });
    assert.equal(await lamp.count(), 1);

    await panel.locator('.panel-close, button[aria-label]').first().click();
    await frame.locator('.back').click();
    await frame.locator('.stage[data-view="overview"]').waitFor();
    check(page);
    await close(page);
  });

  test('a card for one floor plan stays on it; a card for a room opens the room', async () => {
    const page = await cardPage(env);
    await page.evaluate(() => {
      window.harness.addCard({ site: 'example-house', view: 'plan:garage' });
      window.harness.addCard({ site: 'example-house', view: 'room:bedroom', height: 520 });
    });
    const plan = await frameOf(page, 0);
    assert.equal(await view(plan), 'plan:garage');
    assert.equal(await plan.locator('.back').isVisible(), false, 'no way back to an overview the card does not show');
    await plan.locator('body').press('Escape');
    assert.equal(await view(plan), 'plan:garage');

    const room = await frameOf(page, 1);
    assert.equal(await view(room), 'plan:house');
    await room.locator('aside.panel .panel-title', { hasText: 'Bedroom' }).waitFor();
    assert.equal(await room.locator('.back').isVisible(), false);
    assert.equal(Math.round((await page.locator('smarthomedash-card').nth(1).boundingBox()).height), 520, 'height from the config');
    check(page);
    await close(page);
  });

  test('a dashboard without an overview starts on its floor plan; a new config restarts in the same frame', async () => {
    const page = await cardPage(env);
    await page.evaluate(() => { window.harness.addCard({ site: 'example-apartment' }); });
    const frame = await frameOf(page);
    assert.equal(await view(frame), 'plan:apartment');

    await page.evaluate(() => {
      const card = document.querySelector('smarthomedash-card');
      window.firstFrame = card.shadowRoot.querySelector('iframe');
      window.firstFrame.contentWindow.marker = true;
      card.setConfig({ site: 'example-house', view: 'plan:house' });
    });
    await frame.locator('.stage[data-view="plan:house"]').waitFor();
    assert.ok(await page.evaluate(() => {
      const now = document.querySelector('smarthomedash-card').shadowRoot.querySelector('iframe');
      return now === window.firstFrame && now.contentWindow.marker === true;
    }), 'the frame was not loaded again');
    // Site files come through Home Assistant's login.
    const fetched = await page.evaluate(() => window.harness.fetched);
    assert.ok(fetched.includes('/api/smarthomedash/sites/example-apartment/site.json'));
    assert.ok(fetched.includes('/api/smarthomedash/sites/example-house/site.json'));
    check(page);
    await close(page);
  });

  test('no dashboard chosen says so; a dashboard that is gone says why', async () => {
    const page = await cardPage(env);
    await page.evaluate(() => {
      window.harness.addCard({});
      window.harness.addCard({ site: 'not-here' });
    });
    const note = page.locator('smarthomedash-card').first().locator('.note');
    await note.filter({ hasText: 'Choose a dashboard' }).waitFor();
    assert.equal(await page.locator('smarthomedash-card').first().locator('iframe').count(), 0);
    const frame = page.frameLocator('smarthomedash-card iframe');
    await frame.locator('.fatal', { hasText: 'sites/not-here/site.json' }).waitFor();
    assert.match(await frame.locator('.fatal').textContent(), /Could not start/);
    // The 404 and the logged error are the point of this test.
    assert.ok(page.errors.length > 0 && page.errors.every((e) => /404|site\.json/.test(e)), page.errors.join('\n'));

    for (const bad of [{ site: '../x' }, { site: 'a', view: 'kitchen' }]) {
      const message = await page.evaluate((c) => { try { document.createElement('smarthomedash-card').setConfig(c); return ''; } catch (e) { return e.message; } }, bad);
      assert.ok(message, `${JSON.stringify(bad)} is refused`);
    }
    await close(page);
  });

  test('the visual editor lists the dashboards and their views', async () => {
    const page = await cardPage(env);
    await page.evaluate(() => { window.harness.addEditor({ type: 'custom:smarthomedash-card', site: 'example-house' }); });
    await page.waitForFunction(() => document.querySelector('ha-form')?.schema?.[1].selector.select.options.length > 2);
    const form = await page.evaluate(() => {
      const f = document.querySelector('ha-form');
      return {
        names: f.schema.map((s) => s.name),
        labels: f.schema.map((s) => f.computeLabel(s)),
        sites: f.schema[0].selector.select.options,
        views: f.schema[1].selector.select.options,
        data: f.data,
      };
    });
    assert.deepEqual(form.names, ['site', 'view', 'height']);
    assert.deepEqual(form.labels, ['Dashboard', 'Show', 'Height']);
    assert.deepEqual(form.sites, [{ value: 'example-apartment', label: 'Apartment' }, { value: 'example-house', label: 'Example house' }]);
    const values = form.views.map((o) => o.value);
    assert.deepEqual(values.slice(0, 3), ['overview', 'plan:house', 'plan:garage']);
    assert.ok(values.includes('room:bedroom') && values.includes('room:workshop'));
    assert.match(form.views.find((o) => o.value === 'room:bedroom').label, /Bedroom/);
    assert.deepEqual(form.data, { site: 'example-house', view: 'overview' });

    // Picking a room and a height; then another dashboard, which starts on its own start view.
    await page.evaluate(() => document.querySelector('ha-form').change({ view: 'room:bedroom', height: 300 }));
    await page.evaluate(() => document.querySelector('ha-form').change({ site: 'example-apartment' }));
    await page.evaluate(() => document.querySelector('ha-form').change({ height: undefined }));
    const configs = await page.evaluate(() => window.harness.configs);
    assert.deepEqual(configs, [
      { type: 'custom:smarthomedash-card', site: 'example-house', view: 'room:bedroom', height: 300 },
      { type: 'custom:smarthomedash-card', site: 'example-apartment', height: 300 },
      { type: 'custom:smarthomedash-card', site: 'example-apartment' },
    ]);
    await page.waitForFunction(() => document.querySelector('ha-form').schema[1].selector.select.options.some((o) => o.value === 'plan:apartment'));
    check(page);
    await close(page);
  });

  test('the card picker: listed with a description, and a room suggested for its lamp', async () => {
    const page = await cardPage(env, {}, '?lang=sv');
    const entry = await page.evaluate(async () => {
      window.harness.addCard({ site: 'example-house' }); // a card on the page: the Swedish texts are loaded
      const e = window.customCards.find((c) => c.type === 'smarthomedash-card');
      return { name: e.name, fn: typeof e.getEntitySuggestion, stub: customElements.get('smarthomedash-card').getStubConfig(window.harness.hass) };
    });
    assert.deepEqual(entry, { name: 'SmartHomeDash', fn: 'function', stub: { site: 'example-apartment' } });
    await page.waitForFunction(() => window.customCards[0].description.length > 10);

    // The first question starts reading the dashboards; the answer grows as each one arrives.
    await page.waitForFunction(() => window.harness.card.suggest(window.harness.hass, 'light.bedroom')?.length === 2);
    const r = await page.evaluate(() => ({
      lamp: window.harness.card.suggest(window.harness.hass, 'light.bedroom'),
      climate: window.harness.card.suggest(window.harness.hass, 'climate.bedroom'),
      sensor: window.harness.card.suggest(window.harness.hass, 'sensor.outdoor_temperature'),
      unknown: window.harness.card.suggest(window.harness.hass, 'light.nowhere'),
    }));
    // Both example dashboards have this lamp in a bedroom: one suggestion for each.
    assert.deepEqual(r.lamp.map((s) => s.config.site), ['example-apartment', 'example-house']);
    const house = r.lamp[1];
    assert.deepEqual(house.config, { type: 'custom:smarthomedash-card', site: 'example-house', view: 'room:bedroom' });
    assert.match(house.label, /Bedroom/);
    assert.match(house.label, /Example house/);
    assert.ok(r.climate.some((s) => s.config.site === 'example-house' && s.config.view === 'room:bedroom'));
    assert.equal(r.sensor, null);
    assert.equal(r.unknown, null);
    await close(page);
  });

  test('a lamp in a Home Assistant area linked to a room gets that room suggested', async () => {
    const page = await cardPage(env);
    const r = await page.evaluate(async () => {
      const { hass, card } = window.harness;
      // The dashboard links its bedroom to the area; the lamp is only in the area.
      const fetchWithAuth = async (path) => {
        const res = await hass.fetchWithAuth(path);
        if (!path.endsWith('example-house/site.json')) return res;
        const json = await res.json();
        json.floorplans[0].rooms.find((room) => room.id === 'bedroom').ha_area = 'bedroom_area';
        return new Response(JSON.stringify(json));
      };
      const linked = {
        ...hass,
        fetchWithAuth,
        entities: { 'light.reading': { entity_id: 'light.reading', device_id: 'd1' } },
        devices: { d1: { id: 'd1', area_id: 'bedroom_area' } },
      };
      card.suggest(linked, 'light.reading');
      for (let i = 0; i < 100 && !card.suggest(linked, 'light.reading'); i++) await new Promise((done) => setTimeout(done, 50));
      return card.suggest(linked, 'light.reading');
    });
    assert.deepEqual(r?.map((s) => s.config), [{ type: 'custom:smarthomedash-card', site: 'example-house', view: 'room:bedroom' }]);
    check(page);
    await close(page);
  });
});
