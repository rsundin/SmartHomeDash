// Whole-house lights: "All on", "All off" and "Goodnight", in the lights card and in the header.
//
//   "all_lights": { "enabled": true, "exclude": ["light.garden"] }
//
// "enabled": false hides both buttons (set under Buttons in the setup guide).
// "All" is every light on this dashboard, including the ones picked up from linked
// Home Assistant areas (site.index.lights grows when areas load, so it is read on each tap),
// minus the excluded ones. On takes one tap; off asks for a second tap, so nobody is left
// in the dark by mistake.
//
//   "goodnight": { "enabled": true, "minutes": 5, "then": "script.lock_up" }
//
// Goodnight leaves the lights as they are for a few minutes, then turns the same lights
// off and runs `then`. The countdown runs in Home Assistant (goodnight.py, the
// smarthomedash.goodnight action), so a tablet that sleeps or reloads does not stop it;
// every screen shows it from the state smarthomedash.goodnight_<site>, with Cancel.

import { el, sv, paused } from '../util.js';
import { isOn } from '../entities.js';
import { t } from '../i18n.js';

export const allLightsOn = (site) => site.all_lights?.enabled !== false;

export function allLights(site) {
  const skip = new Set(site.all_lights?.exclude ?? []);
  return site.index.lights.filter((id) => !skip.has(id));
}

export function switchAll(site, adapter, on) {
  const ids = allLights(site);
  if (ids.length) adapter.call('homeassistant', on ? 'turn_on' : 'turn_off', { entity_id: ids });
}

export function allOnButton({ site, adapter, onDone }) {
  return el('button', { class: 'chip', type: 'button', 'data-action': 'all-on',
    onclick: () => { switchAll(site, adapter, true); onDone?.(); } }, t('cards.allOn'));
}

// "All off" asks for a second tap instead of a dialog.
export function allOffButton({ site, adapter, onDone }) {
  let armed = null;
  const btn = el('button', { class: 'chip chip-danger', type: 'button', 'data-action': 'all-off' }, t('cards.allOff'));
  const disarm = () => { clearTimeout(armed); armed = null; btn.textContent = t('cards.allOff'); btn.classList.remove('is-armed'); };
  btn.addEventListener('click', () => {
    if (!armed) {
      btn.textContent = t('cards.allOffConfirm');
      btn.classList.add('is-armed');
      armed = setTimeout(disarm, 3500);
      return;
    }
    disarm();
    switchAll(site, adapter, false);
    onDone?.();
  });
  btn.disarm = disarm;
  return btn;
}

export const goodnightOn = (site) => site.goodnight?.enabled !== false;
export const goodnightState = (site) => `smarthomedash.goodnight_${site.id.toLowerCase().replace(/-/g, '_')}`;

function startGoodnight(site, adapter) {
  const g = site.goodnight ?? {};
  const data = { site: site.id, entity_id: allLights(site), minutes: g.minutes ?? 5 };
  if (g.then) data.then = g.then;
  return adapter.call('smarthomedash', 'goodnight', data);
}

export function goodnightButton({ site, adapter, onDone, onError }) {
  return el('button', { class: 'chip chip-goodnight', type: 'button', 'data-action': 'goodnight',
    onclick: () => { Promise.resolve(startGoodnight(site, adapter)).catch((e) => onError?.(e)); onDone?.(); } }, t('goodnight.button'));
}

// The countdown on every screen: "Turning everything off in 4:12" with Cancel.
export function createGoodnightBanner({ site, store, adapter, signal }) {
  const text = el('span', {});
  const cancel = el('button', { class: 'chip', type: 'button', 'data-action': 'goodnight-cancel',
    onclick: () => adapter.call('smarthomedash', 'goodnight', { site: site.id, cancel: true }) }, t('goodnight.cancel'));
  const bar = el('div', { class: 'goodnight', role: 'status', 'aria-live': 'polite', hidden: true }, text, cancel);
  const id = goodnightState(site);
  let timer = null;
  let ends = 0;
  const tick = () => {
    const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
    text.textContent = t('goodnight.countdown', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
  };
  const stopTimer = () => { clearInterval(timer); timer = null; };
  const unwatch = store.watch([id], () => {
    const s = store.get(id);
    const at = s?.state === 'on' ? Date.parse(s.attributes?.ends_at) : NaN;
    bar.hidden = !Number.isFinite(at);
    if (bar.hidden) { stopTimer(); return; }
    ends = at;
    tick();
    // Each second while it counts down; the store's own updates keep a paused page right.
    if (!timer) timer = setInterval(() => { if (!paused()) tick(); }, 1000);
  });
  signal?.addEventListener('abort', () => { stopTimer(); unwatch(); });
  // A failed start (an older Home Assistant integration without the action) says so here.
  const failed = () => {
    bar.hidden = false;
    text.textContent = t('goodnight.failed');
    cancel.hidden = true;
    setTimeout(() => { cancel.hidden = false; if (!timer) bar.hidden = true; }, 5000);
  };
  return { el: bar, failed };
}

const lampIcon = () => sv('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', class: 'lights-icon' },
  sv('path', { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

// The header control: a lamp button that opens a small menu with the buttons. It stays
// on wall screens in kiosk mode, where the lights card is a scroll away. The lamp shows
// whether any of the lights is on.
export function createLightsMenu({ site, store, adapter, signal, onGoodnightError }) {
  const btn = el('button', { class: 'chip chip-lights', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    title: t('lights.menu'), 'aria-label': t('lights.menu') }, lampIcon());
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); off.disarm(); };
  const both = allLightsOn(site);
  const on = both ? allOnButton({ site, adapter, onDone: close }) : null;
  const off = both ? allOffButton({ site, adapter, onDone: close }) : { disarm() {} };
  const night = goodnightOn(site) ? goodnightButton({ site, adapter, onDone: close, onError: onGoodnightError }) : null;
  const menu = el('div', { class: 'lights-menu', role: 'menu', hidden: true }, on, both ? off : null, night);
  btn.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Opens to the right of the lamp, or to the left where the screen ends.
    menu.classList.remove('to-left');
    if (menu.getBoundingClientRect().right > document.documentElement.clientWidth - 8) menu.classList.add('to-left');
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !wrap.contains(e.target)) close(); }, { signal });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) close(); }, { signal });
  const wrap = el('div', { class: 'lights-wrap' }, btn, menu);
  // Which lights to watch is known once areas have loaded; refresh() is called then.
  let unwatch = null;
  const refresh = () => {
    unwatch?.();
    const ids = allLights(site);
    unwatch = store.watch(ids, () => btn.classList.toggle('is-on', ids.some((id) => isOn(store.get(id)))));
  };
  refresh();
  return { el: wrap, refresh, close };
}
