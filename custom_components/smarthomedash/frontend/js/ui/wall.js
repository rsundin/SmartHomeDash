// Wall screens: the doorbell camera, idle mode and light mode.
//
// site.json:
//   "wall_screen": {
//     "doorbell": { "entity": "binary_sensor.doorbell", "camera": "camera.front_door", "seconds": 30 },
//     "idle": { "minutes": 2, "night": ["22:00", "06:30"], "dim": 0.15, "wake": ["binary_sensor.hall_motion"] }
//   }
//
// - Doorbell: when the entity rings (a binary sensor turning on, or a new event on an
//   event.*, button.* or input_button.* entity), every open dashboard shows the camera
//   in a window that closes by itself after `seconds`.
// - Idle: in kiosk mode, after `minutes` without a touch the dashboard goes back to the
//   overview. Between the two `night` times the idle screen is dimmed to `dim` (0-1);
//   a tap, the doorbell or one of the `wake` sensors turning on brightens it again.
// - Light mode (per device, not in site.json): no blur, blending or animation, for older
//   tablets. Auto turns it on for devices with two cores or 2 GB of memory or less.

import { el, storage, clamp, num } from '../util.js';
import { t } from '../i18n.js';

const LITE_KEY = 'shd:lite';
const RING_FRESH_MS = 60e3; // a ring older than this (seen after a reconnect) is not shown
const PRESSED = new Set(['event', 'button', 'input_button']); // state is the time of the last press
const DEAD = new Set(['unavailable', 'unknown', '', undefined, null]);

// ?lite or ?lite=0 on the address sets light mode for this device. In the Home Assistant
// panel the dashboard runs in a frame, so the parent window's address counts too.
function addressParam(name) {
  const sources = [location.search];
  try { if (window.top !== window) sources.push(window.top.location.search); } catch { /* other origin */ }
  for (const s of sources) {
    const p = new URLSearchParams(s);
    if (p.has(name)) return p.get(name);
  }
  return null;
}

export function liteSetting() {
  const p = addressParam('lite');
  if (p != null) storage.set(LITE_KEY, ['0', 'off', 'false', 'no'].includes(p.toLowerCase()) ? 'off' : 'on');
  const v = storage.get(LITE_KEY, 'auto');
  return ['on', 'off'].includes(v) ? v : 'auto';
}

// Older tablets: two cores or 2 GB of memory or less (where the browser tells).
export function liteAuto() {
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  return (mem > 0 && mem <= 2) || (cores > 0 && cores <= 2);
}

export function applyLite(setting = liteSetting()) {
  const on = setting === 'on' || (setting === 'auto' && liteAuto());
  document.body.classList.toggle('is-lite', on);
  return on;
}

export const isLite = () => document.body.classList.contains('is-lite');

const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};
// Is `d` between from and to (minutes after midnight)? Windows may run past midnight.
const inWindow = (d, [from, to]) => {
  const m = d.getHours() * 60 + d.getMinutes();
  return from <= to ? m >= from && m < to : m >= from || m < to;
};

/**
 * @param {object} o
 * @param {object} o.site
 * @param {object} o.store
 * @param {object} o.adapter
 * @param {AbortSignal} o.signal   ends listeners and timers when the dashboard restarts
 * @param {Function} o.goHome      back to the overview, panels closed
 * @param {Function} o.enterKiosk  starts kiosk mode (from a tap)
 */
