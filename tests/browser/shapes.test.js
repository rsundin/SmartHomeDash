// Editor comforts (roadmap S2): undo and redo in the setup guide and placement mode,
// editing a room's corners with snapping, moving a whole room, and arrow-key nudges.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, harness, close, check, centre } = require('./lib');

const UTIL = '../../custom_components/smarthomedash/frontend/js/util.js';

// Screen position of a point in the shape editor's picture coordinates.
const toScreen = (page, [x, y]) => page.locator('.shape-svg').evaluate((svg, [x, y]) => {
  const p = svg.createSVGPoint(); p.x = x; p.y = y;
  const s = p.matrixTransform(svg.getScreenCTM());
  return [s.x, s.y];
}, [x, y]);
const corners = (page) => page.locator('.shape-svg .shape-corner')
  .evaluateAll((ns) => ns.map((n) => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))]));

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  await page.mouse.up();
}

async function openGuide(page, step = null) {
  await page.locator('.top-actions .chip', { hasText: 'Setup' }).click();
  await page.locator('.setup').waitFor();
  if (step) await page.locator('.setup-step', { hasText: step }).click();
}

async function editRoom(page, name) {
  await openGuide(page, 'Floor plans');
  await page.getByRole('button', { name: `Edit the shape of ${name}` }).click();
  await page.locator('.shape-edit').waitFor();
}

async function saveGuide(page) {
  await page.locator('.setup-head .chip', { hasText: 'Save' }).click();
  await page.waitForFunction(() => window.harness.saved.length === 1);
  const saved = await page.evaluate(() => window.harness.saved[0]);
  await page.waitForFunction(() => window.harness.starts === 2);
  await page.evaluate(() => window.harness.ready);
  return saved;
}
const roomIn = (cfg, id) => cfg.floorplans.flatMap((p) => p.rooms).find((r) => r.id === id);

