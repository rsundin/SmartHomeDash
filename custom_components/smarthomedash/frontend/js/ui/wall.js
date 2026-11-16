// Wall screens: the doorbell camera, idle mode and light mode.
//
// site.json:
//   "wall_screen": {
//     "doorbell": { "entity": "binary_sensor.doorbell", "camera": "camera.front_door", "seconds": 60 },
//     "idle": { "back_after": 120, "dim_from": "22:00", "dim_to": "06:30", "dim": 0.85, "wake": ["binary_sensor.hall_motion"] },
//     "lite": false
//   }
//
// Doorbell: when the entity rings, the camera opens in a window that closes by itself.
// Idle (kiosk mode only): back to the start view after a while without touch, and between
// dim_from and dim_to a dimmed screen that a touch or a motion sensor wakes.
// Light mode: no blur, blending or animation, for older tablets. Per device On, Off or
// Auto on the wall screen sheet (the Kiosk mode button), or with ?lite and ?lite=0 on the
// address. Auto follows "lite": true for every screen, and otherwise turns it on for
// devices with two cores or 2 GB of memory or less.

import { el, storage, syncPause } from '../util.js';
import { t } from '../i18n.js';
import { nameOf } from '../entities.js';
import { openCamera, closeCamera, cameraOpen } from './camera.js';

const LITE_KEY = 'shd:lite';

// Query parameters of the page the user sees: in the Home Assistant panel that is the
// window around this frame.
function pageParams() {
  try { return new URLSearchParams(window.top.location.search); } catch { return new URLSearchParams(location.search); }
}

// This device's setting: 'auto', 'on' or 'off'. ?lite on the address sets it.
// (0.8.0 stored true or false.)
export function liteSetting() {
  const p = pageParams();
  if (p.has('lite')) storage.set(LITE_KEY, ['0', 'false', 'off', 'no'].includes(p.get('lite').toLowerCase()) ? 'off' : 'on');
  const v = storage.get(LITE_KEY);
  if (v === true) return 'on';
  if (v === false) return 'off';
  return v === 'on' || v === 'off' ? v : 'auto';
}

// Older tablets: two cores or 2 GB of memory or less, where the browser tells.
export function liteAuto(site) {
  if (site?.wall_screen?.lite === true) return true;
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  return (mem > 0 && mem <= 2) || (cores > 0 && cores <= 2);
}

export function liteMode(site, setting = liteSetting()) {
  return setting === 'on' || (setting === 'auto' && liteAuto(site));
}

const isOn = (s) => s?.state === 'on';
const dead = (s) => !s || s.state === 'unavailable' || s.state === 'unknown';

// A doorbell rings when a binary sensor (or a switch or helper) turns on, or when an event or
// button entity gets a new time stamp as its state.
function rang(id, prev, next) {
  if (!prev || dead(next)) return false;
  if (/^(binary_sensor|input_boolean|switch)\./.test(id)) return isOn(next) && !isOn(prev);
  return next.state !== prev.state && !dead(prev);
}

