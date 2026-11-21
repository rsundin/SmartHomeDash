// The site.json format (roadmap V1): a file without "format" is format 1 and is saved
// with it; a file from a newer PlanView Dash is shown but never saved over.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const JS = '../../custom_components/planview_dash/frontend/js';

// The example house in English with the guide opening by itself, as `format` says.
function site(format) {
  const { format: _, ...s } = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
  return { ...(format === undefined ? {} : { format }), ...s, language: 'en', locale: 'en-GB', setup_pending: true };
}
const serve = (format) => (page) => page.route('**/sites/example-house/site.json',
  (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site(format)) }));

describe('site.json format', () => {
  const env = setup();

  test('a file from before the format is saved as format 1, with format first', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve(undefined) });
    await page.locator('.setup').waitFor();
    assert.equal(await page.evaluate(() => window.__pvdRun.site.raw.format), 1, 'upgraded on load');
    await page.locator('.setup .chip-primary', { hasText: 'Save' }).first().click();
    await page.waitForFunction(() => window.harness.saved.length === 1);
    const saved = await page.evaluate(() => window.harness.saved[0]);
    assert.equal(saved.format, 1);
    assert.equal(Object.keys(saved)[0], 'format');
    assert.equal(saved.name, site().name, 'nothing else changed');
    check(page);
    await close(page);
  });

  test('a file from a newer version is shown, with a message, and never saved', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve(7) });
    const banner = page.locator('.banner[role="alert"]', { hasText: 'newer version' });
    await banner.waitFor();
    assert.match(await banner.innerText(), /format 7/);
    assert.ok(await page.locator('.stage').isVisible(), 'the picture is still shown');
    assert.equal(await page.locator('.setup').count(), 0, 'the setup guide does not open');
    // Placement mode can copy the file but not save it.
    await page.evaluate(() => window.harness.navigateEdit(true));
    await page.locator('button', { hasText: 'Copy site.json' }).waitFor();
    assert.equal(await page.locator('button', { hasText: 'Save to Home Assistant' }).count(), 0);
    assert.equal(await page.evaluate(() => window.__pvdRun.site.raw.format), 7, 'left as it was');
    assert.deepEqual(await page.evaluate(() => window.harness.saved), []);
    check(page);
    await close(page);
  });

  test('formatOf and migrate', async () => {
    const page = await harness(env, '?site=example-house');
    const out = await page.evaluate(async (JS) => {
      const { formatOf, migrate, FORMAT } = await import(`${JS}/site.js`);
      const raw = { name: 'Old', floorplans: [] };
      const same = migrate(raw) === raw;
      return {
        FORMAT,
        formats: [{}, { format: 1 }, { format: 3 }, { format: '1' }, { format: 0 }, { format: 1.5 }, { format: true }].map(formatOf),
        migrated: Object.entries(raw), same,
        newer: migrate({ format: FORMAT + 1, name: 'New' }),
        again: migrate(migrate({ name: 'Twice' })),
      };
    }, JS);
    assert.equal(out.FORMAT, 1);
    assert.deepEqual(out.formats, [1, 1, 3, null, null, null, null]);
    assert.deepEqual(out.migrated, [['format', 1], ['name', 'Old'], ['floorplans', []]]);
    assert.ok(out.same, 'upgraded in place');
    assert.deepEqual(out.newer, { format: 2, name: 'New' });
    assert.deepEqual(out.again, { format: 1, name: 'Twice' });
    await close(page);
  });
});
