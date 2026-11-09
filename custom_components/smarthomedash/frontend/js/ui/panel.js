// Room panel: thermostat, 24 h temperature, and every light in the room.

import { el, sv, fmt, clamp, num } from '../util.js';
import { isOn, level, roomTemp, climate } from '../entities.js';
import { t, has } from '../i18n.js';
import { kindOf, isOpen, isUnlocked, isAlarm, isDead, statusIds, isClosedCover } from '../status.js';

export function createPanel({ site, store, adapter }) {
  const body = el('div', { class: 'panel-body' });
  const title = el('h2', { class: 'panel-title' });
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('panel.close'), onclick: () => close() }, '×');
  const root = el('aside', { class: 'panel', 'aria-hidden': 'true', 'aria-label': t('panel.room') },
    el('header', { class: 'panel-head' }, el('div', {}, el('p', { class: 'eyebrow' }, t('panel.room')), title), closeBtn),
    body);

  let unwatch = [];
  let current = null;

  function close() {
    unwatch.forEach((u) => u()); unwatch = [];
    current = null;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    root.dispatchEvent(new CustomEvent('close'));
  }

  function open(room) {
    close();
    current = room;
    title.textContent = room.name;
    body.replaceChildren();
    if (room.photo) body.append(el('img', { class: 'room-photo', src: site.asset(room.photo), alt: room.name, loading: 'lazy' }));
    if (room.climate || room.temperature) body.append(climateSection(room));
    if (room.lights.length) body.append(lightsSection(room));
    if (room.status?.cover.length) body.append(coversSection(room));
    if (sensorIds(room).length) body.append(statusSection(room));
    if (!room.climate && !room.temperature && !room.lights.length && !statusIds(room).length) {
      body.append(el('p', { class: 'muted' }, t('panel.empty')));
    }
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    closeBtn.focus({ preventScroll: true });
  }

  function climateSection(room) {
    const now = el('div', { class: 'big-temp' });
    const status = el('p', { class: 'muted small' });
    const targetVal = el('output', { class: 'target-val', 'aria-live': 'polite' });
    let pending = null, pendingTimer = null;

    const step = (dir) => {
      const c = climate(store, room.climate);
      if (!c) return;
      const base = pending ?? c.target ?? 20;
      pending = clamp(+(base + dir * c.step).toFixed(1), c.min, c.max);
      targetVal.textContent = `${fmt(pending, 1, site.locale)}°`;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        adapter.call('climate', 'set_temperature', { entity_id: room.climate, temperature: pending });
        pending = null;
      }, 600);
    };

    const modes = el('div', { class: 'seg', role: 'group', 'aria-label': t('panel.mode') });
    const presets = el('div', { class: 'seg seg-wrap', role: 'group', 'aria-label': t('panel.preset') });
    const target = room.climate
      ? el('div', { class: 'target' },
        el('span', { class: 'label' }, t('panel.target')),
        el('button', { class: 'step', type: 'button', 'aria-label': t('panel.lower'), onclick: () => step(-1) }, '−'),
        targetVal,
        el('button', { class: 'step', type: 'button', 'aria-label': t('panel.raise'), onclick: () => step(1) }, '+'))
      : null;

    const chart = el('div', { class: 'chart' }, el('p', { class: 'muted small' }, t('panel.loadingHistory')));
    const src = room.temperature || room.climate;
    adapter.history(src, 24)
      .then((pts) => chart.replaceChildren(tempChart(pts, climate(store, room.climate)?.target, site)))
      .catch(() => chart.replaceChildren(el('p', { class: 'muted small' }, t('panel.noHistory'))));

    const sec = el('section', { class: 'psec' },
      el('h3', { class: 'eyebrow' }, t('panel.heating')),
      el('div', { class: 'temp-row' }, now, target),
      status, room.climate ? modes : null, room.climate ? presets : null, chart);

    unwatch.push(store.watch([room.climate, room.temperature], () => {
      const temp = roomTemp(store, room);
      now.textContent = temp == null ? '–' : `${fmt(temp, 1, site.locale)}°`;
      const c = room.climate ? climate(store, room.climate) : null;
      if (!c) { status.textContent = ''; return; }
      if (pending == null) targetVal.textContent = c.target == null ? '–' : `${fmt(c.target, 1, site.locale)}°`;
      const base = c.mode === 'off' ? t('panel.heatOff')
        : c.action === 'heating' ? t('panel.heatingNow')
          : t('panel.holding');
      status.textContent = c.preset && c.preset !== 'none' ? `${base} · ${presetLabel(c.preset)}` : base;
      status.classList.toggle('is-heating', c.action === 'heating');
      modes.replaceChildren(...c.modes.map((m) => el('button', {
        type: 'button', class: m === c.mode ? 'is-active' : '', 'aria-pressed': String(m === c.mode),
        onclick: () => adapter.call('climate', 'set_hvac_mode', { entity_id: room.climate, hvac_mode: m }),
      }, t(`mode.${m}`))));
      // Presets (Comfort, Eco, Frost, Schedule …) are how many thermostats are really run.
      presets.hidden = !c.presets.length;
      presets.replaceChildren(...c.presets.map((p) => el('button', {
        type: 'button', class: p === c.preset ? 'is-active' : '', 'aria-pressed': String(p === c.preset),
        onclick: () => adapter.call('climate', 'set_preset_mode', { entity_id: room.climate, preset_mode: p }),
      }, presetLabel(p))));
    }));
    return sec;
  }

  // Doors, windows, locks, presence, alarms and batteries in the room. Read only:
  // a wall screen is no place to unlock the front door.
  const sensorIds = (room) => statusIds(room).filter((id) => !(room.status?.cover ?? []).includes(id));

  // Blinds and curtains: up, stop and down, and a position slider where supported.
  function coversSection(room) {
    const list = el('ul', { class: 'light-list cover-list' });
    for (const id of room.status.cover) {
      const call = (service, data = {}) => adapter.call('cover', service, { entity_id: id, ...data });
      const state = el('span', { class: 'pct' });
      const range = el('input', { type: 'range', min: 0, max: 100, 'aria-label': t('panel.coverPosition') });
      range.addEventListener('change', () => call('set_cover_position', { position: Number(range.value) }));
      const btn = (label, aria, fn) => el('button', { class: 'step', type: 'button', 'aria-label': aria, onclick: fn }, label);
      const li = el('li', {},
        el('div', { class: 'light-top' }, el('span', { class: 'light-name' }), state,
          el('div', { class: 'cover-btns' },
            btn('▲', t('panel.coverOpen'), () => call('open_cover')),
            btn('■', t('panel.coverStop'), () => call('stop_cover')),
            btn('▼', t('panel.coverClose'), () => call('close_cover')))),
        range);
      list.append(li);
      unwatch.push(store.watch([id], () => {
        const s = store.get(id);
        li.querySelector('.light-name').textContent = s?.attributes?.friendly_name ?? id;
        const pos = num(s?.attributes?.current_position);
        state.textContent = isDead(s) ? t('status.unavailable') : pos != null ? `${pos} %` : t(isClosedCover(s) ? 'status.closed' : 'status.open');
        range.hidden = pos == null || !((s?.attributes?.supported_features ?? 0) & 4);
        if (pos != null && document.activeElement !== range) range.value = String(pos);
      }));
    }
    return el('section', { class: 'psec' }, el('h3', { class: 'eyebrow' }, t('panel.covers')), list);
  }

  function statusSection(room) {
    const list = el('ul', { class: 'status-list' });
    const ids = sensorIds(room);
    unwatch.push(store.watch(ids, () => {
      list.replaceChildren(...ids.map((id) => {
        const s = store.get(id);
        const [text, warn] = statusText(s);
        return el('li', { class: warn ? 'is-warn' : '' },
          el('span', {}, s?.attributes?.friendly_name ?? id),
          el('span', { class: 'status-val' }, text));
      }));
    }));
    return el('section', { class: 'psec' }, el('h3', { class: 'eyebrow' }, t('panel.status')), list);
  }

  function statusText(s) {
    if (isDead(s)) return [t('status.unavailable'), true];
    const dc = s.attributes?.device_class;
    switch (kindOf(s)) {
      case 'opening': return [t(isOpen(s) ? 'status.open' : 'status.closed'), isOpen(s)];
      case 'lock': return [t(isUnlocked(s) ? 'status.unlocked' : 'status.locked'), isUnlocked(s)];
      case 'presence': return [t(isOpen(s) ? (dc === 'motion' ? 'status.motion' : 'status.present') : 'status.clear'), false];
      case 'alarm': return [t(isAlarm(s) ? 'status.alarm' : 'status.ok'), isAlarm(s)];
      case 'battery': return s.entity_id.startsWith('binary_sensor.')
        ? [t(s.state === 'on' ? 'status.batteryLow' : 'status.ok'), s.state === 'on']
        : [`${s.state} %`, Number(s.state) <= 15];
      default: return [s.state, false];
    }
  }

  function lightsSection(room) {
    const list = el('ul', { class: 'light-list' });
    for (const l of room.lights) {
      const id = `rng-${l.entity.replace(/\W/g, '-')}`;
      const sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': l.name ?? room.name,
        onclick: () => adapter.call('homeassistant', 'toggle', { entity_id: l.entity }) });
      const range = el('input', { type: 'range', id, min: 1, max: 100, 'aria-label': t('panel.brightness', { name: l.name ?? room.name }),
        onchange: (e) => adapter.call('light', 'turn_on', { entity_id: l.entity, brightness_pct: +e.target.value }) });
      const pct = el('span', { class: 'pct' });
      // Only lights dim; a switch gets the on/off control alone.
      const dims = l.entity.startsWith('light.');
      const li = el('li', {}, el('div', { class: 'light-top' }, el('span', { class: 'light-name' }, l.name ?? room.name), pct, sw), dims ? range : null);
      list.append(li);
      unwatch.push(store.watch([l.entity], () => {
        const s = store.get(l.entity);
        const on = isOn(s);
        sw.setAttribute('aria-checked', String(on));
        li.classList.toggle('is-on', on);
        li.classList.toggle('is-missing', !s);
        const p = Math.round(level(s) * 100);
        pct.textContent = !s ? t('panel.missing') : on ? `${p} %` : t('panel.off');
        if (document.activeElement !== range) range.value = on ? p : 50;
        range.disabled = !s;
      }));
    }
    return el('section', { class: 'psec' }, el('h3', { class: 'eyebrow' }, t('panel.lights')), list);
  }

  return { el: root, open, close, get room() { return current; } };
}