// "22:00" → minutes after midnight, or null.
function minutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function inWindow(now, from, to) {
  const a = minutes(from), b = minutes(to);
  if (a == null || b == null || a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/**
 * @param {object} o
 * @param {object} o.site
 * @param {object} o.store
 * @param {object} o.adapter   adapter.url(path) turns a Home Assistant path into an address
 * @param {Function} o.goHome  back to the start view, panels closed
 * @param {Function} o.kiosk   () => is this device in kiosk mode
 * @param {Function} o.enterKiosk  starts kiosk mode (from a tap)
 * @param {AbortSignal} o.signal
 */
export function createWall({ site, store, adapter, goHome, kiosk, enterKiosk, signal }) {
  const cfg = site.wall_screen ?? {};
  const idle = cfg.idle ?? {};
  const bells = [].concat(cfg.doorbell ?? []).filter((b) => b?.entity && b?.camera);
  const timers = [];
  signal.addEventListener('abort', () => { timers.forEach(clearInterval); closeCamera(); dimmer.remove(); sheet.remove(); dim(false); });

  // ---------- idle
  let last = Date.now();
  let away = false; // went home after the last touch
  const backAfter = Number(idle.back_after ?? 120) * 1000;
  const dimLevel = Math.min(0.97, Math.max(0.2, Number(idle.dim ?? 0.85)));
  const dimClock = el('time', { class: 'idle-clock' });
  const dimmer = el('div', { class: 'idle-dim', hidden: true, 'aria-hidden': 'true' }, dimClock);
  dimmer.style.setProperty('--dim', String(dimLevel));
  document.body.append(dimmer);
  // A touch on the dimmed screen only wakes it; it does not reach the dashboard under it.
  dimmer.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); wake(); });
  dimmer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

  // The dim also pauses animations and timers underneath it (syncPause in util.js).
  function dim(on) {
    dimmer.hidden = !on;
    if (document.body.classList.contains('is-dimmed') === on) return;
    document.body.classList.toggle('is-dimmed', on);
    syncPause();
  }
  const touched = () => { last = Date.now(); away = false; if (!dimmer.hidden) wake(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCamera(); closeSheet(); } }, { signal });
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, touched, { capture: true, passive: true, signal });

  function wake() {
    last = Date.now();
    dim(false);
  }
  const night = () => inWindow(new Date(), idle.dim_from, idle.dim_to);
  function check() {
    if (!kiosk() || cameraOpen()) { dim(false); return; }
    const quiet = Date.now() - last;
    if (backAfter > 0 && quiet >= backAfter && !away) { away = true; goHome(); }
    const dimAfter = backAfter > 0 ? backAfter : 120000;
    if (night() && quiet >= dimAfter) {
      dimClock.textContent = new Date().toLocaleTimeString(site.locale, { hour: '2-digit', minute: '2-digit' });
      dim(true);
    } else if (!night()) dim(false);
  }
  timers.push(setInterval(check, 5000));
  // A motion sensor wakes the dimmed screen.
  const wakeIds = [].concat(idle.wake ?? []);
  const seen = new Map();
  if (wakeIds.length) {
    store.watch(wakeIds, () => {
      for (const id of wakeIds) {
        const s = store.get(id);
        if (isOn(s) && seen.has(id) && !isOn(seen.get(id))) wake();
        seen.set(id, s);
      }
    });
  }

  // ---------- doorbell (the window is ui/camera.js)
  const prev = new Map();
  for (const b of bells) {
    store.watch([b.entity], () => {
      const s = store.get(b.entity);
      if (rang(b.entity, prev.get(b.entity), s)) ring(b);
      prev.set(b.entity, s);
    });
  }

  function ring(b) {
    wake();
    openCamera({
      site, store, adapter, ids: [b.camera], seconds: Math.max(5, Number(b.seconds ?? 60)),
      eyebrow: t('wall.ringing'), title: (b.name ?? nameOf(b.camera, { store, site }, '')) || t('wall.door'),
      onClose: () => { last = Date.now(); },
    });
  }

  // ---------- the wall screen sheet (the Kiosk mode button): kiosk mode, light mode on
  // this device, test the doorbell
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': t('wall.lite') });
  const renderSeg = () => {
    const current = liteSetting();
    seg.replaceChildren(...['auto', 'on', 'off'].map((v) => el('button', {
      type: 'button', class: v === current ? 'is-active' : null, 'aria-pressed': String(v === current),
      onclick: () => {
        storage.set(LITE_KEY, v);
        document.body.classList.toggle('is-lite', liteMode(site, v));
        syncPause();
        renderSeg();
      },
    }, v === 'auto' ? t('wall.liteAuto', { state: t(liteAuto(site) ? 'wall.on' : 'wall.off') }) : t(v === 'on' ? 'wall.liteOn' : 'wall.liteOff'))));
  };
  const sheet = el('div', { class: 'sheet', hidden: true },
    el('div', { class: 'sheet-card', role: 'dialog', 'aria-label': t('wall.title') },
      el('header', { class: 'panel-head' },
        el('div', {}, el('p', { class: 'eyebrow' }, t('wall.eyebrow')), el('h2', { class: 'panel-title' }, t('wall.title'))),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: closeSheet }, '×')),
      el('p', { class: 'small' }, t('wall.kioskHelp')),
      el('div', { class: 'row' }, el('button', { class: 'chip chip-primary', type: 'button', onclick: () => { closeSheet(); enterKiosk(); } }, t('wall.startKiosk'))),
      el('h3', { class: 'eyebrow wall-h' }, t('wall.lite')),
      seg,
      el('p', { class: 'muted small' }, t('wall.liteHelp')),
      el('h3', { class: 'eyebrow wall-h' }, t('wall.doorbell')),
      el('p', { class: 'muted small' }, bells.length ? t('wall.doorbellOn') : t('wall.doorbellOff')),
      // Shows the window on this screen only; nothing is rung in Home Assistant.
      bells.length ? el('div', { class: 'row' }, el('button', { class: 'chip', type: 'button', onclick: () => { closeSheet(); ring(bells[0]); } }, t('wall.testDoorbell'))) : null));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  document.body.append(sheet);
  function closeSheet() { sheet.hidden = true; }

  return {
    ring: (i = 0) => bells[i] && ring(bells[i]),
    wake,
    open() { renderSeg(); sheet.hidden = false; },
  };
}
