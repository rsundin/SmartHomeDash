// Entry point: picks the site, connects to HA (or test data), builds the views.
//
// Two ways to run:
// - Standalone page (index.html): site from ?site=<id> or <body data-default-site>,
//   data from a saved token, the browser's HA login, or test data (?mock forces it).
// - Home Assistant panel (panel.js): start(opts) with an adapter built on the
//   panel's `hass` object and a loader for the authenticated site files.

import { el, storage, wait, reducedMotion, press, paused, syncPause } from './util.js';
import { Store } from './store.js';
import { loadSite, missingFilterKey } from './site.js';
import { createHaAdapter, haLogin } from './adapters/ha.js';
import { createMockAdapter } from './adapters/mock.js';
import { createOverview } from './views/overview.js';
import { createFloorplan } from './views/floorplan.js';
import { createPanel } from './ui/panel.js';
import { createSide } from './ui/cards.js';
import { createSettings, connKey } from './ui/settings.js';
import { createEditor } from './ui/editor.js';
import { createSetup } from './ui/setup.js';
import { createZoom } from './ui/zoom.js';
import { createWall, liteMode } from './ui/wall.js';
import { createReport } from './ui/report.js';
import { loadAreas, applyAreaNames, noAreas, linkByName, autoPlace } from './areas.js';
import { assignSensors, warnings, warningIds, configEntities } from './status.js';
import { nameOf as entityName } from './entities.js';

