#!/usr/bin/env node
// Records the short screen recording in the README (docs/images/demo.webp) from the
// test harness with test data: dusk falls on the example house and the lights come on,
// the roof lifts to the floor plan, and a room panel opens.
//
//   node scripts/record-demo.js [out.webp] [out.mp4]
//
// The optional .mp4 is the same recording as a video, for sites that do not play
// animated WebP (Reddit, for one).
//
// Needs Playwright with Chromium (as the browser tests), ffmpeg and Python's Pillow.
// Nothing about a real home is used: only sites/example-house.

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/images/demo.webp'));
const MP4 = process.argv[3] ? path.resolve(process.argv[3]) : null;
const SIZE = { width: 1200, height: 750 };
const WIDTH = 840; // of the recording in the README
const FPS = 12;
const QUALITY = 70;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const port = 8765 + Math.floor(Math.random() * 1000);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pvd-demo-'));
  const browser = await chromium.launch();
  try {
    await sleep(800);
    const context = await browser.newContext({
      viewport: SIZE, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Stockholm', colorScheme: 'dark',
      recordVideo: { dir: tmp, size: SIZE },
    });
    const page = await context.newPage();
    // A November afternoon just after sunset: no solar, the evening price peak.
    await page.clock.setFixedTime(new Date('2026-11-18T16:05:00+01:00'));
    // Day, night or auto is remembered per site; the recording starts on auto.
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* none */ } });
    await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html?site=example-house`);
    await page.waitForFunction(() => window.store && document.querySelector('.ov-bld'));
    // Looks as in kiosk mode (only the dashboard, as on a wall screen), without going full
    // screen: the browser's video recording shrinks its frames in full screen.
    await page.evaluate(() => document.body.classList.add('is-kiosk'));

    // The test data moves the sun with the clock; the recording moves it itself.
    // Every lamp starts off and comes back on as it was in the test data, or warm white.
    await page.evaluate(() => {
      const store = window.store;
      const update = store.update.bind(store);
      store.update = (s) => { if (s.entity_id !== 'sun.sun' || s.demo) update(s); };
      const sun = store.get('sun.sun');
      window.demo = {
        sun(elevation) {
          update({ ...sun, demo: true, state: elevation > 0 ? 'above_horizon' : 'below_horizon', attributes: { ...sun.attributes, elevation } });
        },
        lights: store.all().filter((s) => s.entity_id.startsWith('light.')).map((s) => s.state === 'on' ? s
          : { ...s, state: 'on', attributes: { ...s.attributes, brightness: 200, color_mode: 'color_temp', color_temp_kelvin: 2700 } }),
      };
      for (const s of window.demo.lights) update({ ...s, state: 'off', attributes: { ...s.attributes, brightness: null } });
      window.demo.sun(8);
      store.flush();
    });
    await sleep(1200); // the day picture settles before the recording starts
    const t0 = Date.now();
    await sleep(1200);

    // Dusk: the day picture fades into the evening one.
    for (let e = 8; e >= -7; e -= 0.5) {
      await page.evaluate((x) => window.demo.sun(x), e);
      await sleep(90);
    }
    await sleep(500);

    // The lamps come on one by one: outdoors first, as they would on a timer.
    const order = await page.evaluate(() => {
      const ids = window.demo.lights.map((s) => s.entity_id);
      const outdoor = (id) => /outdoor|garden|facade|porch|entrance|garage|drive|terrace|path/.test(id);
      return [...ids.filter(outdoor), ...ids.filter((id) => !outdoor(id))];
    });
    for (const id of order) {
      await page.evaluate((x) => window.store.update(window.demo.lights.find((s) => s.entity_id === x)), id);
      await sleep(Math.max(60, 1800 / order.length));
    }
    await sleep(1600);

    // Tap the house: the roof lifts and the floor plan opens.
    await page.locator('.ov-bld[aria-label*="House"]').click();
    await page.waitForFunction(() => document.querySelector('.stage').dataset.view === 'plan:house');
    await sleep(2200);

    // Tap a room: its panel, and a lamp switched from it.
    await page.locator('.fp[data-plan="house"] .fp-room[aria-label="Living room"]').click();
    await page.locator('aside.panel .panel-title').waitFor();
    await sleep(1500);
    const sw = page.locator('aside.panel .light-list .switch').first();
    if (await sw.count()) { await sw.click(); await sleep(1000); await sw.click(); }
    await sleep(1800);

    const seconds = (Date.now() - t0) / 1000;
    const video = await page.video().path();
    await context.close();

    // The video starts when the page opens; skip the loading.
    const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString());
    const skip = Math.max(0, (Number.isFinite(total) ? total : seconds) - seconds);
    // ffmpeg cuts the video into frames; Pillow writes the animated WebP (ffmpeg's own
    // animated WebP encoder leaves grey patches where only part of a frame changes).
    const frames = path.join(tmp, 'frames');
    fs.mkdirSync(frames);
    execFileSync('ffmpeg', ['-v', 'error', '-ss', skip.toFixed(2), '-i', video,
      '-vf', `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`, path.join(frames, '%04d.png')]);
    execFileSync('python3', ['-c', `
import sys, glob
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '/*.png'))
first, *rest = [Image.open(f).convert('RGB') for f in files]
first.save(sys.argv[2], save_all=True, append_images=rest, duration=int(sys.argv[3]), loop=0,
           quality=int(sys.argv[4]), method=6, minimize_size=True, allow_mixed=True)
`, frames, OUT, String(Math.round(1000 / FPS)), String(QUALITY)], { stdio: 'inherit' });
    if (MP4) {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', skip.toFixed(2), '-i', video, '-vf', 'fps=30,scale=1200:-2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', '-an', MP4]);
    }
    console.log(`${path.relative(ROOT, OUT)}: ${seconds.toFixed(1)} s, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
