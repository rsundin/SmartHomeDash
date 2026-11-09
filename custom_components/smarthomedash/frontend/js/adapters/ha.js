// Home Assistant websocket adapter: reads states, follows changes, calls services.
// Docs: https://developers.home-assistant.io/docs/api/websocket

import { t } from '../i18n.js';

// `token` is a long-lived token string, or an async function returning a fresh access token
// (used when reusing the Home Assistant login of the same browser, see haLogin below).
export function createHaAdapter({ url, token }) {
  let ws = null;
  let nextId = 1;
  let store = null;
  let onStatus = () => {};
  let retry = 1000;
  const pending = new Map();

  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error(t('ha.notConnected'))); return; }
      msg.id = nextId++;
      pending.set(msg.id, { resolve, reject });
      ws.send(JSON.stringify(msg));
    });
  }

  function open(firstConnect) {
    return new Promise((resolve, reject) => {
      const base = (url || location.origin).replace(/\/$/, '');
      const wsUrl = base.replace(/^http/, 'ws') + '/api/websocket';
      onStatus('connecting');
      try { ws = new WebSocket(wsUrl); }
      catch (e) { onStatus('error', e.message); reject(e); return; }

      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'auth_required') {
          Promise.resolve(typeof token === 'function' ? token() : token)
            .then((access) => ws.send(JSON.stringify({ type: 'auth', access_token: access })))
            .catch((e) => { onStatus('auth_invalid', e.message); ws.onclose = null; ws.close(); reject(e); });
        } else if (m.type === 'auth_invalid') {
          onStatus('auth_invalid', m.message);
          ws.onclose = null;
          ws.close();
          reject(new Error(t('ha.badToken')));
        } else if (m.type === 'auth_ok') {
          retry = 1000;
          send({ type: 'get_states' })
            .then((states) => { store.replace(states); onStatus('connected'); resolve(); })
            .catch(reject);
          send({ type: 'subscribe_events', event_type: 'state_changed' }).catch(() => {});
        } else if (m.type === 'result') {
          const p = pending.get(m.id);
          if (p) { pending.delete(m.id); m.success ? p.resolve(m.result) : p.reject(new Error(m.error?.message || t('ha.error'))); }
        } else if (m.type === 'event') {
          const s = m.event?.data?.new_state;
          if (s) store.update(s);
        }
      };

      ws.onclose = () => {
        for (const p of pending.values()) p.reject(new Error(t('ha.closed')));
        pending.clear();
        onStatus('disconnected');
        if (firstConnect) reject(new Error(t('ha.unreachable', { url: wsUrl })));
        setTimeout(() => open(false).catch(() => {}), retry);
        retry = Math.min(retry * 2, 30000);
        firstConnect = false;
      };
    });
  }

  return {
    kind: 'ha',
    connect(s, statusFn) { store = s; onStatus = statusFn; return open(true); },

    call(domain, service, data) {
      return send({ type: 'call_service', domain, service, service_data: data });
    },

    async areas() {
      const [areas, entities, devices] = await Promise.all([
        send({ type: 'config/area_registry/list' }),
        send({ type: 'config/entity_registry/list' }),
        send({ type: 'config/device_registry/list' }),
      ]);
      return { areas, entities, devices };
    },

    // [{t: ms, v: number}] for the last `hours`. Climate entities use current_temperature.
    async history(entityId, hours = 24) {
      const isClimate = entityId.startsWith('climate.');
      const start = new Date(Date.now() - hours * 3600e3).toISOString();
      const res = await send({
        type: 'history/history_during_period',
        start_time: start,
        entity_ids: [entityId],
        minimal_response: !isClimate,
        no_attributes: !isClimate,
        significant_changes_only: false,
      });
      const rows = res?.[entityId] ?? [];
      let lastAttr = null;
      return rows.map((p) => {
        if (p.a) lastAttr = p.a;
        const v = isClimate ? lastAttr?.current_temperature : parseFloat(p.s);
        return { t: (p.lu ?? p.lc) * 1000, v: Number(v) };
      }).filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));
    },
  };
}

// When the dashboard is served by Home Assistant itself (/local/…), the browser
// already holds the HA frontend's login for this origin under "hassTokens".
// Reuse it, refreshing the short-lived access token when needed. Returns null
// when this browser is not logged in to Home Assistant on this address.
export function haLogin() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('hassTokens')); } catch { saved = null; }
  if (!saved?.refresh_token || !saved.hassUrl) return null;
  if (new URL(saved.hassUrl).origin !== location.origin) return null;
  return {
    url: saved.hassUrl,
    async token() {
      if (saved.access_token && saved.expires > Date.now() + 60e3) return saved.access_token;
      const res = await fetch(`${saved.hassUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.clientId }),
      });
      if (!res.ok) throw new Error(t('ha.loginExpired'));
      const fresh = await res.json();
      saved = { ...saved, access_token: fresh.access_token, expires_in: fresh.expires_in, expires: Date.now() + fresh.expires_in * 1000 };
      try { localStorage.setItem('hassTokens', JSON.stringify(saved)); } catch { /* storage unavailable */ }
      return saved.access_token;
    },
  };
}
