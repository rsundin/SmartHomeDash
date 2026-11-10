// Shared helpers for the browser tests: a static server for the repository, one
// Chromium for the whole file, and pages that collect console errors.

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const { before, after } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');

const SIZES = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
  { name: 'tablet', width: 1080, height: 810, touch: true },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
];
const SITES = ['example-house', 'example-apartment'];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitForPort(port, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => { s.end(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`The test server did not start on port ${port}`);
}

// `python3 -m http.server` from the repository root, as the dev page is served.
async function startServer() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitForPort(port);
  return { url: `http://127.0.0.1:${port}/`, stop: () => proc.kill() };
}

// One server and one browser per test file.
// Call inside describe().
function setup() {
  const env = {};
  before(async () => {
    env.server = await startServer();
    env.browser = await chromium.launch();
  });
  after(async () => {
    await env.browser?.close();
    env.server?.stop();
  });
  return env;
}

// A page in its own context. Console errors and uncaught exceptions are collected in
// page.errors; `check(page)` asserts there were none.
async function open(env, url, { width = 1280, height = 800, touch = false, storage = null } = {}) {
  const context = await env.browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: false });
  if (storage) {
    await context.addInitScript((items) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
    }, storage);
  }
  // A broken page should fail fast, not wait out Playwright's 30 s default.
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => page.errors.push(`exception: ${e.message}`));
  page.on('requestfailed', (r) => page.errors.push(`request failed: ${r.url()}`));
  await page.goto(env.server.url + url);
  return page;
}

// The harness (tests/browser/harness.html): the panel code with test data.
async function harness(env, query = '', opts = {}) {
  const page = await open(env, `tests/browser/harness.html${query}`, opts);
  await page.waitForFunction(() => window.harness && window.store && document.querySelector('.stage'));
  await page.evaluate(() => window.harness.ready);
  return page;
}

async function close(page) {
  await page.context().close();
}

function check(page) {
  assert.deepEqual(page.errors, [], 'no console errors');
}

// Nothing may stick out sideways: the page never scrolls horizontally.
async function assertNoOverflow(page, label = '') {
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    vw: document.documentElement.clientWidth,
  }));
  assert.ok(o.doc <= o.vw && o.body <= o.vw, `${label} overflows sideways: page ${o.doc}px, body ${o.body}px, viewport ${o.vw}px`);
}

// Centre of an element in page coordinates.
async function centre(locator) {
  const b = await locator.boundingBox();
  assert.ok(b, 'element is on screen');
  return [b.x + b.width / 2, b.y + b.height / 2];
}

module.exports = { ROOT, SIZES, SITES, setup, open, harness, close, check, assertNoOverflow, centre };
