// Room panel: thermostat, 24 h temperature, and every light in the room.

import { el, sv, fmt, clamp, num } from '../util.js';
import { isOn, level, roomTemp, climate, nameOf, noReading, fahrenheit } from '../entities.js';
import { t, has } from '../i18n.js';
import { kindOf, isOpen, isUnlocked, isAlarm, isDead, statusIds, isClosedCover } from '../status.js';

export function createPanel({ site, store, adapter }) {
  const body = el('div', { class: 'panel-body' });
  const title = el('h2', { class: 'panel-title' });
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('panel.close'), onclick: () => close() }, '×');
  const root = el('aside', { class: 'panel', 'aria-hidden': 'true', inert: '', 'aria-label': t('panel.room') },
    el('header', { class: 'panel-head' }, el('div', {}, el('p', { class: 'eyebrow' }, t('panel.room')), title), closeBtn),
    body);

  let unwatch = [];
  let current = null;
  let opener = null; // what had focus when the panel opened

  function close() {
    unwatch.forEach((u) => u()); unwatch = [];
    current = null;
    root.classList.remove('is-open');
    // Focus goes back to the room or lamp the panel was opened from.
    if (root.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    root.dispatchEvent(new CustomEvent('close'));
  }

  function open(room) {
    const from = root.contains(document.activeElement) ? opener : document.activeElement;
    close();
    opener = from;
    current = room;
    title.textContent = room.name;
    body.replaceChildren();
    if (room.photo) {
      const photo = el('img', { class: 'room-photo', alt: room.name, loading: 'lazy' });
      // The photo may still be on its way right after start (site.js): it is added when it is in.
      if (site.asset(room.photo)) photo.src = site.asset(room.photo);
      else { photo.hidden = true; site.pictures([room.photo]).then(() => { if (site.asset(room.photo)) { photo.src = site.asset(room.photo); photo.hidden = false; } }); }
      body.append(photo);
    }
    if (room.climate || room.temperature) body.append(climateSection(room));
    if (room.lights.length) body.append(lightsSection(room));
    if (room.status?.cover.length) body.append(coversSection(room));
    if (sensorIds(room).length) body.append(statusSection(room));
    if (!room.climate && !room.temperature && !room.lights.length && !statusIds(room).length) {
      body.append(el('p', { class: 'muted' }, t('panel.empty')));
    }
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    root.inert = false;
    closeBtn.focus({ preventScroll: true });
  }

  function climateSection(room) {
    const now = el('div', { class: 'big-temp' });
    const status = el('p', { class: 'muted small' });
    const targetVal = el('output', { class: 'target-val', 'aria-live': 'polite' });
    let pending = null, pendingTimer = null;

    const f = fahrenheit(site);
    const targetText = (c) => (c?.target == null ? '–' : `${fmt(c.target, 1, site.locale)}°`);
    const step = (dir) => {
      const c = climate(store, room.climate, f);
      if (!c || c.dead) return;
      const base = pending ?? c.target ?? (f ? 68 : 20);
      pending = clamp(+(base + dir * c.step).toFixed(1), c.min, c.max);
      targetVal.textContent = `${fmt(pending, 1, site.locale)}°`;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        const temperature = pending;
        pending = null;
        // Refused: back to what the thermostat says (the error itself is shown by main.js).
        adapter.call('climate', 'set_temperature', { entity_id: room.climate, temperature })
          .then((ok) => { if (ok === false && pending == null) targetVal.textContent = targetText(climate(store, room.climate, f)); });
      }, 600);
    };

    const modes = el('div', { class: 'seg', role: 'group', 'aria-label': t('panel.mode') });
    const presets = el('div', { class: 'seg seg-wrap', role: 'group', 'aria-label': t('panel.preset') });
    const steps = [
      el('button', { class: 'step', type: 'button', 'aria-label': t('panel.lower'), onclick: () => step(-1) }, '−'),
      el('button', { class: 'step', type: 'button', 'aria-label': t('panel.raise'), onclick: () => step(1) }, '+')];
    const target = room.climate
      ? el('div', { class: 'target' }, el('span', { class: 'label' }, t('panel.target')), steps[0], targetVal, steps[1])
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
      const c = room.climate ? climate(store, room.climate, f) : null;
      // No temperature because the sensor or thermostat is not responding.
      const silentTemp = temp == null && [room.temperature, room.climate].some((id) => noReading(store.get(id)));
      if (!c) { status.textContent = silentTemp ? t('cards.tempSilent') : ''; return; }
      // A thermostat that is not responding cannot be set: no buttons to press in vain.
      for (const b of steps) b.disabled = c.dead;
      if (c.dead) {
        pending = null;
        targetVal.textContent = '–';
        status.textContent = t('cards.thermostatSilent');
        status.classList.remove('is-heating');
        modes.replaceChildren();
        modes.hidden = true;
        presets.replaceChildren();
        presets.hidden = true;
        return;
      }
      if (pending == null) targetVal.textContent = targetText(c);
      const base = c.mode === 'off' ? t('panel.heatOff')
        : c.action === 'heating' ? t('panel.heatingNow')
          : t('panel.holding');
      status.textContent = c.preset && c.preset !== 'none' ? `${base} · ${presetLabel(c.preset)}` : base;
      status.classList.toggle('is-heating', c.action === 'heating');
      if (silentTemp) status.textContent += ` · ${t('cards.tempSilent')}`;
      // A thermostat without HVAC modes gets no empty mode row.
      modes.hidden = !c.modes.length;
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
      range.addEventListener('change', () => call('set_cover_position', { position: Number(range.value) })
        .then((ok) => { if (ok === false) { const pos = num(store.get(id)?.attributes?.current_position); if (pos != null) range.value = String(pos); } }));
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
        li.querySelector('.light-name').textContent = nameOf(id, { store, site });
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
          el('span', {}, nameOf(id, { store, site })),
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
        // Refused: the slider goes back to the light's brightness.
        onchange: (e) => adapter.call('light', 'turn_on', { entity_id: l.entity, brightness_pct: +e.target.value })
          .then((ok) => { if (ok === false) { range.blur(); draw(); } }) });
      const pct = el('span', { class: 'pct' });
      // Only lights dim; a switch gets the on/off control alone.
      const dims = l.entity.startsWith('light.');
      const li = el('li', {}, el('div', { class: 'light-top' }, el('span', { class: 'light-name' }, l.name ?? room.name), pct, sw), dims ? range : null);
      list.append(li);
      const draw = () => {
        const s = store.get(l.entity);
        const on = isOn(s);
        sw.setAttribute('aria-checked', String(on));
        li.classList.toggle('is-on', on);
        li.classList.toggle('is-missing', !s);
        const dead = noReading(s);
        li.classList.toggle('is-silent', dead);
        const p = Math.round(level(s) * 100);
        pct.textContent = !s ? t('panel.missing') : dead ? t('status.unavailable') : on ? `${p} %` : t('panel.off');
        if (document.activeElement !== range) range.value = on ? p : 50;
        range.disabled = !s || dead;
      };
      unwatch.push(store.watch([l.entity], draw));
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
  // The graph in words, for screen readers.
  const deg = (v) => `${fmt(v, 1, site.locale)}°`;
  const summary = t('panel.chartSummary', { now: deg(last.v), low: deg(Math.min(...points.map((p) => p.v))), high: deg(Math.max(...points.map((p) => p.v))) });
  return sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tchart', role: 'img', 'aria-label': `${t('panel.chart')}. ${summary}` },
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
