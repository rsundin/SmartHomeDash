// The texts come from one JSON file per language (frontend/i18n/), fetched before the
// dashboard is drawn. Checked here on the standalone page: only the languages needed
// are fetched, with the page's version, the preload is used, and a failed start still
// shows its message as text.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, open, close, check, SITES } = require('./lib');

const I18N = path.join(__dirname, '..', '..', 'custom_components', 'smarthomedash', 'frontend', 'i18n');
const text = (code) => JSON.parse(fs.readFileSync(path.join(I18N, `${code}.json`), 'utf8'));
// The languages beyond Swedish and English (roadmap S5), all machine-assisted.
const ADDED = ['da', 'de', 'fi', 'nb', 'nl'];
const RAW_KEY = /\b(app|setup|editor|cards|panel|status|flow|alerts|warn|wall|backup|report|shape|history|camera|lights|goodnight|weather|mode|preset)\.[a-z][\w.-]+\b/gi;

// site.json as served, with other settings; "locale" is left out unless given, so it
// follows the language.
const withSite = (site, changes) => (p) => p.route(`**/sites/${site}/site.json`, async (route) => {
  const res = await route.fetch();
  const { locale, ...json } = await res.json();
  await route.fulfill({ response: res, json: { ...json, ...changes } });
});

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

  test('every language renders on both examples, with its own number format', async () => {
    for (const code of ADDED) {
      const strings = text(code);
      for (const site of SITES) {
        const page = await open(env, `index.html?site=${site}`, { prepare: withSite(site, { language: code }) });
        await page.locator('.stage').waitFor();
        await page.evaluate(() => window.store?.flush?.());
        assert.equal(await page.evaluate(() => document.documentElement.lang), code, `${code} ${site}`);
        const body = await page.evaluate(() => document.body.innerText);
        assert.deepEqual(body.match(RAW_KEY) ?? [], [], `${code} ${site}: no text is shown as its key`);
        // The language's own words are on screen, not English.
        assert.ok(body.includes(strings['app.hintOverview']) || body.includes(strings['app.hintPlan']), `${code} ${site}: the hint is in ${code}`);
        assert.ok(body.includes(strings['app.kiosk']), `${code} ${site}: the header is in ${code}`);
        const label = await page.locator('.top-actions [aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(' | '));
        assert.ok(!/Text size|Full screen|Kiosk mode/.test(label) || code === 'en', `${code} ${site}: header labels are translated (${label})`);
        // Numbers follow the language's locale: all five write decimals with a comma.
        const decimals = body.match(/\d+[.,]\d+(?=\s?(kW|°|kWh))/g) ?? [];
        assert.ok(decimals.every((d) => d.includes(',')), `${code} ${site}: ${decimals.join(' ')}`);
        check(page);
        await close(page);
      }
    }
  });

  test('the setup guide lists every language and opens in each of them', async () => {
    const en = text('en');
    for (const code of ['sv', 'en', ...ADDED]) {
      const strings = text(code);
      const page = await open(env, 'tests/browser/harness.html?site=example-house', { prepare: withSite('example-house', { language: code, setup_pending: true }) });
      await page.waitForFunction(() => window.harness && document.querySelector('.stage'));
      await page.evaluate(() => window.harness.ready);
      const setupEl = page.locator('.setup');
      await setupEl.waitFor();
      assert.equal(await setupEl.locator('.panel-title').textContent(), strings['setup.title'], code);
      const guide = await setupEl.innerText();
      assert.deepEqual(guide.match(RAW_KEY) ?? [], [], `${code}: no text in the guide is shown as its key`);
      // The picker: every language by its own name, the machine-assisted ones marked.
      const options = await setupEl.locator('select').first().locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
      assert.deepEqual(options.map(([v]) => v), ['sv', 'en', 'da', 'de', 'fi', 'nb', 'nl'], code);
      const marked = options.filter(([, label]) => label.includes(`(${strings['setup.languageMachine']})`)).map(([v]) => v);
      assert.deepEqual(marked, ADDED, `${code}: the machine-assisted languages are marked`);
      assert.equal(await setupEl.locator('select').first().inputValue(), code);
      if (code !== 'en') assert.notEqual(strings['setup.basicsIntro'], en['setup.basicsIntro'], code);
      check(page);
      await close(page);
    }
  });

  test('picking a language in the guide sets its locale', async () => {
    const page = await open(env, 'tests/browser/harness.html?site=example-house', { prepare: withSite('example-house', { language: 'en', setup_pending: true }) });
    await page.waitForFunction(() => window.harness && document.querySelector('.stage'));
    await page.evaluate(() => window.harness.ready);
    const picker = page.locator('.setup select').first();
    await picker.waitFor();
    await picker.selectOption('nb');
    const saved = await page.evaluate(async () => {
      const mod = await import('../../custom_components/smarthomedash/frontend/js/i18n.js');
      return [mod.localeFor('nb'), mod.matchLanguage('nn-NO'), mod.matchLanguage('de-AT'), mod.matchLanguage('fr'), mod.matchLanguage(undefined)];
    });
    assert.deepEqual(saved, ['nb-NO', 'nb', 'de', 'en', 'en']);
    check(page);
    await close(page);
  });
});

