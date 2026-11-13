// The texts come from one JSON file per language (frontend/i18n/), fetched before the
// dashboard is drawn. Checked here on the standalone page: only the languages needed
// are fetched, with the page's version, the preload is used, and a failed start still
// shows its message as text.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, open, close, check } = require('./lib');

const i18nRequests = (page) => {
  const seen = [];
  page.on('request', (r) => { if (r.url().includes('/frontend/i18n/')) seen.push(r.url()); });
  return seen;
};

describe('texts', () => {
  const env = setup();

  test('an English site shows English, fetched once with the version and preloaded', async () => {
    let seen;
    const warnings = [];
    const page = await open(env, 'index.html?site=example-house', { prepare: (p) => {
      seen = i18nRequests(p);
      p.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    } });
    await page.locator('.stage').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.match(await page.locator('.top-actions').textContent(), /Auto/);
    // No raw keys ("app.overview", "setup.title" …) anywhere on the page.
    const raw = await page.evaluate(() => (document.body.innerText.match(/\b(app|setup|editor|cards|panel|status|flow|alerts)\.[a-z][\w.]+\b/gi) ?? []));
    assert.deepEqual(raw, [], 'no text is shown as its key');

    const version = await page.evaluate(() => window.SHD_VERSION);
    const names = seen.map((u) => u.slice(u.lastIndexOf('/') + 1)).sort();
    // index.html preloads English and the dashboard asks for the same address; Swedish is
    // not fetched for an English site.
    assert.deepEqual([...new Set(names)], [`en.json?v=${version}`]);
    // Chromium warns a few seconds after load about a preload nothing used.
    await page.waitForTimeout(3500);
    assert.deepEqual(warnings.filter((w) => /preload/i.test(w)), [], 'the preload is used');
    check(page);
    await close(page);
  });

  test('a start that fails shows its message as text, in the default language', async () => {
    const page = await open(env, 'index.html?site=no-such-site');
    const fatal = page.locator('.fatal');
    await fatal.waitFor();
    assert.equal(await fatal.locator('.eyebrow').textContent(), 'Kunde inte starta');
    assert.match(await fatal.locator('.muted').textContent(), /site\.json/);
    await close(page);
  });

  test('the setup guide in Swedish and in English', async () => {
    for (const [language, title, basics] of [['sv', 'Inställningar', /Namn/], ['en', 'Setup', /Name/]]) {
      const page = await open(env, 'tests/browser/harness.html?site=example-house', { prepare: (p) => p.route('**/sites/example-house/site.json', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), language, setup_pending: true } }); // a pending setup opens the guide
      }) });
      await page.waitForFunction(() => window.harness && document.querySelector('.stage'));
      await page.evaluate(() => window.harness.ready);
      assert.equal(await page.evaluate(() => document.documentElement.lang), language);
      const setupEl = page.locator('.setup');
      await setupEl.waitFor();
      assert.equal(await setupEl.locator('.panel-title').textContent(), title);
      assert.match(await setupEl.locator('.setup-body').textContent(), basics);
      check(page);
      await close(page);
    }
  });
});