// Known preset names get a translation; others are shown as the integration names them.
const presetLabel = (p) => { const k = `preset.${String(p).toLowerCase().replace(/\s+/g, '_')}`; return has(k) ? t(k) : p; };

function tempChart(points, target, site) {
  if (!points.length) return el('p', { class: 'muted small' }, t('panel.noHistory24'));
  const W = 320, H = 110, L = 30, R = 8, T = 10, B = 20;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vals = points.map((p) => p.v).concat(target ?? []);
  const lo = Math.floor(Math.min(...vals) - 0.3), hi = Math.ceil(Math.max(...vals) + 0.3);
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / Math.max(0.5, hi - lo)) * (H - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join('');
  const area = `${d}L${X(t1).toFixed(1)} ${H - B}L${X(t0).toFixed(1)} ${H - B}Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const last = points[points.length - 1];
  const hours = [0, 6, 12, 18, 24].map((h) => t0 + (h / 24) * (t1 - t0));
  return sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tchart', role: 'img', 'aria-label': t('panel.chart') },
    ticks.map((v) => [
      sv('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid' }),
      sv('text', { x: L - 6, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, `${v}°`)]),
    hours.map((t) => sv('text', { x: X(t), y: H - 5, 'text-anchor': 'middle', class: 'axis' },
      new Date(t).toLocaleTimeString(site.locale, { hour: '2-digit' }))),
    target != null ? sv('line', { x1: L, x2: W - R, y1: Y(target), y2: Y(target), class: 'target-line' }) : null,
    sv('path', { d: area, class: 'area' }),
    sv('path', { d, class: 'line' }),
    sv('circle', { cx: X(last.t), cy: Y(last.v), r: 3.5, class: 'dot' }));
}
