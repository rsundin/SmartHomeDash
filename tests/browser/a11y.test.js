// Accessibility: an automated check (axe-core) on both examples, the keyboard alone,
// names and states for screen readers, contrast of the text on the picture, and the
// text size setting.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SITES, setup, harness, close, check, assertNoOverflow } = require('./lib');

const AXE = require.resolve('axe-core/axe.min.js');

// Every rule axe-core has, on the whole page. Text on a photo cannot be judged by it
// (it reports those as "incomplete"); the contrast test further down covers them.
async function assertAccessible(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(' ')}`).join('\n')}`));
  assert.deepEqual(found, [], `${label}: accessibility violations`);
}

const settled = (page) => page.evaluate(() => new Promise((done) => { window.store.flush?.(); requestAnimationFrame(() => requestAnimationFrame(done)); }));

// Tab until the focused element matches; fails if it never comes.
async function tabTo(page, selector, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return;
  }
  assert.fail(`Tab never reached ${selector}`);
}

describe('accessibility', () => {
  const env = setup();

  for (const site of SITES) {
    for (const size of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }]) {
      test(`axe-core finds nothing on ${site}, ${size.name}: start view, floor plan, room panel, evening`, async () => {
        const page = await harness(env, `?site=${site}`, size);
        await settled(page);
        await assertAccessible(page, 'start view');
        const house = page.locator('.ov-bld[aria-label*="House"]');
        if (await house.count()) {
          await house.click();
          await page.waitForFunction(() => document.querySelector('.stage').dataset.view.startsWith('plan:'));
          await assertAccessible(page, 'floor plan');
        }
        await page.locator('.fp.is-active .fp-room[aria-label="Bedroom"]').click();
        await page.locator('aside.panel.is-open .panel-title', { hasText: 'Bedroom' }).waitFor();
        await page.locator('aside.panel .tchart, aside.panel .light-list').first().waitFor();
        await page.waitForTimeout(450); // the panel slides in; a half-moved panel is not what a user reads
        await assertAccessible(page, 'room panel');
        await page.keyboard.press('Escape');
        // Evening: the picture darkens, the text must not.
        await page.locator('.top-actions .chip', { hasText: /Auto/ }).click();
        await page.locator('.stage.is-night').waitFor();
        await page.waitForTimeout(450);
        await assertAccessible(page, 'evening');
        check(page);
        await close(page);
      });
    }
  }

  test('with the keyboard alone: open the house, open a room, switch its lamp, and come back', async () => {
    const page = await harness(env, '?site=example-house');
    // The closed room panel is not on the way.
    assert.equal(await page.locator('aside.panel').evaluate((n) => n.inert), true);

    await tabTo(page, '.ov-bld[aria-label*="House"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');

    await tabTo(page, '.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]');
    await page.keyboard.press('Space');
    await page.locator('aside.panel.is-open .panel-title', { hasText: 'Bedroom' }).waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('aside.panel').contains(document.activeElement)), 'focus moved into the panel');

    const before = await page.evaluate(() => window.store.get('light.bedroom').state);
    await tabTo(page, 'aside.panel .light-list .switch');
    assert.ok(await page.evaluate(() => {
      const n = document.activeElement;
      return n.matches(':focus-visible') && getComputedStyle(n).outlineStyle !== 'none';
    }), 'focus is visible');
    await page.keyboard.press('Space');
    await page.waitForFunction((b) => window.store.get('light.bedroom').state !== b, before);
    await settled(page);
    assert.equal(await page.locator(':focus').getAttribute('aria-checked'), String(before !== 'on'));

    // Escape closes the panel and focus returns to the room it was opened from.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('aside.panel').classList.contains('is-open'));
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Bedroom');
    assert.equal(await page.locator('aside.panel').evaluate((n) => n.inert), true);

    // A lamp on the plan: Enter switches it; Escape again goes back to the overview.
    await tabTo(page, '.fp[data-plan="house"] .fp-lamp[data-entity="light.bedroom"]');
    const mid = await page.evaluate(() => window.store.get('light.bedroom').state);
    await page.keyboard.press('Enter');
    await page.waitForFunction((b) => window.store.get('light.bedroom').state !== b, mid);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'overview');
    check(page);
    await close(page);
  });

  test('screen readers get names and states: lamps, rooms, outdoor lamps and both graphs', async () => {
    const page = await harness(env, '?site=example-house');
    await settled(page);
    // An outdoor lamp on the overview says whether it is on.
    const zone = page.locator('.ov-zonehit').first();
    assert.match(await zone.getAttribute('aria-label'), /\S/);
    const zoneOn = await zone.getAttribute('aria-pressed');
    assert.ok(['true', 'false'].includes(zoneOn));
    await zone.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((was) => document.querySelector('.ov-zonehit').getAttribute('aria-pressed') !== was, zoneOn);

    // The price graph in words, with the same numbers as the card shows.
    const price = await page.locator('.pbars').getAttribute('aria-label');
    assert.match(price, /Lowest \d+\.\d\d at \d\d:\d\d, highest \d+\.\d\d at \d\d:\d\d/);

    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await settled(page);
    const room = page.locator('.fp[data-plan="house"] .fp-room[aria-label="Bedroom"]');
    assert.equal(await room.getAttribute('role'), 'button');
    assert.match(await room.getAttribute('aria-description'), /^\d+[.,]\d°$/, 'the room says its temperature');

    const lamp = page.locator('.fp[data-plan="house"] .fp-lamp[data-entity="light.bedroom"]');
    for (const state of ['off', 'on']) {
      await page.evaluate((s) => window.store.update({ ...window.store.get('light.bedroom'), state: s }), state);
      await settled(page);
      assert.equal(await lamp.getAttribute('aria-pressed'), String(state === 'on'));
    }

    await room.click();
    const chart = page.locator('aside.panel .tchart');
    await chart.waitFor();
    assert.equal(await chart.getAttribute('role'), 'img');
    assert.match(await chart.getAttribute('aria-label'), /Now \d+[.,]\d°, lowest \d+[.,]\d°, highest \d+[.,]\d°/);
    check(page);
    await close(page);
  });

  test('text on the picture keeps its contrast, day and evening', async () => {
    const page = await harness(env, '?site=example-house');
    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await settled(page);
    // Each text against what is drawn right behind it: its pill, or the dark edge around
    // the letters. Where that backing lets the photo through, the photo is taken as white,
    // the worst it can be.
    const measure = () => page.evaluate(() => {
      const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); const p = m ? m[1].split(/[ ,/]+/).map(Number) : [0, 0, 0, 0]; return [p[0], p[1], p[2], p[3] ?? 1]; };
      const lum = ([r, g, b]) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
      const over = (c, a) => c.slice(0, 3).map((v) => v * a + 255 * (1 - a));
      const ratio = (fg, bg) => { const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      const out = [];
      const add = (label, text, backing, alpha) => {
        const fill = rgba(getComputedStyle(text).fill);
        out.push([label, Number(ratio(fill, over(rgba(backing), alpha)).toFixed(2))]);
      };
      for (const tag of document.querySelectorAll('.ov-flow-tag.is-on, .ov-tag')) {
        const rect = getComputedStyle(tag.querySelector('rect'));
        for (const text of tag.querySelectorAll('tspan, text:not(:has(tspan))')) {
          if (text.textContent.trim()) add(`${tag.getAttribute('class')} ${text.getAttribute('class') ?? 'text'}`, text, rect.fill, Number(rect.fillOpacity) * rgba(rect.fill)[3]);
        }
      }
      for (const text of document.querySelectorAll('.fp.is-active .fp-name, .fp.is-active .fp-temp')) {
        const cs = getComputedStyle(text);
        if (text.textContent.trim()) add(text.getAttribute('class'), text, cs.stroke, rgba(cs.stroke)[3]);
      }
      return out;
    });
    for (const when of ['day', 'evening']) {
      const found = await measure();
      assert.ok(found.length >= 10, `labels were measured (${found.length})`);
      const low = found.filter(([, r]) => r < 4.5);
      assert.deepEqual(low, [], `${when}: text on the picture under 4.5:1`);
      if (when === 'day') {
        await page.locator('.top-actions .chip', { hasText: /Auto/ }).click();
        await page.locator('.stage.is-night').waitFor();
        await settled(page);
      }
    }
    check(page);
    await close(page);
  });

  test('text size: the button steps through three sizes and the device remembers', async () => {
    const page = await harness(env, '?site=example-house');
    const btn = page.locator('.top-actions .chip-text');
    assert.equal(await btn.getAttribute('aria-label'), 'Text size: normal');
    const sizeOf = (sel) => page.locator(sel).first().evaluate((n) => { const b = n.getBoundingClientRect(); return [b.width, b.height]; });
    const normal = { sw: await sizeOf('.side .switch'), title: await sizeOf('.brand h1'), tag: await sizeOf('.ov-flow-tag.is-on rect') };

    await btn.click();
    assert.equal(await page.evaluate(() => document.body.dataset.text), 'large');
    assert.equal(await btn.getAttribute('aria-label'), 'Text size: large');
    await btn.click();
    assert.equal(await page.evaluate(() => document.body.dataset.text), 'xlarge');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shd:text'))), 'xlarge');
    await settled(page);
    // Text and touch targets grow by 30 %. The labels on the picture grow too, a little
    // less on this screen because the wider cards leave the picture less room.
    for (const [name, sel] of [['sw', '.side .switch'], ['title', '.brand h1']]) {
      const grew = (await sizeOf(sel))[1] / normal[name][1];
      assert.ok(Math.abs(grew - 1.3) < 0.04, `${sel} is 30 % higher (${grew.toFixed(2)})`);
    }
    const tag = (await sizeOf('.ov-flow-tag.is-on rect'))[1] / normal.tag[1];
    assert.ok(tag > 1.1, `the labels on the picture are larger (${tag.toFixed(2)})`);

    // Still there after a reload; one more press is back to normal.
    await page.reload();
    await page.waitForFunction(() => window.harness && window.store && document.querySelector('.stage'));
    assert.equal(await page.evaluate(() => document.body.dataset.text), 'xlarge');
    await page.locator('.top-actions .chip-text').click();
    assert.equal(await page.evaluate(() => document.body.dataset.text ?? null), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('shd:text')), '"normal"');
    check(page);
    await close(page);
  });

  for (const site of SITES) {
    for (const text of ['large', 'xlarge']) {
      test(`${text} text on a 390 px phone, ${site}: nothing sticks out, the room panel fits`, async () => {
        const page = await harness(env, `?site=${site}`, { width: 390, height: 844, touch: true, storage: { 'shd:text': text } });
        assert.equal(await page.evaluate(() => document.body.dataset.text), text);
        await settled(page);
        await assertNoOverflow(page, `${site} ${text}`);
        // Nothing inside the header or the cards is cut off sideways either.
        const cut = await page.evaluate(() => [...document.querySelectorAll('.top *, .side *, .alerts *')]
          .filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > innerWidth + 1)
          .map((n) => `${n.tagName.toLowerCase()}.${n.className}`));
        assert.deepEqual(cut, [], 'elements past the right edge');

        const house = page.locator('.ov-bld[aria-label*="House"]');
        if (await house.count()) {
          await house.click();
          await page.waitForFunction(() => document.querySelector('.stage').dataset.view.startsWith('plan:'));
        }
        await page.locator('.fp.is-active .fp-room[aria-label="Bedroom"]').click();
        await page.locator('aside.panel.is-open .panel-title', { hasText: 'Bedroom' }).waitFor();
        await page.waitForTimeout(450);
        const panel = await page.locator('aside.panel').boundingBox();
        assert.ok(panel.x >= -1 && panel.x + panel.width <= 391, `the panel is on screen (${panel.x} to ${panel.x + panel.width})`);
        const inner = await page.locator('aside.panel').evaluate((n) => [n.scrollWidth, n.clientWidth]);
        assert.ok(inner[0] <= inner[1], `nothing in the panel scrolls sideways (${inner})`);
        await assertNoOverflow(page, `${site} ${text} with the room panel`);
        check(page);
        await close(page);
      });
    }
  }
});
