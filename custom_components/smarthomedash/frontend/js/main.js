// Entry point: picks the site, connects to HA (or test data), builds the views.
//
// Two ways to run:
// - Standalone page (index.html): site from ?site=<id> or <body data-default-site>,
//   data from a saved token, the browser's HA login, or test data (?mock forces it).
// - Home Assistant panel (panel.js): start(opts) with an adapter built on the
//   panel's `hass` object and a loader for the authenticated site files.

import { el, storage, wait, reducedMotion, press } from './util.js';
import { Store } from './store.js';
import { loadSite } from './site.js';
import { createHaAdapter, haLogin } from './adapters/ha.js';
import { createMockAdapter } from './adapters/mock.js';
import { createOverview } from './views/overview.js';
import { createFloorplan } from './views/floorplan.js';
import { createPanel } from './ui/panel.js';
import { createSide } from './ui/cards.js';
import { createSettings, connKey } from './ui/settings.js';
import { createEditor } from './ui/editor.js';
import { createSetup } from './ui/setup.js';
import { t, setLanguage } from './i18n.js';

const params = new URLSearchParams(location.search);

export function showFatal(app, e) {
  console.error(e);
  app.replaceChildren(el('div', { class: 'fatal' },
    el('p', { class: 'eyebrow' }, t('app.startFailed')), el('p', {}, e.message),
    el('p', { class: 'muted small' }, t('app.checkSiteJson'))));
}

