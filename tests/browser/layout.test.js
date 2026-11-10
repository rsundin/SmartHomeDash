// Both examples on the standalone page at five screen sizes, in normal and kiosk mode:
// they start without console errors and nothing sticks out sideways.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SIZES, SITES, setup, open, close, check, assertNoOverflow } = require('./lib');

describe('layout', () => {
  const env = setup();

  for (const site of SITES) {
    for (const size of SIZES) {
      test(`${site} at ${size.width}×${size.height} (${size.name})`, async () => {
        const page = await open(env, `index.html?site=${site}&mock`, size);
        await page.locator('.stage .view.is-active').first().waitFor();
        await page.waitForTimeout(400); // fonts and pictures
        await assertNoOverflow(page, `${site} ${size.name}`);
        const views = await page.locator('.stage .view').count();
        assert.ok(views >= 1, 'a picture or floor plan is drawn');
        // The open view fills a real area of the screen.
        const box = await page.locator('.stage').boundingBox();
        assert.ok(box.width > size.width * 0.5 && box.height > 150, `stage is ${box.width}×${box.height}`);
        check(page);
        await close(page);
      });
    }

    test(`${site} in kiosk mode`, async () => {
      for (const size of [SIZES[2], SIZES[4]]) {
        const page = await open(env, `index.html?site=${site}&mock&kiosk`, size);
        await page.locator('.stage .view.is-active').first().waitFor();
        assert.ok(await page.evaluate(() => document.body.classList.contains('is-kiosk')));
        await assertNoOverflow(page, `${site} kiosk ${size.name}`);
        check(page);
        await close(page);
      }
    });
  }
});
