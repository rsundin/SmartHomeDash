// Two editors of one dashboard: a save names the version of site.json it builds on, and
// one based on an older version asks before it replaces what someone else saved.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check } = require('./lib');

const JS = '../../custom_components/smarthomedash/frontend/js';

// The example house with the guide opening by itself, in English.
function site() {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
  return { ...s, language: 'en', locale: 'en-GB', setup_pending: true };
}
const serve = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site()) }));

describe('save conflicts', () => {
  const env = setup();

  test('a save over someone else\'s asks first: cancel keeps theirs, save anyway replaces it', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve });
    await page.locator('.setup').waitFor();
    // Someone else saves while the guide is open here.
    await page.evaluate(() => window.harness.saved.push({ ...window.__shdRun.site.raw, name: 'Theirs' }));
    const save = page.locator('.setup .chip-primary', { hasText: 'Save' }).first();
    await save.click();
    const dialog = page.locator('.save-conflict [role="alertdialog"]');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /saved by someone else/);
    // Cancel has the focus, and Escape means the same.
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
    await page.keyboard.press('Escape');
    await page.locator('.setup-status', { hasText: 'nothing was saved' }).waitFor();
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.locator('.setup').count(), 1, 'the guide stays open with the changes');
    assert.deepEqual(await page.evaluate(() => window.harness.saved.map((s) => s.name)), ['Theirs']);

    await save.click();
    await dialog.locator('button', { hasText: 'Save anyway' }).click();
    await page.waitForFunction(() => window.harness.saved.length === 2 && window.harness.starts === 2);
    assert.notEqual(await page.evaluate(() => window.harness.saved[1].name), 'Theirs');
    check(page);
    await close(page);
  });

  test('a save with nothing in between goes through without a question', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve });
    await page.locator('.setup').waitFor();
    await page.locator('.setup .chip-primary', { hasText: 'Save' }).first().click();
    await page.waitForFunction(() => window.harness.saved.length === 1 && window.harness.starts === 2);
    // The restarted dashboard read the new version.
    await page.waitForFunction(() => window.__shdRun.site?.version === '"v1"');
    assert.equal(await page.locator('.save-conflict').count(), 0);
    check(page);
    await close(page);
  });

  test('a draft in placement mode remembers the version it was started from', async () => {
    const page = await harness(env, '?site=example-house');
    const versions = await page.evaluate(async (JS) => {
      const { loadSite, draftKey, draftBaseKey } = await import(`${JS}/site.js`);
      const { storage } = await import(`${JS}/util.js`);
      const get = async () => new Response(JSON.stringify({ name: 'File', floorplans: [] }), { headers: { ETag: '"now"' } });
      const fresh = (await loadSite('example-house', { loader: { get } })).version;
      storage.set(draftKey('example-house'), { name: 'Draft', floorplans: [] });
      storage.set(draftBaseKey('example-house'), '"then"');
      const draft = await loadSite('example-house', { useDraft: true, loader: { get } });
      storage.set(draftKey('example-house'), null);
      storage.set(draftBaseKey('example-house'), null);
      return { fresh, draft: draft.version, name: draft.name };
    }, JS);
    assert.deepEqual(versions, { fresh: '"now"', draft: '"then"', name: 'Draft' });
    await close(page);
  });
});
