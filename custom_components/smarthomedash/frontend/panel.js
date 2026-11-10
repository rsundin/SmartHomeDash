// Home Assistant panel entry point.
//
// Registered by the smarthomedash integration with panel_custom and embed_iframe,
// so this runs in its own document inside Home Assistant: the dashboard's page CSS
// and document-level code work unchanged. Home Assistant sets `hass` (logged in as
// the current user), `panel` (our config) and `route` on the element.

const BASE = new URL('.', import.meta.url).href;
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';
const API = '/api/smarthomedash/sites';

// Kiosk mode in Home Assistant: hide HA's sidebar on this device (the same setting as
// HA's own "hide sidebar", stored per browser) and put the whole window in full screen.
const KIOSK_KEY = 'shd:kiosk';
const DOCK_KEY = 'shd:dockBeforeKiosk';
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
};
// The reason a save was refused: the server's message ("site.json was not saved: …"), or the status.
async function failure(res) {
  const text = await res.text().catch(() => '');
  try { const msg = JSON.parse(text).message; if (typeof msg === 'string' && msg) return msg; } catch { /* not JSON */ }
  return `${res.status} ${text}`.trim();
}

function haKiosk() {
  const top = window.parent;
  const root = () => top.document.querySelector('home-assistant');
  const setDock = (dock) => root()?.dispatchEvent(new CustomEvent('hass-dock-sidebar', { detail: { dock }, bubbles: true, composed: true }));
  const currentDock = () => ls.get('dockedSidebar') || 'docked';
  const fullscreen = (on) => {
    try {
      const doc = top.document, el = doc.documentElement;
      if (on && !doc.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
      if (!on && doc.fullscreenElement) doc.exitFullscreen?.()?.catch?.(() => {});
    } catch { /* not allowed here */ }
  };
  return {
    wanted: () => new URLSearchParams(top.location.search).has('kiosk') || ls.get(KIOSK_KEY) === true,
    enter(gesture) {
      if (currentDock() !== 'always_hidden') ls.set(DOCK_KEY, currentDock());
      setDock('always_hidden');
      ls.set(KIOSK_KEY, true);
      if (gesture) fullscreen(true);
    },
    exit() {
      setDock(ls.get(DOCK_KEY) || 'docked');
      ls.set(KIOSK_KEY, null);
      fullscreen(false);
      const url = new URL(top.location.href);
      if (url.searchParams.has('kiosk')) { url.searchParams.delete('kiosk'); top.history.replaceState(top.history.state, '', url); }
    },
    fullscreen,
  };
}

function addHead() {
  if (document.getElementById('shd-css')) return;
  const q = VERSION ? `?v=${encodeURIComponent(VERSION)}` : '';
  window.SHD_VERSION = VERSION;
  const css = document.createElement('link');
  css.id = 'shd-css';
  css.rel = 'stylesheet';
  css.href = `${BASE}css/style.css${q}`;
  const style = document.createElement('style');
  // The dashboard sizes itself to the screen; give it the full height of the panel.
  style.textContent = 'html, body { height: 100%; } smarthomedash-panel { display: block; height: 100%; }';
  document.head.append(css, style);
}

class SmartHomeDashPanel extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._adapter) this._adapter.setHass(hass);
    else this._maybeBoot();
  }

  set panel(panel) {
    this._panel = panel;
    this._maybeBoot();
  }

  set route(route) {
    const editing = (route?.path || '').replace(/\/$/, '') === '/edit';
    const changed = this._editing !== undefined && editing !== this._editing;
    this._editing = editing;
    if (changed) this._boot();
  }

  _maybeBoot() {
    if (this._booted || !this._hass || !this._panel) return;
    this._booted = true;
    this._boot();
  }

  async _boot() {
    if (!this._hass || !this._panel) return;
    addHead();
    window.SHD_PANEL = true;
    const [{ start, showFatal }, { createHassAdapter }] = await Promise.all([
      import(`${BASE}js/main.js`),
      import(`${BASE}js/adapters/hass.js`),
    ]);
    const cfg = this._panel.config || {};
    const siteId = cfg.site;
    const urlPath = this._panel.url_path;
    const hass = this._hass;
    const root = document.createElement('div');
    root.id = 'app';
    this.replaceChildren(root);
    this._adapter = createHassAdapter(hass);

    // Navigate the Home Assistant window, the way HA's own links do.
    const navigateEdit = hass.user?.is_admin ? (on) => {
      const top = window.parent;
      top.history.pushState(null, '', `/${urlPath}${on ? '/edit' : ''}`);
      top.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } : null;

    try {
      await start({
        root,
        siteId,
        editing: !!this._editing && !!navigateEdit,
        adapter: this._adapter,
        loader: { get: (path) => this._hass.fetchWithAuth(`${API}/${siteId}/${path}`) },
        saveSite: async (raw) => {
          const res = await this._hass.fetchWithAuth(`${API}/${siteId}/site.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(raw, null, 2),
          });
          if (!res.ok) throw new Error(await failure(res));
        },
        reload: () => this._boot(),
        navigateEdit,
        kiosk: haKiosk(),
        uploadFile: hass.user?.is_admin ? async (name, blob) => {
          const res = await this._hass.fetchWithAuth(`${API}/${siteId}/${name}`, {
            method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
          });
          if (!res.ok) throw new Error(await failure(res));
        } : null,
        // Installs the latest version from GitHub (smarthomedash.update, admins only).
        // Only offered when the update action exists (a configured repository or token).
        updateDashboard: hass.user?.is_admin && hass.services?.smarthomedash?.update ? async () => {
          const res = await this._hass.callService('smarthomedash', 'update', {}, undefined, false, true);
          return res?.response ?? {};
        } : null,
        // New code needs a fresh page: modules already loaded in this frame stay cached.
        reloadPage: () => window.top.location.reload(),
      });
    } catch (e) {
      showFatal(root, e);
    }
  }
}

customElements.define('smarthomedash-panel', SmartHomeDashPanel);
