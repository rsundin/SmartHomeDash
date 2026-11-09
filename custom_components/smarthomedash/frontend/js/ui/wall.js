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
// Light mode: no blur, blending or animation, for older tablets. Per device with ?lite
// (and ?lite=0 to turn it off again), or for every screen with "lite": true.

import { el, storage } from '../util.js';
import { t } from '../i18n.js';

const LITE_KEY = 'shd:lite';

// Query parameters of the page the user sees: in the Home Assistant panel that is the
// window around this frame.
function pageParams() {
  try { return new URLSearchParams(window.top.location.search); } catch { return new URLSearchParams(location.search); }
}

export function liteMode(site) {
  const p = pageParams();
  if (p.has('lite')) storage.set(LITE_KEY, !['0', 'false', 'off'].includes(p.get('lite')));
  const device = storage.get(LITE_KEY);
  return device ?? site.wall_screen?.lite === true;
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
 * @param {AbortSignal} o.signal
 */
export function createWall({ site, store, adapter, goHome, kiosk, signal }) {
  const cfg = site.wall_screen ?? {};
  const idle = cfg.idle ?? {};
  const bells = [].concat(cfg.doorbell ?? []).filter((b) => b?.entity && b?.camera);
  const timers = [];
  signal.addEventListener('abort', () => { timers.forEach(clearInterval); closeBell(); dimmer.remove(); });

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

  const touched = () => { last = Date.now(); away = false; if (!dimmer.hidden) wake(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBell(); }, { signal });
  for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, touched, { capture: true, passive: true, signal });

  function wake() {
    last = Date.now();
    dimmer.hidden = true;
  }
  const night = () => inWindow(new Date(), idle.dim_from, idle.dim_to);
  function check() {
    if (!kiosk() || bell) { dimmer.hidden = true; return; }
    const quiet = Date.now() - last;
    if (backAfter > 0 && quiet >= backAfter && !away) { away = true; goHome(); }
    const dimAfter = backAfter > 0 ? backAfter : 120000;
    if (night() && quiet >= dimAfter) {
      dimClock.textContent = new Date().toLocaleTimeString(site.locale, { hour: '2-digit', minute: '2-digit' });
      dimmer.hidden = false;
    } else if (!night()) dimmer.hidden = true;
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

  // ---------- doorbell
  let bell = null;
  const prev = new Map();
  for (const b of bells) {
    store.watch([b.entity], () => {
      const s = store.get(b.entity);
      if (rang(b.entity, prev.get(b.entity), s)) ring(b);
      prev.set(b.entity, s);
    });
  }

  function cameraUrl(id, stream) {
    const pic = store.get(id)?.attributes?.entity_picture;
    if (!pic) return '';
    const path = stream ? pic.replace('/api/camera_proxy/', '/api/camera_proxy_stream/') : pic;
    return path.startsWith('/') ? (adapter.url?.(path) ?? path) : path;
  }

  function ring(b) {
    closeBell();
    wake();
    const seconds = Math.max(5, Number(b.seconds ?? 60));
    const name = b.name ?? store.get(b.camera)?.attributes?.friendly_name ?? '';
    const img = el('img', { class: 'bell-cam', alt: t('wall.camera', { name }) });
    let stills = null;
    // A live picture where the camera allows it; otherwise a new still every two seconds.
    img.addEventListener('error', () => {
      if (stills) return;
      const next = () => { img.src = `${cameraUrl(b.camera, false)}${cameraUrl(b.camera, false).includes('?') ? '&' : '?'}t=${Date.now()}`; };
      stills = setInterval(next, 2000);
      next();
    }, { once: true });
    img.src = cameraUrl(b.camera, true);
    const left = el('span', { class: 'muted small' });
    const box = el('div', { class: 'bell', role: 'dialog', 'aria-label': t('wall.ringing') },
      el('div', { class: 'bell-card' },
        el('header', { class: 'panel-head' },
          el('div', {}, el('p', { class: 'eyebrow' }, t('wall.ringing')), el('h2', { class: 'panel-title' }, name || t('wall.door'))),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: closeBell }, '×')),
        img,
        left));
    box.addEventListener('click', (e) => { if (e.target === box) closeBell(); });
    const until = Date.now() + seconds * 1000;
    const tick = () => {
      const s = Math.ceil((until - Date.now()) / 1000);
      if (s <= 0) { closeBell(); return; }
      left.textContent = t('wall.closesIn', { s });
    };
    tick();
    const countdown = setInterval(tick, 1000);
    bell = { box, img, stop: () => { clearInterval(countdown); clearInterval(stills); } };
    document.body.append(box);
  }

  function closeBell() {
    if (!bell) return;
    bell.stop();
    // Empty the picture so the browser drops the live stream.
    bell.img.removeAttribute('src');
    bell.box.remove();
    bell = null;
    last = Date.now();
  }

  return { ring: (i = 0) => bells[i] && ring(bells[i]), wake };
}
