// Adapter for the Home Assistant panel: uses the `hass` object Home Assistant hands
// to the panel. It is already logged in as the current user, so no token is needed.
//
// Home Assistant sets a new `hass` object on every state change; setHass() compares
// the state objects and passes only the changed ones on to the store.

export function createHassAdapter(initialHass) {
  let hass = initialHass;
  let store = null;
  let last = {};

  function sync() {
    const states = hass?.states ?? {};
    if (!store) return;
    for (const [id, s] of Object.entries(states)) {
      if (last[id] !== s) store.update(s);
    }
    last = states;
  }

  return {
    kind: 'panel',

    async connect(s, onStatus) {
      store = s;
      last = hass.states;
      store.replace(Object.values(hass.states));
      onStatus('connected');
    },

    setHass(next) {
      hass = next;
      sync();
    },

    call(domain, service, data) {
      return hass.callService(domain, service, data);
    },

    // Area, entity and device registries. Recent Home Assistant versions hand them to
    // the frontend on the hass object; older ones are asked over the websocket.
    async areas() {
      if (hass.areas && hass.entities && hass.devices) {
        return { areas: Object.values(hass.areas), entities: Object.values(hass.entities), devices: Object.values(hass.devices), floors: Object.values(hass.floors ?? {}) };
      }
      const [areas, entities, devices, floors] = await Promise.all([
        hass.callWS({ type: 'config/area_registry/list' }),
        hass.callWS({ type: 'config/entity_registry/list' }),
        hass.callWS({ type: 'config/device_registry/list' }),
        hass.callWS({ type: 'config/floor_registry/list' }).catch(() => []),
      ]);
      return { areas, entities, devices, floors };
    },

    async history(entityId, hours = 24) {
      const isClimate = entityId.startsWith('climate.');
      const res = await hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(Date.now() - hours * 3600e3).toISOString(),
        entity_ids: [entityId],
        minimal_response: !isClimate,
        no_attributes: !isClimate,
        significant_changes_only: false,
      });
      let lastAttr = null;
      return (res?.[entityId] ?? []).map((p) => {
        if (p.a) lastAttr = p.a;
        const v = isClimate ? lastAttr?.current_temperature : parseFloat(p.s);
        return { t: (p.lu ?? p.lc) * 1000, v: Number(v) };
      }).filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));
    },
  };
}