if (!window.SHD_PANEL) {
  const app = document.getElementById('app');
  start({ root: app }).catch((e) => showFatal(app, e));
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root     element the dashboard renders into
 * @param {string} [opts.siteId]
 * @param {boolean} [opts.editing]   placement mode
 * @param {object} [opts.adapter]    data adapter; standalone picks one itself
 * @param {object} [opts.loader]     site file loader (panel: authenticated)
 * @param {Function} [opts.saveSite] saves the edited site config (panel: to HA)
 * @param {Function} [opts.reload]   restarts the dashboard after an edit
 * @param {Function} [opts.navigateEdit] (on) => switch placement mode on/off (panel, admins)
 * @param {Function} [opts.uploadFile] (name, blob) => upload a picture to the site (panel, admins)
 * @param {object} [opts.kiosk]       { wanted(), enter(withFullscreen), exit(), fullscreen(on) } (panel)
 */
export async function start(opts) {
  const app = opts.root;
  // A panel restart (after an edit) runs start() again: drop the previous run's listeners and timers.
  window.__shdRun?.abort();
  const run = new AbortController();
  window.__shdRun = run;
  document.querySelectorAll('.setup').forEach((n) => n.remove());
  const siteId = opts.siteId ?? (params.get('site') || document.body.dataset.defaultSite || 'example-apartment');
  const editing = opts.editing ?? location.hash === '#edit';
  const site = await loadSite(siteId, { useDraft: editing, loader: opts.loader });
  setLanguage(site.language);
  document.title = `${site.name} · SmartHomeDash`;

  // Connection, in order: a token saved under Anslutning, the Home Assistant login of
  // this browser (when served from HA), otherwise test data. ?mock forces test data.
  // The setup guide needs to save the config and upload pictures (panel, admins).
  const canSetup = !!(opts.saveSite && opts.uploadFile && opts.navigateEdit);
  let source, adapter;
  if (opts.adapter) {
    source = 'panel';
    adapter = opts.adapter;
  } else {
    const savedConn = storage.get(connKey(site.id));
    const browserLogin = haLogin();
    source = params.has('mock') ? 'mock' : savedConn?.token ? 'token' : browserLogin ? 'login' : 'mock';
    const conn = { token: savedConn, login: browserLogin }[source] ?? null;
    adapter = conn ? createHaAdapter(conn) : createMockAdapter(site);
  }
  const store = new Store();

  // ---- header
  const status = el('span', { class: 'pill', role: 'status' });
  const setStatus = (s, detail) => {
    const text = t(`status.${s}`);
    status.textContent = text;
    status.dataset.state = s;
    status.title = detail || '';
  };
  const viewNav = el('nav', { class: 'views', 'aria-label': t('app.views') });
  const nightBtn = el('button', { class: 'chip', type: 'button', title: t('app.nightTitle') });
  const settings = createSettings({ site, source });
  const clock = el('time', { class: 'clock' });
  const tickClock = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString(site.locale, { hour: '2-digit', minute: '2-digit' });
    clock.dateTime = d.toISOString();
  };
  tickClock();
  const clockTimer = setInterval(tickClock, 15000);
  run.signal.addEventListener('abort', () => clearInterval(clockTimer));
  // Kiosk mode: only this dashboard on a wall screen or tablet. Hides the dashboard's own
  // buttons (and, in the panel, Home Assistant's sidebar) and goes full screen.
  // Hold the clock for two seconds to leave it.
  const kiosk = opts.kiosk ?? standaloneKiosk();
  const kioskBtn = el('button', { class: 'chip', type: 'button', onclick: () => setKiosk(true, true) }, t('app.kiosk'));
  function setKiosk(on, gesture) {
    document.body.classList.toggle('is-kiosk', on);
    if (on) {
      kiosk.enter(gesture);
      toast(t('app.kioskHint'));
    } else {
      kiosk.exit();
    }
  }
  press(clock, null, () => { if (document.body.classList.contains('is-kiosk')) setKiosk(false); }, 2000);
  const header = el('header', { class: 'top' },
    el('div', { class: 'brand' }, el('p', { class: 'eyebrow' }, 'SmartHomeDash'), el('h1', {}, site.name)),
    viewNav,
    el('div', { class: 'top-actions' }, clock, source === 'panel' ? null : status, site.overview || site.floorplans.length ? nightBtn : null, editing ? null : kioskBtn,
      opts.navigateEdit && !editing ? el('button', { class: 'chip', type: 'button', onclick: () => opts.navigateEdit(true) }, t('app.edit')) : null,
      canSetup && !editing ? el('button', { class: 'chip', type: 'button', onclick: () => openSetup() }, t('app.setup')) : null,
      source === 'panel' ? null : el('button', { class: 'chip', type: 'button', onclick: () => settings.open() }, t('app.connection'))));
  keepAwake();

  // ---- stage
  const stage = el('div', { class: 'stage' });
  const backBtn = el('button', { class: 'back chip', type: 'button', hidden: true, onclick: () => showOverview() }, t('app.backRoof'));
  const hint = el('p', { class: 'stage-hint' }, site.overview
    ? t('app.hintOverview')
    : t('app.hintPlan'));
  const stageWrap = el('div', { class: 'stage-wrap' }, stage, backBtn, hint);
  if (!site.overview) stage.classList.add('no-ov');
  const panel = createPanel({ site, store, adapter });
  const side = el('div');
  const main = el('main', { class: 'layout' }, stageWrap, side);
  app.replaceChildren(header, main, panel.el, settings.el);

  // Make test data impossible to mistake for the real house.
  if (adapter.kind === 'mock' && !params.has('mock')) {
    app.prepend(el('div', { class: 'banner banner-mock' },
      el('span', {}, t('app.mockBanner')),
      el('button', { class: 'chip chip-primary', type: 'button', onclick: () => settings.open() }, t('app.connectNow'))));
  }

  setStatus('connecting');
  try {
    await adapter.connect(store, setStatus);
  } catch (e) {
    setStatus('error', e.message);
    app.prepend(el('div', { class: 'banner' },
      t('app.connectFailed', { msg: e.message }),
      el('a', { href: '?mock' + (params.get('site') ? `&site=${site.id}` : '') }, t('app.showTestData'))));
  }

  // ---- views
  let view = null;
  const plans = new Map();
  const editor = editing ? createEditor({ site, store, saveSite: opts.saveSite, reload: opts.reload, exit: opts.navigateEdit ? () => opts.navigateEdit(false) : null, update: opts.updateDashboard, reloadPage: opts.reloadPage }) : null;

  // Rooms open on their floor plan; a device without a plan (heat pump) opens its panel directly.
  const openRoom = (room) => { if (room.plan) showPlan(room.plan, room.id); else panel.open(room); };
  const overview = site.overview
    ? createOverview({ site, store, adapter, onOpenBuilding: (b) => showPlan(b.floorplan) })
    : null;
  if (overview) { stage.append(overview.el); editor?.attach(overview.svg, { label: t('app.editorOverview') }); }

  // Wall screen / tablet in landscape: the image fills the stage instead of letterboxing.
  const wallScreen = window.matchMedia('(min-width: 1024px) and (orientation: landscape) and (min-height: 560px)');
  const applyFit = () => overview?.setFit(wallScreen.matches && !editor ? 'slice' : 'meet');
  wallScreen.addEventListener?.('change', applyFit);
  applyFit();

  for (const plan of site.floorplans) {
    const fp = createFloorplan({ site, plan, store, adapter, onRoom: (room) => { panel.open(room); fp.select(room.id); } });
    plans.set(plan.id, fp);
    stage.append(fp.el);
    editor?.attach(fp.svg, { label: t('app.editorPlan', { name: plan.name, unit: plan.unit || 'mm' }), round: plan.unit === 'px' ? 1 : 10, plan });
  }
  panel.el.addEventListener('close', () => plans.forEach((p) => p.select(null)));
  side.replaceWith(createSide({ site, store, adapter, openRoom }));
  if (editor) {
    document.querySelectorAll('.editor').forEach((n) => n.remove());
    document.body.append(editor.el);
    document.body.classList.add('is-editing');
  }

  // nav buttons
  const navBtns = [];
  if (overview) navBtns.push(['overview', t('app.overview'), () => showOverview()]);
  for (const plan of site.floorplans) navBtns.push([`plan:${plan.id}`, plan.name, () => showPlan(plan.id)]);
  if (navBtns.length > 1) {
    viewNav.replaceChildren(...navBtns.map(([id, label, fn]) =>
      el('button', { class: 'tab', type: 'button', 'data-view': id, onclick: fn }, label)));
  }

  function mark(id) {
    view = id;
    viewNav.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === id)));
    stage.dataset.view = id;
  }

  function showOverview() {
    if (!overview) return;
    panel.close();
    plans.forEach((p) => p.el.classList.remove('is-active'));
    overview.el.classList.add('is-active');
    overview.drop();
    backBtn.hidden = true;
    hint.textContent = t('app.hintOverview');
    mark('overview');
  }

  async function showPlan(planId, roomId) {
    const fp = plans.get(planId);
    if (!fp) return;
    if (view !== `plan:${planId}`) {
      const b = site.overview?.buildings.find((x) => x.floorplan === planId);
      if (view === 'overview' && b && !reducedMotion()) {
        overview.lift(b.id);
        await wait(520);
      }
      plans.forEach((p) => p.el.classList.toggle('is-active', p === fp));
      overview?.el.classList.remove('is-active');
      backBtn.hidden = !overview;
      hint.textContent = t('app.hintPlan');
      mark(`plan:${planId}`);
    }
    if (roomId) { const room = site.index.rooms.get(roomId); panel.open(room); fp.select(roomId); }
  }

  // ---- day / night on the overview
  const NIGHT_KEY = `shd:${site.id}:night`;
  let nightMode = storage.get(NIGHT_KEY, 'auto');
  // Evening dims the pictures, overview and floor plans alike, so the lights stand out.
  const applyNight = () => {
    const auto = store.get('sun.sun')?.state === 'below_horizon';
    const night = nightMode === 'auto' ? auto : nightMode === 'night';
    overview?.setNight(night);
    stage.classList.toggle('is-night', night);
    adapter.setDemoMode?.(nightMode);
    nightBtn.textContent = { auto: t('app.nightAuto', { state: t(auto ? 'app.nightAutoNight' : 'app.nightAutoDay') }), day: t('app.day'), night: t('app.night') }[nightMode];
  };
  nightBtn.addEventListener('click', () => {
    nightMode = { auto: 'night', night: 'day', day: 'auto' }[nightMode];
    storage.set(NIGHT_KEY, nightMode);
    applyNight();
  });
  store.watch(['sun.sun'], applyNight);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!settings.el.hidden) settings.el.hidden = true;
    else if (panel.room) panel.close();
    else if (view !== 'overview' && overview) showOverview();
  }, { signal: run.signal });

  function openSetup() {
    document.querySelectorAll('.setup').forEach((n) => n.remove());
    const setup = createSetup({
      site, store, saveSite: opts.saveSite, uploadFile: opts.uploadFile, reload: opts.reload,
      openPlacement: () => opts.navigateEdit(true),
    });
    document.body.append(setup.el);
  }

  // A new site has no pictures yet: say so, and offer the setup guide to admins.
  const empty = !overview && !site.floorplans.length;
  if (empty) {
    stage.classList.add('is-empty');
    stage.append(el('div', { class: 'empty-state' },
      el('p', { class: 'eyebrow' }, t('app.emptyTitle')),
      el('p', {}, t(canSetup ? 'app.emptyAdmin' : 'app.emptyUser')),
      canSetup ? el('button', { class: 'chip chip-primary', type: 'button', onclick: () => openSetup() }, t('app.startSetup')) : null));
    hint.hidden = true;
  }
  // New dashboards (and empty ones) open the setup guide for admins on first visit.
  if (canSetup && !editing && (empty || site.raw.setup_pending)) openSetup();

  const resume = editor?.initialView;
  if (resume?.startsWith('plan:') && plans.has(resume.slice(5))) { if (overview) showOverview(); await showPlan(resume.slice(5)); }
  else if (overview) showOverview();
  else showPlan(site.floorplans[0]?.id);

  // Start in kiosk mode from ?kiosk or when this device was left in it. Full screen
  // needs a tap, so it follows on the first touch.
  if (!editing && kiosk.wanted()) {
    setKiosk(true, false);
    document.addEventListener('pointerdown', () => kiosk.fullscreen(true), { once: true, signal: run.signal });
  }
}

