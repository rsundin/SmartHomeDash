// Performance budget on a large site (tests/fixtures/perf-site.js: 3 floor plans,
// 40 rooms, 120 lamps, 60 sensors), in Chromium with the CPU slowed down 4×, as on an
// old wall tablet:
// - under 4,000 DOM nodes on the overview
// - first render under 2 s
// - no long task over 100 ms in 30 s of state changes (a batch every 2 s)
// Also checks that a hidden page or the night dim pauses animations, and that light
// mode draws without filters, blending or animation.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');
const { perfSite } = require('../fixtures/perf-site');

const BUDGET = { nodes: 4000, firstRenderMs: 2000, longTaskMs: 100 };
const CHURN_MS = 30000;

// Serves the generated site at sites/perf-site/, with the house example's pictures.
function serveSite(edit = (s) => s) {
  const site = edit(perfSite());
  return async (page) => {
    await page.route('**/sites/perf-site/**', (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      if (name === 'site.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) });
      const file = path.join(ROOT, 'sites', 'example-house', name);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: file });
    });
  };
}

// Slows the CPU and records long tasks from the start.
const throttled = (prepare) => async (page) => {
  await prepare(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
};

describe('performance', () => {
  const env = setup();

  test('large site stays within the budget, throttled 4×', { timeout: 90000 }, async () => {
    const page = await harness(env, '?site=perf-site', { width: 1280, height: 800, prepare: throttled(serveSite()) });
    // First render: the first frame after the dashboard was built, from the start of navigation.
    const firstRender = await page.evaluate(() => new Promise((resolve) => {
      const mark = performance.getEntriesByName('shd:rendered')[0];
      if (mark) resolve(mark.startTime);
      else requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
    }));
    const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);

    // Let start-up settle, then change states the way a busy home does.
    await page.waitForTimeout(2000);
    const t0 = await page.evaluate((ms) => {
      const store = window.store;
      const ids = store.all().map((s) => s.entity_id).filter((id) => /^(light|sensor|binary_sensor|climate)\./.test(id));
      let n = 0;
      const batch = () => {
        // About 40 changes every 2 s: lamps switching, temperatures drifting, doors and motion.
        for (let i = 0; i < 40; i++) {
          const id = ids[(n * 41 + i * 7) % ids.length];
          const s = store.get(id);
          if (!s) continue;
          if (id.startsWith('light.')) store.update({ ...s, state: s.state === 'on' ? 'off' : 'on', attributes: { ...s.attributes, brightness: s.state === 'on' ? null : 200 } });
          else if (id.startsWith('binary_sensor.')) store.update({ ...s, state: s.state === 'on' ? 'off' : 'on' });
          else if (id.startsWith('climate.')) store.update({ ...s, attributes: { ...s.attributes, current_temperature: 19 + ((n + i) % 40) / 10 } });
          else store.update({ ...s, state: String(Number(s.state) + 0.1 || 1) });
        }
        n++;
      };
      window.__churn = setInterval(batch, 2000);
      setTimeout(() => clearInterval(window.__churn), ms);
      return performance.now();
    }, CHURN_MS);
    await page.waitForTimeout(CHURN_MS + 500);
    const tasks = await page.evaluate((from) => window.__longTasks.filter((t) => t.start >= from), t0);
    const longest = Math.max(0, ...tasks.map((t) => t.ms));
    console.log(`perf: ${nodes} DOM nodes, first render ${Math.round(firstRender)} ms, longest task ${Math.round(longest)} ms (${tasks.length} over 50 ms)`);

    assert.ok(nodes < BUDGET.nodes, `overview has ${nodes} DOM nodes, budget ${BUDGET.nodes}`);
    assert.ok(firstRender < BUDGET.firstRenderMs, `first render took ${Math.round(firstRender)} ms, budget ${BUDGET.firstRenderMs}`);
    assert.ok(longest <= BUDGET.longTaskMs, `longest task in steady state ${Math.round(longest)} ms, budget ${BUDGET.longTaskMs}`);
    check(page);
    await close(page);
  });

  test('a hidden page and the night dim pause animations', { timeout: 30000 }, async () => {
    // Dim at any time of day, one second after the last touch.
    const idle = (site) => ({ ...site, wall_screen: { idle: { back_after: 1, dim_from: '00:00', dim_to: '23:59' } } });
    const page = await harness(env, '?site=perf-site&kiosk', { width: 1080, height: 810, touch: true, prepare: serveSite(idle) });
    // Looping CSS animations; a one-off transition just finishes.
    const running = () => page.evaluate(() => document.getAnimations().filter((a) => a instanceof CSSAnimation && a.playState === 'running').length);
    assert.ok(await running() > 0, 'the overview animates');
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-paused')), false);

    await page.waitForFunction(() => document.body.classList.contains('is-dimmed'), null, { timeout: 15000 });
    assert.ok(await page.evaluate(() => document.body.classList.contains('is-paused')), 'the dim pauses the page');
    assert.equal(await running(), 0, 'no animation runs under the dim');
    assert.ok(await page.locator('.ov-upper').evaluate((n) => n.animationsPaused()), 'SVG animations pause too');

    // A touch wakes it and everything runs again.
    await page.locator('.idle-dim').tap();
    await page.waitForFunction(() => !document.body.classList.contains('is-paused'));
    assert.ok(await running() > 0);
    assert.equal(await page.locator('.ov-upper').evaluate((n) => n.animationsPaused()), false);

    // A hidden page (another tab, a switched-off screen) pauses the same way.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.ok(await page.evaluate(() => document.body.classList.contains('is-paused')));
    assert.equal(await running(), 0);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-paused')), false);
    check(page);
    await close(page);
  });

  test('light mode draws without filters, blending or animation', async () => {
    const page = await harness(env, '?site=example-house&lite', { width: 1280, height: 800 });
    assert.ok(await page.evaluate(() => document.body.classList.contains('is-lite')));
    const heavy = () => page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll('*')) {
        const cs = getComputedStyle(n);
        if (cs.filter !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none') || cs.mixBlendMode !== 'normal') {
          out.push(`${n.tagName.toLowerCase()}.${n.getAttribute('class') ?? ''}: ${cs.filter} ${cs.backdropFilter} ${cs.mixBlendMode}`);
        }
      }
      return { out, animations: document.getAnimations().length, smil: [...document.querySelectorAll('svg.ov-upper')].every((s) => s.animationsPaused()) };
    });
    // In the evening too, on the overview and on a floor plan.
    await page.locator('.top-actions .chip', { hasText: /Auto/ }).click();
    await page.waitForFunction(() => document.querySelector('.stage').classList.contains('is-night'));
    let r = await heavy();
    assert.deepEqual(r.out, [], 'no filters or blending on the overview');
    assert.equal(r.animations, 0, 'no animations');
    assert.ok(r.smil, 'SVG animations stopped');
    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    r = await heavy();
    assert.deepEqual(r.out, [], 'no filters or blending on the floor plan');
    assert.equal(r.animations, 0);
    check(page);
    await close(page);
  });
});
