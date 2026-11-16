// Things that only go wrong over time or on a restart in place (the panel restarts the
// dashboard without reloading the page): devices removed from Home Assistant, pictures
// kept in memory, and two starts running into each other.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, open, harness, close, check } = require('./lib');

const JS = '../../custom_components/smarthomedash/frontend/js';

describe('restarts and removals', () => {
  const env = setup();

  test('an entity removed from Home Assistant leaves the store, and its watchers redraw', async () => {
    const page = await harness(env, '?site=example-house');
    const result = await page.evaluate(async (JS) => {
      const { Store } = await import(`${JS}/store.js`);
      const { createHassAdapter } = await import(`${JS}/adapters/hass.js`);
      const state = (id, s) => ({ entity_id: id, state: s, attributes: {} });
      const a = state('light.a', 'on'), b = state('light.b', 'on');
      const adapter = createHassAdapter({ states: { 'light.a': a, 'light.b': b } });
      const store = new Store();
      await adapter.connect(store, () => {});
      const seen = [];
      store.watch(['light.b'], () => seen.push(store.get('light.b')?.state ?? 'gone'));
      let other = 0;
      store.watch(['light.a'], () => other++);
      // Home Assistant hands over a new object without light.b: the entity was removed.
      adapter.setHass({ states: { 'light.a': a } });
      store.flush();
      // Removing what is not there does nothing.
      store.remove('light.nothing');
      store.flush();
      return { seen, other, size: store.size };
    }, JS);
    assert.deepEqual(result.seen, ['on', 'gone']);
    assert.equal(result.other, 1, 'watchers of other entities are left alone');
    assert.equal(result.size, 1);

    // On the dashboard itself: a lamp whose entity disappears is no longer drawn as on.
    await page.evaluate(() => { const s = window.store.get('light.bedroom'); window.store.update({ ...s, state: 'on' }); window.store.flush(); });
    await page.evaluate(() => { window.store.remove('light.bedroom'); window.store.flush(); });
    assert.equal(await page.evaluate(() => window.store.get('light.bedroom')), undefined);
    check(page);
    await close(page);
  });

  test('the websocket adapter removes an entity whose state_changed has no new state', async () => {
    const page = await open(env, 'index.html?site=example-house');
    await page.locator('.stage').waitFor();
    const left = await page.evaluate(async (JS) => {
      const { Store } = await import(`${JS.replace('../../', './')}/store.js`);
      const { createHaAdapter } = await import(`${JS.replace('../../', './')}/adapters/ha.js`);
      const Real = window.WebSocket;
      let socket;
      window.WebSocket = class { constructor() { socket = this; this.readyState = 1; } send(text) { this.sent = (this.sent ?? []).concat(JSON.parse(text)); } close() {} };
      window.WebSocket.OPEN = 1;
      try {
        const store = new Store();
        const adapter = createHaAdapter({ url: 'http://ha.invalid', token: 'x' });
        const connected = adapter.connect(store, () => {});
        const say = (m) => socket.onmessage({ data: JSON.stringify(m) });
        say({ type: 'auth_required' });
        await new Promise((r) => setTimeout(r, 0));
        say({ type: 'auth_ok' });
        const getStates = socket.sent.find((m) => m.type === 'get_states');
        say({ type: 'result', id: getStates.id, success: true, result: [{ entity_id: 'light.a', state: 'on', attributes: {} }, { entity_id: 'light.b', state: 'on', attributes: {} }] });
        await connected;
        say({ type: 'event', event: { data: { entity_id: 'light.b', old_state: { entity_id: 'light.b' }, new_state: null } } });
        store.flush();
        socket.onclose = null;
        return store.all().map((s) => s.entity_id);
      } finally { window.WebSocket = Real; }
    }, JS);
    assert.deepEqual(left, ['light.a']);
    await close(page);
  });

  test('pictures fetched through the login are released when the dashboard restarts', async () => {
    const page = await harness(env, '?site=example-house');
    const counts = await page.evaluate(async () => {
      const made = new Set(), released = new Set();
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = (b) => { const u = create.call(URL, b); made.add(u); return u; };
      URL.revokeObjectURL = (u) => { released.add(u); revoke.call(URL, u); };
      const count = () => ({ made: made.size, held: [...made].filter((u) => !released.has(u)).length });
      await (window.harness.ready = window.harness.navigateEdit(false));
      const first = count();
      await window.harness.navigateEdit(false);
      await window.harness.navigateEdit(false);
      return { first, after: count() };
    });
    assert.ok(counts.first.held > 0, 'the harness loads pictures as object URLs');
    // Three starts made three sets of addresses; only the running dashboard's are held.
    assert.equal(counts.after.made, counts.first.made * 3);
    assert.equal(counts.after.held, counts.first.held);
    // The picture on screen is the running dashboard's and can still be read.
    const shown = await page.locator('.ov-img-day').first().evaluate(async (img) => {
      const href = img.getAttribute('href');
      return href.startsWith('blob:') && (await fetch(href)).ok;
    });
    assert.ok(shown);
    check(page);
    await close(page);
  });

  test('a start overtaken by a newer one draws nothing', async () => {
    // The third read of site.json is the first start's own (the harness reads it once
    // per start before the dashboard does): hold it until the second start has finished.
    let reads = 0;
    const page = await open(env, 'tests/browser/harness.html?site=example-house', { prepare: (p) => p.route('**/sites/example-house/site.json', async (route) => {
      const n = ++reads;
      if (n === 5) await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    }) });
    await page.waitForFunction(() => window.harness && document.querySelector('.stage'));
    await page.evaluate(() => window.harness.ready);
    assert.equal(reads, 2);
    // Two restarts at once: reads 3 and 4 are the harness's, 5 the older start's (slow), 6 the newer's.
    await page.evaluate(() => { const a = window.harness.navigateEdit(false); const b = window.harness.navigateEdit(false); return Promise.all([a, b]); });
    await page.waitForTimeout(900);
    assert.equal(reads, 6);
    assert.equal(await page.locator('.stage').count(), 1);
    // The dashboard on screen is the newer start's: its Escape key closes the room it opens.
    await page.locator('.tab[data-view^="plan:"]').first().click();
    const room = page.locator('.fp.is-active .fp-room').first();
    await room.click();
    const panel = page.locator('.panel');
    await page.waitForFunction(() => document.querySelector('.panel')?.classList.contains('is-open'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.panel')?.classList.contains('is-open'));
    assert.equal(await panel.count(), 1);
    check(page);
    await close(page);
  });
});