// Wall screens and tablets: keep the screen on while the page is visible.
function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  const request = async () => {
    if (document.visibilityState !== 'visible' || lock) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch { /* refused: battery saver, unsupported browser, or no user gesture yet */ }
  };
  request();
  document.addEventListener('visibilitychange', request);
  document.addEventListener('pointerdown', request, { once: true });
}

function fullscreen(doc, on) {
  try {
    const root = doc.documentElement;
    if (on && !doc.fullscreenElement) (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root)?.catch?.(() => {});
    if (!on && doc.fullscreenElement) doc.exitFullscreen?.()?.catch?.(() => {});
  } catch { /* not allowed here */ }
}

// Standalone page: kiosk mode is full screen plus the hidden buttons, remembered per browser.
function standaloneKiosk() {
  const KEY = 'shd:kiosk';
  return {
    wanted: () => params.has('kiosk') || storage.get(KEY) === true,
    enter(gesture) { storage.set(KEY, true); if (gesture) fullscreen(document, true); },
    exit() { storage.set(KEY, null); fullscreen(document, false); },
    fullscreen: (on) => fullscreen(document, on),
  };
}

function toast(text) {
  const n = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(n);
  setTimeout(() => n.classList.add('is-gone'), 3500);
  setTimeout(() => n.remove(), 4200);
}
