// Test data adapter: invents plausible states for every entity in the site config,
// reacts to the same service calls as HA, and drifts values over time.
// Lets you build and try a site before it is connected to Home Assistant.

import { num } from '../util.js';

export function createMockAdapter(site) {
  let store;
  let demoMode = 'auto'; // 'auto' follows the clock; 'day' / 'night' follow the header button
  const rnd = seeded(site.id.length * 7919);
  const now = () => new Date().toISOString();
  const S = (entity_id, state, attributes = {}) =>
    ({ entity_id, state: String(state), attributes, last_changed: now(), last_updated: now() });
  const set = (id, state, attrs) => {
    const prev = store.get(id);
    store.update(S(id, state ?? prev?.state, { ...(prev?.attributes || {}), ...(attrs || {}) }));
  };

  const E = site.energy || {};
  const sunTimes = site.mock?.sun ?? { rise: '07:30', set: '15:50' };

  function sunState() {
    const today = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
    const rise = today(sunTimes.rise), setT = today(sunTimes.set), t = new Date();
    const nextRise = t < rise ? rise : new Date(rise.getTime() + 864e5);
    const nextSet = t < setT ? setT : new Date(setT.getTime() + 864e5);
    const up = t >= rise && t < setT;
    // A rough elevation: an arc up to 25° by day, down to -30° at midnight.
    const day = (t - rise) / (setT - rise);
    const elevation = up ? 25 * Math.sin(Math.PI * day) : -30 * Math.sin(Math.PI * Math.min(1, ((t - setT + (t < rise ? 864e5 : 0)) / (864e5 - (setT - rise)))));
    return S('sun.sun', up ? 'above_horizon' : 'below_horizon',
      { next_rising: nextRise.toISOString(), next_setting: nextSet.toISOString(), elevation: +elevation.toFixed(1), friendly_name: 'Sun' });
  }

  function prices() {
    // A typical Swedish winter day: night trough, morning and evening peaks, SEK/kWh.
    return Array.from({ length: 24 }, (_, h) => {
      const morning = Math.exp(-((h - 8) ** 2) / 4) * 1.1;
      const evening = Math.exp(-((h - 18) ** 2) / 5) * 1.6;
      return +(0.45 + morning + evening + rnd() * 0.15).toFixed(2);
    });
  }

  function seed() {
    const list = [];
    const scenesOn = new Set(site.mock?.lights_on ?? []);
    for (const id of site.index.lights) {
      const on = scenesOn.size ? scenesOn.has(id) : rnd() < 0.45;
      list.push(S(id, on ? 'on' : 'off', {
        friendly_name: site.index.names.get(id) ?? id,
        brightness: on ? Math.round(140 + rnd() * 115) : null,
        ...(site.mock?.colors?.[id]
          ? { supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: site.mock.colors[id] }
          : site.mock?.color_temps?.[id]
            ? { supported_color_modes: ['color_temp'], color_mode: 'color_temp', color_temp_kelvin: site.mock.color_temps[id] }
            : { supported_color_modes: ['brightness'] }),
      }));
    }
    // Doors, windows, locks, presence and alarms: site.mock.sensors =
    // { entity_id: { state, device_class?, unit?, name? } }
    for (const [id, m] of Object.entries(site.mock?.sensors ?? {})) {
      list.push(S(id, String(m.state ?? 'off'), {
        friendly_name: m.name ?? id,
        ...(m.device_class ? { device_class: m.device_class } : {}),
        ...(m.unit ? { unit_of_measurement: m.unit } : {}),
        ...(m.attributes ?? {}),
      }));
    }
    for (const room of site.index.rooms.values()) {
      if (room.climate) {
        const target = room.mock?.target ?? 21;
        const current = +(target - 1.4 + rnd() * 2).toFixed(1);
        list.push(S(room.climate, 'heat', {
          friendly_name: room.name, hvac_modes: room.device ? ['heat', 'cool', 'auto', 'off'] : ['heat', 'off'], temperature: target,
          preset_modes: room.device ? undefined : ['Comfort', 'Eco', 'Frost'], preset_mode: room.device ? undefined : 'Comfort',
          current_temperature: current, hvac_action: current < target - 0.2 ? 'heating' : 'idle',
          min_temp: 5, max_temp: 28, target_temp_step: 0.5,
        }));
      }
      if (room.temperature) {
        const c = list.find((s) => s.entity_id === room.climate);
        const t = c ? c.attributes.current_temperature : +(18.5 + rnd() * 3.5).toFixed(1);
        list.push(S(room.temperature, t, { unit_of_measurement: '°C', device_class: 'temperature' }));
      }
    }
    if (E.grid_power) list.push(S(E.grid_power, Math.round(1400 + rnd() * 1800), { unit_of_measurement: 'W' }));
    if (E.pv_power) list.push(S(E.pv_power, 0, { unit_of_measurement: 'W' }));
    if (E.battery_power) list.push(S(E.battery_power, 0, { unit_of_measurement: 'W' }));
    if (E.battery_soc) list.push(S(E.battery_soc, 64, { unit_of_measurement: '%' }));
    if (E.load_power) list.push(S(E.load_power, 2.1, { unit_of_measurement: 'kW' }));
    if (E.savings_today) list.push(S(E.savings_today, 7.4, { unit_of_measurement: site.currency }));
    if (E.charger_power) list.push(S(E.charger_power, 0, { unit_of_measurement: 'W' }));
    if (E.energy_today) list.push(S(E.energy_today, (new Date().getHours() * 1.6).toFixed(2), { unit_of_measurement: 'kWh' }));
    if (E.pv_energy_today) list.push(S(E.pv_energy_today, (Math.min(new Date().getHours(), 15) * 0.35).toFixed(2), { unit_of_measurement: 'kWh' }));
    if (E.cost_today) list.push(S(E.cost_today, (new Date().getHours() * 1.9).toFixed(2), { unit_of_measurement: site.currency }));
    if (E.price?.entity) {
      const today = prices();
      list.push(S(E.price.entity, today[new Date().getHours()], { [E.price.today_attribute || 'today']: today, unit_of_measurement: `${site.currency}/kWh` }));
    }
    if (site.weather) {
      list.push(S(site.weather, 'cloudy', { temperature: 6.5, wind_speed: 4, wind_gust_speed: 9, humidity: 86, temperature_unit: '°C', wind_speed_unit: 'm/s' }));
    }
    for (const x of site.mock?.entities ?? []) {
      const id = typeof x === 'string' ? x : x.entity;
      if (list.some((s) => s.entity_id === id)) continue;
      list.push(S(id, 'off', { friendly_name: (typeof x === 'object' && x.name) || id, ...((typeof x === 'object' && x.attributes) || {}) }));
    }
    list.push(sunState());
    for (const sc of site.scenes) list.push(S(sc.entity, sc.entity.startsWith('script.') ? 'off' : 'scening', { friendly_name: sc.name }));
    return list;
  }

  // A plausible power balance for the energy flow: the house uses 1-3 kW, solar covers
  // what it can, surplus charges the battery and the rest is sold; in the evening the
  // battery helps out. The car charges around midday when there is a charger.
  function balance() {
    const kW = (id) => { const s = store.get(id); const v = num(s?.state) ?? 0; return (s?.attributes?.unit_of_measurement || 'W').toLowerCase() === 'kw' ? v : v / 1000; };
    const prev = kW(E.load_power) || 2;
    const load = Math.min(3.4, Math.max(0.9, prev + (rnd() - 0.5) * 0.3));
    const pv = E.pv_power ? kW(E.pv_power) : 0;
    const h = demoMode === 'day' ? 12 : new Date().getHours();
    const car = E.charger_power && h >= 10 && h < 15 ? 3.7 : 0;
    let soc = num(store.get(E.battery_soc)?.state) ?? 64;
    let bat = 0; // above zero: discharging into the house
    const surplus = pv - load - car;
    if (E.battery_power) {
      if (surplus > 0 && soc < 96) bat = -Math.min(surplus, 3);
      else if (surplus < 0 && soc > 20 && (h >= 16 || h < 7)) bat = Math.min(-surplus, 2.5);
    }
    const grid = load + car - pv - bat;
    soc = Math.min(100, Math.max(5, soc - (bat * (4 / 3600) / 10) * 100));
    if (E.load_power) set(E.load_power, load.toFixed(2));
    if (E.grid_power) set(E.grid_power, Math.round(grid * 1000));
    if (E.battery_power) set(E.battery_power, Math.round(bat * 1000));
    if (E.battery_soc) set(E.battery_soc, soc.toFixed(1));
    if (E.charger_power) set(E.charger_power, Math.round(car * 1000));
  }

  function tick() {
    const sun = sunState();
    store.update(sun);
    const up = sun.state === 'above_horizon';
    if (E.pv_power) {
      // Follows the sun; when the dashboard is forced to "Dag" it shows midday production.
      const demoDay = demoMode === 'day';
      const h = demoDay ? 12 : new Date().getHours() + new Date().getMinutes() / 60;
      const peakW = (site.overview?.solar?.peak_kw ?? 5) * 1000 * 0.75;
      const peak = Math.max(0, Math.sin(((h - 7.5) / 8.3) * Math.PI)) * peakW;
      set(E.pv_power, demoMode !== 'night' && (up || demoDay) ? Math.round(peak * (0.75 + rnd() * 0.25)) : 0);
    }
    balance();
    if (E.energy_today) {
      const kwh = num(store.get(E.energy_today)?.state) ?? 0;
      const w = num(store.get(E.grid_power)?.state) ?? 1500;
      const added = (w / 1000) * (4 / 3600);
      set(E.energy_today, (kwh + added).toFixed(3));
      if (E.cost_today) {
        const price = num(store.get(E.price?.entity)?.state) ?? 1;
        set(E.cost_today, ((num(store.get(E.cost_today)?.state) ?? 0) + added * price).toFixed(3));
      }
    }
    for (const room of site.index.rooms.values()) {
      if (!room.climate) continue;
      const s = store.get(room.climate);
      const a = s.attributes;
      let cur = a.current_temperature;
      const target = s.state === 'off' ? 12 : a.temperature;
      cur = +(cur + (target > cur ? 0.06 : -0.04) + (rnd() - 0.5) * 0.04).toFixed(2);
      const action = s.state === 'off' ? 'off' : cur < a.temperature - 0.2 ? 'heating' : 'idle';
      set(room.climate, null, { current_temperature: +cur.toFixed(1), hvac_action: action });
      if (room.temperature) set(room.temperature, cur.toFixed(1));
    }
  }

  return {
    kind: 'mock',
    setDemoMode(mode) {
      if (demoMode === mode || !store) return;
      demoMode = mode;
      tick();
    },
    async connect(s, onStatus) {
      store = s;
      store.replace(seed());
      onStatus('mock');
      setInterval(tick, 4000);
    },

    async call(domain, service, data = {}) {
      await new Promise((r) => setTimeout(r, 120));
      const ids = [].concat(data.entity_id ?? []);
      if (domain === 'light' || domain === 'homeassistant' || domain === 'switch') {
        for (const id of ids) {
          const s = store.get(id);
          if (!s) continue;
          const turnOn = service === 'turn_on' || (service === 'toggle' && s.state !== 'on');
          let b = data.brightness ?? (data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : null);
          if (turnOn && b == null) b = s.attributes.brightness || 220;
          set(id, turnOn ? 'on' : 'off', { brightness: turnOn ? b : null, ...(data.rgb_color ? { rgb_color: data.rgb_color } : {}) });
        }
      } else if (domain === 'cover') {
        for (const id of ids) {
          const pos = service === 'open_cover' ? 100 : service === 'close_cover' ? 0
            : service === 'set_cover_position' ? data.position : num(store.get(id)?.attributes?.current_position);
          if (pos == null) continue;
          set(id, pos > 0 ? 'open' : 'closed', { current_position: pos });
        }
      } else if (domain === 'climate') {
        for (const id of ids) {
          if (service === 'set_temperature') set(id, null, { temperature: data.temperature });
          if (service === 'set_preset_mode') set(id, null, { preset_mode: data.preset_mode, temperature: { Comfort: 21, Eco: 18, Frost: 8 }[data.preset_mode] ?? store.get(id)?.attributes?.temperature });
          if (service === 'set_hvac_mode') set(id, data.hvac_mode, { hvac_action: data.hvac_mode === 'off' ? 'off' : 'idle' });
        }
        tick();
      } else if (domain === 'scene' && service === 'turn_on') {
        for (const id of ids) {
          const sc = site.scenes.find((x) => x.entity === id);
          const on = new Set(sc?.mock?.on ?? []);
          const off = sc?.mock?.off === 'all' ? site.index.lights : sc?.mock?.off ?? [];
          for (const l of off) if (!on.has(l)) set(l, 'off', { brightness: null });
          for (const l of on) set(l, 'on', { brightness: 200 });
        }
      }
    },

    // Test areas: one per room and one per outdoor lamp group, named like them,
    // or the list in site.mock.areas: [{ area_id, name, entities: [...] }].
    async areas() {
      const areas = [], entities = [];
      const add = (area_id, name, ids) => {
        if (!areas.some((a) => a.area_id === area_id)) areas.push({ area_id, name });
        for (const id of ids) if (id) entities.push({ entity_id: id, area_id, device_id: null });
      };
      if (site.mock?.areas) {
        for (const a of site.mock.areas) add(a.area_id, a.name, a.entities ?? []);
      } else {
        for (const room of site.index.rooms.values()) {
          if (room.device) continue;
          add(room.ha_area ?? room.id, room.name, [...room.lights.map((l) => l.entity), room.climate, room.temperature, ...(room.sensors ?? [])]);
        }
        for (const z of site.overview?.zones ?? []) add(`outdoor_${z.id}`, z.name, z.lights);
      }
      // One test floor per floor plan, or site.mock.floors: [{ floor_id, name, level }].
      const floors = site.mock?.floors ?? site.floorplans.map((p, i) => ({ floor_id: `floor_${p.id}`, name: p.name, level: i }));
      return { areas, entities, devices: [], floors };
    },

    async history(entityId, hours = 24) {
      const s = store.get(entityId);
      const base = entityId.startsWith('climate.') ? s?.attributes?.temperature ?? 21 : num(s?.state) ?? 21;
      const end = Date.now();
      return Array.from({ length: hours * 4 + 1 }, (_, i) => {
        const t = end - (hours * 4 - i) * 15 * 60e3;
        const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
        const v = base - 0.6 + Math.sin(((h - 9) / 24) * Math.PI * 2) * 0.7 + (Math.sin(i * 0.35) * 0.08);
        return { t, v: +v.toFixed(2) };
      });
    },
  };
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
