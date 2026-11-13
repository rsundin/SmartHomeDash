// <smarthomedash-card>: a SmartHomeDash dashboard as a card in any Home Assistant
// dashboard. The integration adds this file to every dashboard by itself.
//
//   type: custom:smarthomedash-card
//   site: home            # the dashboard's folder, as in its sidebar panel
//   view: overview        # overview | plan:<floor plan id> | room:<room id>
//   height: 400           # px; leave out in a sections view, where the grid sets it
//
// The dashboard itself runs in a frame (card.html, card-frame.js): the same code as the
// sidebar panel, in a document of its own, so its page-wide CSS, fonts and listeners
// never touch Home Assistant's. This element only sizes the frame and hands it `hass`.

const BASE = new URL('.', import.meta.url).href;
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';
const API = '/api/smarthomedash/sites';
const TYPE = 'smarthomedash-card';
const PANEL_ELEMENT = 'smarthomedash-panel';
const SITE_ID = /^[a-z0-9_-]+$/i;
const VIEW = /^(overview|(plan|room):[\w:.-]+)$/;
const DEFAULT_HEIGHT = 400;
const versioned = (file) => `${BASE}${file}${VERSION ? `?v=${encodeURIComponent(VERSION)}` : ''}`;

// ---- texts: the same files as the dashboard (frontend/i18n/), Swedish or English
const strings = {};
let lang = 'en';
const t = (key, vars) => {
  let s = strings[lang]?.[key] ?? strings.en?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  return s;
};
const loading = {};
function loadTexts(language) {
  const code = String(language || '').toLowerCase().startsWith('sv') ? 'sv' : 'en';
  lang = code;
  const get = (c) => (loading[c] ??= fetch(versioned(`i18n/${c}.json`))
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { strings[c] = j; })
    .catch(() => { delete loading[c]; }));
  return Promise.all([get('en'), get(code)]);
}

const node = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'style') n.style.cssText = v; else if (v != null) n.setAttribute(k, v); }
  n.append(...kids.filter((k) => k != null));
  return n;
};