export function createWall({ site, store, adapter, signal, goHome, enterKiosk }) {
  const cfg = site.wall_screen ?? {};
  const kiosk = () => document.body.classList.contains('is-kiosk');
  const timers = [];
  signal.addEventListener('abort', () => timers.forEach((x) => clearInterval(x)));

  const idle = createIdle({ site, store, cfg: cfg.idle, kiosk, goHome, signal, timers });
  const doorbell = createDoorbell({ site, store, adapter, cfg: cfg.doorbell ?? null, signal, onRing: () => idle.wake() });

  // ---------- the wall screen sheet: kiosk mode, light mode, test the doorbell
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': t('wall.lite') });
  const renderSeg = () => {
    const current = liteSetting();
    seg.replaceChildren(...['auto', 'on', 'off'].map((v) => el('button', {
      type: 'button', class: v === current ? 'is-active' : null, 'aria-pressed': String(v === current),
      onclick: () => { storage.set(LITE_KEY, v); applyLite(v); renderSeg(); },
    }, v === 'auto' ? t('wall.liteAuto', { state: t(liteAuto() ? 'wall.on' : 'wall.off') }) : t(v === 'on' ? 'wall.liteOn' : 'wall.liteOff'))));
  };
  renderSeg();

  const idleText = () => {
    const parts = [idle.minutes ? t('wall.idleOn', { n: idle.minutes }) : t('wall.idleOff')];
    if (idle.minutes && idle.night) parts.push(t('wall.idleNight', { from: idle.night[0], to: idle.night[1] }));
    if (idle.minutes && idle.night && idle.wakeIds.length) parts.push(t('wall.idleWake'));
    return parts.join(' ');
  };

  const sheet = el('div', { class: 'sheet', hidden: true },
    el('div', { class: 'sheet-card', role: 'dialog', 'aria-label': t('wall.title') },
      el('header', { class: 'panel-head' },
        el('div', {}, el('p', { class: 'eyebrow' }, t('wall.eyebrow')), el('h2', { class: 'panel-title' }, t('wall.title'))),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: () => close() }, '×')),
      el('p', { class: 'small' }, t('wall.kioskHelp')),
      el('div', { class: 'row' }, el('button', { class: 'chip chip-primary', type: 'button', onclick: () => { close(); enterKiosk(); } }, t('wall.startKiosk'))),
      el('h3', { class: 'eyebrow wall-h' }, t('wall.lite')),
      seg,
      el('p', { class: 'muted small' }, t('wall.liteHelp')),
      el('h3', { class: 'eyebrow wall-h' }, t('wall.doorbell')),
      el('p', { class: 'muted small' }, doorbell.configured ? t('wall.doorbellOn', { s: doorbell.seconds }) : t('wall.doorbellOff')),
      doorbell.configured ? el('div', { class: 'row' }, el('button', { class: 'chip', type: 'button', onclick: () => { close(); doorbell.test(); } }, t('wall.testDoorbell'))) : null,
      el('h3', { class: 'eyebrow wall-h' }, t('wall.idle')),
      el('p', { class: 'muted small' }, idleText())));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  function close() { sheet.hidden = true; }

  return {
    els: [sheet, doorbell.el, idle.el],
    open() { renderSeg(); sheet.hidden = false; },
    close,
    get isOpen() { return !sheet.hidden; },
    doorbell,
    idle,
  };
}

