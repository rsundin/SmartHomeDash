// The setup guide's Backup step (roadmap S3): download the dashboard as a .zip,
// import one after confirming, and restore one of the kept versions.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, close, check, assertNoOverflow } = require('./lib');

// The example house with the guide opening by itself, in English.
function site() {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
  return { ...s, language: 'en', locale: 'en-GB', setup_pending: true };
}
const serve = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site()) }));
const zip = (name) => ({ name, mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04') });

async function openBackup(env, query = '', opts = {}) {
  const page = await harness(env, `?site=example-house${query}`, { prepare: serve, ...opts });
  await page.locator('.setup').waitFor();
  await page.locator('.setup-step', { hasText: 'Backup' }).click();
  return page;
}

describe('backup', () => {
  const env = setup();

  test('export downloads a .zip', async () => {
    const page = await openBackup(env);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.backup-export').click(),
    ]);
    assert.equal(download.suggestedFilename(), 'smarthomedash-example-house-test.zip');
    await page.locator('.setup-status', { hasText: 'Downloaded smarthomedash-example-house-test.zip' }).waitFor();
    assert.equal(await page.evaluate(() => window.harness.backup.exports), 1);
    check(page);
    await close(page);
  });

  test('import asks first, then imports and restarts', async () => {
    const page = await openBackup(env);
    await page.locator('.backup-file').setInputFiles(zip('home.zip'));
    await page.locator('.backup-confirm', { hasText: 'Replace this dashboard\'s settings with home.zip?' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.harness.backup.imports), [], 'nothing before confirming');
    // Cancel hides the question; choosing again and confirming imports.
    await page.locator('.backup-confirm button', { hasText: 'Cancel' }).click();
    assert.equal(await page.locator('.backup-confirm').isHidden(), true);
    await page.locator('.backup-file').setInputFiles(zip('home.zip'));
    await page.locator('.backup-import-go').click();
    await page.waitForFunction(() => window.harness.starts === 2);
    assert.deepEqual(await page.evaluate(() => window.harness.backup.imports), ['home.zip']);
    check(page);
    await close(page);
  });

  test('a refused import says why and does not restart', async () => {
    const page = await openBackup(env);
    await page.locator('.backup-file').setInputFiles(zip('bad.zip'));
    await page.locator('.backup-import-go').click();
    await page.locator('.setup-status', { hasText: 'Could not import: Nothing was imported: evil.html' }).waitFor();
    assert.equal(await page.evaluate(() => window.harness.starts), 1);
    assert.equal(await page.locator('.backup-import-go').isEnabled(), true, 'can try again');
    check(page);
    await close(page);
  });

  test('restore points are listed newest first and restore after confirming', async () => {
    const page = await openBackup(env, '', { timezoneId: 'Europe/Stockholm' });
    const rows = page.locator('.backup-versions li');
    await rows.nth(1).waitFor();
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(0).textContent(), /10 Nov 2026.*19:30.*Testhuset · floor plans: 2, rooms: 9/);
    assert.match(await rows.nth(1).textContent(), /9 Nov 2026.*floor plans: 1, rooms: 4/);
    await rows.nth(1).locator('.backup-restore').click();
    assert.deepEqual(await page.evaluate(() => window.harness.backup.restores), [], 'nothing before confirming');
    await rows.nth(1).locator('.backup-restore-go').click();
    await page.waitForFunction(() => window.harness.starts === 2);
    assert.deepEqual(await page.evaluate(() => window.harness.backup.restores), [2]);
    check(page);
    await close(page);
  });

  test('no versions yet, and unsaved changes are pointed out', async () => {
    const page = await harness(env, '?site=example-house', { prepare: serve });
    await page.evaluate(() => { window.harness.backup.versions = []; });
    await page.locator('.setup').waitFor();
    await page.locator('.setup-field', { hasText: 'Name' }).locator('input').fill('Changed');
    await page.locator('.setup-step', { hasText: 'Backup' }).click();
    await page.locator('.setup-note', { hasText: 'unsaved changes' }).waitFor();
    await page.locator('.backup-versions li', { hasText: 'No earlier versions yet' }).waitFor();
    assert.doesNotMatch(await page.locator('.setup-body').textContent(), /null|undefined/);
    check(page);
    await close(page);
  });

  test('fits on a phone', async () => {
    const page = await openBackup(env, '', { width: 390, height: 844, touch: true });
    await page.locator('.backup-versions li').nth(1).waitFor();
    await assertNoOverflow(page, 'backup step on a phone');
    assert.doesNotMatch(await page.locator('.setup-body').textContent(), /null|undefined/);
    check(page);
    await close(page);
  });

  test('without export and import the step is not offered', async () => {
    const page = await harness(env, '?site=example-house&nobackup', { prepare: serve });
    await page.locator('.setup').waitFor();
    assert.equal(await page.locator('.setup-step', { hasText: 'Backup' }).count(), 0);
    check(page);
    await close(page);
  });
});