// The online demo sets data-demo on <body> (see .github/workflows/pages.yml).
const DEMO = document.body?.dataset.demo === 'true';
const REPO_URL = 'https://github.com/rsundin/SmartHomeDash';
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
  // Leftovers of the previous run: the setup guide, and placement mode's panel and page
  // state, which otherwise stayed on screen after leaving placement mode in a panel.
  document.querySelectorAll('.setup, .editor').forEach((n) => n.remove());
  document.body.classList.remove('is-editing');
  const siteId = opts.siteId ?? (params.get('site') || document.body.dataset.defaultSite || 'example-apartment');
  const editing = opts.editing ?? location.hash === '#edit';
  const site = await loadSite(siteId, { useDraft: editing, loader: opts.loader });
  setLanguage(site.language);
  // Light mode for older tablets: no blur, blending or animation (see ui/wall.js).
  document.body.classList.toggle('is-lite', liteMode(site));
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
    source = params.has('mock') || DEMO ? 'mock' : savedConn?.token ? 'token' : browserLogin ? 'login' : 'mock';
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
  // Report a problem: a prefilled GitHub issue, read before it leaves (ui/report.js).
  const report = createReport({ site, store, adapter, source });
  const helpBtn = el('button', { class: 'chip chip-help', type: 'button', title: t('report.button'), 'aria-label': t('report.button'), onclick: () => report.open() }, '?');
  const clock = el('time', { class: 'clock' });
  const tickClock = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString(site.locale, { hour: '2-digit', minute: '2-digit' });
    clock.dateTime = d.toISOString();
  };
  tickClock();
  // The clock rests with the page (hidden, or under the night dim) and catches up after.
  const clockTimer = setInterval(() => { if (!paused()) tickClock(); }, 15000);
  run.signal.addEventListener('abort', () => clearInterval(clockTimer));
  document.addEventListener('shd:resume', tickClock, { signal: run.signal });
  document.addEventListener('visibilitychange', syncPause, { signal: run.signal });
  // Kiosk mode: only this dashboard on a wall screen or tablet. Hides the dashboard's own
  // buttons (and, in the panel, Home Assistant's sidebar) and goes full screen.
  // Hold the clock for two seconds to leave it.
  const kiosk = opts.kiosk ?? standaloneKiosk();
  let wall = null; // set up further down, once the views exist
  // The kiosk button opens the wall screen sheet: kiosk mode, light mode, test the doorbell.
  const kioskBtn = el('button', { class: 'chip', type: 'button', onclick: () => (wall ? wall.open() : setKiosk(true, true)) }, t('app.kiosk'));
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
      source === 'panel' || DEMO ? null : el('button', { class: 'chip', type: 'button', onclick: () => settings.open() }, t('app.connection')),
      helpBtn));
  keepAwake();

  // ---- stage
  const stage = el('div', { class: 'stage' });
  const zoom = createZoom(stage);
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const withZoomHint = (text) => (touch ? `${text} ${t('app.hintZoom')}` : text);
  const backBtn = el('button', { class: 'back chip', type: 'button', hidden: true, onclick: () => showOverview() }, t('app.backRoof'));
  const hint = el('p', { class: 'stage-hint' }, withZoomHint(site.overview
    ? t('app.hintOverview')
    : t('app.hintPlan')));
  const stageWrap = el('div', { class: 'stage-wrap' }, stage, backBtn, hint);
  if (!site.overview) stage.classList.add('no-ov');
  const panel = createPanel({ site, store, adapter });
  const side = el('div');
  const main = el('main', { class: 'layout' }, stageWrap, side);
  const alerts = el('div', { class: 'alerts', hidden: true, role: 'status', 'aria-live': 'polite' });
  app.replaceChildren(header, alerts, main, panel.el, settings.el, report.el);

  // The online demo (GitHub Pages): say what it is and where to get it.
  if (DEMO) {
    const other = site.overview ? ['example-apartment', t('app.demoApartment')] : ['example-house', t('app.demoHouse')];
    app.prepend(el('div', { class: 'banner banner-demo' },
      el('span', {}, t('app.demoBanner')),
      el('a', { class: 'chip', href: `?site=${other[0]}` }, other[1]),
      el('a', { class: 'chip chip-primary', href: REPO_URL, target: '_blank', rel: 'noopener' }, t('app.demoGet'))));
  // Make test data impossible to mistake for the real house.
  } else if (adapter.kind === 'mock' && !params.has('mock')) {
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
  // Home Assistant areas: room names follow the area they are linked to.
  site.areas = store.all().length ? await loadAreas(adapter) : noAreas();
  // Rooms named like an area count as linked; what is in a linked room's area in Home
  // Assistant but not placed yet shows up in that room by itself.
  linkByName(site, site.areas);
  applyAreaNames(site, site.areas);
  site.autoPlaced = new Set(autoPlace(site, site.areas, store));
  // Doors, windows, locks, presence and alarms per room, from the room's area and site.json.
  assignSensors(site, store);

  // ---- views
  let view = null;
  const plans = new Map();
  const editor = editing ? createEditor({ site, store, saveSite: opts.saveSite, reload: opts.reload, exit: opts.navigateEdit ? () => opts.navigateEdit(false) : null, update: opts.updateDashboard, reloadPage: opts.reloadPage }) : null;

  // Rooms open on their floor plan; a device without a plan (heat pump) opens its panel directly.
  const openRoom = (room) => { if (room.plan) showPlan(room.plan, room.id); else panel.open(room); };
  const overview = site.overview
    ? createOverview({ site, store, adapter, onOpenBuilding: (b) => (b.floorplan ? showPlan(b.floorplan) : panel.open(site.index.rooms.get(`building:${b.id}`))) })
    : null;
  if (overview) { zoom.layer.append(overview.el); editor?.attach(overview.svg, { label: t('app.editorOverview') }); }

  // Wall screen / tablet in landscape: the image fills the stage instead of letterboxing.
  const wallScreen = window.matchMedia('(min-width: 1024px) and (orientation: landscape) and (min-height: 560px)');
  const applyFit = () => overview?.setFit(wallScreen.matches && !editor ? 'slice' : 'meet');
  wallScreen.addEventListener?.('change', applyFit);
  applyFit();

  // Floor plans are built when first shown, so a big home starts with a small page.
  // Placement mode builds them all: it looks for items across every plan.
  const planById = new Map(site.floorplans.map((p) => [p.id, p]));
  const buildPlan = (planId) => {
    if (plans.has(planId)) return plans.get(planId);
    const plan = planById.get(planId);
    if (!plan) return null;
    const fp = createFloorplan({ site, plan, store, adapter, onRoom: (room) => { panel.open(room); fp.select(room.id); } });
    plans.set(plan.id, fp);
    zoom.layer.append(fp.el);
    editor?.attach(fp.svg, { label: t('app.editorPlan', { name: plan.name, unit: plan.unit || 'mm' }), round: plan.unit === 'px' ? 1 : 10, plan });
    return fp;
  };
  if (editor) site.floorplans.forEach((p) => buildPlan(p.id));
  panel.el.addEventListener('close', () => plans.forEach((p) => p.select(null)));
  side.replaceWith(createSide({ site, store, adapter, openRoom }));

  // ---- warnings: alarms and open windows open their room; the rest unfold a list
  const nameOf = (id) => entityName(id, { store, site }, site.index.names.get(id) ?? id);
  // Rebuilt only when the warnings themselves change, not on every lamp or temperature.
  let shownWarnings = null;
  // "Show in placement mode" under the missing devices: placement mode opens with only them listed.
  const openEdit = opts.navigateEdit ? () => opts.navigateEdit(true)
    : source === 'panel' ? null : () => { location.hash = 'edit'; location.reload(); };
  const actions = {
    missing: openEdit && !editing ? el('button', { class: 'chip alert-action', type: 'button', onclick: () => { storage.set(missingFilterKey(site.id), true); openEdit(); } }, t('warn.missingShow')) : null,
  };
  store.watch([...warningIds(site), ...configEntities(site.raw).map((e) => e.id)], () => {
    const list = warnings(site, store, nameOf);
    const key = JSON.stringify(list.map((w) => [w.level, w.text, w.items]));
    if (key === shownWarnings) return;
    shownWarnings = key;
    const unfolded = new Set([...alerts.querySelectorAll('details[open]')].map((d) => d.dataset.key));
    alerts.hidden = !list.length;
    alerts.replaceChildren(...list.map((w) => (w.items
      ? el('details', { class: 'alert', 'data-level': w.level, 'data-key': w.key, open: unfolded.has(w.key) },
        el('summary', {}, w.text),
        el('ul', {}, w.items.map((i) => el('li', {}, i))),
        actions[w.action] ?? null)
      : el('button', { class: 'alert', type: 'button', 'data-level': w.level, onclick: () => w.room && openRoom(w.room) }, w.text))));
  });
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
    zoom.reset();
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
    hint.textContent = withZoomHint(t('app.hintOverview'));
    mark('overview');
  }

  async function showPlan(planId, roomId) {
    if (!planById.has(planId)) return;
    if (view !== `plan:${planId}`) {
      const b = site.overview?.buildings.find((x) => x.floorplan === planId);
      if (view === 'overview' && b && !reducedMotion()) {
        overview.lift(b.id);
        await wait(520);
      }
      const fp = buildPlan(planId);
      // A plan built just now starts hidden, so it fades in like the others.
      if (!fp.el.classList.contains('is-active')) void fp.el.offsetWidth;
      plans.forEach((p) => p.el.classList.toggle('is-active', p === fp));
      overview?.el.classList.remove('is-active');
      backBtn.hidden = !overview;
      hint.textContent = withZoomHint(t('app.hintPlan'));
      mark(`plan:${planId}`);
    }
    if (roomId) { const room = site.index.rooms.get(roomId); panel.open(room); plans.get(planId)?.select(roomId); }
  }

  // ---- day / night on the overview
  const NIGHT_KEY = `shd:${site.id}:night`;
  let nightMode = storage.get(NIGHT_KEY, 'auto');
  // Evening dims the pictures, overview and floor plans alike, so the lights stand out.
  // Auto follows the sun: the day picture fades into the evening one from 3° above the
  // horizon to 6° below it (civil twilight), instead of switching at sunset.
  const duskLevel = () => {
    const sun = store.get('sun.sun');
    const elev = Number(sun?.attributes?.elevation);
    if (!Number.isFinite(elev)) return sun?.state === 'below_horizon' ? 1 : 0;
    return Math.min(1, Math.max(0, (3 - elev) / 9));
  };
  const applyNight = () => {
    const level = nightMode === 'auto' ? duskLevel() : nightMode === 'night' ? 1 : 0;
    const auto = duskLevel() >= 0.5;
    const night = level >= 0.5;
    overview?.setDusk(level);
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
  if (site.weather) store.watch([site.weather], () => overview?.setWeather(store.get(site.weather)?.state));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!settings.el.hidden) settings.el.hidden = true;
    else if (!report.el.hidden) report.close();
    else if (panel.room) panel.close();
    else if (view !== 'overview' && overview) showOverview();
  }, { signal: run.signal });

  function openSetup() {
    document.querySelectorAll('.setup').forEach((n) => n.remove());
    const setup = createSetup({
      site, store, saveSite: opts.saveSite, uploadFile: opts.uploadFile, reload: opts.reload,
      openPlacement: () => opts.navigateEdit(true),
      openReport: () => report.open(),
      onClose: () => storage.set(SETUP_LATER, true),
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
  // A new dashboard opens the guide by itself, until it is saved once or closed in this browser.
  const SETUP_LATER = `shd:${site.id}:setupLater`;
  if (canSetup && !editing && (empty || (site.raw.setup_pending && !storage.get(SETUP_LATER, false)))) openSetup();

  const resume = editor?.initialView;
  if (resume?.startsWith('plan:') && planById.has(resume.slice(5))) { if (overview) showOverview(); await showPlan(resume.slice(5)); }
  else if (overview) showOverview();
  else showPlan(site.floorplans[0]?.id);

  // Wall screens: the doorbell camera, and back to the start view (dimmed at night) when idle.
  const home = () => {
    settings.el.hidden = true;
    report.close();
    panel.close();
    if (overview) showOverview(); else if (site.floorplans[0]) showPlan(site.floorplans[0].id);
    zoom.reset();
  };
  wall = editing ? null : createWall({ site, store, adapter, goHome: home, kiosk: () => document.body.classList.contains('is-kiosk'), enterKiosk: () => setKiosk(true, true), signal: run.signal });
  // Test data: ?ring rings the first doorbell a moment after start.
  const bell = [].concat(site.wall_screen?.doorbell ?? [])[0];
  if (wall && adapter.kind === 'mock' && params.has('ring') && bell?.entity) {
    setTimeout(() => { const s = store.get(bell.entity); if (s) store.update({ ...s, state: bell.entity.startsWith('binary_sensor.') ? 'on' : new Date().toISOString() }); }, 1500);
  }

  syncPause();

  // The first frame after the dashboard is built: the performance test's "first render".
  requestAnimationFrame(() => performance.mark?.('shd:rendered'));

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