// ---- the dashboards on this Home Assistant, and what each one holds
// Every dashboard has a sidebar panel; `hass.panels` lists the ones this user may open.
function dashboards(hass) {
  return Object.values(hass?.panels ?? {})
    .filter((p) => p?.config?._panel_custom?.name === PANEL_ELEMENT && p.config.site)
    .map((p) => ({ site: p.config.site, title: p.title || p.config.site }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// site.json per dashboard, fetched once: the editor lists its views, and the card
// picker's suggestions need to know which room an entity is in.
const sites = new Map(); // site id → site.json, or null while loading or when unreadable
const sitesLoading = new Map();
function loadSite(hass, site) {
  if (!SITE_ID.test(site ?? '') || !hass?.fetchWithAuth) return Promise.resolve(null);
  if (!sitesLoading.has(site)) {
    sitesLoading.set(site, hass.fetchWithAuth(`${API}/${site}/site.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { sites.set(site, json && typeof json === 'object' ? json : null); return sites.get(site); })
      .catch(() => { sitesLoading.delete(site); return null; }));
  }
  return sitesLoading.get(site);
}

// The views a card can show: [value, label].
function viewOptions(config) {
  const out = [];
  const plans = Array.isArray(config?.floorplans) ? config.floorplans.filter((p) => p && p.id) : [];
  if (config?.overview?.image) out.push(['overview', t('card.view.overview')]);
  for (const p of plans) out.push([`plan:${p.id}`, t('card.view.plan', { name: p.name ?? p.id })]);
  for (const p of plans) {
    for (const r of Array.isArray(p.rooms) ? p.rooms : []) {
      if (r && r.id) out.push([`room:${r.id}`, t('card.view.room', { name: r.name ?? r.id, plan: p.name ?? p.id })]);
    }
  }
  return out;
}

class SmartHomeDashCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._ready = false;
  }

  static getConfigElement() {
    return document.createElement(`${TYPE}-editor`);
  }

  // What a new card starts with: the first dashboard, on its start view.
  static getStubConfig(hass) {
    return { site: dashboards(hass)[0]?.site ?? '' };
  }

  setConfig(config) {
    if (config?.site != null && config.site !== '' && !SITE_ID.test(String(config.site))) throw new Error('site: letters, digits, _ and - only');
    if (config?.view != null && !VIEW.test(String(config.view))) throw new Error('view: overview, plan:<id> or room:<id>');
    const height = Number(config?.height);
    this._config = {
      site: config?.site ? String(config.site) : '',
      view: config?.view ? String(config.view) : 'overview',
      height: Number.isFinite(height) && height > 0 ? Math.min(2000, Math.max(120, Math.round(height))) : null,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._texts) this._texts = loadTexts(hass?.language).then(() => this._label());
    this._push();
  }

  // Masonry views count in units of about 50 px.
  getCardSize() {
    return Math.ceil((this._config?.height ?? DEFAULT_HEIGHT) / 50);
  }

  // Sections views: full width, six rows to start with; the user can resize it.
  getGridOptions() {
    return { columns: 'full', rows: 6, min_columns: 6, min_rows: 4 };
  }

  connectedCallback() {
    // In a sections view the grid gives the card its height; elsewhere it has none of its own.
    this._inGrid = !!this.closest?.('hui-grid-section, hui-card.fit-rows') || this.parentElement?.classList?.contains('fit-rows');
    this._render();
  }

  _render() {
    if (!this._config || !this.isConnected) return;
    const { site, height } = this._config;
    const fixed = height ?? (this._inGrid ? null : DEFAULT_HEIGHT);
    const size = !site ? 'auto' : fixed ? `${fixed}px` : '100%';
    if (!this._card) {
      this._style = node('style');
      this._card = node('ha-card');
      this.shadowRoot.replaceChildren(this._style, this._card);
    }
    this._style.textContent = `
      :host { display: block; height: ${size}; min-height: ${site ? 160 : 0}px; }
      ha-card { display: block; height: 100%; overflow: hidden; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
      .note { padding: 16px; margin: 0; }`;
    if (!site) {
      this._note ??= node('p', { class: 'note' });
      if (this._note.parentNode !== this._card) this._card.replaceChildren(this._note);
    } else {
      if (!this._frame) {
        this._frame = node('iframe', { src: versioned('card.html'), title: 'SmartHomeDash' });
        // The frame says when it can take `hass`; again after Home Assistant moves the card.
        this._frame.addEventListener('shd-card-ready', () => { this._ready = true; this._push(); });
      }
      // Appending a frame that is already in place would load it again.
      if (this._frame.parentNode !== this._card) this._card.replaceChildren(this._frame);
    }
    this._label();
    this._push();
  }

  _label() {
    if (this._note) this._note.textContent = t('card.noSite');
    if (this._frame) this._frame.title = t('card.frameTitle', { site: this._config?.site ?? '' });
  }

  // Hand the frame the current `hass` and config. It restarts itself on a new site or view.
  _push() {
    if (!this._ready || !this._hass || !this._config?.site) return;
    try {
      this._frame?.contentWindow?.shdCard?.update(this._hass, { site: this._config.site, view: this._config.view });
    } catch (e) {
      console.error('SmartHomeDash card', e);
    }
  }
}

// The visual editor: which dashboard, which view, and a height outside sections views.
class SmartHomeDashCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (first) loadTexts(hass?.language).then(() => this._render());
    if (first) this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    const site = this._config.site ?? '';
    if (site && !sites.has(site)) loadSite(this._hass, site).then(() => this._render());
    const list = dashboards(this._hass);
    if (site && !list.some((d) => d.site === site)) list.push({ site, title: site });
    const views = viewOptions(sites.get(site));
    const view = this._config.view ?? 'overview';
    if (!views.some(([v]) => v === view)) views.unshift([view, view === 'overview' ? t('card.view.overview') : view]);
    const schema = [
      { name: 'site', required: true, selector: { select: { mode: 'dropdown', options: list.map((d) => ({ value: d.site, label: d.title })) } } },
      { name: 'view', selector: { select: { mode: 'dropdown', options: views.map(([value, label]) => ({ value, label })) } } },
      { name: 'height', selector: { number: { min: 120, max: 2000, step: 10, mode: 'box', unit_of_measurement: 'px' } } },
    ];
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.addEventListener('value-changed', (e) => this._changed(e));
      this.replaceChildren(this._form);
    }
    this._form.hass = this._hass;
    this._form.computeLabel = (s) => t(`card.editor.${s.name}`);
    this._form.computeHelper = (s) => (s.name === 'height' ? t('card.editor.heightHelp') : '');
    this._form.schema = schema;
    this._form.data = { site, view, ...(this._config.height ? { height: this._config.height } : {}) };
  }

  _changed(e) {
    e.stopPropagation();
    const value = e.detail?.value ?? {};
    const config = { ...this._config, site: value.site ?? '', view: value.view || 'overview' };
    // Another dashboard has other plans and rooms: back to its start view.
    if (config.site !== (this._config.site ?? '')) config.view = 'overview';
    if (config.view === 'overview') delete config.view;
    if (value.height) config.height = value.height; else delete config.height;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    this._render();
  }
}

if (!customElements.get(TYPE)) customElements.define(TYPE, SmartHomeDashCard);
if (!customElements.get(`${TYPE}-editor`)) customElements.define(`${TYPE}-editor`, SmartHomeDashCardEditor);

// ---- the card picker
// Home Assistant 2026.6 and newer suggest cards for an entity the user picks. A lamp or
// thermostat that is in a room of a dashboard gets that room on the picture as a suggestion.
// Which room that is comes from site.json, fetched in the background: the first question
// about a dashboard not read yet answers "nothing" and starts the fetch.
function suggest(hass, entityId) {
  if (!/^(light|climate)\./.test(entityId ?? '')) return null;
  const entry = hass?.entities?.[entityId];
  const area = entry?.area_id ?? hass?.devices?.[entry?.device_id]?.area_id ?? null;
  const out = [];
  for (const { site, title } of dashboards(hass)) {
    if (!sites.has(site)) { loadSite(hass, site); continue; }
    const config = sites.get(site);
    for (const plan of Array.isArray(config?.floorplans) ? config.floorplans : []) {
      for (const room of Array.isArray(plan?.rooms) ? plan.rooms : []) {
        if (!room?.id) continue;
        const placed = (Array.isArray(room.lights) ? room.lights : []).some((l) => (l?.entity ?? l) === entityId) || room.climate === entityId;
        if (!placed && !(area && room.ha_area === area)) continue;
        out.push({
          label: t('card.suggest', { room: room.name ?? room.id, dashboard: title }),
          config: { type: `custom:${TYPE}`, site, view: `room:${room.id}` },
        });
      }
    }
  }
  return out.length ? out : null;
}

const entry = {
  type: TYPE,
  name: 'SmartHomeDash',
  description: '', // set below, in the user's language
  preview: false,
  documentationURL: 'https://github.com/rsundin/SmartHomeDash/blob/main/docs/setup.md#the-card',
  getEntitySuggestion: suggest,
};
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === TYPE)) window.customCards.push(entry);
// The picker's description in the user's language, once the texts have arrived.
loadTexts(document.querySelector('home-assistant')?.hass?.language ?? navigator.language)
  .then(() => { entry.description = t('card.description'); });

export { suggest, viewOptions, dashboards };
