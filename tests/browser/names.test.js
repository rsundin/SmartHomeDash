// Names as Home Assistant shows them (2026.11 naming): nameOf() in entities.js, and
// the names the panel shows for entities on a device.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const ENTITIES = '../../custom_components/smarthomedash/frontend/js/entities.js';

describe('names', () => {
  const env = setup();

  test('nameOf: site.json, then the registry, then friendly_name, then the entity id', async () => {
    const page = await harness(env, '?site=example-house');
    const r = await page.evaluate(async (url) => {
      const { nameOf } = await import(url);
      const states = new Map([
        ['light.ceiling', { entity_id: 'light.ceiling', attributes: { friendly_name: 'Old ceiling' } }],
        ['light.lamp', { entity_id: 'light.lamp', attributes: { friendly_name: 'Lamp from state' } }],
        ['sensor.plain', { entity_id: 'sensor.plain', attributes: {} }],
      ]);
      const store = { get: (id) => states.get(id) };
      const areas = {
        // The panel's hass.entities: name is already resolved.
        entityReg: new Map([
          ['light.ceiling', { entity_id: 'light.ceiling', name: 'Ceiling', device_id: 'kitchen', has_entity_name: true }],
          ['light.kitchen', { entity_id: 'light.kitchen', name: null, device_id: 'kitchen', has_entity_name: true }],
          ['light.legacy', { entity_id: 'light.legacy', name: 'Hall spots', device_id: 'kitchen', has_entity_name: false }],
          ['light.prefixed', { entity_id: 'light.prefixed', name: 'Kitchen island', device_id: 'kitchen', has_entity_name: true }],
          ['light.renamed', { entity_id: 'light.renamed', name: 'Ceiling', device_id: 'renamed', has_entity_name: true }],
          // The websocket entity registry: the integration's name in original_name.
          ['light.ws', { entity_id: 'light.ws', name: null, original_name: 'Spots', device_id: 'kitchen', has_entity_name: true }],
          ['light.nodevice', { entity_id: 'light.nodevice', name: 'Garden', device_id: null }],
        ]),
        deviceReg: new Map([
          ['kitchen', { id: 'kitchen', name: 'Kitchen', name_by_user: null }],
          ['renamed', { id: 'renamed', name: 'Hue bridge 2', name_by_user: 'Office' }],
        ]),
      };
      const site = { index: { labels: new Map([['light.lamp', 'Reading lamp'], ['light.ceiling', 'Ceiling light']]) }, areas };
      const n = (id, ctx = { store, site }, fb) => nameOf(id, ctx, fb);
      return {
        label: n('light.lamp'),
        labelBeatsRegistry: n('light.ceiling'),
        device: n('light.ceiling', { store, areas }),
        deviceOnly: n('light.kitchen', { store, areas }),
        legacy: n('light.legacy', { store, areas }),
        prefixed: n('light.prefixed', { store, areas }),
        byUser: n('light.renamed', { store, areas }),
        ws: n('light.ws', { store, areas }),
        noDevice: n('light.nodevice', { store, areas }),
        friendly: n('light.lamp', { store, areas }),
        id: n('sensor.plain', { store, areas }),
        fallback: n('sensor.plain', { store, areas }, 'Living room'),
        missing: n('sensor.gone', {}),
      };
    }, ENTITIES);
    assert.deepEqual(r, {
      label: 'Reading lamp',
      labelBeatsRegistry: 'Ceiling light',
      device: 'Kitchen Ceiling',
      deviceOnly: 'Kitchen',
      legacy: 'Hall spots',
      prefixed: 'Kitchen island',
      byUser: 'Office Ceiling',
      ws: 'Kitchen Spots',
      noDevice: 'Garden',
      friendly: 'Lamp from state',
      id: 'sensor.plain',
      fallback: 'Living room',
      missing: 'sensor.gone',
    });
    check(page);
    await close(page);
  });

  test('the room panel names a sensor on a device as Home Assistant does', async () => {
    const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
    site.mock.devices = [{ id: 'window_contact', name: 'Bedroom window sensor', entities: { 'binary_sensor.bedroom_window': 'Contact' } }];
    const prepare = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
    const page = await harness(env, '?site=example-house', { prepare });
    // friendly_name is going away: a stale one must not win over the registry.
    await page.evaluate(() => {
      const s = window.store.get('binary_sensor.bedroom_window');
      window.store.update({ ...s, attributes: { ...s.attributes, friendly_name: 'Stale name' } });
    });
    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.locator('.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]').click();
    const status = page.locator('aside.panel .status-list');
    await status.locator('li', { hasText: 'Bedroom window sensor Contact' }).waitFor();
    assert.equal(await status.locator('li', { hasText: 'Stale name' }).count(), 0);
    check(page);
    await close(page);
  });
});