// ---------- doorbell: the camera in a window that closes by itself
function createDoorbell({ site, store, adapter, cfg, signal, onRing }) {
  const ids = [].concat(cfg?.entity ?? []).filter(Boolean);
  const seconds = clamp(num(cfg?.seconds) ?? 30, 5, 600);
  const camera = cfg?.camera ?? null;

  const img = el('img', { class: 'doorbell-img', alt: '' });
  const noPic = el('p', { class: 'doorbell-nopic muted', hidden: true }, t('wall.noPicture'));
  const bar = el('div', { class: 'doorbell-bar' });
  const title = el('h2', { class: 'panel-title' });
  const card = el('div', { class: 'doorbell-card', role: 'alertdialog', 'aria-label': t('wall.ringing') },
    el('header', { class: 'panel-head' },
      el('div', {}, el('p', { class: 'eyebrow' }, t('wall.ringing')), title),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: () => close() }, '×')),
    camera ? el('div', { class: 'doorbell-view' }, img, noPic) : null,
    el('div', { class: 'doorbell-track' }, bar));
  const root = el('div', { class: 'doorbell', hidden: true }, card);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let closeTimer = null, stillTimer = null;
  const nameOf = (id) => store.get(id)?.attributes?.friendly_name ?? id;

  // A camera's entity_picture is /api/camera_proxy/<id>?token=…, a short-lived token Home
  // Assistant renews in the state. The stream variant gives a live MJPEG picture.
  function cameraUrl(stream) {
    const pic = store.get(camera)?.attributes?.entity_picture;
    if (!pic) return null;
    if (/^(data|blob):/.test(pic)) return pic;
    const path = stream
      ? pic.replace('/api/camera_proxy/', '/api/camera_proxy_stream/')
      : `${pic}${pic.includes('?') ? '&' : '?'}_=${Date.now()}`;
    return adapter.media ? adapter.media(path) : path;
  }

  // Live stream first; if it fails (or in light mode) a fresh still every second.
  function startPicture() {
    noPic.hidden = true;
    img.hidden = false;
    const stills = () => {
      clearInterval(stillTimer);
      const next = () => { const u = cameraUrl(false); if (u) img.src = u; else { img.hidden = true; noPic.hidden = false; } };
      img.onerror = () => { img.hidden = true; noPic.hidden = false; };
      img.onload = () => { img.hidden = false; noPic.hidden = true; };
      next();
      if (!/^data:/.test(img.src)) stillTimer = setInterval(next, 1000);
    };
    const live = cameraUrl(true);
    if (!live) { img.hidden = true; noPic.hidden = false; return; }
    if (document.body.classList.contains('is-lite') || /^data:/.test(live)) { stills(); return; }
    img.onload = null;
    img.onerror = () => stills();
    img.src = live;
  }

  function show(id) {
    title.textContent = id ? nameOf(id) : (camera ? nameOf(camera) : t('wall.doorbell'));
    root.hidden = false;
    if (camera) startPicture();
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, seconds * 1000);
    // The bar runs down until the window closes.
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${seconds}s linear`;
    bar.style.transform = 'scaleX(0)';
    onRing();
  }

  function close() {
    root.hidden = true;
    clearTimeout(closeTimer);
    clearInterval(stillTimer);
    img.onerror = null;
    img.onload = null;
    img.removeAttribute('src'); // ends the stream
  }
  signal.addEventListener('abort', close);

  // Ring when a binary sensor turns on, or an event, button or input_button entity gets a
  // new time. The first look at each entity only records it; a ring older than a minute
  // (a change missed while disconnected) is not shown.
  const last = new Map();
  if (ids.length) {
    store.watch(ids, () => {
      for (const id of ids) {
        const s = store.get(id);
        const prev = last.get(id);
        last.set(id, s?.state);
        if (prev === undefined || !s || DEAD.has(s.state) || s.state === prev) continue;
        const pressed = PRESSED.has(id.split('.')[0]);
        const at = Date.parse(pressed ? s.state : s.last_changed);
        if (Number.isFinite(at) && Date.now() - at > RING_FRESH_MS) continue;
        if (pressed || s.state === 'on') show(id);
      }
    });
  }

  return {
    el: root,
    configured: !!(ids.length || camera),
    seconds,
    ring: show,
    close,
    // Test data: ring the test doorbell through the adapter, the way Home Assistant would.
    // Connected to Home Assistant: only show the window here, nothing is rung.
    test() {
      const id = ids.find((x) => x.startsWith('binary_sensor.'));
      if (adapter.kind === 'mock' && id) {
        adapter.call('homeassistant', 'turn_on', { entity_id: id });
        setTimeout(() => adapter.call('homeassistant', 'turn_off', { entity_id: id }), 3000);
      } else {
        show(ids[0] ?? null);
      }
    },
  };
}

// ---------- idle: back to the overview, dimmed at night, woken by motion
function createIdle({ site, store, cfg, kiosk, goHome, signal, timers }) {
  const minutes = cfg === false ? 0 : clamp(num(cfg?.minutes) ?? 2, 0, 1440);
  const nightRaw = Array.isArray(cfg?.night) ? cfg.night : null;
  const night = nightRaw && hm(nightRaw[0]) != null && hm(nightRaw[1]) != null ? [hm(nightRaw[0]), hm(nightRaw[1])] : null;
  const level = clamp(num(cfg?.dim) ?? 0.15, 0, 1);
  const wakeIds = [].concat(cfg?.wake ?? []).filter(Boolean);

  const clock = el('time', { class: 'dimmer-clock' });
  const root = el('div', { class: 'dimmer', hidden: true, role: 'button', 'aria-label': t('wall.wakeUp') }, clock);
  root.style.setProperty('--dim', String(1 - level));
  // Waking takes a whole tap on the dimmed screen, so the tap never lands on a lamp below.
  root.addEventListener('click', (e) => { e.stopPropagation(); wake(); });

  let idleTimer = null, idle = false, dimmed = false;
  const tick = () => { clock.textContent = new Date().toLocaleTimeString(site.locale, { hour: '2-digit', minute: '2-digit' }); };

  function restart() {
    clearTimeout(idleTimer);
    idle = false;
    if (minutes > 0) idleTimer = setTimeout(goIdle, minutes * 60e3);
  }
  function goIdle() {
    if (!kiosk()) { restart(); return; }
    idle = true;
    goHome();
    checkNight();
  }
  function dim(on) {
    dimmed = on;
    root.hidden = !on;
    if (on) tick();
  }
  // Dim while idle in the night window, brighten when the night is over.
  function checkNight() {
    const nightNow = !!night && inWindow(new Date(), night);
    if (idle && kiosk() && nightNow) { if (!dimmed) dim(true); } else if (dimmed) dim(false);
  }
  function wake() {
    if (dimmed) dim(false);
    restart();
  }

  // Any touch, key or wheel counts as use; while dimmed only a tap on the dimmer wakes.
  const use = () => { if (!dimmed) restart(); };
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, use, { capture: true, passive: true, signal });
  document.addEventListener('keydown', () => { if (dimmed) wake(); }, { signal });
  timers.push(setInterval(() => { checkNight(); if (dimmed) tick(); }, 20e3));
  signal.addEventListener('abort', () => { clearTimeout(idleTimer); dim(false); });

  // A wake sensor turning on (or off again) brightens the screen and restarts the timer.
  const last = new Map();
  if (wakeIds.length) {
    store.watch(wakeIds, () => {
      for (const id of wakeIds) {
        const state = store.get(id)?.state;
        const prev = last.get(id);
        last.set(id, state);
        if (prev !== undefined && state !== prev && (state === 'on' || prev === 'on')) wake();
      }
    });
  }
  restart();

  return {
    el: root,
    minutes,
    night: night ? nightRaw.map(String) : null,
    wakeIds,
    wake,
    get dimmed() { return dimmed; },
    // For trying it out: go idle now.
    now: goIdle,
  };
}