describe('editor comforts', () => {
  const env = setup();

  test('snapping and history helpers', async () => {
    const page = await harness(env, '?site=example-house');
    const r = await page.evaluate(async (url) => {
      const { snapPoint, snapShift, createHistory } = await import(url);
      const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
      const h = createHistory({ limit: 2 });
      h.push('a'); h.push('b'); h.push('c');
      const back = [h.back('d'), h.back('c'), h.back('b')];
      const fwd = h.forward('b');
      return {
        corner: snapPoint([104, 3], [square], 10),
        edge: snapPoint([50, 106], [square], 10),
        free: snapPoint([50, 130], [square], 10),
        shift: snapShift([[206, 3], [300, 3], [300, 100]], [square, [[200, 0], [210, 0], [210, 10]]], 10),
        back, fwd, redoLeft: h.redo.length,
      };
    }, UTIL);
    assert.deepEqual(r.corner, { at: [100, 0], to: 'corner' });
    assert.deepEqual(r.edge, { at: [50, 100], to: 'edge' });
    assert.deepEqual(r.free, { at: [50, 130], to: null });
    assert.deepEqual(r.shift, [4, -3], 'the nearest pair of corners wins');
    assert.deepEqual(r.back, ['c', 'b', null], 'keeps the last two steps');
    assert.equal(r.fwd, 'c');
    assert.equal(r.redoLeft, 1);
    check(page);
    await close(page);
  });

  test('undo and redo in the setup guide', async () => {
    const page = await harness(env, '?site=example-house');
    await openGuide(page, 'Basics');
    const name = page.locator('.setup-body input.setup-input').first();
    const currency = page.locator('.setup-body input.setup-input').nth(1);
    const undo = page.locator('.setup-head .setup-undo');
    const redo = page.locator('.setup-head .setup-redo');
    assert.equal(await undo.isDisabled(), true, 'nothing to undo yet');
    const before = await name.inputValue();

    await name.fill('Test house');
    await name.press('End');
    await name.pressSequentially(' two');
    await currency.fill('EUR');
    await page.locator('.setup-status', { hasText: 'Unsaved changes' }).waitFor();

    // Typing in one field is one step.
    await undo.click();
    assert.equal(await page.locator('.setup-body input.setup-input').nth(1).inputValue(), 'SEK');
    assert.equal(await page.locator('.setup-body input.setup-input').first().inputValue(), 'Test house two');
    await undo.click();
    assert.equal(await page.locator('.setup-body input.setup-input').first().inputValue(), before);
    assert.equal(await undo.isDisabled(), true);

    // Redo with the keyboard, from outside a text field.
    await page.locator('.setup-body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+Shift+Z');
    assert.equal(await page.locator('.setup-body input.setup-input').first().inputValue(), 'Test house two');
    await page.keyboard.press('Control+z');
    assert.equal(await redo.isDisabled(), false);

    // Back where it started, Close does not ask.
    await page.locator('.setup-head .chip', { hasText: 'Close' }).click();
    assert.equal(await page.locator('.setup').count(), 0, 'nothing left to save');
    assert.equal(await page.evaluate(() => window.harness.saved.length), 0);
    check(page);
    await close(page);
  });

  test('drag a corner onto another room, with and without snapping', async () => {
    const page = await harness(env, '?site=example-house');
    await editRoom(page, 'Office');
    // The office's top left corner [460, 445] goes near the hall's corner [455, 440].
    assert.deepEqual((await corners(page))[0], [460, 445]);
    const target = await toScreen(page, [452, 437]);
    await drag(page, await centre(page.locator('.shape-corner').first()), target);
    assert.deepEqual((await corners(page))[0], [455, 440], 'snapped to the corner');
    await page.locator('.shape-msg', { hasText: 'Snapped to a corner' }).waitFor();

    // Undo inside the editor, then again with Snap off.
    await page.locator('.shape-edit .chip', { hasText: 'Undo' }).click();
    assert.deepEqual((await corners(page))[0], [460, 445]);
    await page.locator('.shape-edit .draw-snap input').uncheck();
    await drag(page, await centre(page.locator('.shape-corner').first()), target);
    const free = (await corners(page))[0];
    assert.notDeepEqual(free, [455, 440], 'not snapped');
    assert.ok(Math.abs(free[0] - 452) <= 3 && Math.abs(free[1] - 437) <= 3, `follows the pointer: ${free}`);
    await page.locator('.shape-edit .draw-snap input').check(); // remembered: leave it on

    await page.locator('.shape-edit .chip', { hasText: 'Done' }).click();
    const saved = await saveGuide(page);
    assert.deepEqual(roomIn(saved, 'office').area[0], free);
    check(page);
    await close(page);
  });

  test('add a corner on an edge and remove one with a long press', async () => {
    const page = await harness(env, '?site=example-house');
    await editRoom(page, 'Bedroom');
    assert.equal((await corners(page)).length, 4);

    // The dot on the top edge becomes a corner, dragged up off the edge.
    const mid = page.locator('.shape-mid').first();
    const [mx, my] = await centre(mid);
    await drag(page, [mx, my], [mx, my - 30]);
    const after = await corners(page);
    assert.equal(after.length, 5);
    assert.ok(after[1][1] < 80, `the new corner sits above the edge: ${after[1]}`);

    // Hold it: it goes again.
    const [cx, cy] = await centre(page.locator('.shape-corner').nth(1));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    assert.equal((await corners(page)).length, 4);
    await page.locator('.shape-msg', { hasText: 'Corner removed' }).waitFor();

    // Down to three, then a fourth removal is refused (right-click this time).
    await page.locator('.shape-corner').first().click({ button: 'right' });
    assert.equal((await corners(page)).length, 3);
    await page.locator('.shape-corner').first().click({ button: 'right' });
    assert.equal((await corners(page)).length, 3);
    await page.locator('.shape-msg', { hasText: 'at least three corners' }).waitFor();
    await page.locator('.shape-edit .chip', { hasText: 'Cancel' }).click();
    assert.equal(await page.locator('.setup-head .setup-undo').isDisabled(), true, 'Cancel changes nothing');
    check(page);
    await close(page);
  });

  test('move a whole room, with the arrow keys too; its lamps go along', async () => {
    const page = await harness(env, '?site=example-house');
    await editRoom(page, 'Office');
    await page.locator('.shape-edit .draw-snap input').uncheck();
    const before = await corners(page);
    // Drag from inside the room, away from the corners and the lamp.
    const from = await toScreen(page, [520, 520]);
    const to = await toScreen(page, [520, 500]);
    await drag(page, from, to);
    const dragged = await corners(page);
    const dy = dragged[0][1] - before[0][1];
    assert.ok(dy < -10 && dragged.every((c, i) => c[0] === before[i][0] && c[1] - before[i][1] === dy), `moved as one: ${dragged}`);

    // The room is selected: arrows nudge all of it, Shift ten steps.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    assert.deepEqual((await corners(page))[0], [before[0][0] + 11, before[0][1] + dy]);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await corners(page))[0], [before[0][0] + 1, before[0][1] + dy], 'undo in the editor');

    await page.locator('.shape-edit .draw-snap input').check();
    await page.locator('.shape-edit .chip', { hasText: 'Done' }).click();
    // The guide's own undo brings the old shape back, and redo the new one.
    await page.locator('.setup-head .setup-undo').click();
    await page.locator('.setup-head .setup-redo').click();
    const saved = await saveGuide(page);
    const office = roomIn(saved, 'office');
    assert.deepEqual(office.area[0], [before[0][0] + 1, before[0][1] + dy]);
    assert.deepEqual(office.lights[0].at, [600 + 1, 620 + dy], 'the lamp moved with the room');
    check(page);
    await close(page);
  });

  test('a building on the overview picture can be edited too', async () => {
    const page = await harness(env, '?site=example-house');
    await openGuide(page, 'Overview picture');
    await page.getByRole('button', { name: 'Edit the shape of Garage' }).click();
    await page.locator('.shape-edit.shape-building').waitFor();
    assert.equal((await corners(page)).length, 7);
    await page.locator('.shape-corner').first().click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Delete');
    assert.equal((await corners(page)).length, 6);
    await page.locator('.shape-edit .chip', { hasText: 'Done' }).click();
    const saved = await saveGuide(page);
    assert.equal(saved.overview.buildings.find((b) => b.id === 'garage').area.length, 6);
    check(page);
    await close(page);
  });

  test('undo, redo and arrow keys in placement mode', async () => {
    const page = await harness(env, '?site=example-house&edit');
    await page.locator('aside.editor').waitFor();
    await page.locator('.views .tab[data-view="plan:house"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await page.waitForTimeout(600);
    const id = 'light.office';
    const at = () => page.evaluate((id) => {
      const d = JSON.parse(localStorage.getItem('shd:example-house:draft'));
      return d.floorplans.flatMap((p) => p.rooms).flatMap((r) => r.lights).find((l) => l.entity === id).at;
    }, id);
    const restarted = async (n) => {
      await page.waitForFunction((n) => window.harness.starts >= n, n);
      await page.evaluate(() => window.harness.ready);
      await page.locator('aside.editor').waitFor();
    };
    assert.equal(await page.locator('aside.editor .editor-undo').isDisabled(), true);

    // Select the office lamp and nudge it: three steps right and ten down.
    await page.locator('aside.editor .editor-ent', { hasText: id }).click();
    await page.locator('aside.editor .editor-search').blur();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await restarted(2);
    assert.deepEqual(await at(), [603, 630]);

    // Undo puts it back, redo moves it again; each restarts on the draft.
    await page.locator('aside.editor .editor-undo').click();
    await restarted(3);
    assert.deepEqual(await at(), [600, 620]);
    assert.equal(await page.locator('aside.editor .editor-redo').isDisabled(), false);
    await page.keyboard.press('Control+Shift+Z');
    await restarted(4);
    assert.deepEqual(await at(), [603, 630]);
    assert.equal(await page.locator('aside.editor .editor-redo').isDisabled(), true);

    // Saving to Home Assistant ends the history.
    await page.locator('aside.editor .chip', { hasText: 'Save to Home Assistant' }).click();
    await restarted(5);
    assert.equal(await page.evaluate(() => localStorage.getItem('shd:example-house:edithistory')), null);
    assert.equal(await page.locator('aside.editor .editor-undo').isDisabled(), true);
    check(page);
    await close(page);
  });
});
