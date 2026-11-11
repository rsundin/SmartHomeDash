// Report a problem: the ? button and the setup guide open a sheet with the text that
// goes into a prefilled GitHub issue. Issues are public, so the text must never hold
// entity ids, room or area names.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, setup, harness, open, close, check } = require('./lib');

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const PICTURE = /\.(jpg|jpeg|png|webp)$/;

// Every entity id and name in a site.json: none of them may reach the issue.
function privateWords(siteId) {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', siteId, 'site.json'), 'utf8'));
  const out = new Set();
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (ENTITY.test(v) && !PICTURE.test(v)) out.add(v);
      else if ((key === 'name' || key === 'label') && v.length >= 3) out.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(site);
  return [...out];
}

async function openReport(page, opener = '.chip-help') {
  await page.locator(opener).click();
  await page.locator('.report[data-ready="true"]').waitFor();
  const href = await page.locator('#report-open').getAttribute('href');
  return new URL(href);
}

describe('Report a problem', () => {
  const env = setup();

  for (const siteId of ['example-house', 'example-apartment']) {
    test(`${siteId}: the ? button opens a prefilled issue with no ids or names`, async () => {
      const page = await harness(env, `?site=${siteId}`);
      const url = await openReport(page);
      assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/rsundin/SmartHomeDash/issues/new');
      assert.equal(url.searchParams.get('template'), 'bug_report.yml');
      assert.equal(url.searchParams.get('ha'), '2026.11.0');
      const text = url.searchParams.get('dashboard');
      assert.match(text, /^SmartHomeDash: /m);
      assert.match(text, /^Home Assistant: 2026\.11\.0$/m);
      assert.match(text, /^Opened as: Home Assistant panel$/m);
      assert.match(text, /^Screen: \d+×\d+/m);
      assert.match(text, /^Kiosk mode: off$/m);
      assert.match(text, /floor plan\(s\)/);
      // The text the user sees is the text that is sent.
      assert.equal(await page.locator('#report-text').inputValue(), text);
      const all = decodeURIComponent(url.href);
      const leaked = privateWords(siteId).filter((w) => all.includes(w));
      assert.deepEqual(leaked, [], 'no entity ids or names in the issue');
      // Questions go to Discussions.
      assert.equal(await page.locator('#report-discuss').getAttribute('href'), 'https://github.com/rsundin/SmartHomeDash/discussions');
      check(page);
      await close(page);
    });
  }

  test('an edit to the text changes the issue, and Escape closes the sheet', async () => {
    const page = await harness(env, '?site=example-house');
    await openReport(page);
    await page.locator('#report-text').fill('Only this line');
    const url = new URL(await page.locator('#report-open').getAttribute('href'));
    assert.equal(url.searchParams.get('dashboard'), 'Only this line');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.report').isHidden(), true);
    check(page);
    await close(page);
  });

  test('config check: missing devices and a refused save are counted, not named', async () => {
    const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'example-house', 'site.json'), 'utf8'));
    site.floorplans[0].rooms[0].sensors = [...(site.floorplans[0].rooms[0].sensors ?? []), 'binary_sensor.secret_cellar_door'];
    const prepare = (page) => page.route('**/sites/example-house/site.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(site) }));
    const page = await harness(env, '?site=example-house', { prepare });
    await page.evaluate(async () => {
      const m = await import('../../custom_components/smarthomedash/frontend/js/ui/report.js');
      m.noteProblem('site.json was not saved: floorplans[0].rooms[2].area should be a list of at least three [x, y] number pairs');
    });
    const url = await openReport(page);
    const text = url.searchParams.get('dashboard');
    assert.match(text, /^Config check: .*missing 1/m);
    assert.match(text, /^Last refused save: site\.json was not saved: floorplans\[0\]\.rooms\[2\]\.area/m);
    assert.ok(!decodeURIComponent(url.href).includes('secret_cellar_door'));
    check(page);
    await close(page);
  });

  test('the setup guide has Report a problem', async () => {
    const page = await harness(env, '?site=example-house');
    await page.getByRole('button', { name: /^(Setup|Inställningar)$/ }).click();
    await page.locator('.setup-report').waitFor();
    await openReport(page, '.setup-report');
    check(page);
    await close(page);
  });

  test('standalone page on test data, and hidden in kiosk mode', async () => {
    const page = await open(env, '?site=example-apartment&mock');
    await page.locator('.chip-help').waitFor();
    const url = await openReport(page);
    assert.match(url.searchParams.get('dashboard'), /^Opened as: standalone page, test data$/m);
    assert.match(url.searchParams.get('dashboard'), /^Home Assistant: unknown$/m);
    await page.keyboard.press('Escape');
    check(page);
    await close(page);
    const kiosk = await harness(env, '?site=example-house&kiosk');
    assert.equal(await kiosk.locator('.chip-help').isHidden(), true);
    await close(kiosk);
  });
});
